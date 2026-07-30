"""Task #8 — Stripe commerce service (TEST mode) for the redesigned Products
page cart + one-time checkout.

Talks to the live Stripe REST API over httpx (we intentionally DO NOT use the
`stripe` SDK). Base https://api.stripe.com/v1, header `Stripe-Version:
2023-10-16`, Bearer auth from env `STRIPE_TEST_SECRET_KEY` (falls back to
`STRIPE_SECRET_KEY` with a logged warning if the test key is missing).

All request bodies are form-encoded (application/x-www-form-urlencoded) with
nested params flattened per Stripe's convention (metadata[key],
automatic_payment_methods[enabled], etc.). Prices ALWAYS come from the Stripe
catalog server-side — clients never supply amounts.

This module is dev-only (the production surface is the Cloudflare Worker).
"""
from __future__ import annotations

import logging
import os
import re
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("studioos.stripe_commerce")

STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_VERSION = "2023-10-16"

# Relative Stripe API path: `/segment/segment?k=v` with a conservative charset.
# Blocks `..`, `//host`, `#`, CR/LF and anything else that could steer the
# request away from STRIPE_API_BASE.
_SAFE_PATH_RE = re.compile(r"/[A-Za-z0-9_/\-]*(\?[A-Za-z0-9_\-=&.%\[\]]*)?")


def _log_safe(value: str) -> str:
    """Strip CR/LF so untrusted values can never forge log lines."""
    return str(value).replace("\r", "").replace("\n", "")

# Audience categories surfaced on the Products page. Mirrors the contract's
# Audience enum: founders|investors_lps|service_partners|advisors|legal_services.
AUDIENCE_CATEGORIES: List[Dict[str, str]] = [
    {"value": "founders", "label": "Founders"},
    {"value": "investors_lps", "label": "Investors & LPs"},
    {"value": "service_partners", "label": "Service Partners"},
    {"value": "advisors", "label": "Advisors"},
    {"value": "legal_services", "label": "Legal Services"},
]

_UAE_VALUES = {"ae", "uae", "united arab emirates", "dubai"}

# Simple in-process catalog cache so repeat page loads don't hammer Stripe.
_CATALOG_CACHE: Dict[str, Any] = {"ts": 0.0, "data": None}
_CATALOG_TTL = 60.0  # seconds


class StripeError(Exception):
    """Raised when Stripe returns a non-2xx response."""

    def __init__(self, status_code: int, message: str, code: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


def _secret_key() -> str:
    key = os.environ.get("STRIPE_TEST_SECRET_KEY")
    if key:
        return key
    fallback = os.environ.get("STRIPE_SECRET_KEY")
    if fallback:
        logger.warning(
            "stripe_commerce: STRIPE_TEST_SECRET_KEY missing; falling back to "
            "STRIPE_SECRET_KEY (this may NOT be a test-mode key)"
        )
        return fallback
    raise StripeError(500, "Stripe secret key not configured", "no_key")


def publishable_key() -> str:
    return os.environ.get("STRIPE_TEST_PUBLISHABLE_KEY", "") or os.environ.get(
        "STRIPE_PUBLISHABLE_KEY", ""
    )


def webhook_secret() -> str:
    return os.environ.get("STRIPE_TEST_WEBHOOK_SECRET", "") or ""


def vat_rate(billing_country: Optional[str]) -> float:
    """5% for UAE-normalized country values; else 0%."""
    if not billing_country:
        return 0.0
    return 0.05 if billing_country.strip().lower() in _UAE_VALUES else 0.0


# ---------------------------------------------------------------------------
# Low-level form encoding + HTTP
# ---------------------------------------------------------------------------
def _flatten(prefix: str, value: Any, out: List[Tuple[str, str]]) -> None:
    """Flatten nested dict/list into Stripe's bracket form-encoding."""
    if isinstance(value, dict):
        for k, v in value.items():
            _flatten(f"{prefix}[{k}]" if prefix else str(k), v, out)
    elif isinstance(value, (list, tuple)):
        for i, v in enumerate(value):
            _flatten(f"{prefix}[{i}]", v, out)
    elif isinstance(value, bool):
        out.append((prefix, "true" if value else "false"))
    elif value is None:
        return
    else:
        out.append((prefix, str(value)))


def _encode(params: Dict[str, Any]) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for k, v in params.items():
        _flatten(k, v, out)
    return out


def _request(
    method: str,
    path: str,
    params: Optional[Dict[str, Any]] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {_secret_key()}",
        "Stripe-Version": STRIPE_VERSION,
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    # SSRF guard: `path` is always built in this module, but interpolated ids
    # can come from request payloads. Restrict to a safe relative API path so
    # a crafted id can never redirect the request (e.g. via `..`, `//host`,
    # `?`, `#`, or CR/LF) outside the pinned Stripe API base.
    if not _SAFE_PATH_RE.fullmatch(path):
        raise StripeError(400, f"Invalid Stripe API path: {path!r}", "invalid_path")
    url = f"{STRIPE_API_BASE}{path}"
    try:
        with httpx.Client(timeout=30.0) as client:
            if method == "GET":
                resp = client.get(url, headers=headers, params=_encode(params or {}))
            else:
                headers["Content-Type"] = "application/x-www-form-urlencoded"
                body = urllib.parse.urlencode(_encode(params or {})).encode()
                resp = client.request(
                    method, url, headers=headers, content=body
                )
    except httpx.HTTPError as exc:
        logger.exception("stripe_commerce: HTTP error %s %s", method, _log_safe(path))
        raise StripeError(502, f"Stripe request failed: {exc}", "network") from exc
    if resp.status_code >= 400:
        try:
            body = resp.json()
            err = body.get("error", {})
            msg = err.get("message", resp.text)
            code = err.get("code") or err.get("type")
        except Exception:  # noqa: BLE001
            msg, code = resp.text, None
        logger.warning("stripe_commerce: %s %s -> %s %s",
                       method, _log_safe(path), resp.status_code, _log_safe(str(msg)))
        raise StripeError(resp.status_code, msg, code)
    return resp.json()


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------
def _derive_kind(product_meta: Dict[str, Any], prices: List[Dict[str, Any]]) -> str:
    """Kind: subscription|incorporation|session|alacarte.
    Prefer metadata.kind; else recurring-price presence ⇒ subscription."""
    meta_kind = (product_meta.get("kind") or "").strip().lower()
    if meta_kind in ("subscription", "incorporation", "session", "alacarte"):
        return meta_kind
    if meta_kind:
        # Unknown metadata.kind — still respect it if provided but normalize
        # common synonyms.
        if meta_kind in ("recurring", "membership", "plan"):
            return "subscription"
        if meta_kind in ("incorporate", "formation"):
            return "incorporation"
    if any(p.get("type") == "recurring" for p in prices):
        return "subscription"
    return "alacarte"


def _price_shape(price: Dict[str, Any]) -> Dict[str, Any]:
    recurring = price.get("recurring") or None
    return {
        "id": price.get("id"),
        "currency": price.get("currency"),
        "unit_amount": price.get("unit_amount"),
        "interval": (recurring or {}).get("interval") if recurring else None,
        "interval_count": (recurring or {}).get("interval_count") if recurring else None,
        "nickname": price.get("nickname"),
        "type": "recurring" if recurring else "one_time",
        "active": bool(price.get("active")),
    }


def _list_all(path: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    starting_after = None
    for _ in range(20):  # safety cap
        p = dict(params)
        p["limit"] = 100
        if starting_after:
            p["starting_after"] = starting_after
        resp = _request("GET", path, p)
        data = resp.get("data", [])
        out.extend(data)
        if not resp.get("has_more") or not data:
            break
        starting_after = data[-1]["id"]
    return out


def fetch_catalog(force: bool = False) -> Dict[str, Any]:
    """Fetch products + prices from the live (test) Stripe catalog and shape
    them per the contract. Cached for a short TTL."""
    now = time.time()
    if not force and _CATALOG_CACHE["data"] is not None and (now - _CATALOG_CACHE["ts"]) < _CATALOG_TTL:
        return _CATALOG_CACHE["data"]

    products = _list_all("/products", {"active": True})
    prices = _list_all("/prices", {"active": True})

    prices_by_product: Dict[str, List[Dict[str, Any]]] = {}
    for pr in prices:
        prod = pr.get("product")
        if isinstance(prod, dict):
            prod = prod.get("id")
        if not prod:
            continue
        prices_by_product.setdefault(prod, []).append(pr)

    synced_at = int(now)
    shaped: List[Dict[str, Any]] = []
    for prod in products:
        pid = prod["id"]
        meta = prod.get("metadata") or {}
        prod_prices_raw = prices_by_product.get(pid, [])
        prod_prices = [_price_shape(p) for p in prod_prices_raw]
        kind = _derive_kind(meta, prod_prices)
        audience = (meta.get("audience") or "").strip()
        categories = [c.strip() for c in audience.split(",") if c.strip()] if audience else []
        shaped.append({
            "id": pid,
            "name": prod.get("name"),
            "kind": kind,
            "active": bool(prod.get("active")),
            "metadata": meta,
            "categories": categories,
            "prices": prod_prices,
            "synced_at": synced_at,
        })

    result = {"products": shaped, "audience_categories": AUDIENCE_CATEGORIES}
    _CATALOG_CACHE["data"] = result
    _CATALOG_CACHE["ts"] = now
    return result


def get_catalog(kind: Optional[str] = None, audience: Optional[str] = None) -> Dict[str, Any]:
    catalog = fetch_catalog()
    products = catalog["products"]
    if kind:
        products = [p for p in products if p["kind"] == kind]
    if audience:
        products = [p for p in products if audience in p["categories"]]
    return {"products": products, "audience_categories": catalog["audience_categories"]}


def find_price(price_id: str) -> Optional[Dict[str, Any]]:
    """Return {price, product} for a catalog price_id, or None if not found."""
    catalog = fetch_catalog()
    for prod in catalog["products"]:
        for pr in prod["prices"]:
            if pr["id"] == price_id:
                return {"price": pr, "product": prod}
    # Fallback: not in the active catalog cache — fetch the price directly.
    try:
        raw = _request("GET", f"/prices/{price_id}", {"expand[]": "product"})
    except StripeError:
        return None
    prod_raw = raw.get("product")
    if isinstance(prod_raw, dict):
        meta = prod_raw.get("metadata") or {}
        product = {
            "id": prod_raw.get("id"),
            "name": prod_raw.get("name"),
            "metadata": meta,
        }
        product["kind"] = _derive_kind(meta, [_price_shape(raw)])
        product["categories"] = [
            c.strip() for c in (meta.get("audience") or "").split(",") if c.strip()
        ]
    else:
        product = {"id": prod_raw, "name": None, "metadata": {}, "kind": "alacarte", "categories": []}
    return {"price": _price_shape(raw), "product": product}


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
def get_or_create_customer(email: str, name: Optional[str] = None,
                           existing_customer_id: Optional[str] = None) -> str:
    """Return a Stripe customer id, reusing existing_customer_id when valid."""
    if existing_customer_id:
        try:
            cust = _request("GET", f"/customers/{existing_customer_id}")
            if not cust.get("deleted"):
                return cust["id"]
        except StripeError:
            logger.debug("get_or_create_customer: stored customer id no longer valid")
    # Search for an existing customer by email first (idempotent-ish).
    try:
        found = _request("GET", "/customers", {"email": email, "limit": 1})
        data = found.get("data", [])
        if data:
            return data[0]["id"]
    except StripeError:
        logger.debug("get_or_create_customer: email lookup failed; creating new customer")
    created = _request(
        "POST", "/customers",
        {"email": email, "name": name or email},
        idempotency_key=f"cust:{email}",
    )
    return created["id"]


# ---------------------------------------------------------------------------
# Promotion codes
# ---------------------------------------------------------------------------
def validate_promotion_code(code: str) -> Optional[Dict[str, Any]]:
    """Look up an active Stripe promotion code (test mode). Returns a dict with
    coupon details or None if invalid/inactive."""
    if not code:
        return None
    try:
        resp = _request("GET", "/promotion_codes", {"code": code, "active": True, "limit": 1})
    except StripeError:
        return None
    data = resp.get("data", [])
    if not data:
        return None
    promo = data[0]
    coupon = promo.get("coupon") or {}
    if not coupon.get("valid", True):
        return None
    return {
        "code": promo.get("code"),
        "percent_off": coupon.get("percent_off"),
        "amount_off": coupon.get("amount_off"),
        "currency": coupon.get("currency"),
    }


def compute_discount(promo: Dict[str, Any], amount: int) -> int:
    """Discount in cents applied to `amount` (subtotal). Percent applies to the
    subtotal; amount_off is capped at the subtotal."""
    if promo.get("percent_off"):
        return int(round(amount * (float(promo["percent_off"]) / 100.0)))
    if promo.get("amount_off"):
        return min(int(promo["amount_off"]), amount)
    return 0


# ---------------------------------------------------------------------------
# Intents / subscriptions
# ---------------------------------------------------------------------------
def create_payment_intent(amount: int, currency: str, customer: str,
                          metadata: Dict[str, Any],
                          idempotency_key: Optional[str] = None,
                          description: Optional[str] = None) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "amount": amount,
        "currency": currency,
        "customer": customer,
        # Embedded card-only checkout: no off-site redirects, so the SPA can
        # confirm with `redirect: 'if_required'` and no return_url.
        "automatic_payment_methods": {"enabled": True, "allow_redirects": "never"},
        "metadata": metadata,
    }
    if description:
        params["description"] = description
    return _request("POST", "/payment_intents", params, idempotency_key=idempotency_key)


def retrieve_payment_intent(pi_id: str) -> Dict[str, Any]:
    return _request("GET", f"/payment_intents/{pi_id}")


def create_subscription(customer: str, price_id: str, quantity: int,
                        metadata: Dict[str, Any],
                        promotion_code_id: Optional[str] = None,
                        idempotency_key: Optional[str] = None) -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "customer": customer,
        "items": [{"price": price_id, "quantity": quantity}],
        "payment_behavior": "default_incomplete",
        "payment_settings": {"save_default_payment_method": "on_subscription"},
        "expand": ["latest_invoice.payment_intent"],
        "metadata": metadata,
    }
    if promotion_code_id:
        params["promotion_code"] = promotion_code_id
    return _request("POST", "/subscriptions", params, idempotency_key=idempotency_key)

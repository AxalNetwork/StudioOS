"""Task #8 — Redesigned Products page: catalog, payments, cart orders.

Dev-only FastAPI backend (production surface is the Cloudflare Worker). Prices
ALWAYS come from the live TEST Stripe catalog server-side; client-supplied
amounts are never trusted for cart orders. See
`.local/tasks/products-cart-contract.md` for the pinned API contract.

Auth: Bearer only via `get_current_user`. Money is integer cents, currency
lowercase ISO. VAT 5% for UAE-normalized billing_country, else 0%; discount is
applied to subtotal BEFORE VAT.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import string
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User
from backend.app.services import stripe_commerce as sc
from backend.app.services.invoice_pdf import generate_invoice_pdf

logger = logging.getLogger("studioos.commerce")

router = APIRouter(tags=["Commerce"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _err(status: int, payload: Dict[str, Any]) -> JSONResponse:
    return JSONResponse(status_code=status, content=payload)


def _stripe_error_response(exc: sc.StripeError) -> JSONResponse:
    code = exc.status_code if 400 <= exc.status_code < 500 else 502
    return _err(code, {"error": "stripe_error", "message": exc.message})


def _year() -> int:
    return datetime.utcnow().year


def _make_order_ref() -> str:
    suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
    return f"MRD-{_year()}-{suffix}"


def _customer_for(session: Session, user: User) -> str:
    """Resolve (creating if needed) the user's Stripe customer id, persisting
    it on users.stripe_customer_id."""
    existing = None
    try:
        row = session.exec(
            text("SELECT stripe_customer_id FROM users WHERE id = :id").bindparams(id=user.id)
        ).first()
        existing = (row._mapping["stripe_customer_id"] if row else None)
    except Exception:
        try:
            session.rollback()
        except Exception:
            pass
    cust = sc.get_or_create_customer(user.email, user.name, existing)
    if cust and cust != existing:
        try:
            session.exec(
                text("UPDATE users SET stripe_customer_id = :c WHERE id = :id").bindparams(
                    c=cust, id=user.id
                )
            )
            session.commit()
        except Exception:
            session.rollback()
    return cust


def _dev_email_to(user: User) -> str:
    return os.environ.get("DEV_EMAIL_OVERRIDE") or user.email


# ---------------------------------------------------------------------------
# Catalog + config
# ---------------------------------------------------------------------------
@router.get("/catalog/products")
def catalog_products(kind: Optional[str] = None, audience: Optional[str] = None):
    try:
        return sc.get_catalog(kind=kind, audience=audience)
    except sc.StripeError as exc:
        return _stripe_error_response(exc)


@router.get("/payments/config")
def payments_config():
    return {"publishable_key": sc.publishable_key()}


# ---------------------------------------------------------------------------
# Promo validate
# ---------------------------------------------------------------------------
class PromoValidateBody(BaseModel):
    code: str
    price_id: Optional[str] = None


@router.post("/payments/promo/validate")
def promo_validate(body: PromoValidateBody, user: User = Depends(get_current_user)):
    promo = sc.validate_promotion_code(body.code)
    if not promo:
        return {"valid": False, "reason": "invalid_code"}
    original_amount = None
    if body.price_id:
        found = sc.find_price(body.price_id)
        if found and found["price"].get("unit_amount") is not None:
            original_amount = int(found["price"]["unit_amount"])
    result: Dict[str, Any] = {
        "valid": True,
        "code": promo["code"],
        "percent_off": promo.get("percent_off"),
        "amount_off": promo.get("amount_off"),
        "currency": promo.get("currency"),
        "free": False,
    }
    if original_amount is not None:
        discount = sc.compute_discount(promo, original_amount)
        discounted = max(0, original_amount - discount)
        result["original_amount"] = original_amount
        result["discount_cents"] = discount
        result["discounted_amount"] = discounted
        result["free"] = discounted <= 0
    return result


# ---------------------------------------------------------------------------
# Generic payment intent (subscription or one-time)
# ---------------------------------------------------------------------------
class IntentBody(BaseModel):
    price_id: Optional[str] = None
    amount: Optional[int] = None
    currency: Optional[str] = None
    quantity: Optional[int] = 1
    nonce: Optional[str] = None
    description: Optional[str] = None
    promo_code: Optional[str] = None


def _resolve_promo_id(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    try:
        resp = sc._request("GET", "/promotion_codes", {"code": code, "active": True, "limit": 1})
        data = resp.get("data", [])
        return data[0]["id"] if data else None
    except sc.StripeError:
        return None


@router.post("/payments/intent")
def payments_intent(body: IntentBody, session: Session = Depends(get_session),
                    user: User = Depends(get_current_user)):
    try:
        customer = _customer_for(session, user)
        quantity = max(1, int(body.quantity or 1))
        promo = sc.validate_promotion_code(body.promo_code) if body.promo_code else None

        if body.price_id:
            found = sc.find_price(body.price_id)
            if not found:
                return _err(400, {"error": "invalid_price"})
            price = found["price"]
            if price.get("type") == "recurring":
                promo_id = _resolve_promo_id(body.promo_code) if body.promo_code else None
                idem = f"pi:{user.id}:{body.price_id}:{body.promo_code or ''}:{body.nonce or ''}"
                sub = sc.create_subscription(
                    customer, body.price_id, quantity,
                    metadata={"user_id": str(user.id), "kind": "subscription"},
                    promotion_code_id=promo_id, idempotency_key=idem,
                )
                inv = sub.get("latest_invoice") or {}
                pi = inv.get("payment_intent") or {}
                return {
                    "kind": "subscription",
                    "client_secret": pi.get("client_secret"),
                    "customer": customer,
                    "status": sub.get("status"),
                    "subscription_id": sub.get("id"),
                    "price_id": body.price_id,
                    "currency": price.get("currency"),
                    "free": False,
                }
            # one-time price
            amount = int(price.get("unit_amount") or 0) * quantity
            currency = price.get("currency") or "usd"
        elif body.amount is not None:
            amount = int(body.amount)
            currency = (body.currency or "usd").lower()
        else:
            return _err(400, {"error": "price_or_amount_required"})

        discount = sc.compute_discount(promo, amount) if promo else 0
        total = max(0, amount - discount)
        if total <= 0:
            return {
                "kind": "payment",
                "client_secret": None,
                "customer": customer,
                "status": "free",
                "payment_intent_id": None,
                "price_id": body.price_id,
                "amount": 0,
                "currency": currency,
                "free": True,
            }
        idem = f"pi:{user.id}:{body.price_id or body.amount}:{body.promo_code or ''}:{body.nonce or ''}"
        pi = sc.create_payment_intent(
            total, currency, customer,
            metadata={"user_id": str(user.id), "kind": "one_time",
                      "price_id": body.price_id or "", "promo_code": body.promo_code or ""},
            idempotency_key=idem, description=body.description,
        )
        return {
            "kind": "payment",
            "client_secret": pi.get("client_secret"),
            "customer": customer,
            "status": pi.get("status"),
            "payment_intent_id": pi.get("id"),
            "price_id": body.price_id,
            "amount": total,
            "currency": currency,
            "free": False,
        }
    except sc.StripeError as exc:
        return _stripe_error_response(exc)


# ---------------------------------------------------------------------------
# A la carte
# ---------------------------------------------------------------------------
class AlacarteBody(BaseModel):
    price_id: str
    nonce: Optional[str] = None
    promo_code: Optional[str] = None


def _grant_feature_unlock(session: Session, user_id: int, feature_key: str,
                          price_id: Optional[str], pi_id: Optional[str]) -> None:
    try:
        session.exec(text(
            "INSERT INTO feature_unlocks (id, user_id, feature_key, price_id, payment_intent_id) "
            "VALUES (:id, :uid, :fk, :pid, :pi)"
        ).bindparams(id=str(uuid.uuid4()), uid=user_id, fk=feature_key,
                     pid=price_id, pi=pi_id))
        session.commit()
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        logger.warning("grant_feature_unlock failed: %s", exc)


@router.post("/payments/alacarte/intent")
def alacarte_intent(body: AlacarteBody, session: Session = Depends(get_session),
                    user: User = Depends(get_current_user)):
    try:
        found = sc.find_price(body.price_id)
        if not found:
            return _err(400, {"error": "invalid_price"})
        product = found["product"]
        if (product.get("metadata") or {}).get("kind") != "alacarte":
            return _err(400, {"error": "not_alacarte"})
        price = found["price"]
        amount = int(price.get("unit_amount") or 0)
        currency = price.get("currency") or "usd"
        feature_key = (product.get("metadata") or {}).get("feature_key") or product.get("id")

        promo = sc.validate_promotion_code(body.promo_code) if body.promo_code else None
        discount = sc.compute_discount(promo, amount) if promo else 0
        total = max(0, amount - discount)
        customer = _customer_for(session, user)

        if total <= 0:
            _grant_feature_unlock(session, user.id, feature_key, body.price_id, None)
            return {
                "kind": "payment", "client_secret": None, "customer": customer,
                "status": "free", "payment_intent_id": None, "price_id": body.price_id,
                "amount": 0, "currency": currency, "free": True,
            }
        idem = f"pi:{user.id}:{body.price_id}:{body.promo_code or ''}:{body.nonce or ''}"
        pi = sc.create_payment_intent(
            total, currency, customer,
            metadata={"user_id": str(user.id), "kind": "alacarte",
                      "feature_key": feature_key, "price_id": body.price_id},
            idempotency_key=idem,
        )
        return {
            "kind": "payment", "client_secret": pi.get("client_secret"),
            "customer": customer, "status": pi.get("status"),
            "payment_intent_id": pi.get("id"), "price_id": body.price_id,
            "amount": total, "currency": currency, "free": False,
        }
    except sc.StripeError as exc:
        return _stripe_error_response(exc)


@router.get("/payments/alacarte/unlocks")
def alacarte_unlocks(session: Session = Depends(get_session),
                     user: User = Depends(get_current_user)):
    unlocks: List[Dict[str, Any]] = []
    try:
        rows = session.exec(text(
            "SELECT feature_key, expires_at FROM feature_unlocks WHERE user_id = :uid "
            "ORDER BY activated_at DESC"
        ).bindparams(uid=user.id)).all()
        for r in rows:
            m = r._mapping
            unlocks.append({
                "feature_key": m["feature_key"],
                "expires_at": m["expires_at"].isoformat() if m["expires_at"] else None,
            })
    except Exception:
        session.rollback()
    return {"unlocks": unlocks}


# ---------------------------------------------------------------------------
# Intro credits
# ---------------------------------------------------------------------------
class IntroCreditsBody(BaseModel):
    pack: int
    nonce: Optional[str] = None


INTRO_PACK_PRICES = {10: 4900, 100: 39900, 1000: 299000}


@router.post("/payments/intro-credits/intent")
def intro_credits_intent(body: IntroCreditsBody, session: Session = Depends(get_session),
                         user: User = Depends(get_current_user)):
    if body.pack not in INTRO_PACK_PRICES:
        return _err(400, {"error": "invalid_pack"})
    try:
        amount = INTRO_PACK_PRICES[body.pack]
        currency = "usd"
        customer = _customer_for(session, user)
        idem = f"pi:{user.id}:intro_{body.pack}:{body.nonce or ''}"
        pi = sc.create_payment_intent(
            amount, currency, customer,
            metadata={"user_id": str(user.id), "kind": "intro_credits",
                      "pack": str(body.pack)},
            idempotency_key=idem,
        )
        return {
            "kind": "payment", "client_secret": pi.get("client_secret"),
            "customer": customer, "status": pi.get("status"),
            "payment_intent_id": pi.get("id"), "amount": amount,
            "currency": currency, "free": False,
        }
    except sc.StripeError as exc:
        return _stripe_error_response(exc)


# ---------------------------------------------------------------------------
# Explorer promo (dev: none)
# ---------------------------------------------------------------------------
@router.get("/products/promo")
def products_promo(user: User = Depends(get_current_user)):
    return {"promo": None}


class RedeemBody(BaseModel):
    code: str


@router.post("/products/redeem")
def products_redeem(body: RedeemBody, user: User = Depends(get_current_user)):
    # No explorer promo backing data in dev — reject cleanly (400) per contract.
    return _err(400, {"ok": False, "reason": "invalid_code"})


# ---------------------------------------------------------------------------
# Cart orders
# ---------------------------------------------------------------------------
class CartItem(BaseModel):
    price_id: str
    quantity: int = 1


class OrderIntentBody(BaseModel):
    items: List[CartItem]
    promo_code: Optional[str] = None
    billing_country: Optional[str] = None
    nonce: Optional[str] = None


def _price_line(found: Dict[str, Any], quantity: int) -> Dict[str, Any]:
    price = found["price"]
    product = found["product"]
    unit = int(price.get("unit_amount") or 0)
    return {
        "price_id": price["id"],
        "product_id": product.get("id"),
        "name": product.get("name"),
        "kind": product.get("kind"),
        "quantity": quantity,
        "unit_amount": unit,
        "line_total": unit * quantity,
    }


def _order_to_dict(m: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "order_ref": m["order_ref"],
        "status": m["status"],
        "created_at": m["created_at"].isoformat() if m.get("created_at") else None,
        "paid_at": m["paid_at"].isoformat() if m.get("paid_at") else None,
        "currency": m["currency"],
        "subtotal": m["subtotal_cents"],
        "discount_cents": m["discount_cents"],
        "vat_cents": m["vat_cents"],
        "total": m["total_cents"],
        "promo_code": m.get("promo_code"),
        "items": json.loads(m["items_json"]) if m.get("items_json") else [],
    }


def _load_order(session: Session, order_ref: str, user_id: int) -> Optional[Dict[str, Any]]:
    row = session.exec(text(
        "SELECT * FROM orders WHERE order_ref = :ref AND user_id = :uid"
    ).bindparams(ref=order_ref, uid=user_id)).first()
    return dict(row._mapping) if row else None


@router.post("/orders/intent")
def order_intent(body: OrderIntentBody, session: Session = Depends(get_session),
                 user: User = Depends(get_current_user)):
    if not body.items:
        return _err(400, {"error": "empty_cart"})
    try:
        # Merge duplicate price_ids (sum quantities) so the same SKU added twice
        # becomes one line, and iterate in canonical (sorted) order so the
        # idempotency signature is stable regardless of client cart ordering.
        merged: Dict[str, int] = {}
        for it in body.items:
            pid = it.price_id
            if not pid:
                return _err(400, {"error": "invalid_price"})
            merged[pid] = merged.get(pid, 0) + max(1, int(it.quantity or 1))

        items: List[Dict[str, Any]] = []
        currency: Optional[str] = None
        subtotal = 0
        for pid in sorted(merged.keys()):
            qty = merged[pid]
            found = sc.find_price(pid)
            if not found:
                return _err(400, {"error": "invalid_price"})
            price = found["price"]
            if price.get("type") != "one_time" or not price.get("active"):
                return _err(400, {"error": "not_one_time"})
            line_currency = price.get("currency") or "usd"
            if currency is None:
                currency = line_currency
            elif line_currency != currency:
                # One PaymentIntent can only carry one currency — mirrors the
                # Worker's currency_mismatch guard for dual-backend parity.
                return _err(400, {"error": "currency_mismatch"})
            line = _price_line(found, qty)
            subtotal += line["line_total"]
            items.append(line)
        currency = currency or "usd"

        promo = sc.validate_promotion_code(body.promo_code) if body.promo_code else None
        discount = sc.compute_discount(promo, subtotal) if promo else 0
        rate = sc.vat_rate(body.billing_country)
        vat = int(round((subtotal - discount) * rate))
        total = subtotal - discount + vat

        # Stable order_ref per (user+items+promo+nonce) via idempotency hash.
        items_sig = ",".join(f"{i['price_id']}:{i['quantity']}" for i in items)
        sig = hashlib.sha256(
            f"{items_sig}|{body.promo_code or ''}|{body.billing_country or ''}".encode()
        ).hexdigest()
        idem_nonce = body.nonce or ""

        # Reuse an existing pending order for the same idempotency signature.
        existing = session.exec(text(
            "SELECT * FROM orders WHERE user_id = :uid AND status = 'pending' "
            "AND invoice_number = :sig ORDER BY created_at DESC LIMIT 1"
        ).bindparams(uid=user.id, sig=f"idem:{sig}:{idem_nonce}")).first()

        if total <= 0:
            # Free via promo — no PaymentIntent. Insert as pending, then let
            # _fulfil_order atomically flip it to paid and run fulfilment
            # side-effects exactly once (grants, promo redemption, invoice, email).
            order_ref = existing._mapping["order_ref"] if existing else _make_order_ref()
            _upsert_order(session, order_ref, user.id, "pending", currency, subtotal,
                          discount, vat, total, body.promo_code, body.billing_country,
                          None, items, f"idem:{sig}:{idem_nonce}", paid=False)
            _fulfil_order(session, order_ref, user)
            return {
                "free": True, "order_ref": order_ref, "currency": currency,
                "subtotal": subtotal, "discount_cents": discount, "vat_cents": vat,
                "total": 0, "items": items, "client_secret": None,
            }

        order_ref = existing._mapping["order_ref"] if existing else _make_order_ref()
        customer = _customer_for(session, user)
        idem = f"order:{user.id}:{sig}:{idem_nonce}"
        pi = sc.create_payment_intent(
            total, currency, customer,
            metadata={"kind": "cart_order", "order_ref": order_ref,
                      "user_id": str(user.id), "promo_code": body.promo_code or "",
                      "items": items_sig},
            idempotency_key=idem,
        )
        _upsert_order(session, order_ref, user.id, "pending", currency, subtotal,
                      discount, vat, total, body.promo_code, body.billing_country,
                      pi.get("id"), items, f"idem:{sig}:{idem_nonce}", paid=False)
        return {
            "client_secret": pi.get("client_secret"),
            "payment_intent_id": pi.get("id"),
            "order_ref": order_ref, "currency": currency, "subtotal": subtotal,
            "discount_cents": discount, "vat_cents": vat, "total": total,
            "free": False, "items": items,
        }
    except sc.StripeError as exc:
        return _stripe_error_response(exc)


def _upsert_order(session: Session, order_ref: str, user_id: int, status: str,
                  currency: str, subtotal: int, discount: int, vat: int, total: int,
                  promo_code: Optional[str], billing_country: Optional[str],
                  pi_id: Optional[str], items: List[Dict[str, Any]],
                  idem_marker: str, paid: bool) -> None:
    existing = session.exec(text(
        "SELECT id FROM orders WHERE order_ref = :ref"
    ).bindparams(ref=order_ref)).first()
    paid_at = datetime.utcnow() if paid else None
    if existing:
        session.exec(text(
            "UPDATE orders SET status=:st, currency=:cur, subtotal_cents=:sub, "
            "discount_cents=:disc, vat_cents=:vat, total_cents=:tot, promo_code=:promo, "
            "billing_country=:bc, payment_intent_id=:pi, items_json=:items, paid_at=:paid "
            "WHERE order_ref=:ref"
        ).bindparams(st=status, cur=currency, sub=subtotal, disc=discount, vat=vat,
                     tot=total, promo=promo_code, bc=billing_country, pi=pi_id,
                     items=json.dumps(items), paid=paid_at, ref=order_ref))
    else:
        session.exec(text(
            "INSERT INTO orders (id, order_ref, user_id, status, currency, subtotal_cents, "
            "discount_cents, vat_cents, total_cents, promo_code, billing_country, "
            "payment_intent_id, items_json, invoice_number, paid_at) "
            "VALUES (:id, :ref, :uid, :st, :cur, :sub, :disc, :vat, :tot, :promo, :bc, "
            ":pi, :items, :inv, :paid)"
        ).bindparams(id=str(uuid.uuid4()), ref=order_ref, uid=user_id, st=status,
                     cur=currency, sub=subtotal, disc=discount, vat=vat, tot=total,
                     promo=promo_code, bc=billing_country, pi=pi_id,
                     items=json.dumps(items), inv=idem_marker, paid=paid_at))
    session.commit()


def _fulfil_order(session: Session, order_ref: str, user: Optional[User] = None) -> Optional[Dict[str, Any]]:
    """Idempotent fulfilment: mark paid, grant user_products, record promo,
    generate invoice number, send email. Returns the order dict."""
    row = session.exec(text(
        "SELECT * FROM orders WHERE order_ref = :ref"
    ).bindparams(ref=order_ref)).first()
    if not row:
        return None
    m = dict(row._mapping)
    # Preserve any invoice number already assigned; otherwise derive one.
    inv_number = m.get("invoice_number")
    if not inv_number or not str(inv_number).startswith("INV-"):
        inv_number = f"INV-{_year()}-{order_ref.split('-')[-1]}"
    # Atomic claim: only the caller whose UPDATE actually flips pending→paid
    # runs the fulfilment side-effects. This makes /orders/confirm and the
    # Stripe webhook race-safe — the loser's rowcount is 0 and it skips grants.
    result = session.exec(text(
        "UPDATE orders SET status='paid', paid_at=:paid, invoice_number=:inv "
        "WHERE order_ref=:ref AND status <> 'paid'"
    ).bindparams(paid=datetime.utcnow(), inv=inv_number, ref=order_ref))
    session.commit()
    claimed = (getattr(result, "rowcount", 0) or 0) > 0
    if claimed:
        # Grant user_products (one row per line). ON CONFLICT is a second guard
        # on top of the claim gate (unique index on order_ref, price_id).
        items = json.loads(m["items_json"]) if m.get("items_json") else []
        for it in items:
            try:
                session.exec(text(
                    "INSERT INTO user_products (id, user_id, order_ref, product_id, "
                    "price_id, kind, label, quantity) VALUES "
                    "(:id, :uid, :ref, :pid, :price, :kind, :label, :qty) "
                    "ON CONFLICT (order_ref, price_id) DO NOTHING"
                ).bindparams(id=str(uuid.uuid4()), uid=m["user_id"], ref=order_ref,
                             pid=it.get("product_id"), price=it.get("price_id"),
                             kind=it.get("kind"), label=it.get("name"),
                             qty=it.get("quantity", 1)))
                session.commit()
            except Exception as exc:  # noqa: BLE001
                session.rollback()
                logger.warning("_fulfil_order: user_products insert failed: %s", exc)
        # Record promo redemption (unique per order_ref).
        if m.get("promo_code"):
            try:
                session.exec(text(
                    "INSERT INTO promo_redemptions (id, user_id, code, order_ref, discount_cents) "
                    "VALUES (:id, :uid, :code, :ref, :disc) "
                    "ON CONFLICT (order_ref) WHERE order_ref IS NOT NULL DO NOTHING"
                ).bindparams(id=str(uuid.uuid4()), uid=m["user_id"], code=m["promo_code"],
                             ref=order_ref, disc=m["discount_cents"]))
                session.commit()
            except Exception as exc:  # noqa: BLE001
                session.rollback()
                logger.warning("_fulfil_order: promo_redemptions insert failed: %s", exc)
        # Confirmation email (dev → DEV_EMAIL_OVERRIDE or log).
        _send_order_email(session, order_ref, m["user_id"])

    row2 = session.exec(text(
        "SELECT * FROM orders WHERE order_ref = :ref"
    ).bindparams(ref=order_ref)).first()
    return _order_to_dict(dict(row2._mapping)) if row2 else None


def _send_order_email(session: Session, order_ref: str, user_id: int) -> None:
    try:
        urow = session.exec(text(
            "SELECT email, name FROM users WHERE id = :id"
        ).bindparams(id=user_id)).first()
        email = os.environ.get("DEV_EMAIL_OVERRIDE") or (urow._mapping["email"] if urow else None)
        if not email:
            return
        from backend.app.services import email_service
        subject = f"Order confirmed — {order_ref}"
        html = (f"<p>Thank you for your purchase.</p>"
                f"<p>Your order <strong>{order_ref}</strong> is confirmed.</p>")
        if email_service.is_email_configured():
            email_service._send_html_email(
                to_email=email, subject=subject, html_body=html,
                plain_text=f"Your order {order_ref} is confirmed.",
                sender_label="Axal Ventures",
            )
        else:
            # Strip CR/LF so untrusted values can never forge log lines.
            safe_email = str(email).replace("\r", "").replace("\n", "")
            safe_ref = str(order_ref).replace("\r", "").replace("\n", "")
            logger.info("ORDER EMAIL (no provider): to=%s ref=%s", safe_email, safe_ref)
    except Exception as exc:  # noqa: BLE001
        logger.warning("_send_order_email failed: %s", exc)


class OrderConfirmBody(BaseModel):
    payment_intent_id: str


@router.post("/orders/confirm")
def order_confirm(body: OrderConfirmBody, session: Session = Depends(get_session),
                  user: User = Depends(get_current_user)):
    try:
        pi = sc.retrieve_payment_intent(body.payment_intent_id)
    except sc.StripeError as exc:
        return _stripe_error_response(exc)
    meta = pi.get("metadata") or {}
    if meta.get("kind") != "cart_order":
        return _err(400, {"error": "not_cart_order"})
    if str(meta.get("user_id")) != str(user.id):
        return _err(403, {"error": "forbidden"})
    if pi.get("status") != "succeeded":
        return _err(409, {"error": "not_paid", "status": pi.get("status")})
    order_ref = meta.get("order_ref")
    order = _fulfil_order(session, order_ref, user)
    if not order:
        return _err(404, {"error": "order_not_found"})
    return {"order": order}


@router.get("/orders/mine")
def orders_mine(session: Session = Depends(get_session),
                user: User = Depends(get_current_user)):
    rows = session.exec(text(
        "SELECT * FROM orders WHERE user_id = :uid ORDER BY created_at DESC"
    ).bindparams(uid=user.id)).all()
    return {"orders": [_order_to_dict(dict(r._mapping)) for r in rows]}


@router.get("/orders/{order_ref}/invoice")
def order_invoice(order_ref: str, session: Session = Depends(get_session),
                  user: User = Depends(get_current_user)):
    m = _load_order(session, order_ref, user.id)
    if not m:
        return _err(404, {"error": "not_found"})
    order = _order_to_dict(m)
    order["invoice_number"] = m.get("invoice_number")
    pdf = generate_invoice_pdf(order)
    filename = f"{order_ref}.pdf"
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/orders/{order_ref}")
def get_order(order_ref: str, session: Session = Depends(get_session),
              user: User = Depends(get_current_user)):
    m = _load_order(session, order_ref, user.id)
    if not m:
        return _err(404, {"error": "not_found"})
    return {"order": _order_to_dict(m)}


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------
def _verify_webhook(payload: bytes, sig_header: Optional[str], secret: str) -> bool:
    """Verify Stripe webhook signature (HMAC-SHA256). Dev-only, no SDK."""
    import hmac
    if not sig_header:
        return False
    try:
        parts = dict(p.split("=", 1) for p in sig_header.split(",") if "=" in p)
        timestamp = parts.get("t")
        v1 = parts.get("v1")
        if not timestamp or not v1:
            return False
        signed = f"{timestamp}.{payload.decode('utf-8')}".encode()
        expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, v1)
    except Exception:  # noqa: BLE001
        return False


@router.post("/billing/stripe/webhook")
async def stripe_webhook(request: Request, session: Session = Depends(get_session),
                         stripe_signature: Optional[str] = Header(None)):
    payload = await request.body()
    secret = sc.webhook_secret()
    if secret:
        if not _verify_webhook(payload, stripe_signature, secret):
            return _err(400, {"error": "invalid_signature"})
    else:
        logger.warning("stripe_webhook: STRIPE_TEST_WEBHOOK_SECRET unset — processing without verify (dev only)")
    try:
        event = json.loads(payload.decode("utf-8"))
    except Exception:  # noqa: BLE001
        return _err(400, {"error": "invalid_payload"})

    if event.get("type") == "payment_intent.succeeded":
        pi = (event.get("data") or {}).get("object") or {}
        meta = pi.get("metadata") or {}
        if meta.get("kind") == "cart_order":
            order_ref = meta.get("order_ref")
            if order_ref:
                try:
                    _fulfil_order(session, order_ref, None)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("stripe_webhook: fulfil failed: %s", exc)
    return {"received": True}

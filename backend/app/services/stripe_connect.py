"""Task #51 — Stripe Connect adapter.

Thin abstraction over Stripe's Connect + Invoicing APIs. When a real
`STRIPE_SECRET_KEY` is configured in the environment, the adapter calls
Stripe directly. Otherwise it returns deterministic *simulated* values
(flagged with `simulated: True`) so the lifecycle UI is fully usable in
dev / preview without leaking real money.

The adapter never raises on a missing API key — callers always get a
shape-stable response so route handlers can stay simple.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import TYPE_CHECKING, Optional

logger = logging.getLogger(__name__)

if TYPE_CHECKING:  # pragma: no cover
    from backend.app.models.entities import Engagement, Partner, User

_STRIPE_SECRET = os.environ.get("STRIPE_SECRET_KEY")
_RETURN_URL = os.environ.get(
    "STRIPE_CONNECT_RETURN_URL",
    "/marketplace?stripe=connected",
)
_REFRESH_URL = os.environ.get(
    "STRIPE_CONNECT_REFRESH_URL",
    "/marketplace?stripe=refresh",
)


def is_live() -> bool:
    return bool(_STRIPE_SECRET)


def _stripe():
    """Lazy import + key install. Returns None when no key is configured."""
    if not _STRIPE_SECRET:
        return None
    try:
        import stripe  # type: ignore
    except ImportError:  # pragma: no cover — package always installed in this repo
        logger.warning("stripe SDK missing; falling back to simulated mode")
        return None
    stripe.api_key = _STRIPE_SECRET
    return stripe


def _sim_account_id(partner: "Partner") -> str:
    h = hashlib.sha256(f"acct:{partner.id}:{partner.email}".encode()).hexdigest()[:16]
    return f"acct_sim_{h}"


def _sim_invoice(engagement: "Engagement") -> dict:
    h = hashlib.sha256(f"inv:{engagement.id}:{engagement.uid}".encode()).hexdigest()[:16]
    return {
        "id": f"in_sim_{h}",
        "url": f"https://invoice.stripe.simulated/{h}",
        "status": "open",
    }


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------
def create_account_link(partner: "Partner") -> dict:
    """Returns `{url, account_id, simulated}`. The caller persists
    `account_id` onto the Partner row before redirecting the user.
    """
    s = _stripe()
    if s is None:
        account_id = partner.stripe_account_id or _sim_account_id(partner)
        return {
            "url": f"{_RETURN_URL}&simulated=1&account={account_id}",
            "account_id": account_id,
            "simulated": True,
        }
    try:
        account_id = partner.stripe_account_id
        if not account_id:
            acct = s.Account.create(
                type="express",
                email=partner.email,
                business_profile={"name": partner.name},
                capabilities={
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
            )
            account_id = acct["id"]
        link = s.AccountLink.create(
            account=account_id,
            return_url=_RETURN_URL,
            refresh_url=_REFRESH_URL,
            type="account_onboarding",
        )
        return {"url": link["url"], "account_id": account_id, "simulated": False}
    except Exception as exc:  # noqa: BLE001
        logger.error("Stripe account link failed: %s", exc)
        # Fall back to simulated so the UI still progresses; flag clearly.
        account_id = partner.stripe_account_id or _sim_account_id(partner)
        return {
            "url": f"{_RETURN_URL}&simulated=1&account={account_id}&error=stripe_unavailable",
            "account_id": account_id,
            "simulated": True,
            "error": str(exc),
        }


def refresh_account_status(partner: "Partner") -> dict:
    """Pull current onboarding state. Returns the raw flags the caller
    persists onto Partner."""
    if not partner.stripe_account_id:
        return {
            "stripe_account_id": None,
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
            "simulated": not is_live(),
        }
    s = _stripe()
    if s is None:
        # Simulated: pretend onboarding always completes.
        return {
            "stripe_account_id": partner.stripe_account_id,
            "charges_enabled": True,
            "payouts_enabled": True,
            "details_submitted": True,
            "simulated": True,
        }
    try:
        acct = s.Account.retrieve(partner.stripe_account_id)
        return {
            "stripe_account_id": acct["id"],
            "charges_enabled": bool(acct.get("charges_enabled")),
            "payouts_enabled": bool(acct.get("payouts_enabled")),
            "details_submitted": bool(acct.get("details_submitted")),
            "simulated": False,
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("Stripe account refresh failed: %s", exc)
        return {
            "stripe_account_id": partner.stripe_account_id,
            "charges_enabled": False,
            "payouts_enabled": False,
            "details_submitted": False,
            "simulated": True,
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# Invoicing (delivered → invoiced)
# ---------------------------------------------------------------------------
def create_invoice(
    engagement: "Engagement",
    partner: "Partner",
    founder_user: Optional["User"] = None,
) -> dict:
    """Creates a Stripe invoice on the partner's connected account, billed
    to the founder. Returns `{invoice_id, invoice_url, status, amount_cents,
    simulated}`.

    Raises `RuntimeError` only when prerequisites are missing in *live*
    mode (no connected account, charges not enabled, missing email).
    """
    amount_cents = int(round(engagement.price * 100))
    currency = (engagement.currency or "usd").lower()

    s = _stripe()
    if s is None:
        sim = _sim_invoice(engagement)
        return {
            "invoice_id": sim["id"],
            "invoice_url": sim["url"],
            "status": sim["status"],
            "amount_cents": amount_cents,
            "currency": currency,
            "simulated": True,
        }

    if not partner.stripe_account_id:
        raise RuntimeError(
            "Partner has not completed Stripe Connect onboarding — cannot issue invoice."
        )
    if not partner.stripe_charges_enabled:
        raise RuntimeError(
            "Partner's Stripe account is not yet enabled for charges. Refresh status and retry."
        )
    if not founder_user or not founder_user.email:
        raise RuntimeError("Founder email required to issue invoice.")

    try:
        acct = partner.stripe_account_id
        # Idempotent customer lookup by founder email on the connected account.
        customer = s.Customer.create(
            email=founder_user.email,
            name=founder_user.name or founder_user.email,
            stripe_account=acct,
            idempotency_key=f"cust_eng_{engagement.id}",
        )
        s.InvoiceItem.create(
            customer=customer["id"],
            amount=amount_cents,
            currency=currency,
            description=f"{engagement.deliverables[:120]} (engagement #{engagement.id})",
            stripe_account=acct,
            idempotency_key=f"item_eng_{engagement.id}",
        )
        invoice = s.Invoice.create(
            customer=customer["id"],
            collection_method="send_invoice",
            days_until_due=14,
            stripe_account=acct,
            idempotency_key=f"inv_eng_{engagement.id}",
        )
        sent = s.Invoice.send_invoice(invoice["id"], stripe_account=acct)
        return {
            "invoice_id": sent["id"],
            "invoice_url": sent.get("hosted_invoice_url") or sent.get("invoice_pdf"),
            "status": sent.get("status") or "open",
            "amount_cents": amount_cents,
            "currency": currency,
            "simulated": False,
        }
    except Exception as exc:  # noqa: BLE001
        logger.error("Stripe invoice creation failed: %s", exc)
        raise RuntimeError(f"Stripe invoice creation failed: {exc}") from exc


def stripe_status_summary(partner: "Partner") -> dict:
    """Convenience DTO for the Partner Portal banner."""
    return {
        "live_mode": is_live(),
        "connected": bool(partner.stripe_account_id),
        "stripe_account_id": partner.stripe_account_id,
        "charges_enabled": bool(partner.stripe_charges_enabled),
        "payouts_enabled": bool(partner.stripe_payouts_enabled),
        "onboarded_at": partner.stripe_onboarded_at.isoformat() if partner.stripe_onboarded_at else None,
    }

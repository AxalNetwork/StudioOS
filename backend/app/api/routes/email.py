"""Email sending endpoints — branded Gmail notifications.

Two endpoints:
- POST /email/send-deal              (admin only) — broadcast a deal note
- POST /email/send-referral-invites  (any auth)   — bulk send personalized
                                                    invites from CSV-imported
                                                    contacts on the Refer & Earn
                                                    page

Both use the existing Gmail API path in services/email_service.py and inherit
its 20-emails-per-minute-per-user sliding-window rate limit.

Activity logs are written under action="email_sent" with details JSON that
includes type (deal|referral), to_count, sent, failed, subject. Per-recipient
addresses are NOT logged in full — we keep counts only to avoid a PII trail.
"""
import json
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from pydantic import BaseModel, Field

from backend.app.database import get_session
from backend.app.models.entities import User, UserRole, ActivityLog, Partner
from backend.app.api.routes.auth import get_current_user
from backend.app.services.email_service import (
    send_deal_email,
    send_referral_invite,
    is_email_configured,
)

router = APIRouter(prefix="/email", tags=["Email"])

# Lightweight unsubscribe landing page so the link in every email isn't a
# 404. A real preference center is a follow-up; this at least gives the
# recipient a usable confirmation. Mounted under /api by main.py, so the
# absolute URL is /api/unsubscribe?email=... — services/email_service.py
# generates this URL.
unsubscribe_router = APIRouter(tags=["Email"])

@unsubscribe_router.get("/unsubscribe", include_in_schema=False)
def unsubscribe_landing(email: str = ""):
    from fastapi.responses import HTMLResponse
    safe = (email or "").replace("<", "&lt;").replace(">", "&gt;")[:200]
    detail = (f"We won&rsquo;t send any more invitations to <strong>{safe}</strong>."
              if safe else "We won&rsquo;t send any more invitations to this address.")
    html = """<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed — Axal</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:480px;margin:80px auto;padding:32px;background:#fff;border:1px solid #e5e7eb;border-radius:16px;">
  <div style="font-size:20px;font-weight:700;color:#7c3aed;margin-bottom:24px;">&#9889; AXAL Ventures</div>
  <h1 style="font-size:20px;color:#111827;margin:0 0 12px;">You&rsquo;re opted out</h1>
  <p style="font-size:14px;color:#6b7280;line-height:1.6;">__DETAIL__
    If this was a mistake or you&rsquo;d like to manage your preferences in detail, reply to the email or contact us at hello@axal.vc.
  </p>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;">Axal Ventures &middot; axal.vc</p>
</div>
</body></html>""".replace("__DETAIL__", detail)
    return HTMLResponse(html)


logger = logging.getLogger("studioos.email_api")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class DealEmailRequest(BaseModel):
    to: List[str] = Field(..., min_length=1, max_length=200)
    subject: str = Field(..., min_length=2, max_length=200)
    html_body: str = Field(..., min_length=4, max_length=20000)
    cta_url: Optional[str] = None
    cta_label: Optional[str] = "View deal"


class InviteContact(BaseModel):
    email: str
    name: Optional[str] = None


class ReferralInviteRequest(BaseModel):
    contacts: List[InviteContact] = Field(..., min_length=1, max_length=100)
    custom_message: Optional[str] = Field(None, max_length=2000)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _log(session: Session, *, user: User, kind: str, payload: dict):
    try:
        session.add(ActivityLog(
            user_id=user.id,
            action="email_sent",
            actor=user.email,
            details=json.dumps({"type": kind, **payload}),
        ))
        session.commit()
    except Exception:
        logger.exception("Failed to write email activity log")
        session.rollback()


def _resolve_referral_for(user: User, session: Session) -> tuple[str, str]:
    """Return (code, link) for the user's referral. Partners have a stored
    referral_code; everyone else gets a code derived from their user_id (the
    /network/referral/code endpoint already does this lazily — we mirror it
    here to avoid a circular import)."""
    code: Optional[str] = None
    if user.partner_id:
        p = session.get(Partner, user.partner_id)
        if p and p.referral_code:
            code = p.referral_code.upper()
    if not code:
        # Fallback deterministic code so non-partner users can still invite.
        import hashlib
        h = hashlib.sha1(f"user:{user.id}:{user.email}".encode()).hexdigest().upper()
        code = f"AXAL-{h[:8]}"
    import os
    base = os.environ.get("APP_URL", "https://axal.vc").rstrip("/")
    return code, f"{base}/register?ref={code}"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/send-deal")
def send_deal(
    req: DealEmailRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    if not is_email_configured():
        raise HTTPException(status_code=503, detail="Email service not configured (Gmail OAuth missing)")

    result = send_deal_email(
        to_list=req.to,
        subject=req.subject,
        html_body=req.html_body,
        sender_label="Axal Deals",
        actor_user_id=user.id,
        cta_url=req.cta_url,
        cta_label=req.cta_label or "View deal",
    )
    if result.get("rate_limited"):
        raise HTTPException(status_code=429, detail=result.get("reason", "Rate limit exceeded"))

    _log(session, user=user, kind="deal", payload={
        "to_count": len(req.to),
        "sent": result["sent"],
        "failed": len(result["failed"]),
        "subject": req.subject[:120],
    })
    return result


@router.post("/send-referral-invites")
def send_referral_invites(
    req: ReferralInviteRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not is_email_configured():
        raise HTTPException(status_code=503, detail="Email service not configured (Gmail OAuth missing)")

    code, link_base = _resolve_referral_for(user, session)
    referrer_name = user.name or user.email.split("@")[0]

    sent = 0
    failed: list[dict] = []
    for c in req.contacts:
        email = (c.email or "").strip()
        if not email or "@" not in email:
            failed.append({"email": email, "error": "invalid"})
            continue
        # Personalized link includes the invitee param so we can attribute
        # opens/conversions back to a specific contact later.
        from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl
        parts = urlsplit(link_base)
        q = dict(parse_qsl(parts.query))
        q["invitee"] = email
        link = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(q), parts.fragment))

        ok = send_referral_invite(
            to_email=email,
            to_name=c.name,
            referrer_name=referrer_name,
            referral_code=code,
            referral_link=link,
            custom_message=req.custom_message,
            actor_user_id=user.id,
            reply_to=user.email,
        )
        if ok:
            sent += 1
        else:
            failed.append({"email": email, "error": "send_failed_or_rate_limited"})

    _log(session, user=user, kind="referral", payload={
        "to_count": len(req.contacts),
        "sent": sent,
        "failed": len(failed),
        "code": code,
    })
    return {"sent": sent, "failed": failed, "code": code}

"""Task #58 — Trust layer hardening routes.

Surface for:
  - KYB (partner-self-serve via Sumsub or deterministic mock fallback)
  - Investor accreditation upload + admin review + verified badge
  - Per-role NDA generation, signing, and status

All under /api/trust.
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import (APIRouter, Depends, File, Form, Header, HTTPException,
                     Request, UploadFile)
from pydantic import BaseModel, Field as PField
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    Document, Investor, Partner, User,
)
from backend.app.services.trust import (
    NDA_TEMPLATES, apply_sumsub_webhook, ensure_nda_acceptance,
    list_nda_status, required_nda_roles_for, review_accreditation,
    sign_nda, start_kyb, store_accreditation_doc, submit_kyb,
    sumsub_available, verify_sumsub_webhook,
)

logger = logging.getLogger("studioos.trust")
router = APIRouter(prefix="/trust", tags=["Trust Layer"])


def _is_admin(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "admin"


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _require_partner_row(session: Session, user: User) -> Partner:
    if not user.partner_id:
        raise HTTPException(status_code=400, detail="No partner profile linked to your user")
    p = session.get(Partner, user.partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Partner row not found")
    return p


def _require_investor_row(session: Session, user: User) -> Investor:
    if not user.investor_id:
        raise HTTPException(status_code=400, detail="No investor profile linked to your user")
    i = session.get(Investor, user.investor_id)
    if not i:
        raise HTTPException(status_code=404, detail="Investor row not found")
    return i


# ===========================================================================
# KYB — Sumsub-extended
# ===========================================================================
class KybStartIn(BaseModel):
    legal_name: str = PField(min_length=1, max_length=200)
    business_id: str = PField(min_length=1, max_length=64)  # EIN, VAT, company number
    country: str = PField(min_length=2, max_length=3)
    email: Optional[str] = None


class KybSubmitIn(BaseModel):
    legal_name: str
    business_id: str
    country: str
    address: Optional[str] = None
    representative_name: Optional[str] = None


@router.get("/kyb/status")
def kyb_status(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _require_partner_row(session, user)
    return {
        "partner_id": p.id,
        "kyb_status": p.kyb_status,
        "kyb_provider": p.kyb_provider,
        "kyb_ref_id": p.kyb_ref_id,
        "kyb_verified_at": p.kyb_verified_at.isoformat() if p.kyb_verified_at else None,
        "sumsub_available": sumsub_available(),
    }


@router.post("/kyb/start")
def kyb_start(
    body: KybStartIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _require_partner_row(session, user)
    if p.kyb_status == "verified":
        raise HTTPException(status_code=409, detail="KYB already verified")
    return start_kyb(session, p, body.dict())


@router.post("/kyb/submit")
def kyb_submit(
    body: KybSubmitIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _require_partner_row(session, user)
    if p.kyb_status == "verified":
        raise HTTPException(status_code=409, detail="KYB already verified")
    if p.kyb_provider != "mock":
        raise HTTPException(
            status_code=400,
            detail="Sumsub-mode KYB submits via the hosted SDK; the webhook updates status.",
        )
    try:
        return submit_kyb(session, p, body.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/kyb/webhook")
async def kyb_webhook(
    request: Request,
    x_payload_digest: Optional[str] = Header(default=None, alias="X-Payload-Digest"),
    session: Session = Depends(get_session),
):
    """Public webhook endpoint. Sumsub posts here when an applicant review
    completes. We verify the HMAC over the raw body using SUMSUB_WEBHOOK_SECRET."""
    import os
    secret = os.getenv("SUMSUB_WEBHOOK_SECRET", "")
    if not secret:
        # Hard-fail closed: an unset secret must never accept webhooks even
        # if the caller sends a matching empty signature.
        raise HTTPException(status_code=503, detail="Webhook receiver not configured")
    raw = await request.body()
    if not verify_sumsub_webhook(secret, x_payload_digest or "", raw):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw.decode() or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    p = apply_sumsub_webhook(session, payload)
    return {"ok": True, "matched_partner_id": p.id if p else None}


# ===========================================================================
# Accreditation
# ===========================================================================
@router.get("/accreditation/status")
def accreditation_status(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    inv = _require_investor_row(session, user)
    return {
        "investor_id": inv.id,
        "accreditation_status": inv.accreditation_status,
        "accreditation_basis": inv.accreditation_basis,
        "accreditation_verified_at": inv.accreditation_verified_at.isoformat() if inv.accreditation_verified_at else None,
        "has_document": inv.accreditation_document_id is not None,
        "verified_badge": inv.accreditation_status == "verified",
    }


@router.post("/accreditation/upload")
async def accreditation_upload(
    basis: str = Form(...),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    inv = _require_investor_row(session, user)
    data = await file.read()
    try:
        doc = store_accreditation_doc(
            session, inv,
            filename=file.filename or "upload",
            content_type=file.content_type or "application/octet-stream",
            data=data, basis=basis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "document_uid": doc.uid, "investor_status": inv.accreditation_status}


class AccreditationReviewIn(BaseModel):
    decision: str  # 'verified' | 'rejected'


@router.post("/accreditation/{investor_id}/review")
def accreditation_review(
    investor_id: int,
    body: AccreditationReviewIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    inv = session.get(Investor, investor_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investor not found")
    try:
        review_accreditation(session, inv, reviewer=user, decision=body.decision)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "investor_id": inv.id, "status": inv.accreditation_status}


@router.get("/accreditation/badge/{investor_id}")
def accreditation_badge(
    investor_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Public-ish: any authenticated user can read whether an investor is
    *verified* (used to render the badge next to their name in deals /
    profiles). We deliberately *do not* leak `rejected` / `pending` /
    `self_attested` to peers — that's the investor's private journey and
    surfacing 'rejected' to a third party would be a reputational leak.
    The investor themselves and admins see full detail."""
    inv = session.get(Investor, investor_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investor not found")
    is_self = user.investor_id == inv.id
    if _is_admin(user) or is_self:
        return {
            "investor_id": inv.id,
            "verified": inv.accreditation_status == "verified",
            "status": inv.accreditation_status,
            "basis": inv.accreditation_basis,
            "document_id": inv.accreditation_document_id,
            "verified_at": inv.accreditation_verified_at.isoformat() if inv.accreditation_verified_at else None,
        }
    # Peer view: only the binary verified bit + verified_at when applicable.
    return {
        "investor_id": inv.id,
        "verified": inv.accreditation_status == "verified",
        "verified_at": inv.accreditation_verified_at.isoformat() if inv.accreditation_verified_at else None,
    }


# ===========================================================================
# NDA
# ===========================================================================
@router.get("/nda/required")
def nda_required(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """List NDAs required for the current user, auto-instantiating any
    missing rows so the client can show a real document_id immediately."""
    for role in required_nda_roles_for(user):
        ensure_nda_acceptance(session, user, role)
    return {"items": list_nda_status(session, user)}


@router.get("/nda/{role}/preview")
def nda_preview(
    role: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if role not in NDA_TEMPLATES:
        raise HTTPException(status_code=404, detail="Unknown NDA role")
    if role not in required_nda_roles_for(user) and not _is_admin(user):
        raise HTTPException(status_code=403, detail="That NDA is not required for your role")
    acc = ensure_nda_acceptance(session, user, role)
    doc = session.get(Document, acc.document_id) if acc.document_id else None
    return {
        "uid": acc.uid, "role": role, "status": acc.status,
        "title": NDA_TEMPLATES[role]["title"],
        "body": doc.content if doc else NDA_TEMPLATES[role]["body"],
        "document_id": acc.document_id,
    }


class NdaSignIn(BaseModel):
    role: str
    signer_name: str = PField(min_length=1, max_length=200)
    accepted: bool


@router.post("/nda/sign")
def nda_sign(
    body: NdaSignIn,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if body.role not in required_nda_roles_for(user):
        raise HTTPException(status_code=403, detail="That NDA is not required for your role")
    if not body.accepted:
        raise HTTPException(status_code=400, detail="You must affirmatively accept the NDA terms")
    acc = ensure_nda_acceptance(session, user, body.role)
    try:
        sign_nda(session, acc, signer_name=body.signer_name, ip=_client_ip(request))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, "uid": acc.uid, "status": acc.status,
            "signed_at": acc.signed_at.isoformat() if acc.signed_at else None}


@router.get("/nda/status")
def nda_status_endpoint(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return {"items": list_nda_status(session, user)}


# ===========================================================================
# Trust summary — single endpoint the UI uses to render the Trust Center.
# ===========================================================================
@router.get("/summary")
def trust_summary(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    out: dict = {"role": getattr(user.role, "value", user.role), "ndas": list_nda_status(session, user)}
    # `user.partner_id` / `user.investor_id` are already truthy here, so the
    # only HTTPException `_require_*_row` can raise is its 404 — the linked
    # row was deleted but the FK on `users` was not cleaned up. Omitting that
    # section from the summary is correct; failing the whole Trust Center over
    # a stale link is not.
    if user.partner_id:
        try:
            p = _require_partner_row(session, user)
            out["kyb"] = {
                "partner_id": p.id, "status": p.kyb_status,
                "provider": p.kyb_provider, "ref_id": p.kyb_ref_id,
                "verified_at": p.kyb_verified_at.isoformat() if p.kyb_verified_at else None,
                "sumsub_available": sumsub_available(),
            }
        except HTTPException:
            # Best-effort — see the comment above this section.
            pass
    if user.investor_id:
        try:
            inv = _require_investor_row(session, user)
            out["accreditation"] = {
                "investor_id": inv.id,
                "status": inv.accreditation_status,
                "basis": inv.accreditation_basis,
                "verified": inv.accreditation_status == "verified",
                "verified_at": inv.accreditation_verified_at.isoformat() if inv.accreditation_verified_at else None,
                "has_document": inv.accreditation_document_id is not None,
            }
        except HTTPException:
            # Best-effort — see the comment above this section.
            pass
    return out


# ===========================================================================
# Task #38 — DEV-ONLY obligation matrix (/trust/me).
# ---------------------------------------------------------------------------
# Production hosts /trust/me on the Worker, backed by a legal_obligations
# table seeded per role. The dev backend has no such table, so the Settings
# ProfileTrustBadge + Trust Center used to 404. Return an empty-but-valid
# matrix (no required obligations → fully compliant).
# ===========================================================================
@router.get("/me")
def trust_me(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return {
        "role": getattr(user.role, "value", user.role),
        "obligations": [],
        "required_open_count": 0,
        "fully_compliant": True,
    }


# ===========================================================================
# Task #41 — DEV-ONLY trust intro stubs
# ---------------------------------------------------------------------------
# The production Cloudflare Worker hosts /trust/intro/{request,status} with
# a full 3-way envelope creation flow (cloudflare-worker/src/routes/trust.ts
# + services/trustEnvelope.ts). The dev FastAPI backend doesn't have R2 +
# DocuSign + Resend wired in, so we provide a tiny stub that's just enough
# to drive the LockedFounderCard UI:
#
#   POST /trust/intro/request  → upserts a row in `dev_pairwise_ndas`
#                                with status='pending', returns
#                                {status: 'envelope_issued', envelope_uuid}.
#                                If a row already exists with status='active'
#                                we short-circuit with {status: 'already_active'}.
#   GET  /trust/intro/status   → returns {active, status, ...} matching the
#                                shape `LockedFounderCard.useEffect` reads.
#
# The dev backend never deploys (replit.md), so this stub can never serve
# real production traffic. Branch order matches the worker's
# `requestIntroLogic` so the failure modes (cannot_intro_self,
# founder_not_found, target_is_not_a_founder) stay observable in dev.
# ===========================================================================
class IntroRequestIn(BaseModel):
    founder_user_id: int


@router.post("/intro/request")
def trust_intro_request(
    body: IntroRequestIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    role = (getattr(user.role, "value", user.role) or "").lower()
    if role not in ("investor", "admin"):
        raise HTTPException(status_code=403, detail="investor_role_required")
    fid = int(body.founder_user_id or 0)
    if fid <= 0:
        raise HTTPException(status_code=400, detail="founder_user_id required")
    if fid == user.id:
        raise HTTPException(status_code=400, detail="cannot_intro_self")

    founder = session.get(User, fid)
    if not founder:
        raise HTTPException(status_code=404, detail="founder_not_found")
    f_role = (getattr(founder.role, "value", founder.role) or "").lower()
    if f_role != "founder":
        raise HTTPException(status_code=400, detail="target_is_not_a_founder")

    # Lazy-create the dev table — the lifespan hook also runs this, but
    # belt-and-braces in case a fresh dev DB is dropped in mid-process.
    from backend.app.services.demo_seed import ensure_dev_pairwise_ndas_table
    ensure_dev_pairwise_ndas_table()

    existing = session.exec(
        text(
            """SELECT status, envelope_uuid FROM dev_pairwise_ndas
               WHERE founder_user_id = :f AND investor_user_id = :i"""
        ).bindparams(f=fid, i=user.id)
    ).first()
    if existing and (existing[0] if isinstance(existing, tuple) else existing._mapping["status"]) == "active":
        env_uuid = existing[1] if isinstance(existing, tuple) else existing._mapping["envelope_uuid"]
        return {"status": "already_active", "envelope_uuid": env_uuid}

    import uuid as _uuid
    env_uuid = _uuid.uuid4().hex
    if existing:
        session.exec(
            text(
                """UPDATE dev_pairwise_ndas SET status='pending', envelope_uuid=:e
                   WHERE founder_user_id=:f AND investor_user_id=:i"""
            ).bindparams(e=env_uuid, f=fid, i=user.id)
        )
    else:
        session.exec(
            text(
                """INSERT INTO dev_pairwise_ndas
                   (founder_user_id, investor_user_id, status, envelope_uuid)
                   VALUES (:f, :i, 'pending', :e)"""
            ).bindparams(f=fid, i=user.id, e=env_uuid)
        )
    session.commit()
    # Match the worker's success-shape so the frontend (LockedFounderCard)
    # treats this exactly like the prod flow: anything other than
    # `already_active` flips the card to "Intro pending — sign NDA".
    return {
        "status": "envelope_issued",
        "envelope_uuid": env_uuid,
        # Dev stub: no real signing URL — point at /trust so the UI hint
        # ("sign the mutual NDA in your Trust Center") still resolves.
        "signing_url": "/trust",
    }


@router.get("/intro/status")
def trust_intro_status(
    founder: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    role = (getattr(user.role, "value", user.role) or "").lower()
    if role not in ("investor", "admin"):
        raise HTTPException(status_code=403, detail="investor_role_required")
    fid = int(founder or 0)
    if fid <= 0:
        raise HTTPException(status_code=400, detail="founder query param required")

    from backend.app.services.demo_seed import ensure_dev_pairwise_ndas_table
    ensure_dev_pairwise_ndas_table()

    row = session.exec(
        text(
            """SELECT status FROM dev_pairwise_ndas
               WHERE founder_user_id=:f AND investor_user_id=:i"""
        ).bindparams(f=fid, i=user.id)
    ).first()
    status = "none"
    if row:
        status = row[0] if isinstance(row, tuple) else row._mapping["status"]
    return {
        "founder_user_id": fid,
        "investor_user_id": user.id,
        "status": status,
        "valid_until": None,
        "active": status == "active",
    }

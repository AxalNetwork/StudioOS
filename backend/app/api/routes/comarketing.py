"""Task #54 — Co-marketing pitch + admin approval + attribution tracking.

Three surfaces:

Partner-side (`/api/comarketing/me/...`):
    submit a pitch (webinar / blog / podcast / event / newsletter), edit
    while still `proposed`, withdraw, list my own pitches with current
    status + attribution counts.

Admin-side (`/api/comarketing/admin/...`):
    queue of pending pitches, approve/reject with notes, mark published
    (records `published_url` and surfaces it in the public list).
    Approval mints a stable `attribution_code` partners use in
    `?utm_comark=<code>` URLs.

Public (auth-gated) (`/api/comarketing/published`, `/track`):
    list approved+published campaigns; `POST /track` records an inbound
    visit/lead/signup linked to the originating pitch.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field as PField
from sqlalchemy import func
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    CoMarketingAttribution, CoMarketingPitch, Partner, User,
)

logger = logging.getLogger("studioos.comarketing")
router = APIRouter(prefix="/comarketing", tags=["Co-marketing"])

ASSET_TYPES = {"webinar", "blog", "podcast", "event", "newsletter", "other"}
LEGAL_TRANSITIONS = {
    "approved":  {"proposed"},
    "rejected":  {"proposed"},
    "published": {"approved"},
    "withdrawn": {"proposed", "approved"},
}


def _is_admin(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "admin"


def _is_partner_role(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "partner"


def _require_partner(session: Session, user: User) -> Partner:
    """Role-gated partner resolver — see partner_office_hours._require_partner.

    Hardened (Task #54 review): rejects callers who are not partner or
    admin BEFORE any email-based resolution to close a privilege-escalation
    path on shared-email accounts."""
    if not (_is_partner_role(user) or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Partner role required")
    if user.partner_id:
        p = session.get(Partner, user.partner_id)
        if p:
            return p
    p = session.exec(select(Partner).where(Partner.email == user.email)).first()
    if p:
        if not user.partner_id and _is_partner_role(user):
            user.partner_id = p.id
            session.add(user); session.commit()
        return p
    raise HTTPException(status_code=400, detail="No partner profile attached to your account")


def _mint_attribution_code(session: Session) -> str:
    """Generate a short URL-safe attribution code, retry on collision."""
    for _ in range(5):
        code = secrets.token_urlsafe(8).rstrip("=").replace("/", "").replace("+", "")[:12].lower()
        exists = session.exec(
            select(CoMarketingPitch).where(CoMarketingPitch.attribution_code == code)
        ).first()
        if not exists:
            return code
    # Last-ditch: use uid suffix (extremely unlikely to be reached).
    return secrets.token_urlsafe(16)[:16]


def _attribution_counts(session: Session, pitch_id: int) -> dict:
    rows = session.exec(
        select(CoMarketingAttribution.event_kind, func.count(CoMarketingAttribution.id))  # type: ignore[arg-type]
        .where(CoMarketingAttribution.pitch_id == pitch_id)
        .group_by(CoMarketingAttribution.event_kind)
    ).all()
    out = {"visit": 0, "signup": 0, "lead": 0, "conversion": 0, "total": 0}
    for kind, n in rows:
        out[kind] = int(n)
        out["total"] += int(n)
    return out


def _pitch_dto(p: CoMarketingPitch, *, attribution: Optional[dict] = None,
               include_review_notes: bool = True) -> dict:
    data = {
        "id": p.id,
        "uid": p.uid,
        "partner_id": p.partner_id,
        "submitter_user_id": p.submitter_user_id,
        "title": p.title,
        "summary": p.summary,
        "asset_type": p.asset_type,
        "proposed_date": p.proposed_date.isoformat() if p.proposed_date else None,
        "target_audience": p.target_audience,
        "distribution_channels": p.distribution_channels,
        "co_branding_notes": p.co_branding_notes,
        "asset_url": p.asset_url,
        "status": p.status,
        "published_at": p.published_at.isoformat() if p.published_at else None,
        "published_url": p.published_url,
        "attribution_code": p.attribution_code,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
    }
    if include_review_notes:
        data["review_notes"] = p.review_notes
        data["reviewed_at"] = p.reviewed_at.isoformat() if p.reviewed_at else None
    if attribution is not None:
        data["attribution"] = attribution
    return data


# ===========================================================================
# Partner-side: submit + manage own pitches
# ===========================================================================
class PitchCreate(BaseModel):
    title: str = PField(min_length=3, max_length=200)
    summary: str = PField(min_length=10, max_length=4000)
    asset_type: str = PField(default="webinar")
    proposed_date: Optional[datetime] = None
    target_audience: Optional[str] = PField(default=None, max_length=500)
    distribution_channels: Optional[str] = PField(default=None, max_length=500)
    co_branding_notes: Optional[str] = PField(default=None, max_length=2000)
    asset_url: Optional[str] = PField(default=None, max_length=500)


class PitchUpdate(BaseModel):
    title: Optional[str] = PField(default=None, max_length=200)
    summary: Optional[str] = PField(default=None, max_length=4000)
    asset_type: Optional[str] = None
    proposed_date: Optional[datetime] = None
    target_audience: Optional[str] = PField(default=None, max_length=500)
    distribution_channels: Optional[str] = PField(default=None, max_length=500)
    co_branding_notes: Optional[str] = PField(default=None, max_length=2000)
    asset_url: Optional[str] = PField(default=None, max_length=500)


@router.post("/me/pitches")
def submit_pitch(
    body: PitchCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not (_is_partner_role(user) or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Partner role required")
    if body.asset_type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail=f"asset_type must be one of {sorted(ASSET_TYPES)}")
    p = _require_partner(session, user)
    pitch = CoMarketingPitch(
        partner_id=p.id,
        submitter_user_id=user.id,
        title=body.title.strip(),
        summary=body.summary.strip(),
        asset_type=body.asset_type,
        proposed_date=body.proposed_date,
        target_audience=body.target_audience,
        distribution_channels=body.distribution_channels,
        co_branding_notes=body.co_branding_notes,
        asset_url=body.asset_url,
        status="proposed",
    )
    session.add(pitch); session.commit(); session.refresh(pitch)
    return _pitch_dto(pitch, attribution=_attribution_counts(session, pitch.id))


@router.get("/me/pitches")
def list_my_pitches(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _require_partner(session, user)
    stmt = select(CoMarketingPitch).where(CoMarketingPitch.partner_id == p.id)
    if status_filter:
        stmt = stmt.where(CoMarketingPitch.status == status_filter)
    rows = session.exec(stmt.order_by(CoMarketingPitch.created_at.desc())).all()
    return {
        "items": [
            _pitch_dto(r, attribution=_attribution_counts(session, r.id))
            for r in rows
        ],
    }


@router.patch("/me/pitches/{pitch_uid}")
def edit_pitch(
    pitch_uid: str,
    body: PitchUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _require_partner(session, user)
    pitch = session.exec(
        select(CoMarketingPitch).where(CoMarketingPitch.uid == pitch_uid)
    ).first()
    if not pitch or pitch.partner_id != p.id:
        raise HTTPException(status_code=404, detail="Pitch not found")
    if pitch.status != "proposed":
        raise HTTPException(status_code=409, detail="Pitch can only be edited while proposed")
    if body.asset_type and body.asset_type not in ASSET_TYPES:
        raise HTTPException(status_code=400, detail="invalid asset_type")
    for f in ("title", "summary", "asset_type", "proposed_date",
              "target_audience", "distribution_channels", "co_branding_notes",
              "asset_url"):
        v = getattr(body, f)
        if v is not None:
            setattr(pitch, f, v)
    pitch.updated_at = datetime.utcnow()
    session.add(pitch); session.commit(); session.refresh(pitch)
    return _pitch_dto(pitch, attribution=_attribution_counts(session, pitch.id))


@router.post("/me/pitches/{pitch_uid}/withdraw")
def withdraw_pitch(
    pitch_uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _require_partner(session, user)
    pitch = session.exec(
        select(CoMarketingPitch).where(CoMarketingPitch.uid == pitch_uid)
    ).first()
    if not pitch or pitch.partner_id != p.id:
        raise HTTPException(status_code=404, detail="Pitch not found")
    if pitch.status not in LEGAL_TRANSITIONS["withdrawn"]:
        raise HTTPException(status_code=409, detail=f"Cannot withdraw from {pitch.status}")
    pitch.status = "withdrawn"
    pitch.updated_at = datetime.utcnow()
    session.add(pitch); session.commit(); session.refresh(pitch)
    return _pitch_dto(pitch, attribution=_attribution_counts(session, pitch.id))


# ===========================================================================
# Admin: review queue + approval
# ===========================================================================
class ReviewBody(BaseModel):
    notes: Optional[str] = PField(default=None, max_length=2000)


class PublishBody(BaseModel):
    published_url: Optional[str] = PField(default=None, max_length=500)
    notes: Optional[str] = PField(default=None, max_length=2000)


@router.get("/admin/queue")
def admin_queue(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Admin-only: list all pitches across all partners (default: proposed)."""
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    stmt = select(CoMarketingPitch)
    if status_filter:
        stmt = stmt.where(CoMarketingPitch.status == status_filter)
    else:
        stmt = stmt.where(CoMarketingPitch.status == "proposed")
    rows = session.exec(stmt.order_by(CoMarketingPitch.created_at.desc())).all()
    items = []
    for r in rows:
        partner = session.get(Partner, r.partner_id)
        d = _pitch_dto(r, attribution=_attribution_counts(session, r.id))
        d["partner_name"] = partner.name if partner else None
        d["partner_company"] = partner.company if partner else None
        items.append(d)
    return {"items": items}


@router.post("/admin/pitches/{pitch_uid}/approve")
def approve_pitch(
    pitch_uid: str,
    body: ReviewBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    pitch = session.exec(
        select(CoMarketingPitch).where(CoMarketingPitch.uid == pitch_uid)
    ).first()
    if not pitch:
        raise HTTPException(status_code=404, detail="Pitch not found")
    if pitch.status not in LEGAL_TRANSITIONS["approved"]:
        raise HTTPException(status_code=409, detail=f"Cannot approve from {pitch.status}")
    pitch.status = "approved"
    pitch.review_notes = body.notes
    pitch.reviewed_by_user_id = user.id
    pitch.reviewed_at = datetime.utcnow()
    if not pitch.attribution_code:
        pitch.attribution_code = _mint_attribution_code(session)
    pitch.updated_at = datetime.utcnow()
    session.add(pitch); session.commit(); session.refresh(pitch)
    return _pitch_dto(pitch, attribution=_attribution_counts(session, pitch.id))


@router.post("/admin/pitches/{pitch_uid}/reject")
def reject_pitch(
    pitch_uid: str,
    body: ReviewBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    pitch = session.exec(
        select(CoMarketingPitch).where(CoMarketingPitch.uid == pitch_uid)
    ).first()
    if not pitch:
        raise HTTPException(status_code=404, detail="Pitch not found")
    if pitch.status not in LEGAL_TRANSITIONS["rejected"]:
        raise HTTPException(status_code=409, detail=f"Cannot reject from {pitch.status}")
    pitch.status = "rejected"
    pitch.review_notes = body.notes
    pitch.reviewed_by_user_id = user.id
    pitch.reviewed_at = datetime.utcnow()
    pitch.updated_at = datetime.utcnow()
    session.add(pitch); session.commit(); session.refresh(pitch)
    return _pitch_dto(pitch, attribution=_attribution_counts(session, pitch.id))


@router.post("/admin/pitches/{pitch_uid}/publish")
def publish_pitch(
    pitch_uid: str,
    body: PublishBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Admin only")
    pitch = session.exec(
        select(CoMarketingPitch).where(CoMarketingPitch.uid == pitch_uid)
    ).first()
    if not pitch:
        raise HTTPException(status_code=404, detail="Pitch not found")
    if pitch.status not in LEGAL_TRANSITIONS["published"]:
        raise HTTPException(status_code=409, detail=f"Cannot publish from {pitch.status}")
    pitch.status = "published"
    pitch.published_at = datetime.utcnow()
    if body.published_url:
        pitch.published_url = body.published_url
    if body.notes:
        # Append rather than overwrite the approval notes.
        prefix = f"{pitch.review_notes}\n\n" if pitch.review_notes else ""
        pitch.review_notes = f"{prefix}[publish] {body.notes}"
    pitch.updated_at = datetime.utcnow()
    session.add(pitch); session.commit(); session.refresh(pitch)
    return _pitch_dto(pitch, attribution=_attribution_counts(session, pitch.id))


# ===========================================================================
# Public + attribution
# ===========================================================================
@router.get("/published")
def list_published(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """List approved+published co-marketing pieces. Visible to any logged-in user."""
    rows = session.exec(
        select(CoMarketingPitch)
        .where(CoMarketingPitch.status == "published")
        .order_by(CoMarketingPitch.published_at.desc())
    ).all()
    items = []
    for r in rows:
        partner = session.get(Partner, r.partner_id)
        d = _pitch_dto(r, include_review_notes=False)
        d["partner_name"] = partner.name if partner else None
        d["partner_company"] = partner.company if partner else None
        items.append(d)
    return {"items": items}


class TrackBody(BaseModel):
    code: str = PField(min_length=2, max_length=64)
    event_kind: str = PField(default="visit")
    lead_email: Optional[str] = PField(default=None, max_length=320)
    landing_path: Optional[str] = PField(default=None, max_length=500)
    notes: Optional[str] = PField(default=None, max_length=1000)
    project_id: Optional[int] = None


@router.post("/track")
def track_attribution(
    body: TrackBody,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Record an inbound demand event tagged to a co-marketing piece.

    Authenticated callers tag against `user_id`. The frontend should call
    this on landing pages it controls (e.g. `/?utm_comark=<code>`).
    Unknown codes return 404 so the frontend can fail silently.
    """
    if body.event_kind not in ("visit", "signup", "lead", "conversion"):
        raise HTTPException(status_code=400, detail="invalid event_kind")
    pitch = session.exec(
        select(CoMarketingPitch).where(CoMarketingPitch.attribution_code == body.code)
    ).first()
    if not pitch:
        raise HTTPException(status_code=404, detail="Unknown attribution code")
    if pitch.status not in ("approved", "published"):
        raise HTTPException(status_code=409, detail="Pitch not active")
    referrer = request.headers.get("referer") or request.headers.get("referrer")
    row = CoMarketingAttribution(
        pitch_id=pitch.id,
        partner_id=pitch.partner_id,
        event_kind=body.event_kind,
        user_id=user.id,
        project_id=body.project_id,
        lead_email=(body.lead_email or user.email),
        referrer=(referrer[:500] if referrer else None),
        landing_path=body.landing_path,
        notes=body.notes,
    )
    session.add(row); session.commit(); session.refresh(row)
    return {"ok": True, "pitch_uid": pitch.uid, "attribution_uid": row.uid}


@router.get("/me/attributions")
def list_my_attributions(
    pitch_uid: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Partner-side: see raw attribution rows for my pitches."""
    p = _require_partner(session, user)
    stmt = select(CoMarketingAttribution).where(CoMarketingAttribution.partner_id == p.id)
    if pitch_uid:
        pitch = session.exec(
            select(CoMarketingPitch).where(CoMarketingPitch.uid == pitch_uid)
        ).first()
        if pitch:
            stmt = stmt.where(CoMarketingAttribution.pitch_id == pitch.id)
    rows = session.exec(stmt.order_by(CoMarketingAttribution.created_at.desc()).limit(500)).all()
    return {
        "items": [
            {
                "uid": r.uid,
                "pitch_id": r.pitch_id,
                "event_kind": r.event_kind,
                "lead_email": r.lead_email,
                "referrer": r.referrer,
                "landing_path": r.landing_path,
                "notes": r.notes,
                "created_at": r.created_at.isoformat(),
            } for r in rows
        ],
    }

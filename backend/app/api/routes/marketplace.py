"""Task #36 — Service provider marketplace.

A discoverable directory of vetted service providers (legal, accounting,
design, recruiting, fractional CFO, GTM). The Partner role from Phase 0.1
identifies providers; this module wires their public-facing profiles,
verification badges, reviews, and inquiry threads.

Out of scope (per task brief): Stripe Connect invoicing (Task 5.2) and
featured / paid placement (Task 5.4).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field as PydField, field_validator
from sqlmodel import Session, select, func

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    ActivityLog,
    MarketplaceInquiry,
    MarketplaceMessage,
    Partner,
    PartnerReview,
    Project,
    User,
    UserRole,
)

router = APIRouter(prefix="/marketplace", tags=["Service Provider Marketplace"])

VALID_CATEGORIES = {"legal", "accounting", "design", "recruiting", "fractional_cfo", "gtm", "engineering", "marketing"}
VALID_CAPACITY = {"available", "limited", "unavailable"}
VALID_KYB = {"unverified", "pending", "verified", "rejected"}
VALID_PRICING = {"$", "$$", "$$$"}


def _parse_json(s: str | None, default):
    try:
        v = json.loads(s) if s else default
        return v if v is not None else default
    except Exception:
        return default


# ---------------------------------------------------------------------------
# Authorization helpers
# ---------------------------------------------------------------------------
def _ensure_admin(user: User):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")


def _partner_for_user(session: Session, user: User) -> Partner | None:
    """Resolve a partner row strictly via the explicit `User.partner_id`
    foreign key. We deliberately do NOT fall back to email matching for
    authorization purposes — Phase 0.1 already backfills the FK and an
    email-only match could let a newly-registered user impersonate a
    legacy partner row."""
    if user.partner_id:
        return session.get(Partner, user.partner_id)
    return None


def _ensure_partner_self_or_admin(partner: Partner, user: User) -> None:
    if user.role == UserRole.ADMIN:
        return
    if user.role == UserRole.PARTNER and (user.partner_id == partner.id or user.email == partner.email):
        return
    raise HTTPException(status_code=403, detail="Forbidden")


# ---------------------------------------------------------------------------
# Public DTOs
# ---------------------------------------------------------------------------
def _summarize_reviews(session: Session, partner_id: int) -> dict:
    rows = session.exec(
        select(PartnerReview).where(PartnerReview.partner_id == partner_id)
    ).all()
    if not rows:
        return {"avg_rating": None, "count": 0}
    avg = sum(r.rating for r in rows) / len(rows)
    return {"avg_rating": round(avg, 2), "count": len(rows)}


def _public_provider_dto(p: Partner, reviews_summary: dict) -> dict:
    return {
        "id": p.id,
        "uid": p.uid,
        "name": p.name,
        "company": p.company,
        "headline": p.headline,
        "bio": p.bio,
        "categories": _parse_json(p.categories_json, []),
        "sectors": _parse_json(p.sectors_json, []),
        "pricing_tier": p.pricing_tier,
        "hourly_rate_min": p.hourly_rate_min,
        "hourly_rate_max": p.hourly_rate_max,
        "capacity_status": p.capacity_status,
        "response_time_hours": p.response_time_hours,
        "kyb_status": p.kyb_status,
        "kyb_verified": p.kyb_status == "verified",
        "website": p.website,
        "listed": p.listed,
        "specialization": p.specialization,
        "reviews": reviews_summary,
    }


# ---------------------------------------------------------------------------
# Provider profiles — list / detail / self-edit
# ---------------------------------------------------------------------------
class ProviderProfileIn(BaseModel):
    headline: Optional[str] = None
    bio: Optional[str] = None
    categories: list[str] = []
    sectors: list[str] = []
    pricing_tier: Optional[str] = None
    hourly_rate_min: Optional[float] = PydField(default=None, ge=0)
    hourly_rate_max: Optional[float] = PydField(default=None, ge=0)
    capacity_status: str = "available"
    response_time_hours: Optional[int] = PydField(default=None, ge=0)
    website: Optional[str] = None
    listed: bool = False

    @field_validator("categories")
    @classmethod
    def _check_cats(cls, v):
        for c in v:
            if c not in VALID_CATEGORIES:
                raise ValueError(f"unknown category {c}; must be one of {sorted(VALID_CATEGORIES)}")
        return v

    @field_validator("capacity_status")
    @classmethod
    def _check_capacity(cls, v):
        if v not in VALID_CAPACITY:
            raise ValueError(f"capacity_status must be one of {sorted(VALID_CAPACITY)}")
        return v

    @field_validator("pricing_tier")
    @classmethod
    def _check_pricing(cls, v):
        if v is not None and v not in VALID_PRICING:
            raise ValueError(f"pricing_tier must be one of {sorted(VALID_PRICING)}")
        return v


@router.get("/providers")
def list_providers(
    category: Optional[str] = None,
    sector: Optional[str] = None,
    capacity: Optional[str] = Query(default=None, description="available | limited | unavailable"),
    pricing: Optional[str] = Query(default=None, description="$ | $$ | $$$"),
    verified_only: bool = False,
    rate_max: Optional[float] = None,
    q: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """List marketplace-listed providers with filters. Founders / investors /
    partners / admins can browse; partners always see themselves regardless
    of `listed`."""
    stmt = select(Partner).where(Partner.status == "active").where(Partner.listed == True)  # noqa: E712
    rows = session.exec(stmt).all()

    # Always include the viewer's own provider row (even if unlisted) so they
    # can preview their listing as it will appear publicly.
    if user.role == UserRole.PARTNER and user.partner_id:
        own = session.get(Partner, user.partner_id)
        if own and own not in rows:
            rows = list(rows) + [own]

    # In-memory filtering on JSON columns (small marketplace; switch to GIN
    # indexes later if cardinality grows).
    out = []
    for p in rows:
        cats = _parse_json(p.categories_json, [])
        secs = _parse_json(p.sectors_json, [])
        if category and category not in cats:
            continue
        if sector and sector not in secs:
            continue
        if capacity and p.capacity_status != capacity:
            continue
        if pricing and p.pricing_tier != pricing:
            continue
        if verified_only and p.kyb_status != "verified":
            continue
        # rate_max filter: keep the provider if their *lower bound* is at or
        # below the cap. Compare against hourly_rate_min when present, else
        # against hourly_rate_max as a fallback. Providers with no rate set
        # are kept (they may quote per-engagement and shouldn't be hidden by
        # a numeric filter).
        if rate_max is not None:
            floor = p.hourly_rate_min if p.hourly_rate_min is not None else p.hourly_rate_max
            if floor is not None and floor > rate_max:
                continue
        if q:
            hay = " ".join(filter(None, [p.name, p.company, p.headline, p.bio, p.specialization])).lower()
            if q.lower() not in hay:
                continue
        out.append(_public_provider_dto(p, _summarize_reviews(session, p.id)))

    out.sort(key=lambda d: (
        0 if d["kyb_verified"] else 1,
        -(d["reviews"]["avg_rating"] or 0),
        -(d["reviews"]["count"] or 0),
    ))
    return {"providers": out, "total": len(out)}


@router.get("/providers/{partner_id}")
def get_provider(
    partner_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = session.get(Partner, partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    if not p.listed:
        # Only the partner themselves (explicit FK linkage) and admins can
        # view unlisted profiles.
        if not (user.role == UserRole.ADMIN or (user.role == UserRole.PARTNER and user.partner_id == p.id)):
            raise HTTPException(status_code=404, detail="Provider not found")
    reviews = session.exec(
        select(PartnerReview).where(PartnerReview.partner_id == partner_id).order_by(PartnerReview.created_at.desc())
    ).all()
    review_dtos = [
        {
            "id": r.id,
            "rating": r.rating,
            "comment": r.comment,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in reviews
    ]
    dto = _public_provider_dto(p, _summarize_reviews(session, partner_id))
    dto["recent_reviews"] = review_dtos[:10]
    return dto


@router.get("/providers/me")
def get_my_provider(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if user.role != UserRole.PARTNER:
        raise HTTPException(status_code=403, detail="Partner role required")
    p = _partner_for_user(session, user)
    if not p:
        raise HTTPException(status_code=404, detail="No partner profile linked to your account")
    return _public_provider_dto(p, _summarize_reviews(session, p.id))


@router.put("/providers/me")
def update_my_provider(
    body: ProviderProfileIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if user.role != UserRole.PARTNER:
        raise HTTPException(status_code=403, detail="Partner role required")
    p = _partner_for_user(session, user)
    if not p:
        raise HTTPException(status_code=404, detail="No partner profile linked to your account")
    return _apply_provider_profile(session, p, body, user)


@router.put("/providers/{partner_id}")
def admin_update_provider(
    partner_id: int,
    body: ProviderProfileIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Admin override — edit any provider listing without owning it."""
    _ensure_admin(user)
    p = session.get(Partner, partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    return _apply_provider_profile(session, p, body, user)


def _apply_provider_profile(session: Session, p: Partner, body: ProviderProfileIn, actor: User) -> dict:
    p.headline = body.headline
    p.bio = body.bio
    p.categories_json = json.dumps(body.categories)
    p.sectors_json = json.dumps(body.sectors)
    p.pricing_tier = body.pricing_tier
    p.hourly_rate_min = body.hourly_rate_min
    p.hourly_rate_max = body.hourly_rate_max
    p.capacity_status = body.capacity_status
    p.response_time_hours = body.response_time_hours
    p.website = body.website
    p.listed = body.listed
    session.add(p)
    if actor.role == UserRole.ADMIN and actor.partner_id != p.id:
        session.add(ActivityLog(action="marketplace_admin_edit", details=f"partner={p.id}", actor=actor.email, user_id=actor.id))
    session.commit()
    session.refresh(p)
    return _public_provider_dto(p, _summarize_reviews(session, p.id))


# ---------------------------------------------------------------------------
# KYB verification (admin-only)
# ---------------------------------------------------------------------------
class KybIn(BaseModel):
    status: str  # unverified | pending | verified | rejected

    @field_validator("status")
    @classmethod
    def _check(cls, v):
        if v not in VALID_KYB:
            raise ValueError(f"status must be one of {sorted(VALID_KYB)}")
        return v


@router.post("/providers/{partner_id}/kyb")
def set_kyb_status(
    partner_id: int,
    body: KybIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_admin(user)
    p = session.get(Partner, partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    p.kyb_status = body.status
    p.kyb_verified_at = datetime.utcnow() if body.status == "verified" else None
    session.add(p)
    session.add(ActivityLog(action="marketplace_kyb_set", details=f"partner={partner_id} status={body.status}", actor=user.email, user_id=user.id))
    session.commit()
    session.refresh(p)
    return _public_provider_dto(p, _summarize_reviews(session, p.id))


# ---------------------------------------------------------------------------
# Reviews
# ---------------------------------------------------------------------------
class ReviewIn(BaseModel):
    rating: int = PydField(ge=1, le=5)
    comment: Optional[str] = None
    project_id: Optional[int] = None


@router.post("/providers/{partner_id}/reviews")
def create_review(
    partner_id: int,
    body: ReviewIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Founders (and admins) leave reviews. Each user gets one review per
    provider — a second submission updates the existing row."""
    if user.role not in (UserRole.FOUNDER, UserRole.ADMIN):
        raise HTTPException(status_code=403, detail="Only founders may leave reviews")
    p = session.get(Partner, partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    # Reviews are only accepted for providers visible in the marketplace —
    # unlisted (incl. soft-deleted) profiles cannot be reviewed by founders,
    # though admins may still post administrative reviews if needed.
    if not p.listed and user.role != UserRole.ADMIN:
        raise HTTPException(status_code=400, detail="Provider is not listed in the marketplace")

    if body.project_id is not None:
        proj = session.get(Project, body.project_id)
        if not proj:
            raise HTTPException(status_code=400, detail="project_id does not exist")
        if user.role == UserRole.FOUNDER and user.founder_id != proj.founder_id:
            raise HTTPException(status_code=403, detail="Cannot reference a project you don't own")

    existing = session.exec(
        select(PartnerReview)
        .where(PartnerReview.partner_id == partner_id)
        .where(PartnerReview.reviewer_user_id == user.id)
    ).first()
    if existing:
        existing.rating = body.rating
        existing.comment = body.comment
        existing.project_id = body.project_id
        session.add(existing)
        session.commit()
        session.refresh(existing)
        review = existing
    else:
        review = PartnerReview(
            partner_id=partner_id,
            reviewer_user_id=user.id,
            project_id=body.project_id,
            rating=body.rating,
            comment=body.comment,
        )
        session.add(review)
        session.commit()
        session.refresh(review)
    return {
        "id": review.id,
        "rating": review.rating,
        "comment": review.comment,
        "created_at": review.created_at.isoformat() if review.created_at else None,
        "summary": _summarize_reviews(session, partner_id),
    }


@router.get("/providers/{partner_id}/reviews")
def list_reviews(
    partner_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = session.get(Partner, partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    # Mirror the unlisted-gate from get_provider so reviews cannot be used
    # to enumerate hidden profiles (IDOR).
    if not p.listed:
        if not (user.role == UserRole.ADMIN or (user.role == UserRole.PARTNER and user.partner_id == p.id)):
            raise HTTPException(status_code=404, detail="Provider not found")
    rows = session.exec(
        select(PartnerReview).where(PartnerReview.partner_id == partner_id).order_by(PartnerReview.created_at.desc())
    ).all()
    return {
        "summary": _summarize_reviews(session, partner_id),
        "reviews": [
            {
                "id": r.id,
                "rating": r.rating,
                "comment": r.comment,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# Inquiry threads — per-conversation messaging
# ---------------------------------------------------------------------------
class InquiryIn(BaseModel):
    subject: str
    message: str
    project_id: Optional[int] = None


class MessageIn(BaseModel):
    body: str


def _can_view_inquiry(inq: MarketplaceInquiry, user: User, partner: Partner | None) -> bool:
    if user.role == UserRole.ADMIN:
        return True
    if user.id == inq.requester_user_id:
        return True
    # Partner-side access requires an explicit FK linkage — no email fallback.
    if user.role == UserRole.PARTNER and user.partner_id == inq.partner_id:
        return True
    return False


def _serialize_inquiry(inq: MarketplaceInquiry, partner: Partner | None, requester: User | None) -> dict:
    return {
        "id": inq.id,
        "uid": inq.uid,
        "partner_id": inq.partner_id,
        "partner_name": partner.name if partner else None,
        "partner_company": partner.company if partner else None,
        "requester_user_id": inq.requester_user_id,
        "requester_name": requester.name if requester else None,
        "project_id": inq.project_id,
        "subject": inq.subject,
        "status": inq.status,
        "created_at": inq.created_at.isoformat() if inq.created_at else None,
        "updated_at": inq.updated_at.isoformat() if inq.updated_at else None,
    }


@router.post("/inquiries")
def create_inquiry(
    body: InquiryIn,
    partner_id: int = Query(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Open a new inquiry thread with a provider. The first message is
    stored alongside the thread row."""
    if user.role == UserRole.PARTNER:
        raise HTTPException(status_code=403, detail="Partners cannot inquire to themselves")
    p = session.get(Partner, partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    if not p.listed and user.role != UserRole.ADMIN:
        raise HTTPException(status_code=400, detail="This provider is not accepting inquiries")
    if body.project_id is not None:
        proj = session.get(Project, body.project_id)
        if not proj:
            raise HTTPException(status_code=400, detail="project_id does not exist")
        if user.role == UserRole.FOUNDER and user.founder_id != proj.founder_id:
            raise HTTPException(status_code=403, detail="Cannot reference a project you don't own")
    inq = MarketplaceInquiry(
        partner_id=partner_id,
        requester_user_id=user.id,
        project_id=body.project_id,
        subject=body.subject.strip()[:200] or "Inquiry",
    )
    session.add(inq)
    session.commit()
    session.refresh(inq)
    msg = MarketplaceMessage(
        inquiry_id=inq.id,
        sender_user_id=user.id,
        body=body.message.strip(),
    )
    session.add(msg)
    session.add(ActivityLog(action="marketplace_inquiry_opened", details=f"partner={partner_id}", actor=user.email, user_id=user.id))
    session.commit()
    session.refresh(inq)
    return _serialize_inquiry(inq, p, user)


@router.get("/inquiries")
def list_inquiries(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """List inquiries the current user can see — either as the requester or
    as the partner recipient."""
    stmt = select(MarketplaceInquiry).order_by(MarketplaceInquiry.updated_at.desc())
    if user.role == UserRole.ADMIN:
        rows = session.exec(stmt).all()
    elif user.role == UserRole.PARTNER:
        if not user.partner_id:
            return {"inquiries": []}
        rows = session.exec(stmt.where(MarketplaceInquiry.partner_id == user.partner_id)).all()
    else:
        rows = session.exec(stmt.where(MarketplaceInquiry.requester_user_id == user.id)).all()
    out = []
    for inq in rows:
        partner = session.get(Partner, inq.partner_id)
        requester = session.get(User, inq.requester_user_id)
        # Latest message preview
        last = session.exec(
            select(MarketplaceMessage)
            .where(MarketplaceMessage.inquiry_id == inq.id)
            .order_by(MarketplaceMessage.created_at.desc())
            .limit(1)
        ).first()
        d = _serialize_inquiry(inq, partner, requester)
        d["last_message_preview"] = (last.body[:120] if last and last.body else None)
        d["last_message_at"] = last.created_at.isoformat() if last and last.created_at else None
        out.append(d)
    return {"inquiries": out}


@router.get("/inquiries/{inquiry_id}")
def get_inquiry(
    inquiry_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    inq = session.get(MarketplaceInquiry, inquiry_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    partner = session.get(Partner, inq.partner_id)
    if not _can_view_inquiry(inq, user, partner):
        raise HTTPException(status_code=403, detail="Forbidden")
    requester = session.get(User, inq.requester_user_id)
    msgs = session.exec(
        select(MarketplaceMessage)
        .where(MarketplaceMessage.inquiry_id == inquiry_id)
        .order_by(MarketplaceMessage.created_at)
    ).all()
    senders = {u.id: u for u in session.exec(select(User).where(User.id.in_([m.sender_user_id for m in msgs] or [0]))).all()}
    return {
        **_serialize_inquiry(inq, partner, requester),
        "messages": [
            {
                "id": m.id,
                "sender_user_id": m.sender_user_id,
                "sender_name": (senders.get(m.sender_user_id).name if senders.get(m.sender_user_id) else None),
                "body": m.body,
                "created_at": m.created_at.isoformat() if m.created_at else None,
                "is_partner": (partner is not None and senders.get(m.sender_user_id) is not None and senders[m.sender_user_id].partner_id == partner.id),
            }
            for m in msgs
        ],
    }


@router.post("/inquiries/{inquiry_id}/messages")
def post_message(
    inquiry_id: int,
    body: MessageIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    inq = session.get(MarketplaceInquiry, inquiry_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    partner = session.get(Partner, inq.partner_id)
    if not _can_view_inquiry(inq, user, partner):
        raise HTTPException(status_code=403, detail="Forbidden")
    if inq.status == "closed":
        raise HTTPException(status_code=400, detail="Inquiry is closed")
    text_body = (body.body or "").strip()
    if not text_body:
        raise HTTPException(status_code=400, detail="Message body required")
    msg = MarketplaceMessage(inquiry_id=inquiry_id, sender_user_id=user.id, body=text_body)
    session.add(msg)
    inq.updated_at = datetime.utcnow()
    session.add(inq)
    session.commit()
    session.refresh(msg)
    return {
        "id": msg.id,
        "inquiry_id": inquiry_id,
        "sender_user_id": user.id,
        "body": msg.body,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }


@router.post("/inquiries/{inquiry_id}/close")
def close_inquiry(
    inquiry_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    inq = session.get(MarketplaceInquiry, inquiry_id)
    if not inq:
        raise HTTPException(status_code=404, detail="Inquiry not found")
    partner = session.get(Partner, inq.partner_id)
    if not _can_view_inquiry(inq, user, partner):
        raise HTTPException(status_code=403, detail="Forbidden")
    inq.status = "closed"
    inq.updated_at = datetime.utcnow()
    session.add(inq)
    session.commit()
    return {"id": inq.id, "status": inq.status}


# ---------------------------------------------------------------------------
# Categories metadata (used by the UI for filters)
# ---------------------------------------------------------------------------
@router.get("/categories")
def list_categories(_: User = Depends(get_current_user)):
    return {
        "categories": sorted(VALID_CATEGORIES),
        "capacity_statuses": sorted(VALID_CAPACITY),
        "pricing_tiers": sorted(VALID_PRICING),
        "kyb_statuses": sorted(VALID_KYB),
    }


# ---------------------------------------------------------------------------
# Task #51 — Stripe Connect onboarding for the calling partner
# ---------------------------------------------------------------------------
from backend.app.services import stripe_connect  # noqa: E402  (kept local to scope)


@router.get("/providers/me/stripe")
def get_my_stripe_status(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    partner = _partner_for_user(session, user)
    if not partner:
        raise HTTPException(status_code=403, detail="Only partner accounts have a Stripe profile")
    return stripe_connect.stripe_status_summary(partner)


@router.post("/providers/me/stripe/onboard")
def start_stripe_onboarding(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    partner = _partner_for_user(session, user)
    if not partner:
        raise HTTPException(status_code=403, detail="Only partner accounts may onboard to Stripe")
    link = stripe_connect.create_account_link(partner)
    if link.get("account_id") and partner.stripe_account_id != link["account_id"]:
        partner.stripe_account_id = link["account_id"]
        session.add(partner)
        session.commit()
    return {
        "url": link["url"],
        "account_id": link["account_id"],
        "simulated": bool(link.get("simulated")),
    }


@router.post("/providers/me/stripe/refresh")
def refresh_stripe_status(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    partner = _partner_for_user(session, user)
    if not partner:
        raise HTTPException(status_code=403, detail="Only partner accounts may refresh Stripe status")
    status = stripe_connect.refresh_account_status(partner)
    partner.stripe_account_id = status.get("stripe_account_id") or partner.stripe_account_id
    partner.stripe_charges_enabled = bool(status.get("charges_enabled"))
    partner.stripe_payouts_enabled = bool(status.get("payouts_enabled"))
    if partner.stripe_charges_enabled and not partner.stripe_onboarded_at:
        partner.stripe_onboarded_at = datetime.utcnow()
    session.add(partner)
    session.commit()
    return stripe_connect.stripe_status_summary(partner) | {"simulated": bool(status.get("simulated"))}

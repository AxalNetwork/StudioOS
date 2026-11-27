"""Task #50 — Needs board + RFP system.

Two-sided marketplace flow:
- Founders post needs (category, budget, timeline) and may escalate to a
  formal RFP with scoped deliverables.
- Partners (service providers) browse open needs and submit quotes.
- Founders accept exactly one quote per need; acceptance materialises an
  Engagement and closes the need.

Stripe Connect invoicing (Task 5.2) is intentionally out of scope here —
the Engagement row is the handoff target.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field as PydField, field_validator
from sqlmodel import Session, func, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    ActivityLog,
    Engagement,
    EngagementReview,
    Founder,
    FounderNeed,
    Partner,
    Project,
    Quote,
    RFP,
    ServiceOffering,
    User,
    UserRole,
)
from backend.app.api.routes.marketplace import VALID_CATEGORIES
from backend.app.services import stripe_connect

VALID_ENGAGEMENT_STATUSES = {
    "accepted",
    "in_progress",
    "delivered",
    "reviewed",
    "invoiced",
    "cancelled",
}
TERMINAL_ENGAGEMENT_STATUSES = {"reviewed", "invoiced", "cancelled"}

router = APIRouter(prefix="/needs", tags=["Needs Board & RFPs"])

VALID_NEED_STATUSES = {"open", "in_review", "closed", "filled"}


# ---------------------------------------------------------------------------
# Authorization helpers
# ---------------------------------------------------------------------------
def _is_admin(u: User) -> bool:
    return u.role == UserRole.ADMIN


def _is_owner(need: FounderNeed, user: User) -> bool:
    return user.role == UserRole.FOUNDER and user.founder_id == need.founder_id


def _ensure_owner_or_admin(need: FounderNeed, user: User) -> None:
    if not (_is_admin(user) or _is_owner(need, user)):
        raise HTTPException(status_code=403, detail="Only the need's founder or an admin may do this")


def _ensure_partner_self_or_admin(quote: Quote, user: User) -> None:
    if _is_admin(user):
        return
    if user.role == UserRole.PARTNER and user.partner_id == quote.partner_id:
        return
    raise HTTPException(status_code=403, detail="Forbidden")


def _can_view_quote(q: Quote, need: FounderNeed, user: User) -> bool:
    if _is_admin(user):
        return True
    if _is_owner(need, user):  # founder who owns the need sees all quotes
        return True
    if user.role == UserRole.PARTNER and user.partner_id == q.partner_id:
        return True
    return False


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------
class NeedIn(BaseModel):
    project_id: int
    category: str
    title: str
    description: str
    budget_min: Optional[float] = PydField(default=None, ge=0)
    budget_max: Optional[float] = PydField(default=None, ge=0)
    timeline: Optional[str] = None

    @field_validator("category")
    @classmethod
    def _check_cat(cls, v):
        if v not in VALID_CATEGORIES:
            raise ValueError(f"category must be one of {sorted(VALID_CATEGORIES)}")
        return v


class NeedPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    budget_min: Optional[float] = PydField(default=None, ge=0)
    budget_max: Optional[float] = PydField(default=None, ge=0)
    timeline: Optional[str] = None
    status: Optional[str] = None

    @field_validator("category")
    @classmethod
    def _check_cat(cls, v):
        if v is not None and v not in VALID_CATEGORIES:
            raise ValueError(f"category must be one of {sorted(VALID_CATEGORIES)}")
        return v

    @field_validator("status")
    @classmethod
    def _check_status(cls, v):
        if v is not None and v not in VALID_NEED_STATUSES:
            raise ValueError(f"status must be one of {sorted(VALID_NEED_STATUSES)}")
        return v


class RFPIn(BaseModel):
    scope_md: str
    deliverables_md: Optional[str] = None
    deadline_at: Optional[datetime] = None


class QuoteIn(BaseModel):
    price: float = PydField(gt=0)
    timeline_weeks: Optional[int] = PydField(default=None, ge=0)
    deliverables: str
    notes: Optional[str] = None


def _need_dto(session: Session, n: FounderNeed) -> dict:
    proj = session.get(Project, n.project_id)
    rfp = session.exec(select(RFP).where(RFP.need_id == n.id)).first()
    quote_count = session.exec(select(func.count()).select_from(Quote).where(Quote.need_id == n.id)).first() or 0
    return {
        "id": n.id,
        "uid": n.uid,
        "project_id": n.project_id,
        "project_name": proj.name if proj else None,
        "founder_id": n.founder_id,
        "category": n.category,
        "title": n.title,
        "description": n.description,
        "budget_min": n.budget_min,
        "budget_max": n.budget_max,
        "timeline": n.timeline,
        "status": n.status,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
        "quote_count": quote_count,
        "rfp": _rfp_dto(rfp) if rfp else None,
    }


def _rfp_dto(r: RFP) -> dict:
    return {
        "id": r.id,
        "uid": r.uid,
        "need_id": r.need_id,
        "scope_md": r.scope_md,
        "deliverables_md": r.deliverables_md,
        "deadline_at": r.deadline_at.isoformat() if r.deadline_at else None,
        "status": r.status,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _quote_dto(session: Session, q: Quote) -> dict:
    partner = session.get(Partner, q.partner_id)
    return {
        "id": q.id,
        "uid": q.uid,
        "need_id": q.need_id,
        "rfp_id": q.rfp_id,
        "partner_id": q.partner_id,
        "partner_name": partner.name if partner else None,
        "partner_company": partner.company if partner else None,
        "kyb_verified": (partner.kyb_status == "verified") if partner else False,
        "price": q.price,
        "timeline_weeks": q.timeline_weeks,
        "deliverables": q.deliverables,
        "notes": q.notes,
        "status": q.status,
        "submitted_by_user_id": q.submitted_by_user_id,
        "created_at": q.created_at.isoformat() if q.created_at else None,
    }


# ---------------------------------------------------------------------------
# Needs — founder posts / browse
# ---------------------------------------------------------------------------
@router.post("")
def create_need(
    body: NeedIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if user.role != UserRole.FOUNDER or not user.founder_id:
        raise HTTPException(status_code=403, detail="Only founders may post needs")
    proj = session.get(Project, body.project_id)
    if not proj:
        raise HTTPException(status_code=400, detail="Project not found")
    if proj.founder_id != user.founder_id:
        raise HTTPException(status_code=403, detail="Cannot post a need against a project you don't own")
    if body.budget_min is not None and body.budget_max is not None and body.budget_min > body.budget_max:
        raise HTTPException(status_code=400, detail="budget_min cannot exceed budget_max")
    n = FounderNeed(
        project_id=body.project_id,
        founder_id=user.founder_id,
        category=body.category,
        title=body.title.strip()[:200],
        description=body.description.strip(),
        budget_min=body.budget_min,
        budget_max=body.budget_max,
        timeline=body.timeline,
    )
    session.add(n)
    session.add(ActivityLog(
        action="need_posted", project_id=body.project_id, actor=user.email,
        user_id=user.id, details=f"category={body.category}",
    ))
    session.commit()
    session.refresh(n)
    return _need_dto(session, n)


@router.get("")
def list_needs(
    category: Optional[str] = None,
    status: Optional[str] = None,
    mine_only: bool = False,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Browse needs.

    - Founders default to seeing only their own posts.
    - Partners / investors / admins see *open* (and `in_review`) public needs.
    - Pass `mine_only=true` to scope to your own needs (founders only).
    """
    stmt = select(FounderNeed).order_by(FounderNeed.updated_at.desc())
    if user.role == UserRole.FOUNDER:
        if mine_only or user.role == UserRole.FOUNDER:
            stmt = stmt.where(FounderNeed.founder_id == user.founder_id)
    elif not _is_admin(user):
        # Partners/investors only see needs that are open for quoting.
        stmt = stmt.where(FounderNeed.status.in_(["open", "in_review"]))

    if category:
        stmt = stmt.where(FounderNeed.category == category)
    if status:
        stmt = stmt.where(FounderNeed.status == status)
    rows = session.exec(stmt).all()
    return {"needs": [_need_dto(session, n) for n in rows], "total": len(rows)}


@router.get("/{need_id}")
def get_need(
    need_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    n = session.get(FounderNeed, need_id)
    if not n:
        raise HTTPException(status_code=404, detail="Need not found")
    if not _can_view_need(n, user):
        raise HTTPException(status_code=404, detail="Need not found")
    return _need_dto(session, n)


def _can_view_need(n: FounderNeed, user: User) -> bool:
    if _is_admin(user):
        return True
    if user.role == UserRole.FOUNDER:
        return user.founder_id == n.founder_id
    # Partners (incl. those who already submitted a quote) and investors can
    # only see needs that are actively soliciting quotes. Filled / closed
    # needs are hidden from them to avoid leaking founder activity.
    if user.role in (UserRole.PARTNER, UserRole.INVESTOR):
        return n.status in ("open", "in_review")
    return False


@router.patch("/{need_id}")
def update_need(
    need_id: int,
    body: NeedPatch,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    n = session.get(FounderNeed, need_id)
    if not n:
        raise HTTPException(status_code=404, detail="Need not found")
    _ensure_owner_or_admin(n, user)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(n, k, v)
    if n.budget_min is not None and n.budget_max is not None and n.budget_min > n.budget_max:
        raise HTTPException(status_code=400, detail="budget_min cannot exceed budget_max")
    n.updated_at = datetime.utcnow()
    session.add(n)
    session.commit()
    session.refresh(n)
    return _need_dto(session, n)


@router.delete("/{need_id}")
def delete_need(
    need_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    n = session.get(FounderNeed, need_id)
    if not n:
        raise HTTPException(status_code=404, detail="Need not found")
    _ensure_owner_or_admin(n, user)
    # Cascade delete pending quotes / RFP. Engagements (if any) remain — the
    # accepted quote materialises a separate row that should outlive the need.
    quotes = session.exec(select(Quote).where(Quote.need_id == need_id)).all()
    for q in quotes:
        if q.status == "accepted":
            raise HTTPException(status_code=400, detail="Cannot delete a need with an accepted quote — close it instead")
        session.delete(q)
    rfp = session.exec(select(RFP).where(RFP.need_id == need_id)).first()
    if rfp:
        session.delete(rfp)
    session.delete(n)
    session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# RFP — formal scope upgrade (1:1 with a need)
# ---------------------------------------------------------------------------
@router.post("/{need_id}/rfp")
def upsert_rfp(
    need_id: int,
    body: RFPIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    n = session.get(FounderNeed, need_id)
    if not n:
        raise HTTPException(status_code=404, detail="Need not found")
    _ensure_owner_or_admin(n, user)
    existing = session.exec(select(RFP).where(RFP.need_id == need_id)).first()
    if existing:
        existing.scope_md = body.scope_md
        existing.deliverables_md = body.deliverables_md
        existing.deadline_at = body.deadline_at
        session.add(existing)
        rfp = existing
    else:
        rfp = RFP(
            need_id=need_id,
            scope_md=body.scope_md,
            deliverables_md=body.deliverables_md,
            deadline_at=body.deadline_at,
        )
        session.add(rfp)
    n.updated_at = datetime.utcnow()
    session.add(n)
    session.commit()
    session.refresh(rfp)
    return _rfp_dto(rfp)


# ---------------------------------------------------------------------------
# Quotes — partner submissions
# ---------------------------------------------------------------------------
@router.post("/{need_id}/quotes")
def submit_quote(
    need_id: int,
    body: QuoteIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if user.role != UserRole.PARTNER or not user.partner_id:
        raise HTTPException(status_code=403, detail="Only partners may submit quotes")
    n = session.get(FounderNeed, need_id)
    if not n:
        raise HTTPException(status_code=404, detail="Need not found")
    if n.status not in ("open", "in_review"):
        raise HTTPException(status_code=400, detail="This need is no longer accepting quotes")
    # One active quote per partner per need — re-submission updates pending only.
    existing = session.exec(
        select(Quote)
        .where(Quote.need_id == need_id)
        .where(Quote.partner_id == user.partner_id)
    ).first()
    if existing and existing.status == "accepted":
        raise HTTPException(status_code=400, detail="You already have an accepted quote on this need")
    if existing and existing.status == "pending":
        existing.price = body.price
        existing.timeline_weeks = body.timeline_weeks
        existing.deliverables = body.deliverables
        existing.notes = body.notes
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        session.commit()
        session.refresh(existing)
        return _quote_dto(session, existing)
    rfp = session.exec(select(RFP).where(RFP.need_id == need_id)).first()
    q = Quote(
        need_id=need_id,
        rfp_id=rfp.id if rfp else None,
        partner_id=user.partner_id,
        submitted_by_user_id=user.id,
        price=body.price,
        timeline_weeks=body.timeline_weeks,
        deliverables=body.deliverables.strip(),
        notes=body.notes,
    )
    session.add(q)
    n.updated_at = datetime.utcnow()
    session.add(n)
    session.add(ActivityLog(
        action="quote_submitted", project_id=n.project_id, actor=user.email,
        user_id=user.id, details=f"need={need_id} price={body.price}",
    ))
    session.commit()
    session.refresh(q)
    return _quote_dto(session, q)


@router.get("/{need_id}/quotes")
def list_quotes_for_need(
    need_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    n = session.get(FounderNeed, need_id)
    if not n:
        raise HTTPException(status_code=404, detail="Need not found")
    # Enforce visibility on the parent need so partners/investors cannot use
    # this endpoint to probe existence/status of closed/filled needs.
    if not _can_view_need(n, user) and not (
        user.role == UserRole.PARTNER and user.partner_id and session.exec(
            select(Quote).where(Quote.need_id == need_id).where(Quote.partner_id == user.partner_id)
        ).first()
    ):
        raise HTTPException(status_code=404, detail="Need not found")
    rows = session.exec(
        select(Quote).where(Quote.need_id == need_id).order_by(Quote.created_at.desc())
    ).all()
    visible = [q for q in rows if _can_view_quote(q, n, user)]
    return {"quotes": [_quote_dto(session, q) for q in visible]}


# ---------------------------------------------------------------------------
# Quote actions — accept / reject / withdraw
# ---------------------------------------------------------------------------
quote_router = APIRouter(prefix="/quotes", tags=["Needs Board & RFPs"])


@quote_router.get("/me")
def my_quotes(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if user.role != UserRole.PARTNER or not user.partner_id:
        raise HTTPException(status_code=403, detail="Partner role required")
    rows = session.exec(
        select(Quote).where(Quote.partner_id == user.partner_id).order_by(Quote.updated_at.desc())
    ).all()
    out = []
    for q in rows:
        n = session.get(FounderNeed, q.need_id)
        d = _quote_dto(session, q)
        d["need_title"] = n.title if n else None
        d["need_status"] = n.status if n else None
        out.append(d)
    return {"quotes": out}


@quote_router.post("/{quote_id}/accept")
def accept_quote(
    quote_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Founder accepts a partner's quote. Materialises an Engagement, marks
    the winning quote `accepted`, rejects all other pending quotes on that
    need, and sets the need to `filled`."""
    q = session.get(Quote, quote_id)
    if not q:
        raise HTTPException(status_code=404, detail="Quote not found")
    n = session.get(FounderNeed, q.need_id)
    if not n:
        raise HTTPException(status_code=404, detail="Underlying need not found")
    _ensure_owner_or_admin(n, user)
    if q.status != "pending":
        raise HTTPException(status_code=400, detail=f"Quote is {q.status}; only pending quotes can be accepted")
    # Lock the need row to serialize concurrent accepts. If a sibling
    # transaction already filled this need, refuse cleanly. The unique
    # constraint on engagements.need_id provides a final DB-level guarantee.
    n_locked = session.exec(
        select(FounderNeed).where(FounderNeed.id == n.id).with_for_update()
    ).first()
    if not n_locked or n_locked.status not in ("open", "in_review"):
        raise HTTPException(status_code=400, detail="This need is no longer accepting acceptances")
    n = n_locked

    q.status = "accepted"
    q.updated_at = datetime.utcnow()
    session.add(q)

    # Reject other pending quotes on this need.
    other_pending = session.exec(
        select(Quote).where(Quote.need_id == n.id).where(Quote.id != q.id).where(Quote.status == "pending")
    ).all()
    for o in other_pending:
        o.status = "rejected"
        o.updated_at = datetime.utcnow()
        session.add(o)

    n.status = "filled"
    n.updated_at = datetime.utcnow()
    session.add(n)

    now = datetime.utcnow()
    eng = Engagement(
        quote_id=q.id,
        need_id=n.id,
        project_id=n.project_id,
        founder_id=n.founder_id,
        partner_id=q.partner_id,
        price=q.price,
        deliverables=q.deliverables,
        timeline_weeks=q.timeline_weeks,
        status="accepted",
        accepted_at=now,
    )
    session.add(eng)
    session.add(ActivityLog(
        action="quote_accepted", project_id=n.project_id, actor=user.email,
        user_id=user.id, details=f"quote={q.id} partner={q.partner_id} price={q.price}",
    ))
    session.commit()
    session.refresh(eng)
    return {
        "quote": _quote_dto(session, q),
        "engagement": {
            "id": eng.id,
            "uid": eng.uid,
            "quote_id": eng.quote_id,
            "need_id": eng.need_id,
            "project_id": eng.project_id,
            "partner_id": eng.partner_id,
            "price": eng.price,
            "deliverables": eng.deliverables,
            "timeline_weeks": eng.timeline_weeks,
            "status": eng.status,
            "created_at": eng.created_at.isoformat() if eng.created_at else None,
        },
    }


@quote_router.post("/{quote_id}/reject")
def reject_quote(
    quote_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    q = session.get(Quote, quote_id)
    if not q:
        raise HTTPException(status_code=404, detail="Quote not found")
    n = session.get(FounderNeed, q.need_id)
    if not n:
        raise HTTPException(status_code=404, detail="Underlying need not found")
    _ensure_owner_or_admin(n, user)
    if q.status not in ("pending",):
        raise HTTPException(status_code=400, detail=f"Quote is {q.status}; only pending quotes can be rejected")
    q.status = "rejected"
    q.updated_at = datetime.utcnow()
    session.add(q)
    session.commit()
    return _quote_dto(session, q)


@quote_router.post("/{quote_id}/withdraw")
def withdraw_quote(
    quote_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    q = session.get(Quote, quote_id)
    if not q:
        raise HTTPException(status_code=404, detail="Quote not found")
    _ensure_partner_self_or_admin(q, user)
    if q.status not in ("pending",):
        raise HTTPException(status_code=400, detail=f"Quote is {q.status}; only pending quotes can be withdrawn")
    q.status = "withdrawn"
    q.updated_at = datetime.utcnow()
    session.add(q)
    session.commit()
    return _quote_dto(session, q)


# ---------------------------------------------------------------------------
# Engagements — Task #51 lifecycle: accepted → in_progress → delivered
#     → reviewed → invoiced (or cancelled at any non-terminal step)
# ---------------------------------------------------------------------------
engagement_router = APIRouter(prefix="/engagements", tags=["Engagements"])


def _engagement_is_party(eng: Engagement, user: User) -> tuple[bool, bool, bool]:
    """Returns (is_admin, is_founder_party, is_partner_party)."""
    is_admin = _is_admin(user)
    is_founder = user.role == UserRole.FOUNDER and user.founder_id == eng.founder_id
    is_partner = user.role == UserRole.PARTNER and user.partner_id == eng.partner_id
    return is_admin, is_founder, is_partner


def _ensure_party(eng: Engagement, user: User) -> tuple[bool, bool, bool]:
    is_admin, is_founder, is_partner = _engagement_is_party(eng, user)
    if not (is_admin or is_founder or is_partner):
        raise HTTPException(status_code=403, detail="You are not a party to this engagement")
    return is_admin, is_founder, is_partner


def _engagement_dto(session: Session, e: Engagement) -> dict:
    partner = session.get(Partner, e.partner_id)
    proj = session.get(Project, e.project_id)
    offering = session.get(ServiceOffering, e.service_offering_id) if e.service_offering_id else None
    reviews = session.exec(
        select(EngagementReview).where(EngagementReview.engagement_id == e.id)
    ).all()
    return {
        "id": e.id,
        "uid": e.uid,
        "quote_id": e.quote_id,
        "need_id": e.need_id,
        "service_offering_id": e.service_offering_id,
        "service_offering_title": offering.title if offering else None,
        "project_id": e.project_id,
        "project_name": proj.name if proj else None,
        "partner_id": e.partner_id,
        "partner_name": partner.name if partner else None,
        "founder_id": e.founder_id,
        "price": e.price,
        "currency": e.currency or "usd",
        "deliverables": e.deliverables,
        "timeline_weeks": e.timeline_weeks,
        "sla_days": e.sla_days,
        "status": e.status,
        "delivery_notes": e.delivery_notes,
        "cancel_reason": e.cancel_reason,
        "accepted_at": e.accepted_at.isoformat() if e.accepted_at else None,
        "started_at": e.started_at.isoformat() if e.started_at else None,
        "delivered_at": e.delivered_at.isoformat() if e.delivered_at else None,
        "reviewed_at": e.reviewed_at.isoformat() if e.reviewed_at else None,
        "invoiced_at": e.invoiced_at.isoformat() if e.invoiced_at else None,
        "cancelled_at": e.cancelled_at.isoformat() if e.cancelled_at else None,
        "stripe_invoice_id": e.stripe_invoice_id,
        "stripe_invoice_url": e.stripe_invoice_url,
        "stripe_payment_status": e.stripe_payment_status,
        "amount_cents": e.amount_cents,
        "invoice_simulated": bool(e.invoice_simulated),
        "reviews": [
            {
                "id": r.id,
                "reviewer_role": r.reviewer_role,
                "reviewer_user_id": r.reviewer_user_id,
                "rating": r.rating,
                "comment": r.comment,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in reviews
        ],
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def _load_engagement_locked(session: Session, eng_id: int) -> Engagement:
    eng = session.exec(
        select(Engagement).where(Engagement.id == eng_id).with_for_update()
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    return eng


def _ensure_status(eng: Engagement, allowed: set[str]) -> None:
    # Treat legacy `active` as `accepted` for transition checks.
    cur = "accepted" if eng.status == "active" else eng.status
    if cur not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Engagement is '{eng.status}'; this action requires one of {sorted(allowed)}",
        )


@engagement_router.get("")
def list_engagements(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = select(Engagement).order_by(Engagement.created_at.desc())
    if _is_admin(user):
        rows = session.exec(stmt).all()
    elif user.role == UserRole.FOUNDER and user.founder_id:
        rows = session.exec(stmt.where(Engagement.founder_id == user.founder_id)).all()
    elif user.role == UserRole.PARTNER and user.partner_id:
        rows = session.exec(stmt.where(Engagement.partner_id == user.partner_id)).all()
    else:
        rows = []
    return {"engagements": [_engagement_dto(session, e) for e in rows]}


@engagement_router.get("/{eng_id}")
def get_engagement(
    eng_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    eng = session.get(Engagement, eng_id)
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    _ensure_party(eng, user)
    return _engagement_dto(session, eng)


@engagement_router.post("/{eng_id}/start")
def start_engagement(
    eng_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Partner kicks off work. accepted → in_progress."""
    eng = _load_engagement_locked(session, eng_id)
    is_admin, _, is_partner = _ensure_party(eng, user)
    if not (is_admin or is_partner):
        raise HTTPException(status_code=403, detail="Only the assigned partner may start work")
    _ensure_status(eng, {"accepted"})
    now = datetime.utcnow()
    eng.status = "in_progress"
    eng.started_at = now
    eng.updated_at = now
    session.add(eng)
    session.add(ActivityLog(
        action="engagement_started", project_id=eng.project_id, actor=user.email,
        user_id=user.id, details=f"engagement={eng.id}",
    ))
    session.commit()
    session.refresh(eng)
    return _engagement_dto(session, eng)


class DeliverIn(BaseModel):
    delivery_notes: Optional[str] = None


@engagement_router.post("/{eng_id}/deliver")
def deliver_engagement(
    eng_id: int,
    body: DeliverIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Partner marks deliverables submitted. in_progress → delivered. Unlocks reviews."""
    eng = _load_engagement_locked(session, eng_id)
    is_admin, _, is_partner = _ensure_party(eng, user)
    if not (is_admin or is_partner):
        raise HTTPException(status_code=403, detail="Only the assigned partner may mark delivered")
    _ensure_status(eng, {"in_progress"})
    now = datetime.utcnow()
    eng.status = "delivered"
    eng.delivered_at = now
    eng.delivery_notes = (body.delivery_notes or "").strip() or None
    eng.updated_at = now
    session.add(eng)
    session.add(ActivityLog(
        action="engagement_delivered", project_id=eng.project_id, actor=user.email,
        user_id=user.id, details=f"engagement={eng.id}",
    ))
    session.commit()
    session.refresh(eng)
    return _engagement_dto(session, eng)


class CancelIn(BaseModel):
    reason: Optional[str] = None


@engagement_router.post("/{eng_id}/cancel")
def cancel_engagement(
    eng_id: int,
    body: CancelIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Either party (or admin) may cancel before invoicing."""
    eng = _load_engagement_locked(session, eng_id)
    _ensure_party(eng, user)
    if eng.status in TERMINAL_ENGAGEMENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Engagement already {eng.status}")
    now = datetime.utcnow()
    eng.status = "cancelled"
    eng.cancelled_at = now
    eng.cancel_reason = (body.reason or "").strip() or None
    eng.updated_at = now
    session.add(eng)
    session.add(ActivityLog(
        action="engagement_cancelled", project_id=eng.project_id, actor=user.email,
        user_id=user.id, details=f"engagement={eng.id} reason={eng.cancel_reason or '-'}",
    ))
    session.commit()
    session.refresh(eng)
    return _engagement_dto(session, eng)


class ReviewIn(BaseModel):
    rating: int = PydField(ge=1, le=5)
    comment: Optional[str] = None


@engagement_router.get("/{eng_id}/reviews")
def list_engagement_reviews(
    eng_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    eng = session.get(Engagement, eng_id)
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    _ensure_party(eng, user)
    rows = session.exec(
        select(EngagementReview).where(EngagementReview.engagement_id == eng_id)
    ).all()
    return {
        "reviews": [
            {
                "id": r.id,
                "reviewer_role": r.reviewer_role,
                "reviewer_user_id": r.reviewer_user_id,
                "rating": r.rating,
                "comment": r.comment,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }


@engagement_router.post("/{eng_id}/reviews")
def create_engagement_review(
    eng_id: int,
    body: ReviewIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Two-sided review. Only allowed once per side and only after the
    engagement is `delivered` (or further along). When both sides have
    rated, the engagement transitions to `reviewed`.
    """
    eng = _load_engagement_locked(session, eng_id)
    is_admin, is_founder, is_partner = _ensure_party(eng, user)
    if not (is_founder or is_partner):
        raise HTTPException(status_code=403, detail="Only the founder or partner of this engagement may review")
    if eng.status not in {"delivered", "reviewed", "invoiced"}:
        raise HTTPException(
            status_code=400,
            detail="Reviews unlock only after the engagement is marked delivered",
        )
    reviewer_role = "founder" if is_founder else "partner"

    # One review per side. Re-submission is rejected to keep ratings honest.
    existing = session.exec(
        select(EngagementReview)
        .where(EngagementReview.engagement_id == eng_id)
        .where(EngagementReview.reviewer_role == reviewer_role)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"You have already submitted a {reviewer_role} review for this engagement")

    review = EngagementReview(
        engagement_id=eng_id,
        reviewer_user_id=user.id,
        reviewer_role=reviewer_role,
        rating=body.rating,
        comment=(body.comment or "").strip() or None,
    )
    session.add(review)

    # Mirror founder→partner review onto the legacy PartnerReview table so
    # marketplace aggregate ratings include engagement-bound feedback.
    if reviewer_role == "founder":
        from backend.app.models.entities import PartnerReview  # local — avoid cycle
        session.add(PartnerReview(
            partner_id=eng.partner_id,
            reviewer_user_id=user.id,
            project_id=eng.project_id,
            rating=body.rating,
            comment=review.comment,
        ))

    # Promote to `reviewed` once both sides have rated.
    other_role = "partner" if reviewer_role == "founder" else "founder"
    other = session.exec(
        select(EngagementReview)
        .where(EngagementReview.engagement_id == eng_id)
        .where(EngagementReview.reviewer_role == other_role)
    ).first()
    now = datetime.utcnow()
    if other and eng.status == "delivered":
        eng.status = "reviewed"
        eng.reviewed_at = now
    eng.updated_at = now
    session.add(eng)
    session.add(ActivityLog(
        action="engagement_reviewed", project_id=eng.project_id, actor=user.email,
        user_id=user.id, details=f"engagement={eng.id} role={reviewer_role} rating={body.rating}",
    ))
    session.commit()
    session.refresh(eng)
    return _engagement_dto(session, eng)


@engagement_router.post("/{eng_id}/invoice")
def invoice_engagement(
    eng_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Partner issues the Stripe Connect invoice. delivered|reviewed → invoiced.

    Idempotent — re-calling on an already-invoiced engagement returns the
    persisted invoice URL without hitting Stripe again.
    """
    eng = _load_engagement_locked(session, eng_id)
    is_admin, _, is_partner = _ensure_party(eng, user)
    if not (is_admin or is_partner):
        raise HTTPException(status_code=403, detail="Only the assigned partner may invoice")
    if eng.status == "invoiced" and eng.stripe_invoice_id:
        return _engagement_dto(session, eng)
    _ensure_status(eng, {"delivered", "reviewed"})

    partner = session.get(Partner, eng.partner_id)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")

    # Resolve founder user (for billing email).
    founder_user = None
    founder = session.get(Founder, eng.founder_id)
    if founder:
        founder_user = session.exec(
            select(User).where(User.founder_id == founder.id)
        ).first()

    try:
        result = stripe_connect.create_invoice(eng, partner, founder_user)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    now = datetime.utcnow()
    eng.stripe_invoice_id = result["invoice_id"]
    eng.stripe_invoice_url = result["invoice_url"]
    eng.stripe_payment_status = result["status"]
    eng.amount_cents = result["amount_cents"]
    eng.currency = result.get("currency") or eng.currency
    eng.invoice_simulated = bool(result.get("simulated"))
    if eng.status != "reviewed":
        # delivered → invoiced (skip "reviewed" if neither side rated)
        eng.status = "invoiced"
    else:
        eng.status = "invoiced"
    eng.invoiced_at = now
    eng.updated_at = now
    session.add(eng)
    session.add(ActivityLog(
        action="engagement_invoiced", project_id=eng.project_id, actor=user.email,
        user_id=user.id,
        details=f"engagement={eng.id} invoice={eng.stripe_invoice_id} simulated={eng.invoice_simulated}",
    ))
    session.commit()
    session.refresh(eng)
    return _engagement_dto(session, eng)

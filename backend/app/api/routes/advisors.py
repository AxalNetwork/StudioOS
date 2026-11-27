"""Task #35 — Advisor matching + office hours routes.

Surfaces:
  - Advisor profile CRUD (self + admin)
  - Public advisor directory with filters
  - Office-hour slot create / list / cancel
  - Bookings (request → confirm → complete / cancel / no_show)
  - Two-sided reviews after a completed booking

All under /api/advisors.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field as PField
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    Advisor, AdvisorBooking, AdvisorReview, OfficeHourSlot, User,
)
from backend.app.services import advisors as svc

logger = logging.getLogger("studioos.advisors")
router = APIRouter(prefix="/advisors", tags=["Advisor matching"])


def _is_admin(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "admin"


def _is_advisor_role(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "advisor"


def _require_advisor_row(session: Session, user: User) -> Advisor:
    if not user.advisor_id:
        raise HTTPException(status_code=400, detail="No advisor profile attached to your account")
    m = session.get(Advisor, user.advisor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Advisor profile missing")
    return m


# ===========================================================================
# Profile
# ===========================================================================
class AdvisorUpsert(BaseModel):
    name: Optional[str] = None
    headline: Optional[str] = None
    bio: Optional[str] = None
    specialties: Optional[list[str]] = None
    sectors: Optional[list[str]] = None
    timezone: Optional[str] = None
    capacity_per_week: Optional[int] = PField(default=None, ge=0, le=200)
    hourly_rate: Optional[float] = PField(default=None, ge=0)
    currency: Optional[str] = None
    accepting_bookings: Optional[bool] = None
    listed: Optional[bool] = None
    calcom_username: Optional[str] = None
    calcom_event_type_id: Optional[int] = None


@router.post("/me")
def create_or_update_my_advisor(
    body: AdvisorUpsert,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Self-serve advisor profile create/update. The caller must be logged-in
    with role=advisor (admins can create on behalf of an advisor via /admin/...).
    Idempotent — POST upserts the row attached to the current user."""
    if not _is_advisor_role(user) and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Advisor role required")
    if user.advisor_id:
        m = session.get(Advisor, user.advisor_id)
        if not m:
            raise HTTPException(status_code=404, detail="Advisor profile missing")
    else:
        # First-time creation: bind to the user.
        m = Advisor(name=body.name or user.name, email=user.email)
        session.add(m); session.commit(); session.refresh(m)
        user.advisor_id = m.id
        session.add(user); session.commit()

    if body.name is not None: m.name = body.name
    if body.headline is not None: m.headline = body.headline
    if body.bio is not None: m.bio = body.bio
    if body.specialties is not None:
        m.specialties_json = json.dumps([s.strip() for s in body.specialties if s.strip()][:20])
    if body.sectors is not None:
        m.sectors_json = json.dumps([s.strip() for s in body.sectors if s.strip()][:20])
    if body.timezone is not None: m.timezone = body.timezone
    if body.capacity_per_week is not None: m.capacity_per_week = body.capacity_per_week
    if body.hourly_rate is not None: m.hourly_rate = body.hourly_rate
    if body.currency is not None: m.currency = body.currency.upper()[:8]
    if body.accepting_bookings is not None: m.accepting_bookings = body.accepting_bookings
    if body.listed is not None: m.listed = body.listed
    if body.calcom_username is not None: m.calcom_username = body.calcom_username
    if body.calcom_event_type_id is not None: m.calcom_event_type_id = body.calcom_event_type_id
    m.updated_at = datetime.utcnow()
    session.add(m); session.commit(); session.refresh(m)
    return svc.advisor_dto(m, include_email=True)


@router.get("/me")
def get_my_advisor(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = _require_advisor_row(session, user)
    return svc.advisor_dto(m, include_email=True)


# ===========================================================================
# Directory
# ===========================================================================
@router.get("/")
def list_advisors(
    specialty: Optional[str] = Query(default=None),
    sector: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    free_only: bool = Query(default=False),
    max_rate: Optional[float] = Query(default=None, ge=0),
    accepting_only: bool = Query(default=True),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    rows = session.exec(
        select(Advisor).where(Advisor.listed == True, Advisor.status == "active")  # noqa: E712
    ).all()
    ranked = svc.filter_and_rank(
        rows, specialty=specialty, sector=sector, q=q,
        free_only=free_only, max_rate=max_rate, accepting_only=accepting_only,
    )
    # Task #39 — batched user_id lookup so directory rows can render the
    # trust-score badge for admin/investor/partner viewers without an
    # extra fetch per row. Advisor model has no user_id FK; the reverse
    # FK lives on `users.advisor_id`.
    advisor_ids = [m.id for m, _, _ in ranked if m.id is not None]
    user_id_by_advisor: dict[int, int] = {}
    if advisor_ids:
        for u in session.exec(select(User).where(User.advisor_id.in_(advisor_ids))).all():
            if u.advisor_id and u.advisor_id not in user_id_by_advisor:
                user_id_by_advisor[u.advisor_id] = u.id
    return {
        "calcom_available": svc.calcom_available(),
        "items": [
            {**svc.advisor_dto(m, include_email=_is_admin(user), user_id=user_id_by_advisor.get(m.id)),
             "match_score": s, "match_reasons": reasons}
            for m, s, reasons in ranked
        ],
    }


@router.get("/{advisor_uid}")
def get_advisor(
    advisor_uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.exec(select(Advisor).where(Advisor.uid == advisor_uid)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Advisor not found")
    out = svc.advisor_dto(m, include_email=_is_admin(user) or user.advisor_id == m.id)

    # Recent reviews (mentee→advisor only, public-facing).
    reviews = session.exec(
        select(AdvisorReview)
        .where(AdvisorReview.advisor_id == m.id, AdvisorReview.reviewer_role == "mentee")
        .order_by(AdvisorReview.created_at.desc())
        .limit(20)
    ).all()
    out["recent_reviews"] = [svc.review_dto(r) for r in reviews]
    return out


# ===========================================================================
# Office-hour slots
# ===========================================================================
class SlotCreate(BaseModel):
    start_at: datetime
    duration_min: int = PField(default=30, ge=10, le=240)
    capacity: int = PField(default=1, ge=1, le=20)
    location_kind: str = PField(default="video", pattern="^(video|phone|in_person)$")
    location_uri: Optional[str] = None
    notes: Optional[str] = None


@router.post("/me/slots")
def create_slot(
    body: SlotCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = _require_advisor_row(session, user)
    if body.start_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Slot must be in the future")
    slot = OfficeHourSlot(
        advisor_id=m.id,
        start_at=body.start_at,
        duration_min=body.duration_min,
        capacity=body.capacity,
        location_kind=body.location_kind,
        location_uri=body.location_uri,
        notes=body.notes,
    )
    session.add(slot); session.commit(); session.refresh(slot)
    cal_id = svc.calcom_create_slot(m, slot)
    if cal_id:
        slot.calcom_event_id = cal_id
        session.add(slot); session.commit(); session.refresh(slot)
    return svc.slot_dto(slot, taken=0)


@router.get("/{advisor_uid}/slots")
def list_slots(
    advisor_uid: str,
    upcoming_only: bool = Query(default=True),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.exec(select(Advisor).where(Advisor.uid == advisor_uid)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Advisor not found")
    stmt = select(OfficeHourSlot).where(OfficeHourSlot.advisor_id == m.id)
    if upcoming_only:
        stmt = stmt.where(OfficeHourSlot.start_at > datetime.utcnow())
    slots = session.exec(stmt.order_by(OfficeHourSlot.start_at)).all()
    return {
        "items": [
            svc.slot_dto(s, taken=svc.count_active_bookings(session, s.id))
            for s in slots
        ],
    }


@router.delete("/me/slots/{slot_id}")
def cancel_slot(
    slot_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = _require_advisor_row(session, user)
    slot = session.get(OfficeHourSlot, slot_id)
    if not slot or slot.advisor_id != m.id:
        raise HTTPException(status_code=404, detail="Slot not found")
    slot.status = "cancelled"
    slot.updated_at = datetime.utcnow()
    session.add(slot)
    # Auto-cancel pending/confirmed bookings on this slot.
    bookings = session.exec(
        select(AdvisorBooking).where(
            AdvisorBooking.slot_id == slot.id,
            AdvisorBooking.status.in_(("requested", "confirmed")),
        )
    ).all()
    for b in bookings:
        b.status = "cancelled"
        b.cancelled_at = datetime.utcnow()
        b.cancelled_by_user_id = user.id
        b.cancel_reason = "Slot cancelled by advisor"
        session.add(b)
    session.commit()
    return {"ok": True, "cancelled_bookings": len(bookings)}


# ===========================================================================
# Bookings
# ===========================================================================
class BookingCreate(BaseModel):
    topic: str = PField(min_length=2, max_length=240)
    questions: Optional[str] = PField(default=None, max_length=2000)
    project_id: Optional[int] = None


@router.post("/slots/{slot_id}/book")
def book_slot(
    slot_id: int,
    body: BookingCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Anyone authenticated EXCEPT the advisor themselves may book a slot."""
    slot = session.get(OfficeHourSlot, slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    advisor = session.get(Advisor, slot.advisor_id)
    if not advisor:
        raise HTTPException(status_code=404, detail="Advisor missing")
    if user.advisor_id == advisor.id:
        raise HTTPException(status_code=400, detail="You cannot book your own slot")
    if not advisor.accepting_bookings:
        raise HTTPException(status_code=409, detail="Advisor is not accepting bookings")

    # Idempotent re-book for the same user/slot.
    existing = svc.already_booked_by(session, slot.id, user.id)
    if existing:
        return svc.booking_dto(existing)

    taken = svc.count_active_bookings(session, slot.id)
    ok, why = svc.slot_is_bookable(slot, taken)
    if not ok:
        raise HTTPException(status_code=409, detail=f"Cannot book: {why}")

    try:
        booking = svc.create_booking(
            session, advisor=advisor, slot=slot, requester=user,
            topic=body.topic, questions=body.questions, project_id=body.project_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return svc.booking_dto(booking)


@router.get("/me/bookings")
def list_my_advisor_bookings(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Advisor-side: bookings against my slots."""
    m = _require_advisor_row(session, user)
    stmt = select(AdvisorBooking).where(AdvisorBooking.advisor_id == m.id)
    if status_filter:
        stmt = stmt.where(AdvisorBooking.status == status_filter)
    rows = session.exec(stmt.order_by(AdvisorBooking.scheduled_start.desc())).all()
    requester_ids = {b.requester_user_id for b in rows}
    requesters = session.exec(select(User).where(User.id.in_(requester_ids))).all() if requester_ids else []
    requester_by_id = {u.id: u for u in requesters}
    items = []
    for booking in rows:
        dto = svc.booking_dto(booking)
        requester = requester_by_id.get(booking.requester_user_id)
        dto.update({
            "client_user_id": booking.requester_user_id,
            "client_name": requester.name if requester else None,
            "client_email": requester.email if requester else None,
            # Worker aliases retained for the existing Advisory workspace.
            "founder_user_id": booking.requester_user_id,
            "founder_name": requester.name if requester else None,
            "founder_email": requester.email if requester else None,
            "slot_starts_at": dto["scheduled_start"],
            "slot_ends_at": dto["scheduled_end"],
        })
        items.append(dto)
    return {"items": items}


@router.get("/bookings/me")
def list_my_mentee_bookings(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Mentee-side: bookings I requested."""
    stmt = select(AdvisorBooking).where(AdvisorBooking.requester_user_id == user.id)
    if status_filter:
        stmt = stmt.where(AdvisorBooking.status == status_filter)
    rows = session.exec(stmt.order_by(AdvisorBooking.scheduled_start.desc())).all()
    return {"items": [svc.booking_dto(b) for b in rows]}


def _booking_for_actor(session: Session, booking_id: int, user: User) -> tuple[AdvisorBooking, Advisor, str]:
    b = session.get(AdvisorBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    m = session.get(Advisor, b.advisor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Advisor missing")
    is_advisor_side = (user.advisor_id == m.id)
    is_mentee = (user.id == b.requester_user_id)
    if not (is_advisor_side or is_mentee or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Not your booking")
    role = "advisor" if is_advisor_side or _is_admin(user) and not is_mentee else "mentee"
    return b, m, role


class TransitionBody(BaseModel):
    reason: Optional[str] = PField(default=None, max_length=240)


@router.post("/bookings/{booking_id}/confirm")
def confirm_booking(
    booking_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b, m, _ = _booking_for_actor(session, booking_id, user)
    if user.advisor_id != m.id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the advisor may confirm")
    try:
        b = svc.transition_booking(session, b, to="confirmed", actor=user)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return svc.booking_dto(b)


@router.post("/bookings/{booking_id}/cancel")
def cancel_booking(
    booking_id: int,
    body: TransitionBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b, _, _ = _booking_for_actor(session, booking_id, user)
    try:
        b = svc.transition_booking(session, b, to="cancelled", actor=user, reason=body.reason)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return svc.booking_dto(b)


@router.post("/bookings/{booking_id}/complete")
def complete_booking(
    booking_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b, m, _ = _booking_for_actor(session, booking_id, user)
    if user.advisor_id != m.id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the advisor may complete a booking")
    try:
        b = svc.transition_booking(session, b, to="completed", actor=user)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return svc.booking_dto(b)


@router.post("/bookings/{booking_id}/no-show")
def no_show_booking(
    booking_id: int,
    body: TransitionBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b, m, _ = _booking_for_actor(session, booking_id, user)
    if user.advisor_id != m.id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the advisor may file a no-show")
    try:
        b = svc.transition_booking(session, b, to="no_show", actor=user, reason=body.reason)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return svc.booking_dto(b)


# ===========================================================================
# Reviews (two-sided)
# ===========================================================================
class ReviewCreate(BaseModel):
    rating: int = PField(ge=1, le=5)
    comment: Optional[str] = PField(default=None, max_length=2000)


@router.post("/bookings/{booking_id}/review")
def file_review(
    booking_id: int,
    body: ReviewCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Either party may file exactly one review per booking after it has
    moved to ``completed``. Direction is inferred from the caller."""
    b = session.get(AdvisorBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status != "completed":
        raise HTTPException(status_code=409, detail="Reviews open only after completion")
    m = session.get(Advisor, b.advisor_id)
    if user.advisor_id == m.id:
        reviewer_role = "advisor"
    elif user.id == b.requester_user_id:
        reviewer_role = "mentee"
    else:
        raise HTTPException(status_code=403, detail="Not a party to this booking")

    existing = session.exec(
        select(AdvisorReview).where(
            AdvisorReview.booking_id == b.id,
            AdvisorReview.reviewer_role == reviewer_role,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="You've already filed a review for this booking")

    review = AdvisorReview(
        booking_id=b.id,
        advisor_id=m.id,
        reviewer_user_id=user.id,
        reviewer_role=reviewer_role,
        rating=body.rating,
        comment=(body.comment or None),
    )
    session.add(review); session.commit(); session.refresh(review)
    if reviewer_role == "mentee":
        svc.recompute_advisor_rating(session, m)
    return svc.review_dto(review)


@router.get("/bookings/{booking_id}/reviews")
def list_booking_reviews(
    booking_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b = session.get(AdvisorBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    m = session.get(Advisor, b.advisor_id)
    is_party = (user.id == b.requester_user_id) or (user.advisor_id == (m.id if m else None))
    if not (is_party or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Not a party to this booking")
    rows = session.exec(
        select(AdvisorReview).where(AdvisorReview.booking_id == b.id)
        .order_by(AdvisorReview.created_at)
    ).all()
    return {"items": [svc.review_dto(r) for r in rows]}

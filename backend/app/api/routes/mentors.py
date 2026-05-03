"""Task #35 — Mentor matching + office hours routes.

Surfaces:
  - Mentor profile CRUD (self + admin)
  - Public mentor directory with filters
  - Office-hour slot create / list / cancel
  - Bookings (request → confirm → complete / cancel / no_show)
  - Two-sided reviews after a completed booking

All under /api/mentors.
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
    Mentor, MentorBooking, MentorReview, OfficeHourSlot, User, UserRole,
)
from backend.app.services import mentors as svc

logger = logging.getLogger("studioos.mentors")
router = APIRouter(prefix="/mentors", tags=["Mentor matching"])


def _is_admin(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "admin"


def _is_mentor_role(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "mentor"


def _require_mentor_row(session: Session, user: User) -> Mentor:
    if not user.mentor_id:
        raise HTTPException(status_code=400, detail="No mentor profile attached to your account")
    m = session.get(Mentor, user.mentor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Mentor profile missing")
    return m


# ===========================================================================
# Profile
# ===========================================================================
class MentorUpsert(BaseModel):
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
def create_or_update_my_mentor(
    body: MentorUpsert,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Self-serve mentor profile create/update. The caller must be logged-in
    with role=mentor (admins can create on behalf of a mentor via /admin/...).
    Idempotent — POST upserts the row attached to the current user."""
    if not _is_mentor_role(user) and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Mentor role required")
    if user.mentor_id:
        m = session.get(Mentor, user.mentor_id)
        if not m:
            raise HTTPException(status_code=404, detail="Mentor profile missing")
    else:
        # First-time creation: bind to the user.
        m = Mentor(name=body.name or user.name, email=user.email)
        session.add(m); session.commit(); session.refresh(m)
        user.mentor_id = m.id
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
    return svc.mentor_dto(m, include_email=True)


@router.get("/me")
def get_my_mentor(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = _require_mentor_row(session, user)
    return svc.mentor_dto(m, include_email=True)


# ===========================================================================
# Directory
# ===========================================================================
@router.get("/")
def list_mentors(
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
        select(Mentor).where(Mentor.listed == True, Mentor.status == "active")  # noqa: E712
    ).all()
    ranked = svc.filter_and_rank(
        rows, specialty=specialty, sector=sector, q=q,
        free_only=free_only, max_rate=max_rate, accepting_only=accepting_only,
    )
    return {
        "calcom_available": svc.calcom_available(),
        "items": [
            {**svc.mentor_dto(m, include_email=_is_admin(user)),
             "match_score": s, "match_reasons": reasons}
            for m, s, reasons in ranked
        ],
    }


@router.get("/{mentor_uid}")
def get_mentor(
    mentor_uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.exec(select(Mentor).where(Mentor.uid == mentor_uid)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mentor not found")
    out = svc.mentor_dto(m, include_email=_is_admin(user) or user.mentor_id == m.id)

    # Recent reviews (mentee→mentor only, public-facing).
    reviews = session.exec(
        select(MentorReview)
        .where(MentorReview.mentor_id == m.id, MentorReview.reviewer_role == "mentee")
        .order_by(MentorReview.created_at.desc())
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
    m = _require_mentor_row(session, user)
    if body.start_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Slot must be in the future")
    slot = OfficeHourSlot(
        mentor_id=m.id,
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


@router.get("/{mentor_uid}/slots")
def list_slots(
    mentor_uid: str,
    upcoming_only: bool = Query(default=True),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.exec(select(Mentor).where(Mentor.uid == mentor_uid)).first()
    if not m:
        raise HTTPException(status_code=404, detail="Mentor not found")
    stmt = select(OfficeHourSlot).where(OfficeHourSlot.mentor_id == m.id)
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
    m = _require_mentor_row(session, user)
    slot = session.get(OfficeHourSlot, slot_id)
    if not slot or slot.mentor_id != m.id:
        raise HTTPException(status_code=404, detail="Slot not found")
    slot.status = "cancelled"
    slot.updated_at = datetime.utcnow()
    session.add(slot)
    # Auto-cancel pending/confirmed bookings on this slot.
    bookings = session.exec(
        select(MentorBooking).where(
            MentorBooking.slot_id == slot.id,
            MentorBooking.status.in_(("requested", "confirmed")),
        )
    ).all()
    for b in bookings:
        b.status = "cancelled"
        b.cancelled_at = datetime.utcnow()
        b.cancelled_by_user_id = user.id
        b.cancel_reason = "Slot cancelled by mentor"
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
    """Anyone authenticated EXCEPT the mentor themselves may book a slot."""
    slot = session.get(OfficeHourSlot, slot_id)
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    mentor = session.get(Mentor, slot.mentor_id)
    if not mentor:
        raise HTTPException(status_code=404, detail="Mentor missing")
    if user.mentor_id == mentor.id:
        raise HTTPException(status_code=400, detail="You cannot book your own slot")
    if not mentor.accepting_bookings:
        raise HTTPException(status_code=409, detail="Mentor is not accepting bookings")

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
            session, mentor=mentor, slot=slot, requester=user,
            topic=body.topic, questions=body.questions, project_id=body.project_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return svc.booking_dto(booking)


@router.get("/me/bookings")
def list_my_mentor_bookings(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Mentor-side: bookings against my slots."""
    m = _require_mentor_row(session, user)
    stmt = select(MentorBooking).where(MentorBooking.mentor_id == m.id)
    if status_filter:
        stmt = stmt.where(MentorBooking.status == status_filter)
    rows = session.exec(stmt.order_by(MentorBooking.scheduled_start.desc())).all()
    return {"items": [svc.booking_dto(b) for b in rows]}


@router.get("/bookings/me")
def list_my_mentee_bookings(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Mentee-side: bookings I requested."""
    stmt = select(MentorBooking).where(MentorBooking.requester_user_id == user.id)
    if status_filter:
        stmt = stmt.where(MentorBooking.status == status_filter)
    rows = session.exec(stmt.order_by(MentorBooking.scheduled_start.desc())).all()
    return {"items": [svc.booking_dto(b) for b in rows]}


def _booking_for_actor(session: Session, booking_id: int, user: User) -> tuple[MentorBooking, Mentor, str]:
    b = session.get(MentorBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    m = session.get(Mentor, b.mentor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Mentor missing")
    is_mentor_side = (user.mentor_id == m.id)
    is_mentee = (user.id == b.requester_user_id)
    if not (is_mentor_side or is_mentee or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Not your booking")
    role = "mentor" if is_mentor_side or _is_admin(user) and not is_mentee else "mentee"
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
    if user.mentor_id != m.id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the mentor may confirm")
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
    if user.mentor_id != m.id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the mentor may complete a booking")
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
    if user.mentor_id != m.id and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the mentor may file a no-show")
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
    b = session.get(MentorBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    if b.status != "completed":
        raise HTTPException(status_code=409, detail="Reviews open only after completion")
    m = session.get(Mentor, b.mentor_id)
    if user.mentor_id == m.id:
        reviewer_role = "mentor"
    elif user.id == b.requester_user_id:
        reviewer_role = "mentee"
    else:
        raise HTTPException(status_code=403, detail="Not a party to this booking")

    existing = session.exec(
        select(MentorReview).where(
            MentorReview.booking_id == b.id,
            MentorReview.reviewer_role == reviewer_role,
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="You've already filed a review for this booking")

    review = MentorReview(
        booking_id=b.id,
        mentor_id=m.id,
        reviewer_user_id=user.id,
        reviewer_role=reviewer_role,
        rating=body.rating,
        comment=(body.comment or None),
    )
    session.add(review); session.commit(); session.refresh(review)
    if reviewer_role == "mentee":
        svc.recompute_mentor_rating(session, m)
    return svc.review_dto(review)


@router.get("/bookings/{booking_id}/reviews")
def list_booking_reviews(
    booking_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b = session.get(MentorBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    m = session.get(Mentor, b.mentor_id)
    is_party = (user.id == b.requester_user_id) or (user.mentor_id == (m.id if m else None))
    if not (is_party or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Not a party to this booking")
    rows = session.exec(
        select(MentorReview).where(MentorReview.booking_id == b.id)
        .order_by(MentorReview.created_at)
    ).all()
    return {"items": [svc.review_dto(r) for r in rows]}

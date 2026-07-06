"""Task #54 — Partner office hours.

Mirrors the advisor office-hour flow but for service-provider Partners.

Surfaces:
  * Partner-side: publish bookable slots, list / cancel my slots,
    list incoming bookings, confirm / complete / cancel / no-show.
  * Founder/investor side: list a partner's open slots, book one,
    cancel my own booking.
  * The unified calendar layer (`/api/calendar/events`) ingests
    confirmed/requested partner bookings as a new source kind
    (`partner_office_hour`) so they appear alongside advisor bookings,
    IC meetings, and founder check-ins.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field as PField
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    Partner, PartnerBooking, PartnerOfficeHourSlot, User,
)

logger = logging.getLogger("studioos.partner_office_hours")
router = APIRouter(prefix="/partner-office-hours", tags=["Partner office hours"])

ACTIVE_BOOKING_STATES = ("requested", "confirmed", "completed")


def _is_admin(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "admin"


def _is_partner_role(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "partner"


def _require_partner(session: Session, user: User) -> Partner:
    """Resolve the Partner row for the calling user.

    Hardened (Task #54 review): role-gated FIRST. Only users with role
    ``partner`` (or ``admin`` acting on behalf of one) may access partner
    surfaces; this prevents privilege escalation via email-based linking
    on accounts that happen to share an address with a Partner row.

    Resolution order: explicit ``users.partner_id`` link → email match
    (only for partner-role accounts). Email-based linkage backfills the
    `partner_id` column so subsequent calls take the fast path.
    """
    if not (_is_partner_role(user) or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Partner role required")
    if user.partner_id:
        p = session.get(Partner, user.partner_id)
        if p:
            return p
    # Email-based backfill is only safe once the role gate above has run.
    p = session.exec(select(Partner).where(Partner.email == user.email)).first()
    if p:
        if not user.partner_id and _is_partner_role(user):
            user.partner_id = p.id
            session.add(user); session.commit()
        return p
    raise HTTPException(status_code=400, detail="No partner profile attached to your account")


def _slot_dto(slot: PartnerOfficeHourSlot, *, taken: int = 0) -> dict:
    return {
        "id": slot.id,
        "uid": slot.uid,
        "partner_id": slot.partner_id,
        "title": slot.title,
        "start_at": slot.start_at.isoformat(),
        "duration_min": slot.duration_min,
        "capacity": slot.capacity,
        "taken": taken,
        "remaining": max(0, slot.capacity - taken),
        "location_kind": slot.location_kind,
        "location_uri": slot.location_uri,
        "notes": slot.notes,
        "status": slot.status,
    }


def _booking_dto(b: PartnerBooking) -> dict:
    return {
        "id": b.id,
        "uid": b.uid,
        "slot_id": b.slot_id,
        "partner_id": b.partner_id,
        "requester_user_id": b.requester_user_id,
        "project_id": b.project_id,
        "topic": b.topic,
        "questions": b.questions,
        "scheduled_start": b.scheduled_start.isoformat(),
        "scheduled_end": b.scheduled_end.isoformat(),
        "status": b.status,
        "meeting_uri": b.meeting_uri,
        "cancel_reason": b.cancel_reason,
    }


def _count_active(session: Session, slot_id: int) -> int:
    rows = session.exec(
        select(PartnerBooking).where(
            PartnerBooking.slot_id == slot_id,
            PartnerBooking.status.in_(ACTIVE_BOOKING_STATES),
        )
    ).all()
    return len(rows)


# ===========================================================================
# Slot management (partner-side)
# ===========================================================================
class SlotCreate(BaseModel):
    title: Optional[str] = PField(default=None, max_length=120)
    start_at: datetime
    duration_min: int = PField(default=30, ge=10, le=480)
    capacity: int = PField(default=1, ge=1, le=50)
    location_kind: str = PField(default="video")
    location_uri: Optional[str] = PField(default=None, max_length=500)
    notes: Optional[str] = PField(default=None, max_length=2000)


@router.post("/me/slots")
def create_slot(
    body: SlotCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not (_is_partner_role(user) or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Partner role required")
    p = _require_partner(session, user)
    if body.start_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Slot must start in the future")
    slot = PartnerOfficeHourSlot(
        partner_id=p.id,
        title=body.title,
        start_at=body.start_at.replace(tzinfo=None),
        duration_min=body.duration_min,
        capacity=body.capacity,
        location_kind=body.location_kind,
        location_uri=body.location_uri,
        notes=body.notes,
    )
    session.add(slot); session.commit(); session.refresh(slot)
    return _slot_dto(slot, taken=0)


@router.get("/me/slots")
def list_my_slots(
    upcoming_only: bool = Query(default=True),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _require_partner(session, user)
    stmt = select(PartnerOfficeHourSlot).where(PartnerOfficeHourSlot.partner_id == p.id)
    if upcoming_only:
        stmt = stmt.where(PartnerOfficeHourSlot.start_at > datetime.utcnow())
    slots = session.exec(stmt.order_by(PartnerOfficeHourSlot.start_at)).all()
    return {"items": [_slot_dto(s, taken=_count_active(session, s.id)) for s in slots]}


@router.get("/partners/{partner_uid}/slots")
def list_partner_slots(
    partner_uid: str,
    upcoming_only: bool = Query(default=True),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    """Public-to-authenticated-users: list a specific partner's open slots."""
    p = session.exec(select(Partner).where(Partner.uid == partner_uid)).first()
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    stmt = select(PartnerOfficeHourSlot).where(
        PartnerOfficeHourSlot.partner_id == p.id,
        PartnerOfficeHourSlot.status == "open",
    )
    if upcoming_only:
        stmt = stmt.where(PartnerOfficeHourSlot.start_at > datetime.utcnow())
    slots = session.exec(stmt.order_by(PartnerOfficeHourSlot.start_at)).all()
    return {"items": [_slot_dto(s, taken=_count_active(session, s.id)) for s in slots]}


@router.delete("/me/slots/{slot_id}")
def cancel_slot(
    slot_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _require_partner(session, user)
    slot = session.get(PartnerOfficeHourSlot, slot_id)
    if not slot or slot.partner_id != p.id:
        raise HTTPException(status_code=404, detail="Slot not found")
    slot.status = "cancelled"
    slot.updated_at = datetime.utcnow()
    session.add(slot)
    bookings = session.exec(
        select(PartnerBooking).where(
            PartnerBooking.slot_id == slot.id,
            PartnerBooking.status.in_(("requested", "confirmed")),
        )
    ).all()
    for b in bookings:
        b.status = "cancelled"
        b.cancelled_at = datetime.utcnow()
        b.cancelled_by_user_id = user.id
        b.cancel_reason = "Slot cancelled by partner"
        session.add(b)
    session.commit()
    return {"ok": True, "cancelled_bookings": len(bookings)}


# ===========================================================================
# Booking flow
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
    """Anyone authenticated EXCEPT the publishing partner may book."""
    slot = session.get(PartnerOfficeHourSlot, slot_id)
    if not slot or slot.status != "open":
        raise HTTPException(status_code=404, detail="Slot not available")
    p = session.get(Partner, slot.partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Partner missing")
    if user.partner_id and user.partner_id == p.id:
        raise HTTPException(status_code=400, detail="You cannot book your own slot")
    if slot.start_at <= datetime.utcnow():
        raise HTTPException(status_code=409, detail="Slot has already started")

    # Idempotent re-book.
    existing = session.exec(
        select(PartnerBooking).where(
            PartnerBooking.slot_id == slot.id,
            PartnerBooking.requester_user_id == user.id,
            PartnerBooking.status.in_(ACTIVE_BOOKING_STATES),
        )
    ).first()
    if existing:
        return _booking_dto(existing)

    taken = _count_active(session, slot.id)
    if taken >= slot.capacity:
        raise HTTPException(status_code=409, detail="Slot is full")

    booking = PartnerBooking(
        slot_id=slot.id,
        partner_id=p.id,
        requester_user_id=user.id,
        project_id=body.project_id,
        topic=body.topic,
        questions=body.questions,
        scheduled_start=slot.start_at,
        scheduled_end=slot.start_at + timedelta(minutes=slot.duration_min),
        meeting_uri=slot.location_uri,
        status="requested",
    )
    session.add(booking); session.commit(); session.refresh(booking)
    return _booking_dto(booking)


@router.get("/me/bookings")
def list_my_partner_bookings(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Partner-side: bookings against my slots."""
    p = _require_partner(session, user)
    stmt = select(PartnerBooking).where(PartnerBooking.partner_id == p.id)
    if status_filter:
        stmt = stmt.where(PartnerBooking.status == status_filter)
    rows = session.exec(stmt.order_by(PartnerBooking.scheduled_start.desc())).all()
    return {"items": [_booking_dto(b) for b in rows]}


@router.get("/bookings/me")
def list_my_requested_bookings(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Founder/requester-side: bookings I made."""
    stmt = select(PartnerBooking).where(PartnerBooking.requester_user_id == user.id)
    if status_filter:
        stmt = stmt.where(PartnerBooking.status == status_filter)
    rows = session.exec(stmt.order_by(PartnerBooking.scheduled_start.desc())).all()
    return {"items": [_booking_dto(b) for b in rows]}


def _resolve_booking(session: Session, booking_id: int, user: User) -> tuple[PartnerBooking, Partner, str]:
    b = session.get(PartnerBooking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    p = session.get(Partner, b.partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Partner missing")
    # Hardened (Task #54 review): partner-side authority requires the
    # caller to actually hold the partner role — a stale ``users.partner_id``
    # on a non-partner account must NOT grant booking transitions.
    is_partner_side = bool(
        _is_partner_role(user)
        and user.partner_id
        and user.partner_id == p.id
    )
    is_requester = (user.id == b.requester_user_id)
    if not (is_partner_side or is_requester or _is_admin(user)):
        raise HTTPException(status_code=403, detail="Not your booking")
    role = "partner" if (is_partner_side or _is_admin(user)) else "requester"
    return b, p, role


class TransitionBody(BaseModel):
    reason: Optional[str] = PField(default=None, max_length=240)


def _transition(b: PartnerBooking, *, to: str, actor: User, reason: Optional[str] = None) -> PartnerBooking:
    legal = {
        "confirmed": ("requested",),
        "completed": ("confirmed",),
        "cancelled": ("requested", "confirmed"),
        "no_show":   ("confirmed",),
    }
    if to not in legal:
        raise HTTPException(status_code=400, detail=f"Unknown transition '{to}'")
    if b.status not in legal[to]:
        raise HTTPException(status_code=409, detail=f"Cannot {to} from {b.status}")
    now = datetime.utcnow()
    b.status = to
    if to == "confirmed":
        b.confirmed_at = now
    elif to == "completed":
        b.completed_at = now
    elif to == "cancelled":
        b.cancelled_at = now
        b.cancelled_by_user_id = actor.id
        b.cancel_reason = reason or "Cancelled"
    elif to == "no_show":
        b.cancelled_at = now
        b.cancel_reason = reason or "No-show"
    b.updated_at = now
    return b


@router.post("/bookings/{booking_id}/confirm")
def confirm_booking(
    booking_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b, p, role = _resolve_booking(session, booking_id, user)
    if role != "partner" and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the partner may confirm")
    b = _transition(b, to="confirmed", actor=user)
    session.add(b); session.commit(); session.refresh(b)
    return _booking_dto(b)


@router.post("/bookings/{booking_id}/cancel")
def cancel_booking(
    booking_id: int,
    body: TransitionBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b, _, _ = _resolve_booking(session, booking_id, user)
    b = _transition(b, to="cancelled", actor=user, reason=body.reason)
    session.add(b); session.commit(); session.refresh(b)
    return _booking_dto(b)


@router.post("/bookings/{booking_id}/complete")
def complete_booking(
    booking_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b, p, role = _resolve_booking(session, booking_id, user)
    if role != "partner" and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the partner may complete")
    b = _transition(b, to="completed", actor=user)
    session.add(b); session.commit(); session.refresh(b)
    return _booking_dto(b)


@router.post("/bookings/{booking_id}/no-show")
def no_show_booking(
    booking_id: int,
    body: TransitionBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    b, p, role = _resolve_booking(session, booking_id, user)
    if role != "partner" and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only the partner may file a no-show")
    b = _transition(b, to="no_show", actor=user, reason=body.reason)
    session.add(b); session.commit(); session.refresh(b)
    return _booking_dto(b)

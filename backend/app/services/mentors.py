"""Task #35 — Mentor matching + office hours service layer.

Responsibilities
================
* Cal.com mirror client (env-gated). When ``CALCOM_API_KEY`` is unset the
  in-app scheduler is the source of truth; when set, slot creation /
  booking is mirrored to Cal.com so a mentor's existing calendar stays
  authoritative.
* Slot capacity arithmetic — counting ``confirmed`` (and pending
  ``requested``) bookings against an ``OfficeHourSlot.capacity``.
* Booking transitions — request → confirm → complete / cancel / no_show
  with idempotent guards and audit-friendly timestamps.
* Two-sided review aggregation — recompute ``Mentor.rating_avg`` /
  ``rating_count`` from mentee→mentor rows on every new review.
* Directory ranking — light scoring used by ``GET /mentors`` (sectors /
  specialties keyword overlap + rating + accepting_bookings).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Iterable, Optional

import httpx
from sqlmodel import Session, select

from backend.app.models.entities import (
    Mentor, MentorBooking, MentorReview, OfficeHourSlot, User,
)

logger = logging.getLogger("studioos.mentors")

# Bookings that count against a slot's capacity. ``cancelled`` and
# ``no_show`` free the spot up.
ACTIVE_BOOKING_STATES = ("requested", "confirmed", "completed")
ALL_BOOKING_STATES = ACTIVE_BOOKING_STATES + ("cancelled", "no_show")


# ===========================================================================
# Cal.com mirror client
# ===========================================================================
def calcom_available() -> bool:
    return bool(os.getenv("CALCOM_API_KEY"))


def _calcom_base() -> str:
    return os.getenv("CALCOM_API_BASE", "https://api.cal.com/v2")


def _calcom_headers() -> dict:
    key = os.getenv("CALCOM_API_KEY", "")
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "cal-api-version": "2024-08-13",
    }


def calcom_create_slot(mentor: Mentor, slot: OfficeHourSlot) -> Optional[str]:
    """Mirror a slot into Cal.com. Returns the remote event id or None on
    failure. Failure here MUST NOT raise — it's a best-effort mirror."""
    if not calcom_available() or not mentor.calcom_event_type_id:
        return None
    payload = {
        "eventTypeId": mentor.calcom_event_type_id,
        "start": slot.start_at.isoformat() + "Z",
        "duration": slot.duration_min,
        "metadata": {"mentor_uid": mentor.uid, "slot_uid": slot.uid},
    }
    try:
        with httpx.Client(timeout=10.0) as cli:
            r = cli.post(f"{_calcom_base()}/slots", headers=_calcom_headers(), json=payload)
            if r.status_code >= 400:
                logger.warning("calcom_create_slot %s: %s", r.status_code, r.text[:200])
                return None
            data = r.json()
            return data.get("data", {}).get("id") or data.get("id")
    except Exception as exc:  # noqa: BLE001
        logger.warning("calcom_create_slot exception: %s", exc)
        return None


def calcom_create_booking(
    mentor: Mentor, slot: OfficeHourSlot, booking: MentorBooking, requester: User,
) -> Optional[str]:
    """Mirror a booking into Cal.com. Returns the remote booking id or None."""
    if not calcom_available() or not mentor.calcom_event_type_id:
        return None
    payload = {
        "eventTypeId": mentor.calcom_event_type_id,
        "start": booking.scheduled_start.isoformat() + "Z",
        "attendee": {"name": requester.name, "email": requester.email,
                     "timeZone": mentor.timezone or "UTC"},
        "metadata": {"booking_uid": booking.uid, "topic": booking.topic[:120]},
    }
    try:
        with httpx.Client(timeout=10.0) as cli:
            r = cli.post(f"{_calcom_base()}/bookings", headers=_calcom_headers(), json=payload)
            if r.status_code >= 400:
                logger.warning("calcom_create_booking %s: %s", r.status_code, r.text[:200])
                return None
            return r.json().get("data", {}).get("uid")
    except Exception as exc:  # noqa: BLE001
        logger.warning("calcom_create_booking exception: %s", exc)
        return None


def calcom_cancel_booking(remote_id: str) -> bool:
    if not calcom_available() or not remote_id:
        return False
    try:
        with httpx.Client(timeout=10.0) as cli:
            r = cli.post(f"{_calcom_base()}/bookings/{remote_id}/cancel",
                         headers=_calcom_headers(), json={"reason": "Cancelled in StudioOS"})
            return r.status_code < 400
    except Exception as exc:  # noqa: BLE001
        logger.warning("calcom_cancel_booking exception: %s", exc)
        return False


# ===========================================================================
# Slot / booking helpers
# ===========================================================================
def count_active_bookings(session: Session, slot_id: int) -> int:
    rows = session.exec(
        select(MentorBooking).where(
            MentorBooking.slot_id == slot_id,
            MentorBooking.status.in_(ACTIVE_BOOKING_STATES),
        )
    ).all()
    return len(rows)


def slot_is_bookable(slot: OfficeHourSlot, taken: int) -> tuple[bool, str]:
    if slot.status != "open":
        return False, f"slot is {slot.status}"
    if slot.start_at <= datetime.utcnow():
        return False, "slot is in the past"
    if taken >= slot.capacity:
        return False, "slot is full"
    return True, "ok"


def already_booked_by(session: Session, slot_id: int, user_id: int) -> Optional[MentorBooking]:
    """A user can have at most one active booking per slot — repeated POSTs
    must be idempotent (return the existing booking) rather than 500."""
    return session.exec(
        select(MentorBooking).where(
            MentorBooking.slot_id == slot_id,
            MentorBooking.requester_user_id == user_id,
            MentorBooking.status.in_(ACTIVE_BOOKING_STATES),
        )
    ).first()


def create_booking(
    session: Session, *, mentor: Mentor, slot: OfficeHourSlot,
    requester: User, topic: str, questions: Optional[str], project_id: Optional[int],
) -> MentorBooking:
    """Atomically create a booking under a row-level lock on the slot.

    Two concurrent requests against the same slot serialize on
    ``SELECT ... FOR UPDATE`` so the capacity check + insert happens
    inside a single transaction window. SQLite (used by some local
    dev/test setups) ignores ``FOR UPDATE`` — that's fine because SQLite
    serializes writers anyway.
    """
    # Lock the slot row for the duration of this transaction.
    locked = session.exec(
        select(OfficeHourSlot).where(OfficeHourSlot.id == slot.id).with_for_update()
    ).first()
    if locked is None:
        raise ValueError("slot disappeared")
    taken = count_active_bookings(session, locked.id)
    bookable, why = slot_is_bookable(locked, taken)
    if not bookable:
        raise ValueError(why)

    booking = MentorBooking(
        slot_id=locked.id,
        mentor_id=mentor.id,
        requester_user_id=requester.id,
        project_id=project_id,
        topic=topic.strip()[:240] or "Office hours",
        questions=(questions or None),
        scheduled_start=locked.start_at,
        scheduled_end=locked.start_at + timedelta(minutes=locked.duration_min),
        status="requested",
        meeting_uri=locked.location_uri,
    )
    session.add(booking)
    session.commit()
    session.refresh(booking)

    # Best-effort Cal.com mirror.
    cal_id = calcom_create_booking(mentor, slot, booking, requester)
    if cal_id:
        booking.calcom_booking_id = cal_id
        session.add(booking); session.commit(); session.refresh(booking)
    return booking


def transition_booking(
    session: Session, booking: MentorBooking, *, to: str,
    actor: User, reason: Optional[str] = None,
) -> MentorBooking:
    """Validated lifecycle transition. Idempotent — calling with the same
    target state on an already-terminal booking is a no-op."""
    valid = {
        "requested": {"confirmed", "cancelled"},
        "confirmed": {"completed", "cancelled", "no_show"},
        "completed": set(),
        "cancelled": set(),
        "no_show": set(),
    }
    if booking.status == to:
        return booking
    if to not in valid.get(booking.status, set()):
        raise ValueError(f"cannot move booking from {booking.status} to {to}")
    now = datetime.utcnow()
    booking.status = to
    if to == "confirmed":
        booking.confirmed_at = now
    elif to == "completed":
        booking.completed_at = now
    elif to == "cancelled":
        booking.cancelled_at = now
        booking.cancelled_by_user_id = actor.id
        if reason:
            booking.cancel_reason = reason[:240]
        if booking.calcom_booking_id:
            calcom_cancel_booking(booking.calcom_booking_id)
    elif to == "no_show":
        booking.completed_at = now  # treat as terminal
        if reason:
            booking.cancel_reason = reason[:240]
    booking.updated_at = now
    session.add(booking); session.commit(); session.refresh(booking)
    return booking


# ===========================================================================
# Reviews
# ===========================================================================
def recompute_mentor_rating(session: Session, mentor: Mentor) -> None:
    """Cache mentee→mentor rating aggregate on the Mentor row.

    Acquires a row-level lock on the mentor before reading reviews + writing
    the cache so two concurrent reviews can't race and lose an update.
    """
    locked = session.exec(
        select(Mentor).where(Mentor.id == mentor.id).with_for_update()
    ).first()
    if locked is None:
        return
    rows = session.exec(
        select(MentorReview).where(
            MentorReview.mentor_id == locked.id,
            MentorReview.reviewer_role == "mentee",
        )
    ).all()
    if not rows:
        locked.rating_avg = None
        locked.rating_count = 0
    else:
        locked.rating_avg = round(sum(r.rating for r in rows) / len(rows), 2)
        locked.rating_count = len(rows)
    locked.updated_at = datetime.utcnow()
    session.add(locked); session.commit()


# ===========================================================================
# Directory ranking
# ===========================================================================
def _parse_json_list(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return [str(x).lower() for x in v] if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def score_mentor_for_query(
    mentor: Mentor, *, specialty: Optional[str] = None,
    sector: Optional[str] = None, q: Optional[str] = None,
) -> tuple[int, list[str]]:
    """Lightweight scorer. Returns (score, reasons[])."""
    score, reasons = 0, []
    specs = _parse_json_list(mentor.specialties_json)
    sectors = _parse_json_list(mentor.sectors_json)

    if specialty:
        sp = specialty.lower().strip()
        if sp in specs:
            score += 50; reasons.append(f"specialty: {specialty}")
    if sector:
        sc = sector.lower().strip()
        if sc in sectors:
            score += 30; reasons.append(f"sector: {sector}")
    if q:
        ql = q.lower().strip()
        haystack = " ".join([mentor.name or "", mentor.headline or "",
                             mentor.bio or "", " ".join(specs), " ".join(sectors)]).lower()
        if ql and ql in haystack:
            score += 20; reasons.append(f"keyword: {q}")
    if mentor.rating_avg:
        # +0..+15 based on rating (4.0 → +5, 5.0 → +15).
        score += int(max(0, (mentor.rating_avg - 3.5)) * 10)
        if mentor.rating_avg >= 4.5:
            reasons.append(f"⭐ {mentor.rating_avg}")
    if mentor.accepting_bookings:
        score += 5
    else:
        score -= 25
    return score, reasons


def filter_and_rank(
    mentors: Iterable[Mentor], *, specialty: Optional[str] = None,
    sector: Optional[str] = None, q: Optional[str] = None,
    free_only: bool = False, max_rate: Optional[float] = None,
    accepting_only: bool = True,
) -> list[tuple[Mentor, int, list[str]]]:
    out: list[tuple[Mentor, int, list[str]]] = []
    for m in mentors:
        if accepting_only and not m.accepting_bookings:
            continue
        if free_only and (m.hourly_rate or 0) > 0:
            continue
        if max_rate is not None and (m.hourly_rate or 0) > max_rate:
            continue
        s, reasons = score_mentor_for_query(m, specialty=specialty, sector=sector, q=q)
        out.append((m, s, reasons))
    out.sort(key=lambda t: (-t[1], -(t[0].rating_avg or 0), t[0].id or 0))
    return out


# ===========================================================================
# Serialisation helpers
# ===========================================================================
def mentor_dto(m: Mentor, *, include_email: bool = False, user_id: int | None = None) -> dict:
    return {
        "id": m.id,
        "uid": m.uid,
        "user_id": user_id,
        "name": m.name,
        "email": m.email if include_email else None,
        "headline": m.headline,
        "bio": m.bio,
        "specialties": _parse_json_list(m.specialties_json),
        "sectors": _parse_json_list(m.sectors_json),
        "timezone": m.timezone,
        "capacity_per_week": m.capacity_per_week,
        "hourly_rate": m.hourly_rate,
        "currency": m.currency,
        "accepting_bookings": m.accepting_bookings,
        "rating_avg": m.rating_avg,
        "rating_count": m.rating_count,
        "calcom_username": m.calcom_username,
        "status": m.status,
    }


def slot_dto(s: OfficeHourSlot, *, taken: int = 0) -> dict:
    return {
        "id": s.id,
        "uid": s.uid,
        "mentor_id": s.mentor_id,
        "start_at": s.start_at.isoformat(),
        "duration_min": s.duration_min,
        "capacity": s.capacity,
        "taken": taken,
        "remaining": max(0, s.capacity - taken),
        "location_kind": s.location_kind,
        "location_uri": s.location_uri,
        "notes": s.notes,
        "status": s.status,
    }


def booking_dto(b: MentorBooking) -> dict:
    return {
        "id": b.id,
        "uid": b.uid,
        "slot_id": b.slot_id,
        "mentor_id": b.mentor_id,
        "requester_user_id": b.requester_user_id,
        "project_id": b.project_id,
        "topic": b.topic,
        "questions": b.questions,
        "scheduled_start": b.scheduled_start.isoformat(),
        "scheduled_end": b.scheduled_end.isoformat(),
        "status": b.status,
        "confirmed_at": b.confirmed_at.isoformat() if b.confirmed_at else None,
        "completed_at": b.completed_at.isoformat() if b.completed_at else None,
        "cancelled_at": b.cancelled_at.isoformat() if b.cancelled_at else None,
        "cancel_reason": b.cancel_reason,
        "meeting_uri": b.meeting_uri,
    }


def review_dto(r: MentorReview) -> dict:
    return {
        "id": r.id,
        "uid": r.uid,
        "booking_id": r.booking_id,
        "mentor_id": r.mentor_id,
        "reviewer_user_id": r.reviewer_user_id,
        "reviewer_role": r.reviewer_role,
        "rating": r.rating,
        "comment": r.comment,
        "created_at": r.created_at.isoformat(),
    }

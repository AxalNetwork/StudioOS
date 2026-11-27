"""Task #35 — Advisor matching + office hours service layer.

Responsibilities
================
* Cal.com mirror client (env-gated). When ``CALCOM_API_KEY`` is unset the
  in-app scheduler is the source of truth; when set, slot creation /
  booking is mirrored to Cal.com so an advisor's existing calendar stays
  authoritative.
* Slot capacity arithmetic — counting ``confirmed`` (and pending
  ``requested``) bookings against an ``OfficeHourSlot.capacity``.
* Booking transitions — request → confirm → complete / cancel / no_show
  with idempotent guards and audit-friendly timestamps.
* Two-sided review aggregation — recompute ``Advisor.rating_avg`` /
  ``rating_count`` from mentee→advisor rows on every new review.
* Directory ranking — light scoring used by ``GET /advisors`` (sectors /
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
    Advisor, AdvisorBooking, AdvisorReview, OfficeHourSlot, User,
)

logger = logging.getLogger("studioos.advisors")

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


def calcom_create_slot(advisor: Advisor, slot: OfficeHourSlot) -> Optional[str]:
    """Mirror a slot into Cal.com. Returns the remote event id or None on
    failure. Failure here MUST NOT raise — it's a best-effort mirror."""
    if not calcom_available() or not advisor.calcom_event_type_id:
        return None
    payload = {
        "eventTypeId": advisor.calcom_event_type_id,
        "start": slot.start_at.isoformat() + "Z",
        "duration": slot.duration_min,
        "metadata": {"advisor_uid": advisor.uid, "slot_uid": slot.uid},
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
    advisor: Advisor, slot: OfficeHourSlot, booking: AdvisorBooking, requester: User,
) -> Optional[str]:
    """Mirror a booking into Cal.com. Returns the remote booking id or None."""
    if not calcom_available() or not advisor.calcom_event_type_id:
        return None
    payload = {
        "eventTypeId": advisor.calcom_event_type_id,
        "start": booking.scheduled_start.isoformat() + "Z",
        "attendee": {"name": requester.name, "email": requester.email,
                     "timeZone": advisor.timezone or "UTC"},
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
        select(AdvisorBooking).where(
            AdvisorBooking.slot_id == slot_id,
            AdvisorBooking.status.in_(ACTIVE_BOOKING_STATES),
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


def already_booked_by(session: Session, slot_id: int, user_id: int) -> Optional[AdvisorBooking]:
    """A user can have at most one active booking per slot — repeated POSTs
    must be idempotent (return the existing booking) rather than 500."""
    return session.exec(
        select(AdvisorBooking).where(
            AdvisorBooking.slot_id == slot_id,
            AdvisorBooking.requester_user_id == user_id,
            AdvisorBooking.status.in_(ACTIVE_BOOKING_STATES),
        )
    ).first()


def create_booking(
    session: Session, *, advisor: Advisor, slot: OfficeHourSlot,
    requester: User, topic: str, questions: Optional[str], project_id: Optional[int],
) -> AdvisorBooking:
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

    booking = AdvisorBooking(
        slot_id=locked.id,
        advisor_id=advisor.id,
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
    cal_id = calcom_create_booking(advisor, slot, booking, requester)
    if cal_id:
        booking.calcom_booking_id = cal_id
        session.add(booking); session.commit(); session.refresh(booking)
    return booking


def transition_booking(
    session: Session, booking: AdvisorBooking, *, to: str,
    actor: User, reason: Optional[str] = None,
) -> AdvisorBooking:
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
def recompute_advisor_rating(session: Session, advisor: Advisor) -> None:
    """Cache mentee→advisor rating aggregate on the Advisor row.

    Acquires a row-level lock on the advisor before reading reviews + writing
    the cache so two concurrent reviews can't race and lose an update.
    """
    locked = session.exec(
        select(Advisor).where(Advisor.id == advisor.id).with_for_update()
    ).first()
    if locked is None:
        return
    rows = session.exec(
        select(AdvisorReview).where(
            AdvisorReview.advisor_id == locked.id,
            AdvisorReview.reviewer_role == "mentee",
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


def score_advisor_for_query(
    advisor: Advisor, *, specialty: Optional[str] = None,
    sector: Optional[str] = None, q: Optional[str] = None,
) -> tuple[int, list[str]]:
    """Lightweight scorer. Returns (score, reasons[])."""
    score, reasons = 0, []
    specs = _parse_json_list(advisor.specialties_json)
    sectors = _parse_json_list(advisor.sectors_json)

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
        haystack = " ".join([advisor.name or "", advisor.headline or "",
                             advisor.bio or "", " ".join(specs), " ".join(sectors)]).lower()
        if ql and ql in haystack:
            score += 20; reasons.append(f"keyword: {q}")
    if advisor.rating_avg:
        # +0..+15 based on rating (4.0 → +5, 5.0 → +15).
        score += int(max(0, (advisor.rating_avg - 3.5)) * 10)
        if advisor.rating_avg >= 4.5:
            reasons.append(f"⭐ {advisor.rating_avg}")
    if advisor.accepting_bookings:
        score += 5
    else:
        score -= 25
    return score, reasons


def filter_and_rank(
    advisors: Iterable[Advisor], *, specialty: Optional[str] = None,
    sector: Optional[str] = None, q: Optional[str] = None,
    free_only: bool = False, max_rate: Optional[float] = None,
    accepting_only: bool = True,
) -> list[tuple[Advisor, int, list[str]]]:
    out: list[tuple[Advisor, int, list[str]]] = []
    for m in advisors:
        if accepting_only and not m.accepting_bookings:
            continue
        if free_only and (m.hourly_rate or 0) > 0:
            continue
        if max_rate is not None and (m.hourly_rate or 0) > max_rate:
            continue
        s, reasons = score_advisor_for_query(m, specialty=specialty, sector=sector, q=q)
        out.append((m, s, reasons))
    out.sort(key=lambda t: (-t[1], -(t[0].rating_avg or 0), t[0].id or 0))
    return out


# ===========================================================================
# Serialisation helpers
# ===========================================================================
def advisor_dto(m: Advisor, *, include_email: bool = False, user_id: int | None = None) -> dict:
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
        "advisor_id": s.advisor_id,
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


def booking_dto(b: AdvisorBooking) -> dict:
    return {
        "id": b.id,
        "uid": b.uid,
        "slot_id": b.slot_id,
        "advisor_id": b.advisor_id,
        "requester_user_id": b.requester_user_id,
        "project_id": b.project_id,
        "topic": b.topic,
        "questions": b.questions,
        "notes": b.questions,
        "client_message": b.questions,
        "scheduled_start": b.scheduled_start.isoformat(),
        "scheduled_end": b.scheduled_end.isoformat(),
        "status": b.status,
        "confirmed_at": b.confirmed_at.isoformat() if b.confirmed_at else None,
        "completed_at": b.completed_at.isoformat() if b.completed_at else None,
        "cancelled_at": b.cancelled_at.isoformat() if b.cancelled_at else None,
        "cancel_reason": b.cancel_reason,
        "meeting_uri": b.meeting_uri,
        "created_at": b.created_at.isoformat(),
        "updated_at": b.updated_at.isoformat(),
    }


def review_dto(r: AdvisorReview) -> dict:
    return {
        "id": r.id,
        "uid": r.uid,
        "booking_id": r.booking_id,
        "advisor_id": r.advisor_id,
        "reviewer_user_id": r.reviewer_user_id,
        "reviewer_role": r.reviewer_role,
        "rating": r.rating,
        "comment": r.comment,
        "created_at": r.created_at.isoformat(),
    }

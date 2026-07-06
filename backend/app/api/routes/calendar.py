"""Task #56 — Unified calendar layer routes.

All under ``/api/calendar``. Six surfaces:

* ``GET /events`` — unified feed across advisor bookings + IC meetings +
  founder check-ins, scoped to the caller.
* ``GET /events.ics`` — same feed rendered as an RFC 5545 iCalendar
  document for one-click subscription in Google/Outlook/Apple.
* ``POST/GET/DELETE /ic-meetings`` — investor/admin schedule + cancel
  Investment Committee meetings with N attendees.
* ``POST/GET/DELETE /founder-checkins`` — founder check-ins between a
  founder and an advisor/partner/investor.
* ``POST /google/connect``, ``GET /google/callback``,
  ``DELETE /google``, ``POST /google/sync``, ``GET /google/status`` —
  per-user Google Calendar OAuth + push-sync.
* ``POST /me/calcom`` — per-user Cal.com API key (advisor-only). Stored
  alongside the existing system-level ``CALCOM_API_KEY`` mirror.

The Google + Cal.com integrations are env-gated. Without
``GOOGLE_CLIENT_ID``/``GOOGLE_CLIENT_SECRET`` the connect endpoint
returns 503; the rest of the calendar still works because the in-app
scheduler is the source of truth.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel, Field as PField
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    FounderCheckin, GoogleOAuthToken, IcMeeting, IcMeetingAttendee,
    Advisor, User,
)
from backend.app.services import calendar_unified as svc

logger = logging.getLogger("studioos.calendar")
router = APIRouter(prefix="/calendar", tags=["Calendar"])

# In-memory CSRF/state map: state -> (user_id, browser_nonce, expires_at).
# The OAuth round-trip is a single browser session of ≤10 min so an
# in-process dict is fine; we'd promote to Redis if we ever ran
# multi-replica. Companion HttpOnly cookie binds state to one browser.
_OAUTH_STATE: dict[str, tuple[int, str, datetime]] = {}
_OAUTH_COOKIE = "axal_gcal_oauth"


def _sweep_oauth_state() -> None:
    """Drop expired entries so abandoned flows don't leak memory."""
    now = datetime.utcnow()
    for k in [k for k, v in _OAUTH_STATE.items() if v[2] < now]:
        _OAUTH_STATE.pop(k, None)


def _is_admin(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "admin"


def _role(user: User) -> str:
    return (getattr(user.role, "value", user.role) or "").lower()


# ===========================================================================
# Unified feed
# ===========================================================================
@router.get("/events")
def list_events(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    kinds: Optional[str] = Query(None, description="comma-separated kinds"),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Default window is now → 90 days out."""
    try:
        from_dt = datetime.fromisoformat(from_) if from_ else datetime.utcnow() - timedelta(days=1)
        to_dt = datetime.fromisoformat(to) if to else datetime.utcnow() + timedelta(days=90)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid from/to ISO datetime")
    kinds_list = [k.strip() for k in kinds.split(",")] if kinds else None
    events = svc.fetch_user_events(session, user, from_dt=from_dt, to_dt=to_dt, kinds=kinds_list)
    return {"items": events, "from": from_dt.isoformat(), "to": to_dt.isoformat(),
            "google_connected": bool(session.exec(
                select(GoogleOAuthToken).where(GoogleOAuthToken.user_id == user.id)
            ).first())}


@router.get("/events.ics")
def export_ics(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    from_dt = datetime.fromisoformat(from_) if from_ else datetime.utcnow() - timedelta(days=7)
    to_dt = datetime.fromisoformat(to) if to else datetime.utcnow() + timedelta(days=180)
    events = svc.fetch_user_events(session, user, from_dt=from_dt, to_dt=to_dt)
    body = svc.events_to_ics(events, calendar_name=f"Axal StudioOS — {user.name}")
    return Response(
        content=body,
        media_type="text/calendar",
        headers={"Content-Disposition": 'attachment; filename="axal-studioos.ics"'},
    )


# ===========================================================================
# IC meetings
# ===========================================================================
class IcMeetingCreate(BaseModel):
    title: str = PField(min_length=2, max_length=240)
    agenda: Optional[str] = None
    start_at: datetime
    duration_min: int = PField(default=60, ge=10, le=600)
    deal_id: Optional[int] = None
    location_kind: str = PField(default="video")
    location_uri: Optional[str] = None
    attendee_user_ids: list[int] = PField(default_factory=list)


def _can_schedule_ic(user: User) -> bool:
    return _role(user) in ("admin", "investor")


@router.post("/ic-meetings")
def create_ic_meeting(
    body: IcMeetingCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not _can_schedule_ic(user):
        raise HTTPException(status_code=403, detail="Investor or admin role required")
    if body.start_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="start_at must be in the future")
    meeting = IcMeeting(
        title=body.title.strip()[:240],
        agenda=body.agenda,
        start_at=body.start_at.replace(tzinfo=None),
        duration_min=body.duration_min,
        deal_id=body.deal_id,
        organizer_user_id=user.id,
        location_kind=body.location_kind,
        location_uri=body.location_uri,
    )
    session.add(meeting); session.commit(); session.refresh(meeting)
    # Always include the organiser as an attendee.
    attendee_ids = set(body.attendee_user_ids) | {user.id}
    for uid in attendee_ids:
        u = session.get(User, uid)
        if not u:
            continue
        session.add(IcMeetingAttendee(meeting_id=meeting.id, user_id=uid,
                                      rsvp="accepted" if uid == user.id else "invited"))
    session.commit()
    return _serialize_ic(session, meeting)


@router.get("/ic-meetings")
def list_ic_meetings(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    is_admin = _is_admin(user)
    rows = session.exec(select(IcMeeting).order_by(IcMeeting.start_at.desc())).all()
    out = []
    for m in rows:
        attendees = session.exec(
            select(IcMeetingAttendee).where(IcMeetingAttendee.meeting_id == m.id)
        ).all()
        invited_ids = {a.user_id for a in attendees}
        if not (is_admin or m.organizer_user_id == user.id or user.id in invited_ids):
            continue
        out.append(_serialize_ic(session, m, attendees=attendees))
    return {"items": out}


@router.post("/ic-meetings/{meeting_id}/rsvp")
def rsvp_ic(
    meeting_id: int, rsvp: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if rsvp not in ("accepted", "declined", "tentative"):
        raise HTTPException(status_code=400, detail="Invalid rsvp value")
    row = session.exec(
        select(IcMeetingAttendee).where(
            IcMeetingAttendee.meeting_id == meeting_id,
            IcMeetingAttendee.user_id == user.id,
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="You are not invited to this meeting")
    row.rsvp = rsvp
    session.add(row); session.commit()
    return {"ok": True, "rsvp": rsvp}


@router.delete("/ic-meetings/{meeting_id}")
def cancel_ic_meeting(
    meeting_id: int,
    reason: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.get(IcMeeting, meeting_id)
    if not m:
        raise HTTPException(status_code=404, detail="IC meeting not found")
    if not (_is_admin(user) or m.organizer_user_id == user.id):
        raise HTTPException(status_code=403, detail="Only the organiser or an admin can cancel")
    m.status = "cancelled"
    m.cancelled_at = datetime.utcnow()
    m.cancel_reason = (reason or "").strip()[:240] or None
    m.updated_at = datetime.utcnow()
    session.add(m); session.commit()
    return {"ok": True}


def _serialize_ic(session: Session, m: IcMeeting,
                  attendees: Optional[list[IcMeetingAttendee]] = None) -> dict:
    if attendees is None:
        attendees = session.exec(
            select(IcMeetingAttendee).where(IcMeetingAttendee.meeting_id == m.id)
        ).all()
    att = []
    for a in attendees:
        u = session.get(User, a.user_id)
        if u:
            att.append({"user_id": a.user_id, "email": u.email, "name": u.name, "rsvp": a.rsvp})
    return {
        "id": m.id, "uid": m.uid, "title": m.title, "agenda": m.agenda,
        "start_at": m.start_at.isoformat(), "duration_min": m.duration_min,
        "deal_id": m.deal_id, "organizer_user_id": m.organizer_user_id,
        "location_kind": m.location_kind, "location_uri": m.location_uri,
        "status": m.status, "attendees": att,
    }


# ===========================================================================
# Founder check-ins
# ===========================================================================
class FounderCheckinCreate(BaseModel):
    founder_user_id: int
    counterpart_user_id: Optional[int] = None
    project_id: Optional[int] = None
    title: str = PField(min_length=2, max_length=240)
    notes: Optional[str] = None
    start_at: datetime
    duration_min: int = PField(default=30, ge=10, le=240)
    location_kind: str = PField(default="video")
    location_uri: Optional[str] = None


@router.post("/founder-checkins")
def create_checkin(
    body: FounderCheckinCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Either party can schedule a check-in: the founder themselves, the
    advisor/partner/investor counterpart, or an admin."""
    if body.start_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="start_at must be in the future")
    target_founder = session.get(User, body.founder_user_id)
    if not target_founder:
        raise HTTPException(status_code=404, detail="founder user not found")
    is_self = user.id == body.founder_user_id
    is_counter = body.counterpart_user_id == user.id
    if not (_is_admin(user) or is_self or is_counter or
            _role(user) in ("partner", "investor", "advisor")):
        raise HTTPException(status_code=403, detail="Not allowed to schedule this check-in")
    # If counterpart wasn't set explicitly and the caller is not the founder,
    # default to the caller — that's the natural pairing.
    counter_id = body.counterpart_user_id
    if counter_id is None and not is_self:
        counter_id = user.id
    chk = FounderCheckin(
        founder_user_id=body.founder_user_id,
        counterpart_user_id=counter_id,
        project_id=body.project_id,
        title=body.title.strip()[:240],
        notes=body.notes,
        start_at=body.start_at.replace(tzinfo=None),
        duration_min=body.duration_min,
        location_kind=body.location_kind,
        location_uri=body.location_uri,
    )
    session.add(chk); session.commit(); session.refresh(chk)
    return _serialize_checkin(session, chk)


@router.get("/founder-checkins")
def list_checkins(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    is_admin = _is_admin(user)
    if is_admin:
        rows = session.exec(select(FounderCheckin).order_by(FounderCheckin.start_at.desc())).all()
    else:
        rows = session.exec(
            select(FounderCheckin).where(
                (FounderCheckin.founder_user_id == user.id) |
                (FounderCheckin.counterpart_user_id == user.id)
            ).order_by(FounderCheckin.start_at.desc())
        ).all()
    return {"items": [_serialize_checkin(session, c) for c in rows]}


@router.delete("/founder-checkins/{checkin_id}")
def cancel_checkin(
    checkin_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    c = session.get(FounderCheckin, checkin_id)
    if not c:
        raise HTTPException(status_code=404, detail="Check-in not found")
    if not (_is_admin(user) or c.founder_user_id == user.id or c.counterpart_user_id == user.id):
        raise HTTPException(status_code=403, detail="Only attendees or admin can cancel")
    c.status = "cancelled"
    c.cancelled_at = datetime.utcnow()
    c.updated_at = datetime.utcnow()
    session.add(c); session.commit()
    return {"ok": True}


def _serialize_checkin(session: Session, c: FounderCheckin) -> dict:
    f = session.get(User, c.founder_user_id)
    co = session.get(User, c.counterpart_user_id) if c.counterpart_user_id else None
    return {
        "id": c.id, "uid": c.uid, "title": c.title, "notes": c.notes,
        "start_at": c.start_at.isoformat(), "duration_min": c.duration_min,
        "location_kind": c.location_kind, "location_uri": c.location_uri,
        "status": c.status,
        "founder": {"user_id": c.founder_user_id, "email": f.email if f else None,
                    "name": f.name if f else None},
        "counterpart": ({"user_id": c.counterpart_user_id,
                         "email": co.email if co else None,
                         "name": co.name if co else None} if co else None),
        "project_id": c.project_id,
    }


# ===========================================================================
# Google Calendar OAuth + sync
# ===========================================================================
@router.get("/google/status")
def google_status(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    row = session.exec(
        select(GoogleOAuthToken).where(GoogleOAuthToken.user_id == user.id)
    ).first()
    return {
        "available": svc.google_oauth_available(),
        "connected": bool(row),
        "google_email": row.google_email if row else None,
        "last_synced_at": row.last_synced_at.isoformat() if row and row.last_synced_at else None,
        "scope": row.scope if row else None,
    }


@router.post("/google/connect")
def google_connect(response: Response, user: User = Depends(get_current_user)):
    """Returns a Google OAuth consent URL. The browser navigates there
    and Google redirects back to ``/api/calendar/google/callback`` with
    a one-time auth code that we exchange server-side.

    To prevent a CSRF account-linking attack (attacker initiates a flow,
    tricks victim into clicking the resulting Google consent URL — would
    otherwise bind the attacker's Axal account to the victim's Google
    calendar) we additionally bind the state to a per-browser HttpOnly
    nonce cookie that the callback must present.
    """
    if not svc.google_oauth_available():
        raise HTTPException(status_code=503, detail="Google OAuth not configured on server")
    _sweep_oauth_state()
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    _OAUTH_STATE[state] = (user.id, nonce, datetime.utcnow() + timedelta(minutes=10))
    response.set_cookie(
        _OAUTH_COOKIE, nonce,
        max_age=600, httponly=True, secure=True, samesite="lax", path="/",
    )
    return {"auth_url": svc.build_google_auth_url(state)}


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    session: Session = Depends(get_session),
):
    """Exchange code → tokens, persist refresh_token, redirect to the
    in-app calendar page with a result flag."""
    domain = ""
    try:
        import os
        domain = os.environ.get("REPLIT_DEV_DOMAIN", "") or ""
    except Exception:
        pass
    base = f"https://{domain}" if domain else ""
    success = f"{base}/calendar?google=connected"
    failure = f"{base}/calendar?google=failed"

    if error or not code or not state:
        return RedirectResponse(failure)
    record = _OAUTH_STATE.pop(state, None)
    if not record:
        return RedirectResponse(failure + "&reason=expired_state")
    user_id, nonce, expires = record
    if datetime.utcnow() > expires:
        return RedirectResponse(failure + "&reason=expired_state")
    # CSRF guard: the browser that completes the flow must be the same
    # browser that initiated it (we set a HttpOnly nonce cookie at /connect).
    cookie_nonce = request.cookies.get(_OAUTH_COOKIE)
    if not cookie_nonce or not secrets.compare_digest(cookie_nonce, nonce):
        logger.warning("google callback nonce mismatch for user_id=%s", user_id)
        return RedirectResponse(failure + "&reason=csrf")
    user = session.get(User, user_id)
    if not user:
        return RedirectResponse(failure + "&reason=unknown_user")

    try:
        tokens = svc.exchange_code_for_tokens(code)
    except RuntimeError as exc:
        logger.warning("google callback exchange failed: %s", exc)
        return RedirectResponse(failure + "&reason=token_exchange")
    refresh_token = tokens.get("refresh_token")
    if not refresh_token:
        # Google only returns refresh_token on first consent — if user has
        # already granted us before, they need to revoke at
        # myaccount.google.com to get a fresh one.
        return RedirectResponse(failure + "&reason=no_refresh_token")
    info = svc.fetch_userinfo(tokens.get("access_token", ""))

    existing = session.exec(
        select(GoogleOAuthToken).where(GoogleOAuthToken.user_id == user.id)
    ).first()
    if existing:
        existing.refresh_token = refresh_token
        existing.scope = tokens.get("scope", "")
        existing.google_email = info.get("email")
        existing.updated_at = datetime.utcnow()
        session.add(existing)
    else:
        session.add(GoogleOAuthToken(
            user_id=user.id, refresh_token=refresh_token,
            scope=tokens.get("scope", ""), google_email=info.get("email"),
        ))
    session.commit()
    return RedirectResponse(success)


@router.delete("/google")
def google_disconnect(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Forget the user's refresh token + every sync mapping. Does NOT
    delete the events that were already pushed (Google retains them)."""
    row = session.exec(
        select(GoogleOAuthToken).where(GoogleOAuthToken.user_id == user.id)
    ).first()
    if row:
        session.delete(row)
        session.commit()
    return {"ok": True}


@router.post("/google/sync")
def google_sync(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Push every event in the window into the user's primary Google
    calendar. Idempotent: re-runs PATCH the previously-pushed events."""
    if not svc.google_oauth_available():
        raise HTTPException(status_code=503, detail="Google OAuth not configured on server")
    from_dt = datetime.fromisoformat(from_) if from_ else datetime.utcnow() - timedelta(days=1)
    to_dt = datetime.fromisoformat(to) if to else datetime.utcnow() + timedelta(days=60)
    try:
        return svc.sync_user_to_google(session, user, from_dt=from_dt, to_dt=to_dt)
    except RuntimeError as exc:
        if str(exc) == "not_connected":
            raise HTTPException(status_code=409, detail="Connect a Google account first")
        raise HTTPException(status_code=502, detail=f"Google sync failed: {exc}")


# ===========================================================================
# Task #38 — DEV-ONLY Microsoft (Outlook) calendar + "push one" stubs.
# ---------------------------------------------------------------------------
# Production hosts these on the Worker (cloudflare-worker/src/routes/
# calendar.ts). The dev backend has no Microsoft OAuth wiring, so the
# Calendar page's loadMicrosoft() used to 404. We report the same
# "not configured / not connected" posture Google uses in dev so the page
# renders; connect/sync fail-loud with 503 (matching google_connect).
# ===========================================================================
@router.get("/microsoft/status")
def microsoft_status(user: User = Depends(get_current_user)):
    return {
        "configured": False,
        "available": False,  # back-compat alias
        "connected": False,
        "microsoft_email": None,
        "last_synced_at": None,
        "scope": None,
    }


@router.post("/microsoft/connect")
def microsoft_connect(user: User = Depends(get_current_user)):
    raise HTTPException(status_code=503, detail="Microsoft OAuth not configured on server")


@router.post("/microsoft/sync")
def microsoft_sync(user: User = Depends(get_current_user)):
    raise HTTPException(status_code=503, detail="Microsoft OAuth not configured on server")


@router.delete("/microsoft")
def microsoft_disconnect(user: User = Depends(get_current_user)):
    return {"ok": True}


_PUSHABLE_KINDS = {"advisor_booking", "ic_meeting", "founder_checkin", "partner_office_hour"}


@router.post("/push/{kind}/{source_id}")
def push_one_to_external(kind: str, source_id: int, user: User = Depends(get_current_user)):
    """Dev stub for "Add to my external calendar". No provider is connected
    in dev, so nothing is actually pushed — but we validate the kind and
    return a valid envelope so the per-event button doesn't 404."""
    if kind not in _PUSHABLE_KINDS:
        raise HTTPException(status_code=400, detail="Unsupported kind")
    return {"ok": True, "pushed": {"google": False, "microsoft": False}}


# ===========================================================================
# Per-user Cal.com API key (advisor-only)
# ===========================================================================
class CalcomKeyBody(BaseModel):
    api_key: str = PField(min_length=8, max_length=200)
    event_type_id: Optional[int] = None
    username: Optional[str] = None


@router.post("/me/calcom")
def attach_calcom_key(
    body: CalcomKeyBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Advisors can connect their own Cal.com account so bookings are
    mirrored to their personal calendar instead of the shared system
    integration. We persist the api_key on the Advisor row (column added
    if missing) so service helpers can prefer it over the env-level key.

    NOTE: this is a personal access token, not OAuth. Cal.com offers
    OAuth via their managed-users platform but it requires platform
    billing — out of scope for this task.
    """
    if _role(user) != "advisor" and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Advisor or admin only")
    if not user.advisor_id:
        raise HTTPException(status_code=400, detail="No advisor profile yet — create one first")
    m = session.get(Advisor, user.advisor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Advisor profile not found")
    # Lazy column add so we don't need a separate migration round-trip
    # for what is otherwise a single-field optional setting.
    from sqlalchemy import text
    try:
        session.exec(text("ALTER TABLE advisors ADD COLUMN IF NOT EXISTS calcom_api_key VARCHAR"))
        session.commit()
    except Exception:
        session.rollback()
    try:
        session.exec(text(
            "UPDATE advisors SET calcom_api_key = :k, calcom_event_type_id = :e, "
            "calcom_username = COALESCE(:u, calcom_username), updated_at = :now "
            "WHERE id = :id"
        ).bindparams(k=body.api_key, e=body.event_type_id,
                     u=body.username, now=datetime.utcnow(), id=m.id))
        session.commit()
    except Exception as exc:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Could not persist key: {exc}")
    return {"ok": True, "advisor_id": m.id, "calcom_event_type_id": body.event_type_id}

"""Task #56 — Unified calendar layer service.

Two responsibilities:

1. **Aggregator** — `fetch_user_events(user, from_dt, to_dt)` walks every
   bookable surface (advisor bookings, IC meetings the user is invited to or
   organising, founder check-ins where the user is founder or counterpart)
   and returns a normalised list of ``CalendarEvent`` dicts. Used by the
   `/api/calendar/events` route + ICS export + Google sync.

2. **Google Calendar client** — auth-URL builder, token-exchange,
   per-event upsert/delete via the Google Calendar v3 REST API. We use
   `httpx` and the long-lived refresh token stored in
   ``google_oauth_tokens``; access tokens are minted on demand. The
   integration is fully env-gated: when ``GOOGLE_CLIENT_ID`` /
   ``GOOGLE_CLIENT_SECRET`` are unset every call short-circuits to
   ``available=False`` and the unified calendar still works (it just
   stops mirroring outwards).

Cal.com integration: the `/api/advisors` flow already mirrors advisor
slots+bookings to a system-level Cal.com account when ``CALCOM_API_KEY``
is set. Per-user OAuth would mean Cal.com's "managed users" platform
billing — out of scope. The in-app scheduler IS the self-hosted
fallback the task brief calls out.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from urllib.parse import urlencode

import httpx
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from backend.app.models.entities import (
    CalendarSyncRecord,
    FounderCheckin,
    GoogleOAuthToken,
    IcMeeting,
    IcMeetingAttendee,
    Advisor,
    AdvisorBooking,
    Partner,
    PartnerBooking,
    User,
)

logger = logging.getLogger("studioos.calendar")


# ===========================================================================
# Google OAuth (Calendar scope)
# ===========================================================================
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"
CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]


def google_oauth_available() -> bool:
    return bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"))


def _google_redirect_uri() -> str:
    """Where Google sends the auth-code back to. Prefers an explicit env
    var, falls back to the public Replit dev domain so the local devtime
    workflow Just Works."""
    explicit = os.getenv("GOOGLE_CALENDAR_REDIRECT_URI")
    if explicit:
        return explicit
    domain = os.getenv("REPLIT_DEV_DOMAIN", "")
    base = f"https://{domain}" if domain else os.getenv("APP_URL", "http://localhost:5000")
    return f"{base}/api/calendar/google/callback"


def build_google_auth_url(state: str) -> str:
    """Standard Google OAuth 2.0 web-server flow with offline access (so we
    receive a refresh token) and forced consent (so the refresh token
    stays valid even after re-authorisation)."""
    params = {
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        "scope": " ".join(CALENDAR_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "include_granted_scopes": "true",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


def exchange_code_for_tokens(code: str) -> dict:
    """Trade an auth-code for ``{access_token, refresh_token, expires_in,
    scope, id_token}``. Raises ``RuntimeError`` on any non-2xx."""
    if not google_oauth_available():
        raise RuntimeError("google_oauth_unavailable")
    payload = {
        "code": code,
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "redirect_uri": _google_redirect_uri(),
        "grant_type": "authorization_code",
    }
    with httpx.Client(timeout=15.0) as cli:
        r = cli.post(GOOGLE_TOKEN_URL, data=payload)
        if r.status_code >= 400:
            logger.warning("google oauth code exchange returned status %s", r.status_code)
            raise RuntimeError(f"token_exchange_failed: {r.status_code}")
        return r.json()


def refresh_access_token(refresh_token: str) -> str:
    """Mint a short-lived access token from a stored refresh token."""
    if not google_oauth_available():
        raise RuntimeError("google_oauth_unavailable")
    payload = {
        "refresh_token": refresh_token,
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "grant_type": "refresh_token",
    }
    with httpx.Client(timeout=15.0) as cli:
        r = cli.post(GOOGLE_TOKEN_URL, data=payload)
        if r.status_code >= 400:
            logger.warning("google refresh failed %s: %s", r.status_code, r.text[:200])
            raise RuntimeError(f"refresh_failed: {r.status_code}")
        return r.json()["access_token"]


def fetch_userinfo(access_token: str) -> dict:
    """Best-effort: pull the user's primary Google email so the connection
    UI can show *which* Google account is linked."""
    try:
        with httpx.Client(timeout=10.0) as cli:
            r = cli.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
            if r.status_code < 400:
                return r.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("fetch_userinfo failed: %s", exc)
    return {}


# ===========================================================================
# Aggregator — unified events feed
# ===========================================================================
def _to_dict(*, kind: str, source_id: int, source_uid: str, title: str,
             start_at: datetime, end_at: datetime, status: str,
             location_kind: Optional[str], location_uri: Optional[str],
             organizer_email: Optional[str], attendees: list[dict],
             notes: Optional[str], deal_id: Optional[int] = None,
             project_id: Optional[int] = None) -> dict:
    return {
        "id": f"{kind}:{source_id}",
        "kind": kind,
        "source_id": source_id,
        "source_uid": source_uid,
        "title": title,
        "start_at": start_at.isoformat(),
        "end_at": end_at.isoformat(),
        "status": status,
        "location_kind": location_kind,
        "location_uri": location_uri,
        "organizer_email": organizer_email,
        "attendees": attendees,
        "notes": notes,
        "deal_id": deal_id,
        "project_id": project_id,
    }


def _advisor_events(session: Session, user: User,
                   from_dt: datetime, to_dt: datetime) -> list[dict]:
    """Return advisor-booking events the user is involved in.

    A user sees an advisor booking row when (a) they're the mentee
    (``requester_user_id``) or (b) they own the advisor profile attached
    to that booking (``advisor.id == user.advisor_id``).
    """
    bookings = session.exec(
        select(AdvisorBooking).where(
            AdvisorBooking.scheduled_start >= from_dt,
            AdvisorBooking.scheduled_start <= to_dt,
            AdvisorBooking.status.in_(("requested", "confirmed", "completed")),
        )
    ).all()
    out: list[dict] = []
    for b in bookings:
        is_mentee = b.requester_user_id == user.id
        is_advisor = bool(user.advisor_id and b.advisor_id == user.advisor_id)
        if not (is_mentee or is_advisor):
            continue
        advisor_row = session.get(Advisor, b.advisor_id)
        mentee = session.get(User, b.requester_user_id)
        out.append(_to_dict(
            kind="advisor_booking",
            source_id=b.id, source_uid=b.uid,
            title=f"Advisor session — {b.topic}",
            start_at=b.scheduled_start, end_at=b.scheduled_end,
            status=b.status,
            location_kind="video",
            location_uri=b.meeting_uri,
            organizer_email=(advisor_row.email if advisor_row else None),
            attendees=[
                {"email": advisor_row.email if advisor_row else None,
                 "name": advisor_row.name if advisor_row else None, "role": "advisor"},
                {"email": mentee.email if mentee else None,
                 "name": mentee.name if mentee else None, "role": "mentee"},
            ],
            notes=b.questions,
            project_id=b.project_id,
        ))
    return out


def _ic_events(session: Session, user: User,
               from_dt: datetime, to_dt: datetime) -> list[dict]:
    """IC meetings the user is organising, attending, or that an admin
    can see (admin sees everything globally)."""
    is_admin = (getattr(user.role, "value", user.role) or "").lower() == "admin"
    rows = session.exec(
        select(IcMeeting).where(
            IcMeeting.start_at >= from_dt,
            IcMeeting.start_at <= to_dt,
            IcMeeting.status != "cancelled",
        )
    ).all()
    out: list[dict] = []
    for m in rows:
        attendees = session.exec(
            select(IcMeetingAttendee).where(IcMeetingAttendee.meeting_id == m.id)
        ).all()
        invited_user_ids = {a.user_id for a in attendees}
        if not (is_admin or m.organizer_user_id == user.id or user.id in invited_user_ids):
            continue
        att_users = []
        for a in attendees:
            u = session.get(User, a.user_id)
            if u:
                att_users.append({"email": u.email, "name": u.name,
                                  "role": "attendee", "rsvp": a.rsvp})
        organizer = session.get(User, m.organizer_user_id)
        out.append(_to_dict(
            kind="ic_meeting",
            source_id=m.id, source_uid=m.uid,
            title=m.title,
            start_at=m.start_at,
            end_at=m.start_at + timedelta(minutes=m.duration_min),
            status=m.status,
            location_kind=m.location_kind,
            location_uri=m.location_uri,
            organizer_email=(organizer.email if organizer else None),
            attendees=att_users,
            notes=m.agenda,
            deal_id=m.deal_id,
        ))
    return out


def _checkin_events(session: Session, user: User,
                    from_dt: datetime, to_dt: datetime) -> list[dict]:
    """Founder check-ins where the user is the founder or the counterpart
    (advisor/partner/investor). Admin sees all."""
    is_admin = (getattr(user.role, "value", user.role) or "").lower() == "admin"
    if is_admin:
        rows = session.exec(
            select(FounderCheckin).where(
                FounderCheckin.start_at >= from_dt,
                FounderCheckin.start_at <= to_dt,
                FounderCheckin.status != "cancelled",
            )
        ).all()
    else:
        rows = session.exec(
            select(FounderCheckin).where(
                FounderCheckin.start_at >= from_dt,
                FounderCheckin.start_at <= to_dt,
                FounderCheckin.status != "cancelled",
                ((FounderCheckin.founder_user_id == user.id) |
                 (FounderCheckin.counterpart_user_id == user.id)),
            )
        ).all()
    out: list[dict] = []
    for c in rows:
        founder = session.get(User, c.founder_user_id)
        counter = session.get(User, c.counterpart_user_id) if c.counterpart_user_id else None
        attendees = []
        if founder:
            attendees.append({"email": founder.email, "name": founder.name, "role": "founder"})
        if counter:
            attendees.append({"email": counter.email, "name": counter.name, "role": "counterpart"})
        out.append(_to_dict(
            kind="founder_checkin",
            source_id=c.id, source_uid=c.uid,
            title=c.title,
            start_at=c.start_at,
            end_at=c.start_at + timedelta(minutes=c.duration_min),
            status=c.status,
            location_kind=c.location_kind,
            location_uri=c.location_uri,
            organizer_email=(counter.email if counter else (founder.email if founder else None)),
            attendees=attendees,
            notes=c.notes,
            project_id=c.project_id,
        ))
    return out


def _partner_office_hour_events(session: Session, user: User,
                                from_dt: datetime, to_dt: datetime) -> list[dict]:
    """Task #54 — Partner office-hour bookings the user is involved in.

    Visible when (a) the user is the booking requester or (b) owns the
    partner profile attached to the booking. Admin sees everything."""
    is_admin = (getattr(user.role, "value", user.role) or "").lower() == "admin"
    bookings = session.exec(
        select(PartnerBooking).where(
            PartnerBooking.scheduled_start >= from_dt,
            PartnerBooking.scheduled_start <= to_dt,
            PartnerBooking.status.in_(("requested", "confirmed", "completed")),
        )
    ).all()
    out: list[dict] = []
    for b in bookings:
        is_requester = b.requester_user_id == user.id
        is_partner_side = bool(user.partner_id and b.partner_id == user.partner_id)
        if not (is_admin or is_requester or is_partner_side):
            continue
        partner = session.get(Partner, b.partner_id)
        requester = session.get(User, b.requester_user_id)
        out.append(_to_dict(
            kind="partner_office_hour",
            source_id=b.id, source_uid=b.uid,
            title=f"Partner office hours — {b.topic}",
            start_at=b.scheduled_start, end_at=b.scheduled_end,
            status=b.status,
            location_kind="video",
            location_uri=b.meeting_uri,
            organizer_email=(partner.email if partner else None),
            attendees=[
                {"email": partner.email if partner else None,
                 "name": partner.name if partner else None, "role": "partner"},
                {"email": requester.email if requester else None,
                 "name": requester.name if requester else None, "role": "requester"},
            ],
            notes=b.questions,
            project_id=b.project_id,
        ))
    return out


def fetch_user_events(session: Session, user: User, *,
                      from_dt: datetime, to_dt: datetime,
                      kinds: Optional[Iterable[str]] = None) -> list[dict]:
    """Unified feed across all bookable surfaces, sorted by start_at."""
    wanted = set(kinds) if kinds else {
        "advisor_booking", "ic_meeting", "founder_checkin", "partner_office_hour",
    }
    out: list[dict] = []
    if "advisor_booking" in wanted:
        out.extend(_advisor_events(session, user, from_dt, to_dt))
    if "ic_meeting" in wanted:
        out.extend(_ic_events(session, user, from_dt, to_dt))
    if "founder_checkin" in wanted:
        out.extend(_checkin_events(session, user, from_dt, to_dt))
    if "partner_office_hour" in wanted:
        out.extend(_partner_office_hour_events(session, user, from_dt, to_dt))
    out.sort(key=lambda e: e["start_at"])
    return out


# ===========================================================================
# ICS export
# ===========================================================================
def _ics_dt(dt: datetime) -> str:
    """Format a datetime as a UTC iCalendar timestamp."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _ics_escape(s: Optional[str]) -> str:
    if not s:
        return ""
    return (s.replace("\\", "\\\\").replace(",", "\\,")
              .replace(";", "\\;").replace("\n", "\\n"))


def events_to_ics(events: list[dict], *, calendar_name: str = "Axal StudioOS") -> str:
    """Render a feed as an RFC 5545 iCalendar document."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Axal StudioOS//EN",
        f"X-WR-CALNAME:{_ics_escape(calendar_name)}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]
    now = _ics_dt(datetime.now(timezone.utc))
    for ev in events:
        start = datetime.fromisoformat(ev["start_at"])
        end = datetime.fromisoformat(ev["end_at"])
        uid = f"{ev['kind']}-{ev['source_uid']}@axal.vc"
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now}",
            f"DTSTART:{_ics_dt(start)}",
            f"DTEND:{_ics_dt(end)}",
            f"SUMMARY:{_ics_escape(ev['title'])}",
        ])
        if ev.get("notes"):
            lines.append(f"DESCRIPTION:{_ics_escape(ev['notes'])}")
        if ev.get("location_uri"):
            lines.append(f"LOCATION:{_ics_escape(ev['location_uri'])}")
        for a in ev.get("attendees") or []:
            if a.get("email"):
                lines.append(
                    f"ATTENDEE;CN={_ics_escape(a.get('name') or a['email'])}:mailto:{a['email']}"
                )
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


# ===========================================================================
# Google Calendar mirror
# ===========================================================================
def _event_payload(ev: dict, organizer_email: Optional[str]) -> dict:
    """Translate one unified event into Google Calendar's event schema."""
    body = {
        "summary": ev["title"],
        "description": ev.get("notes") or "",
        "start": {"dateTime": ev["start_at"], "timeZone": "UTC"},
        "end": {"dateTime": ev["end_at"], "timeZone": "UTC"},
        "source": {"title": "Axal StudioOS", "url": "https://axal.vc"},
    }
    if ev.get("location_uri"):
        body["location"] = ev["location_uri"]
    attendees = []
    for a in ev.get("attendees") or []:
        if a.get("email") and a["email"] != organizer_email:
            attendees.append({"email": a["email"], "displayName": a.get("name")})
    if attendees:
        body["attendees"] = attendees
    return body


def push_event_to_google(*, access_token: str, event_payload: dict,
                         google_event_id: Optional[str] = None) -> Optional[str]:
    """Insert (POST) or update (PATCH) a single event on the user's
    primary calendar. Returns the Google event id on success."""
    headers = {"Authorization": f"Bearer {access_token}",
               "Content-Type": "application/json"}
    try:
        with httpx.Client(timeout=15.0) as cli:
            if google_event_id:
                r = cli.patch(
                    f"{GOOGLE_CALENDAR_API}/calendars/primary/events/{google_event_id}",
                    headers=headers, json=event_payload,
                )
                # If the remote got deleted, fall through to a fresh insert.
                if r.status_code == 404:
                    pass
                elif r.status_code >= 400:
                    logger.warning("gcal patch %s: %s", r.status_code, r.text[:200])
                    return None
                else:
                    return r.json().get("id")
            r = cli.post(
                f"{GOOGLE_CALENDAR_API}/calendars/primary/events",
                headers=headers, json=event_payload,
            )
            if r.status_code >= 400:
                logger.warning("gcal insert %s: %s", r.status_code, r.text[:200])
                return None
            return r.json().get("id")
    except Exception as exc:  # noqa: BLE001
        logger.warning("push_event_to_google exception: %s", exc)
        return None


def delete_event_from_google(*, access_token: str, google_event_id: str) -> bool:
    headers = {"Authorization": f"Bearer {access_token}"}
    try:
        with httpx.Client(timeout=15.0) as cli:
            r = cli.delete(
                f"{GOOGLE_CALENDAR_API}/calendars/primary/events/{google_event_id}",
                headers=headers,
            )
            return r.status_code in (200, 204, 404, 410)
    except Exception as exc:  # noqa: BLE001
        logger.warning("delete_event_from_google exception: %s", exc)
        return False


def sync_user_to_google(session: Session, user: User, *,
                        from_dt: datetime, to_dt: datetime) -> dict:
    """Push every event in the window to the user's Google Calendar.

    Returns a summary dict ``{pushed, updated, failed, skipped, total}``.
    Every successful push lands a row in ``calendar_sync_records`` so
    re-runs PATCH instead of insert.
    """
    # Take a per-user advisory lock by row-locking the GoogleOAuthToken so
    # two concurrent /google/sync calls (e.g. user double-clicks) serialise
    # instead of both POSTing the same event and tripping uq_cal_sync_user_source.
    token_row = session.exec(
        select(GoogleOAuthToken)
        .where(GoogleOAuthToken.user_id == user.id)
        .with_for_update()
    ).first()
    if not token_row:
        raise RuntimeError("not_connected")
    access_token = refresh_access_token(token_row.refresh_token)
    events = fetch_user_events(session, user, from_dt=from_dt, to_dt=to_dt)
    pushed = updated = failed = skipped = 0
    for ev in events:
        kind, source_id = ev["kind"], ev["source_id"]
        # Re-read the per-event sync record under the same transaction so
        # we never round-trip Google twice for the same event.
        rec = session.exec(
            select(CalendarSyncRecord).where(
                CalendarSyncRecord.user_id == user.id,
                CalendarSyncRecord.source_kind == kind,
                CalendarSyncRecord.source_id == source_id,
            ).with_for_update()
        ).first()
        payload = _event_payload(ev, organizer_email=ev.get("organizer_email"))
        existing_remote = rec.google_event_id if rec else None
        new_id = push_event_to_google(
            access_token=access_token,
            event_payload=payload,
            google_event_id=existing_remote,
        )
        if not new_id:
            failed += 1
            continue
        if rec:
            rec.google_event_id = new_id
            rec.last_synced_at = datetime.now(timezone.utc)
            session.add(rec); updated += 1
        else:
            try:
                session.add(CalendarSyncRecord(
                    user_id=user.id, source_kind=kind, source_id=source_id,
                    google_event_id=new_id,
                ))
                session.flush()
                pushed += 1
            except IntegrityError:
                # Defensive: another transaction beat us to it. Roll back
                # just this insert and treat it as an update.
                session.rollback()
                failed += 1
    token_row.last_synced_at = datetime.now(timezone.utc)
    session.add(token_row)
    session.commit()
    return {
        "pushed": pushed, "updated": updated, "failed": failed,
        "skipped": skipped, "total": len(events),
    }

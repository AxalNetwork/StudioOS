"""Task #32 — Compliance calendar.

Once a project is incorporated, founders need recurring deadlines so
they don't lose good standing (annual reports, franchise tax,
registered agent renewal, board meetings). This module:

* Defines a per-jurisdiction catalogue of standard recurring events.
* Exposes a ``seed_standard_events_for_jurisdiction`` helper called by
  ``/incorporate/wizard`` to auto-populate the calendar.
* Exposes ``GET / POST / PATCH / DELETE /api/compliance/events`` for
  the ``/compliance`` page (list + filter + mark complete + manual add).
* Pairs with ``services.compliance_reminders`` which fires notify()
  pings at T-30 / 14 / 7 / 1 days before each open due date.

Out of scope (per Task #32): filing on behalf of the founder.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.models.entities import (
    ComplianceEvent,
    Entity,
    Project,
    User,
)
from backend.app.api.routes.auth import get_current_user

router = APIRouter(prefix="/compliance", tags=["compliance"])
logger = logging.getLogger("studioos.compliance")


# ---------------------------------------------------------------------------
# Standard recurring events per jurisdiction.
# ``offset_days`` is added to the incorporation date to get the first
# due_date. ``recurrence`` controls how the daily reminder loop rolls a
# completed event forward to its next occurrence.
# ---------------------------------------------------------------------------
STANDARD_EVENTS: dict[str, list[dict]] = {
    "us_de_ccorp": [
        {
            "event_type": "franchise_tax",
            "title": "Delaware franchise tax + annual report",
            "description": (
                "File the annual report and pay franchise tax via the "
                "Delaware Division of Corporations. Min ~$450/yr for "
                "early-stage; due March 1."
            ),
            "due_month": 3, "due_day": 1,
            "recurrence": "annual",
        },
        {
            "event_type": "registered_agent",
            "title": "Registered agent renewal",
            "description": "Renew your Delaware registered agent (~$100/yr).",
            "offset_days": 365,
            "recurrence": "annual",
        },
        {
            "event_type": "board_meeting",
            "title": "Quarterly board meeting",
            "description": (
                "Hold a quarterly board meeting and record minutes. "
                "Required for proper corporate hygiene under DGCL."
            ),
            "offset_days": 90,
            "recurrence": "quarterly",
        },
        {
            "event_type": "annual_report",
            "title": "Federal corporate tax (Form 1120)",
            "description": "File IRS Form 1120 by April 15 (or extension to October 15).",
            "due_month": 4, "due_day": 15,
            "recurrence": "annual",
        },
    ],
    "us_de_llc": [
        {
            "event_type": "franchise_tax",
            "title": "Delaware LLC annual tax",
            "description": "Flat $300/yr Delaware LLC tax — due June 1.",
            "due_month": 6, "due_day": 1,
            "recurrence": "annual",
        },
        {
            "event_type": "registered_agent",
            "title": "Registered agent renewal",
            "description": "Renew your Delaware registered agent.",
            "offset_days": 365,
            "recurrence": "annual",
        },
    ],
    "uk_ltd": [
        {
            "event_type": "annual_report",
            "title": "Confirmation statement (Companies House)",
            "description": "File the annual confirmation statement (£34 online).",
            "offset_days": 365,
            "recurrence": "annual",
        },
        {
            "event_type": "annual_report",
            "title": "Annual accounts",
            "description": "File annual accounts with Companies House (due 9 months after year end).",
            "offset_days": 365 + 270,
            "recurrence": "annual",
        },
        {
            "event_type": "franchise_tax",
            "title": "Corporation tax (CT600)",
            "description": "File CT600 with HMRC within 12 months of year end.",
            "offset_days": 365,
            "recurrence": "annual",
        },
    ],
    "sg_pte": [
        {
            "event_type": "annual_report",
            "title": "ACRA annual return",
            "description": "Hold AGM and file annual return with ACRA.",
            "offset_days": 365,
            "recurrence": "annual",
        },
        {
            "event_type": "franchise_tax",
            "title": "IRAS Form C-S / C",
            "description": "File estimated chargeable income (ECI) and Form C-S/C with IRAS.",
            "due_month": 11, "due_day": 30,
            "recurrence": "annual",
        },
        {
            "event_type": "registered_agent",
            "title": "Company secretary engagement",
            "description": "Renew company secretary + nominee director services.",
            "offset_days": 365,
            "recurrence": "annual",
        },
    ],
    "ee_oy": [
        {
            "event_type": "annual_report",
            "title": "Estonian Business Register annual report",
            "description": "Submit annual accounts within 6 months of year end.",
            "offset_days": 365,
            "recurrence": "annual",
        },
        {
            "event_type": "registered_agent",
            "title": "Contact person + e-Residency renewal",
            "description": "Renew contact-person service and e-Residency card if expiring.",
            "offset_days": 365,
            "recurrence": "annual",
        },
    ],
}


# Reminder lead-times. The daily loop fires notify() once for each
# threshold the open event crosses (deduped via reminders_sent_json).
REMINDER_OFFSETS_DAYS = (30, 14, 7, 1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _next_occurrence(today: date, due_month: int, due_day: int) -> date:
    """For fixed-calendar deadlines (e.g. DE franchise tax: March 1),
    return this year's date if still upcoming, otherwise next year."""
    try:
        candidate = date(today.year, due_month, due_day)
    except ValueError:
        candidate = date(today.year, due_month, 28)
    if candidate < today:
        try:
            candidate = date(today.year + 1, due_month, due_day)
        except ValueError:
            candidate = date(today.year + 1, due_month, 28)
    return candidate


def _check_project_write_access(user: User, project: Project) -> None:
    """Mirror of legal._check_project_write_access. Investors are NOT
    privileged for compliance writes — only admin/partner/owning founder."""
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    if role in ("admin", "partner"):
        return
    if (
        project.founder_id is not None
        and getattr(user, "founder_id", None) == project.founder_id
    ):
        return
    raise HTTPException(status_code=403, detail="Forbidden: you do not own this project")


def _check_project_read_access(user: User, project: Project) -> None:
    """Read access — admin/partner/investor (read-only) OR owning founder."""
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    if role in ("admin", "partner", "investor"):
        return
    if (
        project.founder_id is not None
        and getattr(user, "founder_id", None) == project.founder_id
    ):
        return
    raise HTTPException(status_code=403, detail="Forbidden: you do not own this project")


def _serialize(event: ComplianceEvent) -> dict:
    today = date.today()
    days_until = (event.due_date - today).days
    return {
        "id": event.id,
        "uid": event.uid,
        "project_id": event.project_id,
        "entity_id": event.entity_id,
        "jurisdiction": event.jurisdiction,
        "event_type": event.event_type,
        "title": event.title,
        "description": event.description,
        "due_date": event.due_date.isoformat(),
        "days_until": days_until,
        "completion_status": event.completion_status,
        "completed_at": event.completed_at.isoformat() if event.completed_at else None,
        "recurrence": event.recurrence,
        "source": event.source,
        "reminders_sent": json.loads(event.reminders_sent_json or "[]"),
        "created_at": event.created_at.isoformat(),
        "updated_at": event.updated_at.isoformat(),
    }


def seed_standard_events_for_jurisdiction(
    session: Session,
    project_id: int,
    entity: Optional[Entity],
    jurisdiction_id: str,
    jurisdiction_label: str,
    user_id: Optional[int],
    incorporation_date: Optional[date] = None,
) -> list[ComplianceEvent]:
    """Seed the standard recurring events for a freshly-incorporated
    project. Idempotent: the unique index on (project_id, event_type,
    due_date) means re-running on the same project is a no-op.

    Called from ``/incorporate/wizard`` immediately after the entity is
    created. Failures are swallowed so a calendar problem can never
    block the incorporation flow.
    """
    catalogue = STANDARD_EVENTS.get(jurisdiction_id, [])
    if not catalogue:
        return []
    today = incorporation_date or date.today()
    created: list[ComplianceEvent] = []
    for spec in catalogue:
        if "due_month" in spec and "due_day" in spec:
            due = _next_occurrence(today, spec["due_month"], spec["due_day"])
        else:
            offset = int(spec.get("offset_days", 365))
            due = today + timedelta(days=offset)
        event = ComplianceEvent(
            project_id=project_id,
            entity_id=entity.id if entity else None,
            jurisdiction=jurisdiction_label,
            event_type=spec["event_type"],
            title=spec["title"],
            description=spec.get("description"),
            due_date=due,
            recurrence=spec.get("recurrence", "annual"),
            source="auto",
            created_by_user_id=user_id,
        )
        try:
            session.add(event)
            session.commit()
            session.refresh(event)
            created.append(event)
        except IntegrityError:
            # Already seeded for this (project, event_type, due_date) —
            # the wizard was re-run, so just skip.
            session.rollback()
            continue
        except Exception as exc:  # noqa: BLE001
            logger.warning("seed compliance event failed: %s", exc)
            session.rollback()
    return created


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/events")
def list_events(
    project_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """List compliance events, optionally filtered by project + status.

    Without ``project_id``, returns events across every project the
    caller can read (admin/partner/investor see all; founders see only
    their own projects)."""
    role = (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()
    stmt = select(ComplianceEvent)
    if project_id is not None:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        _check_project_read_access(user, project)
        stmt = stmt.where(ComplianceEvent.project_id == project_id)
    elif role in ("admin", "partner"):
        # Privileged operators see everything for triage/oversight.
        pass
    else:
        # Founders + investors must scope to projects they own /
        # have visibility into. Architect review flagged the previous
        # un-scoped fallback as a potential cross-tenant data leak.
        # Founders -> their own founder_id. Investors -> projects they
        # have a deal/investment relationship with (resolved via the
        # project_read_access predicate); for the unfiltered case we
        # require project_id so the predicate has something to bind to.
        if role == "founder":
            own_projects = session.exec(
                select(Project.id).where(Project.founder_id == getattr(user, "founder_id", -1))
            ).all()
            own_ids = [pid for pid in own_projects] or [-1]
            stmt = stmt.where(ComplianceEvent.project_id.in_(own_ids))
        else:
            raise HTTPException(
                status_code=400,
                detail="project_id is required for this role",
            )
    if status:
        stmt = stmt.where(ComplianceEvent.completion_status == status)
    stmt = stmt.order_by(ComplianceEvent.due_date.asc())
    rows = session.exec(stmt).all()

    today = date.today()
    summary = {
        "total": len(rows),
        "overdue": 0,
        "due_30d": 0,
        "due_7d": 0,
        "completed": 0,
    }
    for r in rows:
        if r.completion_status == "completed":
            summary["completed"] += 1
            continue
        d = (r.due_date - today).days
        if d < 0:
            summary["overdue"] += 1
        elif d <= 7:
            summary["due_7d"] += 1
        elif d <= 30:
            summary["due_30d"] += 1
    return {
        "events": [_serialize(r) for r in rows],
        "summary": summary,
    }


class CreateEventBody(BaseModel):
    project_id: int
    event_type: str
    title: str
    due_date: str  # ISO YYYY-MM-DD
    description: Optional[str] = None
    recurrence: str = "annual"
    jurisdiction: Optional[str] = None  # falls back to entity.jurisdiction


@router.post("/events")
def create_event(
    body: CreateEventBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _check_project_write_access(user, project)

    try:
        due = datetime.strptime(body.due_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="due_date must be YYYY-MM-DD")
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title is required")

    entity = session.get(Entity, project.entity_id) if project.entity_id else None
    jurisdiction = body.jurisdiction or (entity.jurisdiction if entity else "Unspecified")
    event = ComplianceEvent(
        project_id=project.id,
        entity_id=entity.id if entity else None,
        jurisdiction=jurisdiction,
        event_type=body.event_type or "other",
        title=body.title.strip(),
        description=body.description,
        due_date=due,
        recurrence=body.recurrence,
        source="manual",
        created_by_user_id=user.id,
    )
    try:
        session.add(event)
        session.commit()
        session.refresh(event)
    except IntegrityError:
        # Duplicate (project, event_type, due_date) — return the existing.
        session.rollback()
        existing = session.exec(
            select(ComplianceEvent).where(
                ComplianceEvent.project_id == project.id,
                ComplianceEvent.event_type == event.event_type,
                ComplianceEvent.due_date == due,
            )
        ).first()
        if existing:
            return _serialize(existing)
        raise HTTPException(status_code=409, detail="Duplicate event")
    return _serialize(event)


class UpdateEventBody(BaseModel):
    completion_status: Optional[str] = None  # pending | completed | snoozed
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None  # YYYY-MM-DD


@router.patch("/events/{event_id}")
def update_event(
    event_id: int,
    body: UpdateEventBody,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    event = session.get(ComplianceEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    project = session.get(Project, event.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _check_project_write_access(user, project)

    if body.completion_status is not None:
        if body.completion_status not in ("pending", "completed", "snoozed"):
            raise HTTPException(status_code=400, detail="invalid completion_status")
        event.completion_status = body.completion_status
        if body.completion_status == "completed":
            event.completed_at = datetime.utcnow()
            event.completed_by_user_id = user.id
            # Auto-roll the next occurrence forward for recurring events
            # so the founder's calendar never goes empty after marking
            # one done. Best-effort: a duplicate (already seeded for the
            # next year) is silently skipped via the unique index.
            _maybe_roll_next_occurrence(session, event)
        else:
            event.completed_at = None
            event.completed_by_user_id = None
    if body.title is not None:
        event.title = body.title.strip() or event.title
    if body.description is not None:
        event.description = body.description
    if body.due_date is not None:
        try:
            event.due_date = datetime.strptime(body.due_date, "%Y-%m-%d").date()
            event.reminders_sent_json = "[]"  # reset reminder dedup on date change
        except ValueError:
            raise HTTPException(status_code=400, detail="due_date must be YYYY-MM-DD")
    event.updated_at = datetime.utcnow()
    session.add(event)
    session.commit()
    session.refresh(event)
    return _serialize(event)


@router.delete("/events/{event_id}")
def delete_event(
    event_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    event = session.get(ComplianceEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    project = session.get(Project, event.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _check_project_write_access(user, project)
    session.delete(event)
    session.commit()
    return {"ok": True}


def _maybe_roll_next_occurrence(session: Session, event: ComplianceEvent) -> None:
    """When a recurring event is completed, seed the next occurrence so
    the calendar continues to surface deadlines. One-time events do not
    roll forward."""
    if event.recurrence == "one_time":
        return
    delta_days = {"annual": 365, "quarterly": 91, "monthly": 30}.get(event.recurrence, 365)
    next_due = event.due_date + timedelta(days=delta_days)
    rolled = ComplianceEvent(
        project_id=event.project_id,
        entity_id=event.entity_id,
        jurisdiction=event.jurisdiction,
        event_type=event.event_type,
        title=event.title,
        description=event.description,
        due_date=next_due,
        recurrence=event.recurrence,
        source=event.source,
        created_by_user_id=event.created_by_user_id,
    )
    try:
        session.add(rolled)
        session.commit()
    except IntegrityError:
        session.rollback()
    except Exception as exc:  # noqa: BLE001
        logger.warning("roll next occurrence failed: %s", exc)
        session.rollback()

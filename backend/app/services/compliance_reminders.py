"""Task #32 — Compliance calendar reminder loop.

Wakes hourly. At most one sweep per UTC day across all workers / restarts:
the day is claimed atomically via INSERT ON CONFLICT DO NOTHING into
``compliance_reminder_runs(run_date)``. For every open ``ComplianceEvent``
whose ``due_date - today`` matches a reminder threshold (T-30 / T-14 /
T-7 / T-1), publish a notification via the Phase 0.2 ``notify()``
publisher and record the threshold in ``reminders_sent_json`` so we never
double-ping.

Per the architect review, the reminder bucket is recorded as sent ONLY
after notify() returns successfully — a transient email/Slack failure
must not silently drop the reminder.

Recipients are the project's owning founder. Admin / partner views
already see the events surfaced live on the page; this loop is for the
founder's inbox + email.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime
from typing import Iterable

from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.database import engine
from backend.app.models.entities import ComplianceEvent, Project, User
from backend.app.services.notify import notify
from backend.app.api.routes.compliance import REMINDER_OFFSETS_DAYS

logger = logging.getLogger("studioos.compliance_reminders")


def _claim_today(today: date) -> bool:
    """Atomically claim today's sweep slot. Returns True if THIS process
    won the race; False if another worker has already claimed today.

    INSERT ... ON CONFLICT DO NOTHING + rowcount check is the canonical
    Postgres recipe for once-per-key leases.
    """
    with Session(engine) as session:
        try:
            res = session.exec(
                text(
                    "INSERT INTO compliance_reminder_runs (run_date) "
                    "VALUES (:d) ON CONFLICT (run_date) DO NOTHING"
                ).bindparams(d=today)
            )
            session.commit()
            return (res.rowcount or 0) > 0
        except Exception as exc:  # noqa: BLE001
            logger.warning("compliance_reminders: claim_today failed: %s", exc)
            session.rollback()
            return False


def _record_run_summary(today: date, scanned: int, pinged: int) -> None:
    with Session(engine) as session:
        try:
            session.exec(
                text(
                    "UPDATE compliance_reminder_runs SET scanned = :s, pinged = :p "
                    "WHERE run_date = :d"
                ).bindparams(s=scanned, p=pinged, d=today)
            )
            session.commit()
        except Exception:
            session.rollback()


def _due_thresholds(days_until: int, already_sent: Iterable[str]) -> list[int]:
    """Return the reminder threshold (in days) that fires today, if any.

    A threshold T fires if ``days_until <= T`` and we haven't already
    sent that bucket. We send the *largest* unsent applicable bucket so
    a fresh event 5 days away gets a "T-7" ping today (not T-30/14/7
    all at once)."""
    sent = set(already_sent)
    for t in sorted(REMINDER_OFFSETS_DAYS, reverse=True):
        key = f"T-{t}"
        if days_until <= t and key not in sent:
            return [t]
    return []


def run_sweep(today: date | None = None) -> dict:
    """One pass over open events. Returns a small summary dict for logs.

    Per architect review: ``reminders_sent_json`` is only updated after
    notify() returns without raising. A failure leaves the bucket
    unsent so the next tick will retry.
    """
    today = today or date.today()
    summary = {"scanned": 0, "pinged": 0}
    with Session(engine) as session:
        rows = session.exec(
            select(ComplianceEvent).where(ComplianceEvent.completion_status == "pending")
        ).all()
        # Pre-resolve project -> founder user_id in batches to avoid N+1.
        project_ids = sorted({r.project_id for r in rows})
        founders_by_project: dict[int, int] = {}
        if project_ids:
            projects = session.exec(
                select(Project).where(Project.id.in_(project_ids))
            ).all()
            founder_ids = sorted({p.founder_id for p in projects if p.founder_id})
            users = session.exec(
                select(User).where(User.founder_id.in_(founder_ids))
            ).all() if founder_ids else []
            user_by_founder = {u.founder_id: u.id for u in users if u.founder_id}
            for p in projects:
                if p.founder_id and p.founder_id in user_by_founder:
                    founders_by_project[p.id] = user_by_founder[p.founder_id]

        for ev in rows:
            summary["scanned"] += 1
            days_until = (ev.due_date - today).days
            thresholds = _due_thresholds(
                days_until, json.loads(ev.reminders_sent_json or "[]")
            )
            if not thresholds:
                continue
            recipient_user_id = founders_by_project.get(ev.project_id)
            if not recipient_user_id:
                continue

            t = thresholds[0]
            title = (
                f"Compliance: {ev.title} due in {t} day{'s' if t != 1 else ''}"
                if days_until >= 0
                else f"Compliance OVERDUE: {ev.title}"
            )
            body = (
                f"{ev.jurisdiction} — {ev.event_type}. "
                f"Due {ev.due_date.isoformat()}. "
                f"{ev.description or ''}"
            ).strip()
            notify_ok = False
            try:
                notify(
                    user_id=recipient_user_id,
                    type="compliance_reminder",
                    title=title,
                    body=body,
                    link="/compliance",
                    payload={
                        "event_id": ev.id,
                        "event_uid": ev.uid,
                        "project_id": ev.project_id,
                        "due_date": ev.due_date.isoformat(),
                        "days_until": days_until,
                        "threshold": t,
                    },
                    channels=("in_app", "email"),
                )
                notify_ok = True
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "compliance_reminders: notify failed event=%s user=%s threshold=T-%s: %s — will retry next tick",
                    ev.id, recipient_user_id, t, exc,
                )
            if not notify_ok:
                # Critical fix from architect review: don't mark the
                # threshold as sent if the publish failed. Leave the
                # bucket unsent so the next sweep retries.
                continue

            already = json.loads(ev.reminders_sent_json or "[]")
            already.append(f"T-{t}")
            ev.reminders_sent_json = json.dumps(sorted(set(already)))
            ev.updated_at = datetime.utcnow()
            session.add(ev)
            session.commit()
            summary["pinged"] += 1
    return summary


def _tick_if_due() -> None:
    today = date.today()
    if not _claim_today(today):
        # Another worker already ran today's sweep, OR this process
        # already ran it earlier today. Either way: skip.
        return
    summary = run_sweep(today)
    _record_run_summary(today, summary["scanned"], summary["pinged"])
    logger.info(
        "compliance_reminders: tick date=%s scanned=%d pinged=%d",
        today.isoformat(), summary["scanned"], summary["pinged"],
    )


async def reminder_loop(stop_event: asyncio.Event) -> None:
    """Wakes hourly, fires once per UTC date (DB-leased). Mirrors the
    portfolio health daily loop pattern."""
    logger.info("compliance reminder loop: started")
    while not stop_event.is_set():
        try:
            await asyncio.to_thread(_tick_if_due)
        except Exception as exc:  # noqa: BLE001
            logger.warning("compliance reminder tick failed: %s", exc)
        try:
            # Wake every hour; use stop_event so shutdown is responsive.
            # TimeoutError here is the expected outcome of every iteration
            # but the last one — it means no stop signal arrived, keep looping.
            await asyncio.wait_for(stop_event.wait(), timeout=3600)
        except asyncio.TimeoutError:
            # Expected on every iteration but the last — no stop signal arrived.
            pass
    logger.info("compliance reminder loop: stopped")

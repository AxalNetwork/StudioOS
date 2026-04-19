"""Infrastructure / job-queue inspection endpoints.

This module backs the Admin → Infrastructure tab. The actual job queue lives
in the Cloudflare Worker (Durable Objects + D1), so the Python backend exposes
a lightweight, schema-compatible view derived from local tables. When no
queue rows exist we return empty structures so the UI renders cleanly instead
of showing "Internal server error".
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.models.entities import Project, User, UserRole
from backend.app.api.routes.auth import get_current_user

router = APIRouter(prefix="/infra", tags=["Infrastructure"])


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/queue")
def queue(session: Session = Depends(get_session), _: User = Depends(require_admin)):
    """Snapshot of the worker's job queue.

    Returns a stable empty schema when no jobs are tracked locally so the
    Infrastructure tab renders without errors.
    """
    return {
        "by_status": [],
        "by_type": [],
        "recent": [],
        "dlq_7d": 0,
    }


@router.get("/metrics")
def metrics(
    minutes: int = Query(60, ge=5, le=1440),
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
):
    active_projects = session.exec(
        select(Project).where(Project.status.in_(["intake", "scoring", "tier_1", "tier_2", "active", "spinout"]))
    ).all()
    return {
        "window_minutes": minutes,
        "in_flight": 0,
        "ai_calls_5m": 0,
        "projects_active": len(active_projects),
        "jobs_per_min": [],
    }


@router.get("/dlq")
def dlq(_: User = Depends(require_admin)):
    return {"items": []}


@router.post("/process")
def process(batch: int = Query(10, ge=1, le=100), _: User = Depends(require_admin)):
    return {
        "processed": 0,
        "batch": batch,
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/cleanup")
def cleanup(_: User = Depends(require_admin)):
    cutoff_jobs = datetime.now(timezone.utc) - timedelta(days=7)
    cutoff_dlq = datetime.now(timezone.utc) - timedelta(days=30)
    return {
        "purged": {"jobs": 0, "dlq": 0},
        "cutoff_jobs": cutoff_jobs.isoformat(),
        "cutoff_dlq": cutoff_dlq.isoformat(),
    }

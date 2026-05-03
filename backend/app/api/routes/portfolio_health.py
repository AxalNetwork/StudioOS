"""Task #44 — Portfolio health score routes. Mounted at ``/api/portfolio``.

  GET  /portfolio/health                   — latest snapshot per visible project
  GET  /portfolio/health/{project_uid}     — single project's latest + history
  POST /portfolio/health/recompute         — admin-only synchronous sweep
  POST /portfolio/health/recompute/{uid}   — admin/partner: recompute one project

Visibility model:
  * Admin           — every project.
  * Investor/Partner — every project (the dashboard is a portfolio overview;
    deal-level filtering happens in the Deals page).
  * Founder         — only projects they own.
  * Mentor          — 403.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    PortfolioHealthSnapshot,
    Project,
    User,
)
from backend.app.services import portfolio_health as svc

logger = logging.getLogger("studioos.portfolio_health")
router = APIRouter(prefix="/portfolio", tags=["Portfolio Health"])


def _role(user: User) -> str:
    return (getattr(user.role, "value", user.role) or "").lower()


def _can_view_dashboard(user: User) -> bool:
    return _role(user) in ("admin", "founder", "investor", "partner")


def _gate(user: User) -> None:
    if not _can_view_dashboard(user):
        raise HTTPException(status_code=403, detail="Not authorised for portfolio health")


def _visible_project_ids(session: Session, user: User) -> Optional[list[int]]:
    """Return the project IDs this user may see, or None for "all"."""
    role = _role(user)
    if role in ("admin", "investor", "partner"):
        return None
    if role == "founder":
        if not user.founder_id:
            return []
        rows = session.exec(select(Project.id).where(Project.founder_id == user.founder_id)).all()
        return [r if isinstance(r, int) else r[0] for r in rows]
    return []


@router.get("/health")
def list_latest(
    badge: Optional[str] = Query(default=None, regex="^(green|yellow|red)$"),
    intervention_only: bool = Query(default=False),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Latest snapshot per visible project, sorted intervention-first
    then ascending score (worst-first by default)."""
    _gate(user)
    visible = _visible_project_ids(session, user)
    proj_q = select(Project)
    if visible is not None:
        if not visible:
            return {"items": [], "as_of": None}
        proj_q = proj_q.where(Project.id.in_(visible))
    projects = {p.id: p for p in session.exec(proj_q).all()}
    if not projects:
        return {"items": [], "as_of": None}

    # Pull the most recent snapshot per project. SQLModel doesn't expose
    # DISTINCT ON cleanly, so we fan out one query per project. Cheap at
    # any realistic portfolio size; if this gets hot we can swap to a
    # window-function CTE.
    items: list[dict] = []
    latest_date = None
    for pid, p in projects.items():
        row = session.exec(
            select(PortfolioHealthSnapshot)
            .where(PortfolioHealthSnapshot.project_id == pid)
            .order_by(PortfolioHealthSnapshot.snapshot_date.desc())
            .limit(1)
        ).first()
        if not row:
            continue
        if badge and row.badge != badge:
            continue
        if intervention_only and not row.intervention:
            continue
        items.append(svc.serialize_snapshot(row, project=p))
        if latest_date is None or (row.snapshot_date and row.snapshot_date > latest_date):
            latest_date = row.snapshot_date

    # intervention first, then by score asc (worst-first)
    items.sort(key=lambda x: (0 if x["intervention"] else 1, x["score"]))
    return {
        "items": items,
        "as_of": latest_date.isoformat() if latest_date else None,
        "totals": {
            "green": sum(1 for i in items if i["badge"] == "green"),
            "yellow": sum(1 for i in items if i["badge"] == "yellow"),
            "red": sum(1 for i in items if i["badge"] == "red"),
            "intervention": sum(1 for i in items if i["intervention"]),
        },
    }


@router.get("/health/{project_uid}")
def get_one(
    project_uid: str,
    history_days: int = Query(default=30, ge=1, le=365),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    project = session.exec(select(Project).where(Project.uid == project_uid)).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    visible = _visible_project_ids(session, user)
    if visible is not None and project.id not in visible:
        raise HTTPException(status_code=403, detail="Not authorised for this project")
    rows = session.exec(
        select(PortfolioHealthSnapshot)
        .where(PortfolioHealthSnapshot.project_id == project.id)
        .order_by(PortfolioHealthSnapshot.snapshot_date.desc())
        .limit(history_days)
    ).all()
    history = [svc.serialize_snapshot(r) for r in rows]
    return {
        "project": {
            "uid": project.uid,
            "name": project.name,
            "sector": project.sector,
            "stage": project.stage,
            "status": getattr(project.status, "value", project.status),
        },
        "latest": history[0] if history else None,
        "history": history,
    }


@router.post("/health/recompute")
def admin_recompute_all(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if _role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    summary = svc.run_daily_health_sweep()
    return {"ok": True, "summary": summary}


@router.post("/health/recompute/{project_uid}")
def recompute_one(
    project_uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    role = _role(user)
    if role not in ("admin", "partner", "investor"):
        raise HTTPException(status_code=403, detail="Admin/partner/investor only")
    project = session.exec(select(Project).where(Project.uid == project_uid)).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    row = svc.recompute_for_project(session, project, fire_notifications=False)
    return svc.serialize_snapshot(row, project=project)

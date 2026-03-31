from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from backend.app.database import get_session
from backend.app.models.entities import ActivityLog, User
from backend.app.api.routes.auth import get_current_user
from typing import Optional

router = APIRouter(prefix="/activity", tags=["Activity Log"])


@router.get("/")
def list_activity(
    project_id: Optional[int] = None,
    actor: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    base = select(ActivityLog)
    if project_id:
        base = base.where(ActivityLog.project_id == project_id)
    if actor:
        base = base.where(ActivityLog.actor == actor)

    total = session.exec(select(func.count()).select_from(base.subquery())).first() or 0

    logs = session.exec(
        base.order_by(ActivityLog.created_at.desc()).offset(offset).limit(limit)
    ).all()

    return {
        "logs": logs,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/summary")
def activity_summary(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    total = session.exec(select(func.count(ActivityLog.id))).first() or 0

    recent = session.exec(
        select(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(10)
    ).all()

    rows = session.exec(
        select(ActivityLog.action, func.count(ActivityLog.id))
        .group_by(ActivityLog.action)
    ).all()
    action_counts = {action: count for action, count in rows}

    return {
        "total_events": total,
        "recent": recent,
        "action_breakdown": action_counts,
    }

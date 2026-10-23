from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select, func
from backend.app.database import get_session
from backend.app.models.entities import ActivityLog, User, UserRole
from backend.app.api.routes.auth import get_current_user
from typing import Optional

router = APIRouter(prefix="/activity", tags=["Activity Log"])


@router.get("")
@router.get("/")
async def list_activity(
    project_id: Optional[int] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    base = select(ActivityLog)
    if user.role != UserRole.ADMIN:
        base = base.where(ActivityLog.actor == user.email)
    if project_id:
        base = base.where(ActivityLog.project_id == project_id)

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
async def activity_summary(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    base = select(ActivityLog)
    if user.role != UserRole.ADMIN:
        base = base.where(ActivityLog.actor == user.email)

    total = session.exec(
        select(func.count()).select_from(base.subquery())
    ).first() or 0

    recent = session.exec(
        base.order_by(ActivityLog.created_at.desc()).limit(10)
    ).all()

    count_base = select(ActivityLog.action, func.count(ActivityLog.id)).group_by(ActivityLog.action)
    if user.role != UserRole.ADMIN:
        count_base = count_base.where(ActivityLog.actor == user.email)
    rows = session.exec(count_base).all()
    action_counts = {action: count for action, count in rows}

    return {
        "total_events": total,
        "recent": recent,
        "action_breakdown": action_counts,
    }

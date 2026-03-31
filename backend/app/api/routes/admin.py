import os
import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import User, UserRole, ActivityLog
from backend.app.api.routes.auth import get_current_user, JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRY_HOURS

router = APIRouter(prefix="/admin", tags=["Admin"])


def require_admin(user: User = Depends(get_current_user)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/users")
def list_all_users(session: Session = Depends(get_session), admin: User = Depends(require_admin)):
    users = session.exec(select(User).order_by(User.created_at.desc())).all()
    return [
        {
            "id": u.id,
            "uid": u.uid,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "is_active": u.is_active,
            "email_verified": u.email_verified,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/impersonate/{user_id}")
def impersonate_user(user_id: int, session: Session = Depends(get_session), admin: User = Depends(require_admin)):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    payload = {
        "user_id": target.id,
        "email": target.email,
        "role": target.role,
        "impersonated_by": admin.id,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.utcnow(),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    log = ActivityLog(
        action="admin_impersonate",
        details=f"Admin {admin.name} impersonated user {target.name} ({target.email})",
        actor=admin.email,
    )
    session.add(log)
    session.commit()

    return {
        "token": token,
        "user": {
            "id": target.id,
            "email": target.email,
            "name": target.name,
            "role": target.role,
        },
    }


@router.patch("/users/{user_id}/role")
def update_user_role(user_id: int, role: str, session: Session = Depends(get_session), admin: User = Depends(require_admin)):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    try:
        new_role = UserRole(role)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid role: {role}")

    old_role = target.role
    target.role = new_role
    session.add(target)

    log = ActivityLog(
        action="role_changed",
        details=f"Admin {admin.name} changed {target.name}'s role from {old_role} to {new_role}",
        actor=admin.email,
    )
    session.add(log)
    session.commit()

    return {"message": f"Role updated to {new_role}", "user_id": user_id, "role": new_role}


@router.patch("/users/{user_id}/toggle-active")
def toggle_user_active(user_id: int, session: Session = Depends(get_session), admin: User = Depends(require_admin)):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")

    target.is_active = not target.is_active
    session.add(target)

    log = ActivityLog(
        action="user_toggled",
        details=f"Admin {admin.name} {'activated' if target.is_active else 'deactivated'} user {target.name}",
        actor=admin.email,
    )
    session.add(log)
    session.commit()

    return {"message": f"User {'activated' if target.is_active else 'deactivated'}", "is_active": target.is_active}

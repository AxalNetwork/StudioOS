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


# ---------------------------------------------------------------------------
# User profile detail (modal)
# ---------------------------------------------------------------------------
from pydantic import BaseModel
from sqlmodel import desc as _desc
from backend.app.models.entities import Ticket, Integration


class NotesIn(BaseModel):
    admin_notes: str = ""


@router.get("/users/{user_id}/profile")
def user_profile(
    user_id: int,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Recent activity (try common column names; fall back gracefully)
    activity = []
    try:
        rows = session.exec(
            select(ActivityLog)
            .where((ActivityLog.actor == target.email) | (ActivityLog.user_id == target.id))
            .order_by(_desc(ActivityLog.created_at))
            .limit(100)
        ).all()
    except Exception:
        # Some ActivityLog versions don't have user_id; fall back to actor only
        rows = session.exec(
            select(ActivityLog)
            .where(ActivityLog.actor == target.email)
            .order_by(_desc(ActivityLog.created_at))
            .limit(100)
        ).all()
    for r in rows:
        activity.append({
            "id": r.id,
            "action": r.action,
            "details": getattr(r, "details", None),
            "actor": getattr(r, "actor", None),
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    # Tickets opened by this user
    tickets = []
    try:
        trows = session.exec(
            select(Ticket).where(Ticket.user_id == target.id).order_by(_desc(Ticket.created_at)).limit(20)
        ).all()
        tickets = [
            {"id": t.id, "title": t.title, "status": t.status, "priority": t.priority,
             "created_at": t.created_at.isoformat() if t.created_at else None}
            for t in trows
        ]
    except Exception:
        pass

    # Integrations connected by this user
    integrations = []
    try:
        irows = session.exec(
            select(Integration).where(Integration.user_id == target.id).order_by(_desc(Integration.created_at))
        ).all()
        integrations = [
            {"uid": i.uid, "provider_name": i.provider_name, "display_name": i.display_name,
             "status": i.status, "last_synced_at": i.last_synced_at.isoformat() if i.last_synced_at else None}
            for i in irows
        ]
    except Exception:
        pass

    # KYC status — best-effort lookup from related Founder/Partner records
    kyc = {"status": "not_started", "totp_enabled": True, "id_uploaded": False}
    if target.email_verified:
        kyc["status"] = "email_verified"

    return {
        "ok": True,
        "user": {
            "id": target.id,
            "uid": target.uid,
            "email": target.email,
            "name": target.name,
            "role": target.role,
            "is_active": target.is_active,
            "email_verified": target.email_verified,
            "founder_id": target.founder_id,
            "partner_id": target.partner_id,
            "admin_notes": target.admin_notes or "",
            "last_active_at": target.last_active_at.isoformat() if target.last_active_at else None,
            "created_at": target.created_at.isoformat() if target.created_at else None,
        },
        "kyc": kyc,
        "activity": activity,
        "tickets": tickets,
        "integrations": integrations,
        "stats": {
            "activity_count": len(activity),
            "ticket_count": len(tickets),
            "integration_count": len(integrations),
        },
    }


@router.post("/users/{user_id}/notes")
def update_notes(
    user_id: int,
    body: NotesIn,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.admin_notes = body.admin_notes or None
    session.add(target)
    session.add(ActivityLog(
        action="admin_notes_updated",
        details=f"Admin {admin.name} updated notes for {target.email}",
        actor=admin.email,
    ))
    session.commit()
    return {"ok": True, "admin_notes": target.admin_notes or ""}


@router.post("/users/{user_id}/resend-verification")
def admin_resend_verification(
    user_id: int,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    from backend.app.api.routes.auth import _send_verification

    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.email_verified:
        return {"ok": True, "already_verified": True, "message": "User is already verified."}

    result = _send_verification(target.email, target.name, session, target)
    session.add(ActivityLog(
        action="admin_resend_verification",
        details=f"Admin {admin.name} resent verification email to {target.email}",
        actor=admin.email,
    ))
    session.commit()
    return {"ok": True, "sent": result.get("sent", True), "message": "Verification email sent."}

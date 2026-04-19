import os
import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import (
    User, UserRole, ActivityLog, Document, Founder, Partner, OnboardingMessage,
)
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


class OnboardingMessageIn(BaseModel):
    role: str           # "user" | "assistant" | "system"
    content: str
    extracted_persona: str | None = None


# Action prefixes that we surface as "Registration timeline" events. Anything
# matching is shown chronologically on the user profile modal so admins can
# trace a user's onboarding from sign-up through verification.
_REGISTRATION_ACTIONS = (
    "user_registered",
    "user_signup",
    "email_verified",
    "kyc_submitted",
    "kyc_approved",
    "kyc_rejected",
    "totp_enabled",
    "agreement_assigned",
    "agreement_signed",
    "onboarding_completed",
)


def _registration_label(action: str) -> str:
    return action.replace("_", " ").title() if action else "Event"


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

    # Linked Founder / Partner enrichment so the Profile tab can show a real
    # bio, LinkedIn, etc., instead of a wall of dashes.
    founder_info: dict | None = None
    if target.founder_id:
        f = session.get(Founder, target.founder_id)
        if f:
            founder_info = {
                "id": f.id,
                "name": f.name,
                "linkedin_url": getattr(f, "linkedin_url", None),
                "domain_expertise": getattr(f, "domain_expertise", None),
                "experience_years": getattr(f, "experience_years", None),
                "bio": getattr(f, "bio", None),
            }
    partner_info: dict | None = None
    if target.partner_id:
        p = session.get(Partner, target.partner_id)
        if p:
            partner_info = {
                "id": p.id,
                "name": p.name,
                "company": getattr(p, "company", None),
                "specialization": getattr(p, "specialization", None),
                "status": getattr(p, "status", None),
            }

    # Agreements signed by this user (Document.signed_by stores the email).
    # We surface the modal expects: document_title, document_type, status,
    # created_at, signed_at, role_in_envelope.
    agreements: list[dict] = []
    try:
        docs = session.exec(
            select(Document)
            .where(Document.signed_by == target.email)
            .order_by(_desc(Document.created_at))
            .limit(50)
        ).all()
        for d in docs:
            agreements.append({
                "envelope_id": d.uid,
                "recipient_id": None,
                "document_title": d.title,
                "document_type": str(d.doc_type) if d.doc_type else None,
                "envelope_status": str(d.status) if d.status else None,
                "recipient_status": "signed" if d.signed_at else (str(d.status) if d.status else None),
                "recipient_email": target.email,
                "role_in_envelope": "recipient",
                "created_at": d.created_at.isoformat() if d.created_at else None,
                "signed_at": d.signed_at.isoformat() if d.signed_at else None,
                "recipient_signed_at": d.signed_at.isoformat() if d.signed_at else None,
            })
    except Exception:  # noqa: BLE001 — agreements are best-effort
        pass

    # Registration timeline — filter ActivityLog rows down to the events that
    # describe a user's onboarding journey. Ordered chronologically (oldest
    # first) because the modal renders top-to-bottom as a stepper.
    timeline: list[dict] = []
    for r in reversed(rows):  # rows is desc; reverse to ascending
        action = (r.action or "").lower()
        if any(action.startswith(prefix) for prefix in _REGISTRATION_ACTIONS):
            timeline.append({
                "kind": action,
                "label": _registration_label(r.action),
                "detail": getattr(r, "details", None),
                "ts": r.created_at.isoformat() if r.created_at else None,
            })

    # Onboarding chat transcript persisted from the Cloudflare DO mirror.
    onboarding: list[dict] = []
    try:
        msgs = session.exec(
            select(OnboardingMessage)
            .where(OnboardingMessage.user_id == target.id)
            .order_by(OnboardingMessage.created_at)
        ).all()
        onboarding = [
            {
                "role": m.role,
                "content": m.content,
                "extracted_persona": m.extracted_persona,
                "ts": m.created_at.isoformat() if m.created_at else None,
            }
            for m in msgs
        ]
    except Exception:  # noqa: BLE001 — table may not exist in pre-migration DBs
        pass

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
        "agreements": agreements,
        "timeline": timeline,
        "onboarding": onboarding,
        "founder": founder_info,
        "partner": partner_info,
        "stats": {
            "activity_count": len(activity),
            "ticket_count": len(tickets),
            "integration_count": len(integrations),
            "agreement_count": len(agreements),
            "onboarding_count": len(onboarding),
        },
    }


@router.post("/users/{user_id}/onboarding-messages")
def append_onboarding_message(
    user_id: int,
    body: OnboardingMessageIn,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    """Append a single chat turn to a user's persisted onboarding transcript.

    Intended to be called by the Cloudflare Worker (using an admin token) so
    the FastAPI admin console has a server-side copy of the conversation
    once the Durable Object flushes a turn.
    """
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if body.role not in ("user", "assistant", "system"):
        raise HTTPException(status_code=400, detail="role must be user|assistant|system")
    if not (body.content or "").strip():
        raise HTTPException(status_code=400, detail="content is required")
    msg = OnboardingMessage(
        user_id=target.id,
        role=body.role,
        content=body.content,
        extracted_persona=body.extracted_persona,
    )
    session.add(msg)
    session.commit()
    session.refresh(msg)
    return {
        "ok": True,
        "message": {
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "extracted_persona": msg.extracted_persona,
            "ts": msg.created_at.isoformat() if msg.created_at else None,
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

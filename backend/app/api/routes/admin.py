import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import bindparam, text
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
            # Surface kyc_status so the admin UI can show verification state
            # and offer "Grant Full Access" without going through the queue.
            "kyc_status": getattr(u, "kyc_status", None),
            # 'limited' (or null) — admin-granted browse-only access without
            # KYC; cannot sign legal agreements until KYC is complete.
            "access_level": getattr(u, "access_level", None),
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

    # Security policy: admin promotion/demotion is NOT allowed via this
    # endpoint. Mirrors the worker `/admin/users/:id/role` policy. The only
    # way to grant or revoke admin is via direct SQL against the database.
    if str(new_role) == "admin" or new_role == UserRole.ADMIN:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Admin role can only be granted via direct database SQL (security policy).",
                "code": "admin_promotion_disabled",
            },
        )
    if str(target.role) == "admin" or target.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Existing admin role can only be changed via direct database SQL (security policy).",
                "code": "admin_demotion_disabled",
            },
        )

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


class AccessLevelIn(BaseModel):
    # Only "limited" or null is accepted. Full access is granted via the
    # KYC approve endpoint (single source of truth).
    level: str | None = None


@router.patch("/users/{user_id}/access-level")
def set_user_access_level(
    user_id: int,
    payload: AccessLevelIn,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if str(target.role) == "admin":
        raise HTTPException(status_code=400, detail="Admins already have full access")
    new_level = "limited" if (payload.level == "limited") else None
    if getattr(target, "access_level", None) == new_level:
        raise HTTPException(status_code=409, detail="No change")

    target.access_level = new_level
    session.add(target)

    action = "access_limited_granted" if new_level == "limited" else "access_limited_revoked"
    detail = (
        f"Admin {admin.name} granted limited access (browse-only, no signing) to "
        f"{target.name} ({target.email})"
        if new_level == "limited"
        else f"Admin {admin.name} revoked limited access from {target.name} ({target.email})"
    )
    session.add(ActivityLog(action=action, details=detail, actor=admin.email, user_id=admin.id))
    user_msg = (
        "You were granted limited platform access by Axal compliance. You can browse "
        "but cannot sign legal agreements until KYC is complete."
        if new_level == "limited"
        else "Your limited platform access was revoked by Axal compliance."
    )
    session.add(ActivityLog(action=action, details=user_msg, actor=target.email, user_id=target.id))
    session.commit()

    return {"access_level": new_level, "user_id": user_id}


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

    # Tickets opened by this user — best-effort: an admin profile view with a
    # missing table on an old dev DB should show an empty section, not 500 the
    # whole page.
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
        # Best-effort — see the comment above this section.
        pass

    # Integrations connected by this user — same trade-off as tickets above.
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
        # Best-effort — see the comment above this section.
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


# Task #7 — Spin-Out Lab cohort admission (dev parity with the Worker's
# POST /api/admin/users/:id/spinout-admit). The dev backend has no email
# pipeline, so the admission email is skipped here — flags only.
@router.post("/users/{user_id}/spinout-admit")
def admin_spinout_admit(
    user_id: int,
    body: dict = None,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role == "admin":
        raise HTTPException(status_code=400, detail="Admins cannot be admitted to the Lab")
    # Re-entry guard, not an eligibility rule — mirrors the worker's
    # spinout-admit handler. Refuses an alumnus, never a founder who arrived
    # with a company.
    if int(target.is_incorporated or 0) == 1:
        raise HTTPException(
            status_code=409,
            detail="This account has already been through the Lab",
        )
    cohort = ((body or {}).get("cohort") or "").strip() or "Cohort 3"
    already_admitted = int(target.spinout_lab_admitted or 0) == 1
    target.spinout_lab_admitted = 1
    target.spinout_lab_cohort = cohort
    session.add(target)
    session.add(ActivityLog(
        action="spinout_lab_admitted",
        details=f"Admin {admin.name} admitted {target.email} to Spin-Out Lab {cohort}"
        + (" (already admitted — cohort refreshed)" if already_admitted else " (dev: no email sent)"),
        actor=admin.email,
    ))
    session.commit()
    return {"ok": True, "cohort": cohort, "already_admitted": already_admitted, "emailed": False}


# Spin-Out Lab cohort applications — review queue + accept/refuse decisions
# (dev parity with the Worker's /admin/spinout-applications routes; no
# email pipeline in dev, so decision emails are skipped — flags only).
@router.get("/spinout-applications")
def admin_spinout_applications(
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    rows = session.exec(text(
        """SELECT a.id, a.user_id, u.name, u.email, a.company_name, a.idea,
                  a.incorporated, a.stage, a.jurisdiction, a.cohort, a.status,
                  a.created_at, a.decided_at
           FROM spinout_applications a
           JOIN users u ON u.id = a.user_id
           ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END,
                    a.created_at DESC
           LIMIT 200"""
    )).all()
    return {"applications": [
        {
            "id": r[0], "user_id": r[1], "name": r[2], "email": r[3],
            "company_name": r[4], "idea": r[5], "incorporated": r[6],
            "stage": r[7], "jurisdiction": r[8], "cohort": r[9], "status": r[10],
            "created_at": r[11].isoformat() if hasattr(r[11], "isoformat") else str(r[11]),
            "decided_at": r[12].isoformat() if hasattr(r[12], "isoformat") else (str(r[12]) if r[12] else None),
        }
        for r in rows
    ]}


@router.post("/spinout-applications/{app_id}/decide")
def admin_spinout_decide(
    app_id: int,
    body: dict = None,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    decision = ((body or {}).get("decision") or "").strip().lower()
    if decision not in ("accepted", "refused"):
        raise HTTPException(status_code=400, detail="decision must be 'accepted' or 'refused'")
    # Task #102 — optional cohort override on approval (defaults to the
    # cohort the founder applied to, matching prior behavior).
    # Worker parity: only a string cohort is honored; any other payload type
    # is ignored and the applied-cohort/default fallback applies.
    _raw_cohort = (body or {}).get("cohort")
    cohort_override = _raw_cohort.strip()[:50] if isinstance(_raw_cohort, str) else ""
    row = session.exec(text(
        "SELECT id, user_id, cohort, status FROM spinout_applications WHERE id = :aid"
    ).bindparams(aid=app_id)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    if row[3] != "pending":
        raise HTTPException(status_code=409, detail=f"Application already {row[3]}")
    target = session.get(User, row[1])
    if not target:
        raise HTTPException(status_code=404, detail="Applicant user not found")

    # Guarded update — WHERE status='pending' makes the decision atomic, so
    # two admins deciding at once can't both trigger side effects.
    result = session.exec(text(
        "UPDATE spinout_applications SET status = :st, decided_at = CURRENT_TIMESTAMP "
        "WHERE id = :aid AND status = 'pending'"
    ).bindparams(st=decision, aid=app_id))
    if getattr(result, "rowcount", 1) == 0:
        session.rollback()
        raise HTTPException(status_code=409, detail="Application was already decided")
    cohort = cohort_override or row[2] or "Cohort 4"
    if decision == "accepted":
        target.spinout_lab_admitted = 1
        target.spinout_lab_cohort = cohort
        session.add(target)
    session.add(ActivityLog(
        action=f"spinout_application_{decision}",
        details=f"Admin {admin.name} {decision} Spin-Out Lab application #{app_id} from {target.email}"
        + (f" into {cohort}" if decision == "accepted" else "")
        + " (dev: no email sent)",
        actor=admin.email,
    ))
    session.commit()
    return {"ok": True, "status": decision, "cohort": cohort if decision == "accepted" else None, "emailed": False}


# Task #102 — Spin-Out Lab participants for the admin dashboard
# (/admin/spinout-lab): every admitted, active, or graduated founder with
# their full program data — week/day, milestone rows, derived unlocked
# tools, and the joined company/project. Worker parity:
# cloudflare-worker/src/routes/admin.ts GET /spinout-participants.
@router.get("/spinout-participants")
def admin_spinout_participants(
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    from backend.app.api.routes.spinout_lab import (
        MILESTONES, SPRINT_DAYS, _days_since, _unlocked_through,
    )

    catalog = [
        {
            "week": w["week"],
            "required_all": w["required_all"],
            "required_any": w["required_any"],
            "unlocked_features": w["unlocked_features"],
        }
        for w in MILESTONES
    ]

    try:
        rows = session.exec(text(
            """SELECT u.id, u.uid, u.name, u.email,
                      u.spinout_lab_admitted, u.spinout_lab_cohort,
                      u.spinout_lab_active, u.spinout_lab_week,
                      u.spinout_lab_started_at, u.is_incorporated,
                      p.name, p.sector
               FROM users u
               LEFT JOIN projects p ON p.founder_id = u.founder_id
               WHERE u.spinout_lab_admitted = 1
                  OR u.spinout_lab_active = 1
                  OR u.id IN (SELECT user_id FROM spinout_lab_milestones
                              WHERE milestone_key = 'incorporation_completed')
               ORDER BY u.spinout_lab_started_at ASC NULLS LAST, u.id ASC, p.id ASC
               LIMIT 400"""
        )).all()
    except Exception:  # tables predate the Lab migrations
        return {"participants": [], "catalog": catalog}

    # Several projects per founder: keep the first row per user (same rule
    # as the public cohort tracker).
    deduped = []
    seen = set()
    for r in rows:
        if r[0] in seen:
            continue
        seen.add(r[0])
        deduped.append(r)

    ms_map = {}
    user_ids = [r[0] for r in deduped]
    if user_ids:
        try:
            ms_rows = session.exec(
                text(
                    """SELECT user_id, milestone_key, week, completed_at
                       FROM spinout_lab_milestones
                       WHERE user_id IN :ids
                       ORDER BY week ASC, completed_at ASC"""
                ).bindparams(bindparam("ids", expanding=True)).bindparams(ids=user_ids)
            ).all()
        except Exception:
            ms_rows = []
        for m in ms_rows:
            ms_map.setdefault(m[0], []).append({
                "key": m[1],
                "week": int(m[2]),
                "completed_at": m[3].isoformat() if hasattr(m[3], "isoformat") else str(m[3]),
            })

    # Latest application per participant, fetched in ONE query (rows come
    # back newest-first per user; keep the first seen) — a per-row
    # _latest_application() call here would be an N+1 against up to 400
    # participants. Same shape as spinout_lab._latest_application.
    app_map = {}
    if user_ids:
        try:
            app_rows = session.exec(
                text(
                    """SELECT user_id, id, company_name, incorporated, stage,
                              jurisdiction, cohort, status, created_at, decided_at
                       FROM spinout_applications
                       WHERE user_id IN :ids
                       ORDER BY user_id ASC, created_at DESC, id DESC"""
                ).bindparams(bindparam("ids", expanding=True)).bindparams(ids=user_ids)
            ).all()
        except Exception:  # table not yet migrated
            app_rows = []
        for a in app_rows:
            if a[0] in app_map:
                continue
            app_map[a[0]] = {
                "id": a[1],
                "company_name": a[2],
                "incorporated": a[3],
                "stage": a[4],
                "jurisdiction": a[5],
                "cohort": a[6],
                "status": a[7],
                "created_at": a[8].isoformat() if hasattr(a[8], "isoformat") else str(a[8]),
                "decided_at": a[9].isoformat() if hasattr(a[9], "isoformat") else (str(a[9]) if a[9] else None),
            }

    participants = []
    for r in deduped:
        uid, started = r[0], r[8]
        milestones = ms_map.get(uid, [])
        completed_keys = {m["key"] for m in milestones}
        active = int(r[6] or 0) == 1
        graduated = "incorporation_completed" in completed_keys
        status = "active" if active else ("graduated" if graduated else "admitted")
        week = 4 if status == "graduated" else max(0, min(4, int(r[7] or 0)))
        day = None
        days_remaining = None
        if status == "active" and started is not None:
            day = min(SPRINT_DAYS, _days_since(started) + 1)
            days_remaining = max(0, SPRINT_DAYS - _days_since(started))
        elif status == "graduated" and started is not None:
            done = next((m for m in milestones if m["key"] == "incorporation_completed"), None)
            if done:
                try:
                    completed_dt = datetime.fromisoformat(done["completed_at"].replace(" ", "T"))
                    started_dt = started if started.tzinfo else started
                    delta = (completed_dt.replace(tzinfo=None) - started_dt.replace(tzinfo=None)).total_seconds()
                    day = max(1, int(delta // 86_400) + 1)
                except Exception:
                    day = None
        application = app_map.get(uid)
        participants.append({
            "user_id": uid,
            "uid": r[1],
            "name": r[2],
            "email": r[3],
            "admitted": int(r[4] or 0) == 1,
            "cohort": r[5],
            "status": status,
            "week": week,
            "day": day,
            "days_remaining": days_remaining,
            "started_at": started.isoformat() if hasattr(started, "isoformat") else (str(started) if started else None),
            "is_incorporated": int(r[9] or 0) == 1,
            "company_name": r[10] or (application or {}).get("company_name"),
            "sector": r[11],
            "milestones": milestones,
            "unlocked_features": _unlocked_through(week) if status != "admitted" else [],
            "application": application,
        })
    return {"participants": participants, "catalog": catalog}


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

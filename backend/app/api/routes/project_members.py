"""Task #1 (Spin-Out Teams Collaboration) — project member + invitation routes.

Dev-FastAPI mirror of the Worker's member-management endpoints in
``cloudflare-worker/src/routes/projects.ts``. Mounted under ``/api/projects``
(shares the prefix with the main projects router).

  GET    /projects/{id}/members                      — roster + invitations + gate
  POST   /projects/{id}/members                      — direct add (user_id | cofounder_match)
  POST   /projects/{id}/invitations                  — tokenized invite (email | link)
  POST   /projects/{id}/invitations/{inv_id}/revoke  — revoke a pending invite
  DELETE /projects/{id}/members/{user_id}            — remove a member (never owner)
  POST   /projects/invitations/accept                — bind a token to the authed user

Roster MANAGEMENT is owner + admin/partner only and stage-gated. Accepted
co-founders edit project DATA; advisors are read-only. Investors are never
granted membership. Tokens are stored hashed (sha256); the raw token is
returned exactly once at creation.
"""
from __future__ import annotations

import hashlib
import logging
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import Project, User
from backend.app.services.project_access import (
    TEAM_BUILDING_MIN_LAB_WEEK,
    can_access_project,
    evaluate_team_gate,
    is_project_manager,
    project_member_role,
)

logger = logging.getLogger("studioos.project_members")
router = APIRouter(prefix="/projects", tags=["Project Members"])

_MEMBER_ROLES = {"cofounder", "advisor"}
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@.]+$")


def _sanitize_role(raw) -> str:
    r = str(raw or "").strip().lower()
    return r if r in _MEMBER_ROLES else "cofounder"


def _normalize_email(email) -> str:
    return str(email or "").strip().lower()


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _load_project(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _resolve_owner_user_id(session: Session, project: Project) -> int | None:
    if project.founder_id is None:
        return None
    row = session.exec(
        text("SELECT id FROM users WHERE founder_id = :fid ORDER BY id ASC LIMIT 1").bindparams(
            fid=project.founder_id
        )
    ).first()
    if not row:
        return None
    return row[0] if isinstance(row, tuple) else row._mapping["id"]


def _seed_owner_member(session: Session, project: Project) -> int | None:
    owner_id = _resolve_owner_user_id(session, project)
    if owner_id is None:
        return None
    session.exec(
        text(
            """
            INSERT INTO project_members (project_id, user_id, role, status, source, accepted_at)
            VALUES (:pid, :uid, 'owner', 'accepted', 'owner_seed', CURRENT_TIMESTAMP)
            ON CONFLICT (project_id, user_id) DO UPDATE SET
                role = 'owner', status = 'accepted', removed_at = NULL, updated_at = CURRENT_TIMESTAMP
            """
        ).bindparams(pid=project.id, uid=owner_id)
    )
    session.commit()
    return owner_id


def _require_manager(session: Session, user: User, project: Project) -> dict:
    if not is_project_manager(user, project, session):
        raise HTTPException(status_code=403, detail="Forbidden: only the project owner can manage the team")
    gate = evaluate_team_gate(user)
    if gate["locked"]:
        raise HTTPException(
            status_code=403,
            detail={"detail": gate["reason"], "code": "team_locked", "unlock_week": gate["unlock_week"]},
        )
    return gate


class MemberAddIn(BaseModel):
    mode: str = "user_id"  # user_id | cofounder_match
    user_id: int | None = None
    user_uid: str | None = None
    connection_uid: str | None = None
    role: str = "cofounder"


class InviteIn(BaseModel):
    mode: str = "link"  # email | link
    email: str | None = None
    role: str = "cofounder"


class AcceptIn(BaseModel):
    token: str


@router.get("/{project_id}/members")
def list_members(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    project = _load_project(session, project_id)
    manager = is_project_manager(user, project, session)
    # Investors never see the team roster (Task #1) — mirror the Worker, which
    # excludes them from canView even though they hold a privileged READ.
    acct_role = str(getattr(user.role, "value", user.role) or "").lower()
    can_view = manager or (
        acct_role != "investor"
        and can_access_project(user, project, session, write=False)
    )
    if not can_view:
        raise HTTPException(status_code=403, detail="Forbidden: you do not have access to this project")

    _seed_owner_member(session, project)

    member_rows = session.exec(
        text(
            """
            SELECT pm.id, pm.user_id, pm.role, pm.source, pm.accepted_at, pm.created_at,
                   u.uid, u.name, u.email, u.role AS account_role
            FROM project_members pm JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = :pid AND pm.status = 'accepted'
            ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'cofounder' THEN 1 ELSE 2 END, pm.created_at ASC
            """
        ).bindparams(pid=project_id)
    ).all()
    members = [dict(r._mapping) for r in member_rows]

    invitations = []
    if manager:
        inv_rows = session.exec(
            text(
                """
                SELECT id, role, status, source, invitee_email, invitee_user_id, expires_at, created_at
                FROM project_member_invitations
                WHERE project_id = :pid AND status = 'pending'
                ORDER BY created_at DESC
                """
            ).bindparams(pid=project_id)
        ).all()
        invitations = [dict(r._mapping) for r in inv_rows]

    gate = evaluate_team_gate(user)
    # Caller's effective edit rights, so the UI can show "Edit Project" to
    # co-founders/owner/managers and hide it from advisors/investors.
    if user.founder_id and project.founder_id == user.founder_id:
        my_role = "owner"
    else:
        my_role = project_member_role(session, project.id, user.id)
    can_edit = can_access_project(user, project, session, write=True)
    return {
        "members": members,
        "invitations": invitations,
        "can_manage": manager,
        "can_edit": can_edit,
        "my_role": my_role,
        "locked": gate["locked"] if manager else False,
        "gate_reason": gate["reason"] if manager else None,
        "unlock_week": gate["unlock_week"],
    }


@router.post("/{project_id}/members")
def add_member(
    project_id: int,
    body: MemberAddIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    project = _load_project(session, project_id)
    _require_manager(session, user, project)
    role = _sanitize_role(body.role)
    mode = (body.mode or "user_id").strip()

    target_user_id: int | None = None
    connection_id: int | None = None

    if mode == "cofounder_match":
        owner_user_id = _resolve_owner_user_id(session, project)
        if owner_user_id is None:
            raise HTTPException(status_code=409, detail="Project has no founder account")
        if not body.connection_uid:
            raise HTTPException(status_code=400, detail="connection_uid is required")
        conn = session.exec(
            text(
                "SELECT id, user_a_id, user_b_id, status FROM cofounder_connections WHERE uid = :u LIMIT 1"
            ).bindparams(u=body.connection_uid)
        ).first()
        if not conn:
            raise HTTPException(status_code=404, detail="Connection not found")
        cm = conn._mapping
        if cm["status"] != "active":
            raise HTTPException(status_code=400, detail="Connection must be active (NDA signed by both sides)")
        if owner_user_id not in (cm["user_a_id"], cm["user_b_id"]):
            raise HTTPException(status_code=403, detail="This connection does not belong to the project owner")
        target_user_id = cm["user_b_id"] if cm["user_a_id"] == owner_user_id else cm["user_a_id"]
        connection_id = cm["id"]
    else:
        if body.user_id is not None:
            row = session.exec(
                text("SELECT id FROM users WHERE id = :i LIMIT 1").bindparams(i=int(body.user_id))
            ).first()
            if row:
                target_user_id = row[0] if isinstance(row, tuple) else row._mapping["id"]
        elif body.user_uid:
            row = session.exec(
                text("SELECT id FROM users WHERE uid = :u LIMIT 1").bindparams(u=body.user_uid)
            ).first()
            if row:
                target_user_id = row[0] if isinstance(row, tuple) else row._mapping["id"]
        else:
            raise HTTPException(status_code=400, detail="user_id or user_uid is required")

    if target_user_id is None:
        raise HTTPException(status_code=404, detail="User not found")

    target = session.get(User, target_user_id)
    if not target or not target.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    target_role = str(getattr(target.role, "value", target.role) or "").lower()
    if target_role == "investor":
        raise HTTPException(status_code=400, detail="Investors cannot be added as project members")
    if project.founder_id is not None and target.founder_id == project.founder_id:
        raise HTTPException(status_code=409, detail="This user already owns the project")

    inv = session.exec(
        text(
            """
            INSERT INTO project_member_invitations
                (project_id, role, status, source, invitee_user_id, cofounder_connection_id,
                 invited_by_user_id, accepted_by_user_id, accepted_at)
            VALUES (:pid, :role, 'accepted', :src, :tuid, :conn, :inviter, :tuid, CURRENT_TIMESTAMP)
            RETURNING id
            """
        ).bindparams(pid=project_id, role=role, src=mode, tuid=target_user_id, conn=connection_id, inviter=user.id)
    ).first()
    invitation_id = inv[0] if isinstance(inv, tuple) else inv._mapping["id"]

    session.exec(
        text(
            """
            INSERT INTO project_members
                (project_id, user_id, role, status, source, invitation_id, cofounder_connection_id,
                 added_by_user_id, accepted_at)
            VALUES (:pid, :uid, :role, 'accepted', :src, :inv, :conn, :inviter, CURRENT_TIMESTAMP)
            ON CONFLICT (project_id, user_id) DO UPDATE SET
                role = EXCLUDED.role, status = 'accepted', source = EXCLUDED.source,
                invitation_id = EXCLUDED.invitation_id, cofounder_connection_id = EXCLUDED.cofounder_connection_id,
                accepted_at = CURRENT_TIMESTAMP, removed_at = NULL, updated_at = CURRENT_TIMESTAMP
            """
        ).bindparams(
            pid=project_id, uid=target_user_id, role=role, src=mode, inv=invitation_id,
            conn=connection_id, inviter=user.id,
        )
    )
    session.commit()
    return {"ok": True, "user_id": target_user_id, "role": role}


@router.post("/{project_id}/invitations")
def create_invitation(
    project_id: int,
    body: InviteIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    project = _load_project(session, project_id)
    _require_manager(session, user, project)
    role = _sanitize_role(body.role)
    mode = (body.mode or "link").strip()
    invitee_email = None
    if mode == "email":
        invitee_email = _normalize_email(body.email)
        if not invitee_email or not _EMAIL_RE.match(invitee_email):
            raise HTTPException(status_code=400, detail="A valid email is required")

    token = secrets.token_urlsafe(32)
    token_hash = _hash_token(token)
    inv = session.exec(
        text(
            """
            INSERT INTO project_member_invitations
                (project_id, role, status, source, invitee_email, token_hash, invited_by_user_id, expires_at)
            VALUES (:pid, :role, 'pending', :src, :email, :th, :inviter, CURRENT_TIMESTAMP + INTERVAL '14 days')
            RETURNING id, role, status, source, invitee_email, expires_at, created_at
            """
        ).bindparams(pid=project_id, role=role, src=mode, email=invitee_email, th=token_hash, inviter=user.id)
    ).first()
    session.commit()
    return {
        "invitation": dict(inv._mapping),
        "token": token,
        "accept_path": f"/projects/invitations/accept?token={token}",
    }


@router.post("/{project_id}/invitations/{inv_id}/revoke")
def revoke_invitation(
    project_id: int,
    inv_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    project = _load_project(session, project_id)
    _require_manager(session, user, project)
    session.exec(
        text(
            """
            UPDATE project_member_invitations SET status='revoked', updated_at=CURRENT_TIMESTAMP
            WHERE id = :iid AND project_id = :pid AND status='pending'
            """
        ).bindparams(iid=inv_id, pid=project_id)
    )
    session.commit()
    return {"ok": True}


@router.delete("/{project_id}/members/{member_user_id}")
def remove_member(
    project_id: int,
    member_user_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    project = _load_project(session, project_id)
    _require_manager(session, user, project)
    owner_user_id = _resolve_owner_user_id(session, project)
    if owner_user_id is not None and member_user_id == owner_user_id:
        raise HTTPException(status_code=400, detail="The project owner cannot be removed")
    session.exec(
        text(
            """
            UPDATE project_members SET status='removed', removed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE project_id = :pid AND user_id = :uid AND role <> 'owner'
            """
        ).bindparams(pid=project_id, uid=member_user_id)
    )
    session.exec(
        text(
            """
            UPDATE project_member_invitations SET status='revoked', updated_at=CURRENT_TIMESTAMP
            WHERE project_id = :pid AND invitee_user_id = :uid AND status='pending'
            """
        ).bindparams(pid=project_id, uid=member_user_id)
    )
    session.commit()
    return {"ok": True}


@router.post("/invitations/accept")
def accept_invitation(
    body: AcceptIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    role_value = str(getattr(user.role, "value", user.role) or "").lower()
    if role_value == "investor":
        raise HTTPException(status_code=403, detail="Investors cannot join projects as members")
    token = str(body.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="token is required")
    token_hash = _hash_token(token)
    inv = session.exec(
        text(
            """
            SELECT *, (expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP) AS expired
            FROM project_member_invitations WHERE token_hash = :th LIMIT 1
            """
        ).bindparams(th=token_hash)
    ).first()
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found")
    im = inv._mapping
    if im["status"] != "pending":
        raise HTTPException(status_code=410, detail="This invitation is no longer valid")
    if im["expired"]:
        session.exec(
            text("UPDATE project_member_invitations SET status='expired', updated_at=CURRENT_TIMESTAMP WHERE id = :i").bindparams(i=im["id"])
        )
        session.commit()
        raise HTTPException(status_code=410, detail="This invitation has expired")

    if im["invitee_user_id"] is not None and int(im["invitee_user_id"]) != int(user.id):
        raise HTTPException(status_code=403, detail="This invitation was issued to a different account")
    if im["invitee_email"] is not None and _normalize_email(user.email) != _normalize_email(im["invitee_email"]):
        raise HTTPException(status_code=403, detail="This invitation was issued to a different email address")

    project = session.get(Project, im["project_id"])
    if not project:
        raise HTTPException(status_code=404, detail="Project no longer exists")

    if project.founder_id is not None and user.founder_id and user.founder_id == project.founder_id:
        session.exec(
            text(
                "UPDATE project_member_invitations SET status='accepted', accepted_by_user_id=:u, accepted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=:i"
            ).bindparams(u=user.id, i=im["id"])
        )
        session.commit()
        return {"ok": True, "project_id": project.id, "role": "owner", "already_owner": True}

    _seed_owner_member(session, project)
    role = _sanitize_role(im["role"])
    session.exec(
        text(
            """
            INSERT INTO project_members
                (project_id, user_id, role, status, source, invitation_id, cofounder_connection_id,
                 added_by_user_id, accepted_at)
            VALUES (:pid, :uid, :role, 'accepted', :src, :inv, :conn, :inviter, CURRENT_TIMESTAMP)
            ON CONFLICT (project_id, user_id) DO UPDATE SET
                role = EXCLUDED.role, status = 'accepted', source = EXCLUDED.source,
                invitation_id = EXCLUDED.invitation_id, accepted_at = CURRENT_TIMESTAMP,
                removed_at = NULL, updated_at = CURRENT_TIMESTAMP
            """
        ).bindparams(
            pid=project.id, uid=user.id, role=role, src=im["source"], inv=im["id"],
            conn=im["cofounder_connection_id"], inviter=im["invited_by_user_id"],
        )
    )
    session.exec(
        text(
            """
            UPDATE project_member_invitations
            SET status='accepted', invitee_user_id=COALESCE(invitee_user_id, :u),
                accepted_by_user_id=:u, accepted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE id=:i
            """
        ).bindparams(u=user.id, i=im["id"])
    )
    session.commit()
    return {"ok": True, "project_id": project.id, "role": role}

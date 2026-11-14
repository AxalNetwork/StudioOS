"""Task #1 (Spin-Out Teams Collaboration) — project membership + access.

Dev-FastAPI mirror of the Worker's ``services/projectAccess.ts``. A Spin-Out
project was single-founder via ``projects.founder_id``; this adds the membership
layer so a project can be built by a TEAM (co-founders + advisors). The access
predicate unions founder_id ownership with accepted ``project_members`` rows.

Note: the dev backend keeps the legacy ``is_privileged`` READ semantics
(admin / partner / investor) so in-flight dev read paths (e.g. the investor
deal-review view) don't regress. WRITES are stricter — investors can never
edit project DATA (Task #1), mirroring the Worker, which is the deployed
source of truth (investors get NO membership access there).
"""
from __future__ import annotations

from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.deps import is_privileged
from backend.app.models.entities import Project, User

# New founders (Spin-Out Lab active, pre-incorporation) cannot manage
# co-founders/advisors until this lab week. Mirrors TEAM_BUILDING_MIN_LAB_WEEK
# in the Worker. The dev users table carries no spinout-lab columns, so dev
# founders are treated as "existing" (unlocked) — see evaluate_team_gate.
TEAM_BUILDING_MIN_LAB_WEEK = 2


def project_member_role(session: Session, project_id: int, user_id: int) -> str | None:
    """Accepted membership role for a user on a project, or None."""
    row = session.exec(
        text(
            "SELECT role FROM project_members "
            "WHERE project_id = :p AND user_id = :u AND status = 'accepted' LIMIT 1"
        ).bindparams(p=project_id, u=user_id)
    ).first()
    if not row:
        return None
    return row[0] if isinstance(row, tuple) else row._mapping["role"]


def member_project_ids(session: Session, user_id: int) -> list[int]:
    """Project ids where the user is an accepted member (any role)."""
    rows = session.exec(
        text(
            "SELECT project_id FROM project_members "
            "WHERE user_id = :u AND status = 'accepted'"
        ).bindparams(u=user_id)
    ).all()
    out: list[int] = []
    for r in rows:
        out.append(r[0] if isinstance(r, tuple) else r._mapping["project_id"])
    return out


def _is_investor(user: User) -> bool:
    return str(getattr(user.role, "value", user.role) or "").lower() == "investor"


def can_access_project(
    user: User, project: Project, session: Session, *, write: bool = False
) -> bool:
    """True iff the user may read (or, with write=True, edit) the project.

    Advisors are read-only on project DATA; co-founders + owner may edit.
    Investors are NEVER editors (Task #1): they keep their existing privileged
    deal-review READ, but can never pass a write check on either layer.
    """
    if write and _is_investor(user):
        return False
    if is_privileged(user):
        return True
    if user.founder_id and project.founder_id == user.founder_id:
        return True
    role = project_member_role(session, project.id, user.id)
    if not role:
        return False
    if write and role == "advisor":
        return False
    return True


def ensure_project_access(
    user: User, project: Project, session: Session, *, write: bool = False
) -> None:
    from fastapi import HTTPException

    if not can_access_project(user, project, session, write=write):
        raise HTTPException(status_code=403, detail="Forbidden: you do not have access to this project")


def is_project_manager(user: User, project: Project, session: Session) -> bool:
    """Roster management (invite/add/remove): owner or studio staff only."""
    role_value = (getattr(user.role, "value", user.role) or "")
    if str(role_value).lower() in ("admin", "partner"):
        return True
    return bool(user.founder_id) and user.founder_id == project.founder_id


def evaluate_team_gate(user: User) -> dict:
    """Stage gate for member management. Dev users carry no spinout-lab
    columns, so this resolves to unlocked (existing founder) in dev. The
    Worker enforces the real new-founder gate in prod."""
    role_value = str(getattr(user.role, "value", user.role) or "").lower()
    if role_value in ("admin", "partner"):
        return {"locked": False, "reason": None, "unlock_week": TEAM_BUILDING_MIN_LAB_WEEK}
    lab_active = int(getattr(user, "spinout_lab_active", 0) or 0) == 1
    incorporated = int(getattr(user, "is_incorporated", 0) or 0) == 1
    if not lab_active or incorporated:
        return {"locked": False, "reason": None, "unlock_week": TEAM_BUILDING_MIN_LAB_WEEK}
    week = int(getattr(user, "spinout_lab_week", 1) or 1)
    if week >= TEAM_BUILDING_MIN_LAB_WEEK:
        return {"locked": False, "reason": None, "unlock_week": TEAM_BUILDING_MIN_LAB_WEEK}
    return {
        "locked": True,
        "reason": (
            f"Co-founder and advisor invites unlock in Week {TEAM_BUILDING_MIN_LAB_WEEK} "
            f"of the Spin-Out Lab. Keep going — you're in Week {week}."
        ),
        "unlock_week": TEAM_BUILDING_MIN_LAB_WEEK,
    }

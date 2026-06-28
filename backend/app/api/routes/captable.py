"""Task #27 — Cap-table simulator routes.

All under /api/captable. Authenticated. Scenarios are owned by their
creator; admin can read all.

  POST   /simulate                     — stateless run (preview, no persist)
  GET    /scenarios                    — list mine (admin: all)
  POST   /scenarios                    — create + simulate + persist
  GET    /scenarios/{uid}              — read one
  PUT    /scenarios/{uid}              — update inputs + re-simulate
  DELETE /scenarios/{uid}              — delete
  GET    /scenarios/{uid}/export.csv   — 409A-friendly CSV export
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field as PField
from sqlalchemy import func, text
from sqlmodel import Session, desc, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import CapTableScenario, Project, User
from backend.app.services.captable import simulate, to_csv, validate_inputs

router = APIRouter(prefix="/captable", tags=["Cap Table"])


# Task #29 — cap_table_scenarios.is_variant may be missing on an existing dev
# SQLite DB (create_all only adds it to fresh DBs). Lazy-bootstrap it once per
# process so the canonical-only filters below don't blow up. Mirrors the
# worker's ensureCapTableVariantColumn self-heal (SQLite has no ADD COLUMN IF
# NOT EXISTS, so the ALTER is wrapped in try/except).
_schema_ready = False


def _ensure_schema(session: Session) -> None:
    global _schema_ready
    if _schema_ready:
        return
    try:
        session.exec(text(
            "ALTER TABLE cap_table_scenarios ADD COLUMN is_variant INTEGER NOT NULL DEFAULT 0"
        ))
        session.commit()
    except Exception:
        session.rollback()
    _schema_ready = True


def _session_with_schema(session: Session = Depends(get_session)) -> Session:
    _ensure_schema(session)
    return session


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SimulateIn(BaseModel):
    inputs: dict[str, Any]


class ScenarioIn(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    inputs: dict[str, Any]
    project_id: Optional[int] = None


def _role(user: User) -> str:
    return (getattr(user.role, "value", user.role) or "").lower()


def _is_admin(user: User) -> bool:
    return _role(user) == "admin"


def _founder_owns(user: User, proj: Project) -> bool:
    owner_fid = getattr(proj, "founder_id", None)
    return owner_fid is not None and owner_fid == user.founder_id


def _can_read_project(user: User, proj: Project) -> bool:
    """Mirror of Projects visibility: founder (own only) · admin · partner · investor."""
    r = _role(user)
    if r in ("admin", "partner", "investor"):
        return True
    return _founder_owns(user, proj)


def _can_write_project(user: User, proj: Project) -> bool:
    """Cap-table writes: founder (own only) · admin · partner (investors excluded)."""
    r = _role(user)
    if r in ("admin", "partner"):
        return True
    return _founder_owns(user, proj)


def _can_read_scenario(user: User, s: CapTableScenario, proj: Optional[Project]) -> bool:
    if s.owner_user_id == user.id or _is_admin(user):
        return True
    if s.project_id is not None and proj is not None:
        return _can_read_project(user, proj)
    return False


def _can_write_scenario(user: User, s: CapTableScenario, proj: Optional[Project]) -> bool:
    if s.owner_user_id == user.id or _is_admin(user):
        return True
    if s.project_id is not None and proj is not None:
        return _can_write_project(user, proj)
    return False


def _serialize(s: CapTableScenario, with_result: bool = True) -> dict:
    out = {
        "uid": s.uid,
        "name": s.name,
        "owner_user_id": s.owner_user_id,
        "project_id": s.project_id,
        "is_variant": int(s.is_variant or 0),
        "inputs": json.loads(s.inputs_json) if s.inputs_json else {},
        "computed_at": s.computed_at.isoformat() if s.computed_at else None,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }
    if with_result:
        out["result"] = json.loads(s.result_json) if s.result_json else None
    return out


def _ensure_project_write_access(session: Session, project_id: Optional[int], user: User) -> None:
    """If the caller passes a project_id, prove they may write a cap table to it
    (founder-owner · admin · partner)."""
    if project_id is None:
        return
    proj = session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_write_project(user, proj):
        raise HTTPException(status_code=403, detail="You don't have access to that project")


def _scenario_project(session: Session, s: CapTableScenario) -> Optional[Project]:
    return session.get(Project, s.project_id) if s.project_id is not None else None


def _read_or_404(session: Session, uid: str, user: User) -> CapTableScenario:
    s = session.exec(select(CapTableScenario).where(CapTableScenario.uid == uid)).first()
    if not s:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if not _can_read_scenario(user, s, _scenario_project(session, s)):
        raise HTTPException(status_code=403, detail="Not your scenario")
    return s


def _write_or_404(session: Session, uid: str, user: User) -> CapTableScenario:
    s = session.exec(select(CapTableScenario).where(CapTableScenario.uid == uid)).first()
    if not s:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if not _can_write_scenario(user, s, _scenario_project(session, s)):
        raise HTTPException(status_code=403, detail="Not your scenario")
    return s


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.post("/simulate")
def simulate_endpoint(
    body: SimulateIn,
    user: User = Depends(get_current_user),
):
    errs = validate_inputs(body.inputs)
    if errs:
        raise HTTPException(status_code=400, detail={"code": "invalid_inputs", "errors": errs})
    return simulate(body.inputs)


@router.get("/scenarios")
def list_scenarios(
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    stmt = select(CapTableScenario).order_by(desc(CapTableScenario.updated_at))
    if not _is_admin(user):
        stmt = stmt.where(CapTableScenario.owner_user_id == user.id)
    rows = session.exec(stmt).all()
    return {"items": [_serialize(s, with_result=False) for s in rows]}


@router.post("/scenarios")
def create_scenario(
    body: ScenarioIn,
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    errs = validate_inputs(body.inputs)
    if errs:
        raise HTTPException(status_code=400, detail={"code": "invalid_inputs", "errors": errs})
    _ensure_project_write_access(session, body.project_id, user)
    result = simulate(body.inputs)
    now = datetime.utcnow()

    # Task #28 — one cap table per project. When a project is provided and a
    # scenario already exists for it, UPDATE that row instead of inserting a
    # duplicate (guards against stale frontend state). Access to the existing
    # project's scenario is already gated by _ensure_project_write_access above.
    if body.project_id is not None:
        existing = session.exec(
            select(CapTableScenario)
            .where(CapTableScenario.project_id == body.project_id)
            .where(func.coalesce(CapTableScenario.is_variant, 0) == 0)
            .order_by(desc(CapTableScenario.updated_at))
        ).first()
        if existing is not None:
            existing.name = body.name
            existing.inputs_json = json.dumps(body.inputs)
            existing.result_json = json.dumps(result)
            existing.computed_at = now
            existing.updated_at = now
            session.add(existing); session.commit(); session.refresh(existing)
            return _serialize(existing)

    s = CapTableScenario(
        owner_user_id=user.id,
        project_id=body.project_id,
        name=body.name,
        inputs_json=json.dumps(body.inputs),
        result_json=json.dumps(result),
        computed_at=now,
    )
    session.add(s); session.commit(); session.refresh(s)
    return _serialize(s)


# Task #28 — load a project's single cap table (project-scoped, NOT owner-
# scoped) so partners/admins can open a founder's cap table from the dropdown.
# Declared before /scenarios/{uid} so "by-project" isn't captured as a uid.
@router.get("/scenarios/by-project/{project_id}")
def read_scenario_by_project(
    project_id: int,
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    proj = session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_read_project(user, proj):
        raise HTTPException(status_code=403, detail="You don't have access to that project")
    s = session.exec(
        select(CapTableScenario)
        .where(CapTableScenario.project_id == project_id)
        .where(func.coalesce(CapTableScenario.is_variant, 0) == 0)
        .order_by(desc(CapTableScenario.updated_at))
    ).first()
    return {"scenario": _serialize(s) if s else None}


# Task #29 — create a named DRAFT variant for a project (is_variant=1). Always
# inserts a fresh row (never upserts), so it stays distinct from the canonical
# cap table and is excluded from the deck + one-per-project lookups. Declared
# before /scenarios/{uid} so "by-project" isn't captured as a uid.
@router.post("/scenarios/by-project/{project_id}/variants")
def create_variant(
    project_id: int,
    body: ScenarioIn,
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    _ensure_project_write_access(session, project_id, user)
    errs = validate_inputs(body.inputs)
    if errs:
        raise HTTPException(status_code=400, detail={"code": "invalid_inputs", "errors": errs})
    result = simulate(body.inputs)
    now = datetime.utcnow()
    s = CapTableScenario(
        owner_user_id=user.id,
        project_id=project_id,
        name=body.name,
        inputs_json=json.dumps(body.inputs),
        result_json=json.dumps(result),
        computed_at=now,
        is_variant=1,
    )
    session.add(s); session.commit(); session.refresh(s)
    return _serialize(s)


# Task #29 — read-only compare: the canonical cap table + all draft variants,
# each with its computed result, for side-by-side ownership / dilution.
@router.get("/scenarios/by-project/{project_id}/compare")
def compare_scenarios(
    project_id: int,
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    proj = session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    if not _can_read_project(user, proj):
        raise HTTPException(status_code=403, detail="You don't have access to that project")
    rows = session.exec(
        select(CapTableScenario)
        .where(CapTableScenario.project_id == project_id)
        .order_by(
            func.coalesce(CapTableScenario.is_variant, 0).asc(),
            desc(CapTableScenario.updated_at),
        )
    ).all()
    canonical = next((r for r in rows if not r.is_variant), None)
    variants = [r for r in rows if r.is_variant]
    return {
        "canonical": _serialize(canonical) if canonical else None,
        "variants": [_serialize(r) for r in variants],
    }


@router.get("/scenarios/{uid}")
def read_scenario(
    uid: str,
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    s = _read_or_404(session, uid, user)
    return _serialize(s)


@router.put("/scenarios/{uid}")
def update_scenario(
    uid: str,
    body: ScenarioIn,
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    s = _write_or_404(session, uid, user)
    errs = validate_inputs(body.inputs)
    if errs:
        raise HTTPException(status_code=400, detail={"code": "invalid_inputs", "errors": errs})
    if body.project_id is not None:
        _ensure_project_write_access(session, body.project_id, user)
        # Task #28 — one cap table per project: refuse to bind this scenario to a
        # project that a DIFFERENT scenario already owns (prevents PUT duplicates).
        # Task #29 — only CANONICAL scenarios are unique per project; draft
        # variants (is_variant=1) coexist freely, so a variant edit never clashes
        # and only an existing canonical row counts as the clash.
        if not s.is_variant:
            clash = session.exec(
                select(CapTableScenario)
                .where(CapTableScenario.project_id == body.project_id)
                .where(CapTableScenario.uid != uid)
                .where(func.coalesce(CapTableScenario.is_variant, 0) == 0)
            ).first()
            if clash is not None:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "project_has_cap_table",
                        "message": "This project already has a cap table. Edit that one instead.",
                    },
                )
    result = simulate(body.inputs)
    now = datetime.utcnow()
    s.name = body.name
    s.inputs_json = json.dumps(body.inputs)
    s.result_json = json.dumps(result)
    s.computed_at = now
    s.updated_at = now
    if body.project_id is not None:
        s.project_id = body.project_id
    session.add(s); session.commit(); session.refresh(s)
    return _serialize(s)


@router.delete("/scenarios/{uid}")
def delete_scenario(
    uid: str,
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    s = _write_or_404(session, uid, user)
    session.delete(s); session.commit()
    return {"ok": True}


@router.get("/scenarios/{uid}/export.csv", response_class=PlainTextResponse)
def export_csv(
    uid: str,
    session: Session = Depends(_session_with_schema),
    user: User = Depends(get_current_user),
):
    s = _read_or_404(session, uid, user)
    result = json.loads(s.result_json) if s.result_json else simulate(json.loads(s.inputs_json))
    csv = to_csv(result)
    return PlainTextResponse(
        content=csv,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="captable-{s.name}.csv"'},
    )

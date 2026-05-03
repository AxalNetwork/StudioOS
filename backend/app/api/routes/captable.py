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
from sqlmodel import Session, desc, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import CapTableScenario, Project, User
from backend.app.services.captable import simulate, to_csv, validate_inputs

router = APIRouter(prefix="/captable", tags=["Cap Table"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class SimulateIn(BaseModel):
    inputs: dict[str, Any]


class ScenarioIn(BaseModel):
    name: str = PField(min_length=1, max_length=200)
    inputs: dict[str, Any]
    project_id: Optional[int] = None


def _is_admin(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "admin"


def _serialize(s: CapTableScenario, with_result: bool = True) -> dict:
    out = {
        "uid": s.uid,
        "name": s.name,
        "owner_user_id": s.owner_user_id,
        "project_id": s.project_id,
        "inputs": json.loads(s.inputs_json) if s.inputs_json else {},
        "computed_at": s.computed_at.isoformat() if s.computed_at else None,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }
    if with_result:
        out["result"] = json.loads(s.result_json) if s.result_json else None
    return out


def _ensure_project_access(session: Session, project_id: Optional[int], user: User) -> None:
    """If the caller passes a project_id, prove they may attach to it.
    Admins can attach to any project; otherwise the project must be owned by
    the caller's founder_id (the standard Project.founder_id ownership)."""
    if project_id is None:
        return
    proj = session.get(Project, project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    if _is_admin(user):
        return
    owner_fid = getattr(proj, "founder_id", None)
    if owner_fid is None or owner_fid != user.founder_id:
        raise HTTPException(status_code=403, detail="You don't own that project")


def _own_or_404(session: Session, uid: str, user: User) -> CapTableScenario:
    s = session.exec(select(CapTableScenario).where(CapTableScenario.uid == uid)).first()
    if not s:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if s.owner_user_id != user.id and not _is_admin(user):
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
    session: Session = Depends(get_session),
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
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    errs = validate_inputs(body.inputs)
    if errs:
        raise HTTPException(status_code=400, detail={"code": "invalid_inputs", "errors": errs})
    _ensure_project_access(session, body.project_id, user)
    result = simulate(body.inputs)
    now = datetime.utcnow()
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


@router.get("/scenarios/{uid}")
def read_scenario(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    s = _own_or_404(session, uid, user)
    return _serialize(s)


@router.put("/scenarios/{uid}")
def update_scenario(
    uid: str,
    body: ScenarioIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    s = _own_or_404(session, uid, user)
    errs = validate_inputs(body.inputs)
    if errs:
        raise HTTPException(status_code=400, detail={"code": "invalid_inputs", "errors": errs})
    if body.project_id is not None:
        _ensure_project_access(session, body.project_id, user)
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
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    s = _own_or_404(session, uid, user)
    session.delete(s); session.commit()
    return {"ok": True}


@router.get("/scenarios/{uid}/export.csv", response_class=PlainTextResponse)
def export_csv(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    s = _own_or_404(session, uid, user)
    result = json.loads(s.result_json) if s.result_json else simulate(json.loads(s.inputs_json))
    csv = to_csv(result)
    return PlainTextResponse(
        content=csv,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="captable-{s.name}.csv"'},
    )

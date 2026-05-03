"""Phase 0.2 / Task #23 — Per-role onboarding wizards (FastAPI dev mirror).

Persists step-by-step wizard state in `onboarding_progress`, keyed by
user. The frontend calls these endpoints from the founder/investor/
partner wizard pages; on login, the shell asks `GET /progress` and
redirects unfinished users to the right `/onboarding/<role>` step.

Endpoints
    GET  /api/onboarding/progress
    PUT  /api/onboarding/progress   {flow, step, total_steps, data}
    POST /api/onboarding/complete   {flow}
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User

router = APIRouter(prefix="/onboarding", tags=["Onboarding"])

VALID_FLOWS = {"founder", "investor", "partner"}

_migrated = False


def _ensure_schema(session: Session) -> None:
    global _migrated
    if _migrated:
        return
    try:
        session.exec(text(
            """
            CREATE TABLE IF NOT EXISTS onboarding_progress (
                user_id INTEGER PRIMARY KEY,
                flow TEXT NOT NULL,
                step INTEGER NOT NULL DEFAULT 0,
                total_steps INTEGER NOT NULL DEFAULT 0,
                data TEXT,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        ))
        session.commit()
        _migrated = True
    except Exception:
        session.rollback()


def _row_to_dto(row) -> Dict[str, Any]:
    if row is None:
        return {"flow": None, "step": 0, "total_steps": 0, "data": {}, "completed_at": None}
    data = {}
    raw = row["data"] if "data" in row.keys() else None
    if raw:
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
    # `completed_at` may come back as datetime (Postgres TIMESTAMP) or
    # plain string (SQLite TEXT). Normalize to an ISO string defensively
    # so the FastAPI dev mirror matches the worker D1 path on the wire.
    completed = row["completed_at"]
    if isinstance(completed, datetime):
        completed_out: Optional[str] = completed.isoformat()
    elif completed:
        completed_out = str(completed)
    else:
        completed_out = None
    return {
        "flow": row["flow"],
        "step": row["step"] or 0,
        "total_steps": row["total_steps"] or 0,
        "data": data,
        "completed_at": completed_out,
    }


def _flow_for(user: User) -> Optional[str]:
    """Map authenticated user.role → wizard flow. The role enum may come
    through as either a `RoleEnum` or a bare string depending on entry
    path, so unwrap defensively."""
    role = getattr(user, "role", None)
    role_str = getattr(role, "value", role)
    if isinstance(role_str, str):
        role_str = role_str.lower()
    return role_str if role_str in VALID_FLOWS else None


def _enforce_flow_match(user: User, flow: str) -> None:
    """Server-side role-flow binding. Admins can manage any flow (used
    when seeding / impersonation). Everyone else may only touch their
    own role's wizard."""
    role = getattr(user, "role", None)
    role_str = (getattr(role, "value", role) or "").lower() if role else ""
    if role_str == "admin":
        return
    if flow != _flow_for(user):
        raise HTTPException(status_code=403, detail="flow does not match your role")


@router.get("/progress")
def get_progress(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT flow, step, total_steps, data, completed_at FROM onboarding_progress WHERE user_id = :uid"
    ), params={"uid": user.id}).mappings().first()
    return _row_to_dto(row)


class ProgressUpsert(BaseModel):
    flow: str
    step: int = 0
    total_steps: int = 0
    data: Optional[Dict[str, Any]] = None


@router.put("/progress")
def upsert_progress(
    payload: ProgressUpsert,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if payload.flow not in VALID_FLOWS:
        raise HTTPException(status_code=400, detail="invalid flow")
    _enforce_flow_match(user, payload.flow)
    _ensure_schema(session)
    data_json = json.dumps(payload.data or {})
    if len(data_json) > 64_000:
        raise HTTPException(status_code=400, detail="data too large")
    # UPSERT — Postgres ON CONFLICT, falling back to manual upsert for SQLite.
    try:
        session.exec(text(
            """
            INSERT INTO onboarding_progress (user_id, flow, step, total_steps, data, updated_at)
            VALUES (:uid, :flow, :step, :total, :data, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) DO UPDATE SET
                flow = EXCLUDED.flow,
                step = EXCLUDED.step,
                total_steps = EXCLUDED.total_steps,
                data = EXCLUDED.data,
                updated_at = CURRENT_TIMESTAMP
            """
        ), params={"uid": user.id, "flow": payload.flow, "step": payload.step,
                   "total": payload.total_steps, "data": data_json})
        session.commit()
    except Exception:
        session.rollback()
        existing = session.exec(text(
            "SELECT user_id FROM onboarding_progress WHERE user_id = :uid"
        ), params={"uid": user.id}).first()
        if existing:
            session.exec(text(
                "UPDATE onboarding_progress SET flow=:flow, step=:step, total_steps=:total, "
                "data=:data, updated_at=CURRENT_TIMESTAMP WHERE user_id=:uid"
            ), params={"uid": user.id, "flow": payload.flow, "step": payload.step,
                       "total": payload.total_steps, "data": data_json})
        else:
            session.exec(text(
                "INSERT INTO onboarding_progress (user_id, flow, step, total_steps, data) "
                "VALUES (:uid, :flow, :step, :total, :data)"
            ), params={"uid": user.id, "flow": payload.flow, "step": payload.step,
                       "total": payload.total_steps, "data": data_json})
        session.commit()
    return {"ok": True}


class CompletePayload(BaseModel):
    flow: str


@router.post("/complete")
def complete(
    payload: CompletePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if payload.flow not in VALID_FLOWS:
        raise HTTPException(status_code=400, detail="invalid flow")
    _enforce_flow_match(user, payload.flow)
    _ensure_schema(session)
    session.exec(text(
        "UPDATE onboarding_progress SET completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP "
        "WHERE user_id=:uid"
    ), params={"uid": user.id})
    # If no row exists (user finished without ever PUT'ing) insert a stub.
    existing = session.exec(text(
        "SELECT user_id FROM onboarding_progress WHERE user_id=:uid"
    ), params={"uid": user.id}).first()
    if not existing:
        session.exec(text(
            "INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at) "
            "VALUES (:uid, :flow, 0, 0, CURRENT_TIMESTAMP)"
        ), params={"uid": user.id, "flow": payload.flow})
    session.commit()
    return {"ok": True, "completed_at": True}

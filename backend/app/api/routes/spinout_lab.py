"""Spin-Out Lab — 4-week guided sprint for pre-incorporation founders.

Dev-parity port of the production Worker routes
(cloudflare-worker/src/routes/spinout_lab.ts + services/spinoutLabCatalog.ts)
so the /spinout-lab dashboard renders against the dev backend too.

  GET  /spinout-lab/state      → current week, days remaining, milestones,
                                 unlocked features for the caller
  POST /spinout-lab/start      → flip the lab on (idempotent; 409 if the
                                 caller is already incorporated)
  POST /spinout-lab/milestone  → mark a milestone done; auto-advances weeks;
                                 completing week 4 flips is_incorporated and
                                 turns the lab off
  POST /spinout-lab/exit       → mark incorporated and turn the lab off

The MILESTONES catalog mirrors the Worker's spinoutLabCatalog.ts — the
single source of truth. Keep the two in sync when milestones change.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User

router = APIRouter(prefix="/spinout-lab", tags=["spinout-lab"])

SPRINT_DAYS = 28

# Mirror of cloudflare-worker/src/services/spinoutLabCatalog.ts
MILESTONES = [
    {
        "week": 1,
        "required_all": [
            "project_created",
            "customer_interview_logged_1",
            "customer_interview_logged_2",
            "customer_interview_logged_3",
        ],
        "required_any": [],
        "unlocked_features": [
            "spinout-lab",
            "projects",
            "customer-discovery",
            "market-intelligence",
        ],
    },
    {
        "week": 2,
        "required_all": ["okrs_created", "brand_basics_filled", "pitch_deck_drafted"],
        "required_any": [],
        "unlocked_features": ["roadmap", "brand-builder", "pitch-deck"],
    },
    {
        "week": 3,
        "required_all": ["scoring_run_completed"],
        "required_any": ["advisor_meeting_booked", "cofounder_request_sent"],
        "unlocked_features": ["cofounder-match", "advisors", "office-hours", "scoring"],
    },
    {
        "week": 4,
        "required_all": ["incorporation_completed"],
        "required_any": [],
        "unlocked_features": [
            "incorporate",
            "captable",
            "section-83b",
            "cofounder-agreement",
            "capital",
            "compliance",
        ],
    },
]

VALID_MILESTONE_KEYS = {
    k for w in MILESTONES for k in [*w["required_all"], *w["required_any"]]
}


def _week_for_key(key: str) -> Optional[int]:
    for w in MILESTONES:
        if key in w["required_all"] or key in w["required_any"]:
            return w["week"]
    return None


def _week_met(week: int, completed: set) -> bool:
    d = next((w for w in MILESTONES if w["week"] == week), None)
    if not d:
        return False
    if not all(k in completed for k in d["required_all"]):
        return False
    if d["required_any"] and not any(k in completed for k in d["required_any"]):
        return False
    return True


def _unlocked_through(current_week: int) -> list:
    out = []
    for w in MILESTONES:
        if w["week"] <= current_week:
            out.extend(w["unlocked_features"])
    return out


def _days_since(started_at: Optional[datetime]) -> int:
    if not started_at:
        return 0
    now = datetime.now(timezone.utc)
    start = started_at if started_at.tzinfo else started_at.replace(tzinfo=timezone.utc)
    return max(0, int((now - start).total_seconds() // 86_400))


def _state(session: Session, user: User) -> dict:
    session.refresh(user)
    rows = session.exec(
        text(
            """SELECT milestone_key, week, completed_at
               FROM spinout_lab_milestones
               WHERE user_id = :uid
               ORDER BY week ASC, completed_at ASC"""
        ).bindparams(uid=user.id)
    ).all()
    # Worker parity: `Number(row.spinout_lab_week ?? 1)` — NULL → 1, but a
    # stored 0 (pre-start default) stays 0 so no features leak before start.
    week = int(user.spinout_lab_week) if user.spinout_lab_week is not None else 1
    return {
        "active": int(user.spinout_lab_active or 0) == 1,
        "week": week,
        "days_remaining": max(0, SPRINT_DAYS - _days_since(user.spinout_lab_started_at)),
        "started_at": user.spinout_lab_started_at.isoformat() if user.spinout_lab_started_at else None,
        "is_incorporated": int(user.is_incorporated or 0) == 1,
        "milestones": [
            {
                "key": r[0],
                "week": int(r[1]),
                "completed_at": r[2].isoformat() if hasattr(r[2], "isoformat") else str(r[2]),
            }
            for r in rows
        ],
        "unlocked_features": _unlocked_through(week),
        # Task #7 — cohort admission (Worker parity).
        "admitted": int(getattr(user, "spinout_lab_admitted", 0) or 0) == 1,
        "cohort": getattr(user, "spinout_lab_cohort", None),
    }


@router.get("/state")
def get_state(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return _state(session, user)


@router.post("/start")
def start_lab(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if int(user.is_incorporated or 0) == 1:
        raise HTTPException(status_code=409, detail="User is already incorporated")
    user.spinout_lab_active = 1
    user.spinout_lab_week = user.spinout_lab_week or 1
    user.spinout_lab_started_at = user.spinout_lab_started_at or datetime.utcnow()
    session.add(user)
    session.commit()
    return _state(session, user)


class MilestoneRequest(BaseModel):
    milestone_key: str = ""


@router.post("/milestone")
def record_milestone(
    req: MilestoneRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    key = (req.milestone_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="milestone_key is required")
    if key not in VALID_MILESTONE_KEYS:
        raise HTTPException(status_code=400, detail=f"Unknown milestone_key: {key}")
    week = _week_for_key(key)
    if int(user.spinout_lab_active or 0) != 1:
        raise HTTPException(status_code=409, detail="Spin-Out Lab is not active")

    session.exec(
        text(
            """INSERT INTO spinout_lab_milestones (user_id, week, milestone_key)
               VALUES (:uid, :w, :k)
               ON CONFLICT (user_id, milestone_key) DO NOTHING"""
        ).bindparams(uid=user.id, w=week, k=key)
    )
    session.commit()

    completed_rows = session.exec(
        text(
            "SELECT milestone_key FROM spinout_lab_milestones WHERE user_id = :uid"
        ).bindparams(uid=user.id)
    ).all()
    completed = {r[0] for r in completed_rows}

    new_week = int(user.spinout_lab_week or 1) or 1
    while new_week < 4 and _week_met(new_week, completed):
        new_week += 1
    if new_week != int(user.spinout_lab_week or 1):
        user.spinout_lab_week = new_week
    if new_week == 4 and _week_met(4, completed):
        user.spinout_lab_active = 0
        user.is_incorporated = 1
    session.add(user)
    session.commit()
    return _state(session, user)


@router.post("/exit")
def exit_lab(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user.spinout_lab_active = 0
    user.is_incorporated = 1
    session.add(user)
    session.commit()
    return _state(session, user)

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
            "profiling",
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
        "unlocked_features": ["cofounder-match", "advisors", "office-hours", "scoring", "revenue"],
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
            "use-of-funds",
        ],
    },
]

# Deliverable-only milestones: recorded per user like gating milestones and
# surfaced on the workspace checklist, but NOT part of the week-advance gate
# (_week_met ignores them). Fired by the owning module on real completion
# events — the checklist is never manually checkable. Mirror of
# OPTIONAL_MILESTONES in cloudflare-worker/src/services/spinoutLabCatalog.ts.
OPTIONAL_MILESTONES = {
    1: [
        "customer_interview_logged_4",
        "customer_interview_logged_5",
        "market_sizing_completed",
        "profiling_completed",
        "icp_defined",
        "market_research_shared",
    ],
    2: [
        "mvp_scoped",
        "landing_page_created",
        "studio_ops_cadence_set",
        "discovery_followups_mapped",
    ],
    3: [
        "office_hours_booked",
        "revenue_proof_added",
        "revenue_summary_generated",
        "scoring_confidence_70",
    ],
    4: [
        "ein_received",
        "founder_stock_issued",
        "section83b_filed",
        "cofounder_agreement_signed",
        "fundraise_ask_locked",
        "use_of_funds_filled",
        "investor_intros_secured",
        "captable_locked",
        "data_room_built",
    ],
}

VALID_MILESTONE_KEYS = {
    k for w in MILESTONES for k in [*w["required_all"], *w["required_any"]]
} | {k for keys in OPTIONAL_MILESTONES.values() for k in keys}


def _week_for_key(key: str) -> Optional[int]:
    for w in MILESTONES:
        if key in w["required_all"] or key in w["required_any"]:
            return w["week"]
    for week, keys in OPTIONAL_MILESTONES.items():
        if key in keys:
            return week
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
        # Cohort application (latest submission, if any).
        "application": _latest_application(session, user.id),
    }


def _latest_application(session: Session, user_id: int) -> Optional[dict]:
    try:
        row = session.exec(
            text(
                """SELECT id, company_name, incorporated, stage, jurisdiction,
                          cohort, status, created_at, decided_at
                   FROM spinout_applications
                   WHERE user_id = :uid
                   ORDER BY created_at DESC, id DESC
                   LIMIT 1"""
            ).bindparams(uid=user_id)
        ).first()
    except Exception:  # table not yet migrated
        return None
    if not row:
        return None
    return {
        "id": row[0],
        "company_name": row[1],
        "incorporated": row[2],
        "stage": row[3],
        "jurisdiction": row[4],
        "cohort": row[5],
        "status": row[6],
        "created_at": row[7].isoformat() if hasattr(row[7], "isoformat") else str(row[7]),
        "decided_at": row[8].isoformat() if hasattr(row[8], "isoformat") else (str(row[8]) if row[8] else None),
    }


@router.get("/graduates")
def list_graduates(session: Session = Depends(get_session)):
    """Public (no auth) — powers the "Graduate companies." section, which
    also renders on the logged-out marketing page.

    A graduate is a user with the week-4 `incorporation_completed`
    milestone on record — the strongest completion signal (the /exit
    escape hatch flips is_incorporated without finishing the sprint, so it
    does NOT count). Company facts come from the founder's project; the
    cohort application's working name is the fallback. The dev projects
    table has no funding columns, so `raised`/`last_round` are null here
    (the production Worker fills them from projects.total_funding /
    last_funding_round).
    """
    try:
        rows = session.exec(
            text(
                """SELECT m.user_id, m.completed_at, u.spinout_lab_cohort,
                          p.uid, p.name, p.sector, p.stage, p.status
                   FROM spinout_lab_milestones m
                   JOIN users u ON u.id = m.user_id
                   LEFT JOIN projects p ON p.founder_id = u.founder_id
                   WHERE m.milestone_key = 'incorporation_completed'
                   ORDER BY m.completed_at DESC, p.id ASC"""
            )
        ).all()
    except Exception:  # tables predate the Lab migrations
        return []
    # One card per graduate. Founders can have several projects — prefer the
    # first one whose public profile will actually resolve
    # (GET /public/startup/{handle} 404s archived/rejected/intake projects).
    by_user: dict = {}
    order: list = []
    for r in rows:
        user_id = r[0]
        status = (str(r[7]) if r[7] is not None else "").lower()
        linkable = bool(r[3]) and status not in ("archived", "rejected", "intake")
        entry = {
            "name": r[4],
            "sector": r[5],
            "stage": r[6],
            "cohort": r[2],
            "uid": r[3] if linkable else None,
            "graduated_at": r[1].isoformat() if hasattr(r[1], "isoformat") else str(r[1]),
            "raised": None,
            "last_round": None,
        }
        existing = by_user.get(user_id)
        if existing is None:
            by_user[user_id] = entry
            order.append(user_id)
        elif existing["uid"] is None and entry["uid"]:
            by_user[user_id] = entry  # upgrade to the publicly linkable project
    out = []
    for user_id in order:
        entry = by_user[user_id]
        if not entry["name"]:
            app = _latest_application(session, user_id)
            entry["name"] = (app or {}).get("company_name")
        if not entry["name"]:
            continue  # nothing real to show for this graduate
        out.append(entry)
        if len(out) >= 12:
            break
    return out


@router.get("/stats")
def lab_stats(session: Session = Depends(get_session)):
    """Public (no auth) — real numbers for the hero stats panel (also on the
    logged-out marketing page). Companies built = distinct founders who
    completed the week-4 incorporation milestone. Dev projects have no
    funding columns, so total_raised is null here; the production Worker
    sums projects.total_funding. Answers zeros when tables predate the Lab
    migrations.
    """
    try:
        row = session.exec(
            text(
                "SELECT COUNT(DISTINCT user_id) FROM spinout_lab_milestones "
                "WHERE milestone_key = 'incorporation_completed'"
            )
        ).first()
        companies = int((row[0] if row else 0) or 0)
    except Exception:  # tables predate the Lab migrations
        return {"companies": 0, "total_raised": None}
    return {"companies": companies, "total_raised": None}


@router.get("/cohort")
def list_cohort(session: Session = Depends(get_session)):
    """Public (no auth) — powers the "Active cohort." live tracker, which
    also renders on the logged-out marketing page.

    Returns company-level facts only (working name, sector, week, day) —
    never founder names, emails, or ids. Members are users currently in the
    sprint (`spinout_lab_active = 1`); recent graduates (the week-4
    `incorporation_completed` milestone within the last 45 days) fill the
    final column. Answers [] when tables predate the Lab migrations.
    """
    members = []

    def _company(row_name, user_id):
        name = row_name
        if not name:
            app = _latest_application(session, user_id)
            name = (app or {}).get("company_name")
        return name

    try:
        active_rows = session.exec(
            text(
                """SELECT u.id, u.spinout_lab_week, u.spinout_lab_started_at,
                          u.spinout_lab_cohort, p.name, p.sector
                   FROM users u
                   LEFT JOIN projects p ON p.founder_id = u.founder_id
                   WHERE u.spinout_lab_active = 1
                   ORDER BY u.spinout_lab_started_at ASC NULLS LAST, p.id ASC"""
            )
        ).all()
    except Exception:  # tables predate the Lab migrations
        return []
    seen = set()
    for r in active_rows:
        user_id = r[0]
        if user_id in seen:  # several projects: keep the first
            continue
        seen.add(user_id)
        name = _company(r[4], user_id)
        if not name:
            continue
        started = r[2]
        week = max(1, min(4, int(r[1] or 1)))
        day = min(SPRINT_DAYS, _days_since(started) + 1)
        members.append(
            {
                "name": name,
                "sector": r[5],
                "cohort": r[3],
                "status": "active",
                "week": week,
                "day": day,
                "started_at": started.isoformat() if hasattr(started, "isoformat") else (str(started) if started else None),
            }
        )
        if len(members) >= 24:
            break

    # Recent graduates fill the final ("Incorporated") column.
    try:
        grad_rows = session.exec(
            text(
                """SELECT m.user_id, m.completed_at, u.spinout_lab_started_at,
                          u.spinout_lab_cohort, p.name, p.sector
                   FROM spinout_lab_milestones m
                   JOIN users u ON u.id = m.user_id
                   LEFT JOIN projects p ON p.founder_id = u.founder_id
                   WHERE m.milestone_key = 'incorporation_completed'
                     AND m.completed_at >= NOW() - INTERVAL '45 days'
                   ORDER BY m.completed_at DESC, p.id ASC"""
            )
        ).all()
    except Exception:
        grad_rows = []
    grad_seen = set()
    for r in grad_rows:
        user_id = r[0]
        if user_id in grad_seen or user_id in seen:
            continue
        grad_seen.add(user_id)
        name = _company(r[4], user_id)
        if not name:
            continue
        completed, started = r[1], r[2]
        day = None
        if started is not None and completed is not None:
            try:
                delta = (completed - started).total_seconds()
                day = max(1, int(delta // 86_400) + 1)
            except Exception:
                day = None
        members.append(
            {
                "name": name,
                "sector": r[5],
                "cohort": r[3],
                "status": "graduated",
                "week": 5,
                "day": day,
                "started_at": started.isoformat() if hasattr(started, "isoformat") else (str(started) if started else None),
            }
        )
        if len(grad_seen) >= 8:
            break
    return members


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


class ApplyRequest(BaseModel):
    company_name: str = ""
    idea: str = ""
    incorporated: str = "no"  # 'no' | 'yes'
    stage: str = ""
    jurisdiction: str = ""
    cohort: str = "Cohort 4"


@router.post("/apply")
def apply_to_cohort(
    req: ApplyRequest,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Submit a cohort application. Signed-in founders only — contact info
    comes from the account. Dev parity with the Worker's POST /apply; the
    dev backend has no email pipeline, so the confirmation email is skipped.
    """
    company = (req.company_name or "").strip()
    idea = (req.idea or "").strip()
    if not company:
        raise HTTPException(status_code=400, detail="Company / working name is required")
    if not idea:
        raise HTTPException(status_code=400, detail="Please describe your idea or project")
    # Founder and Explorer accounts may apply — the Lab is exactly how an
    # explorer graduates into a founder-track company.
    if (getattr(user, "role", "") or "").lower() not in ("founder", "exploring"):
        raise HTTPException(status_code=403, detail="Only founder and explorer accounts can apply to the Lab")
    if int(getattr(user, "spinout_lab_admitted", 0) or 0) == 1:
        raise HTTPException(status_code=409, detail="You are already admitted to the Lab")
    existing = _latest_application(session, user.id)
    if existing and existing["status"] == "pending":
        raise HTTPException(status_code=409, detail="You already have an application in review")
    incorporated = "yes" if (req.incorporated or "").strip().lower() == "yes" else "no"
    cohort = (req.cohort or "").strip() or "Cohort 4"
    # Conditional insert — the NOT EXISTS guard makes "one pending application
    # per user" atomic at the DB level, so two concurrent submissions can't
    # both slip past the pre-check above.
    result = session.exec(
        text(
            """INSERT INTO spinout_applications
               (user_id, company_name, idea, incorporated, stage, jurisdiction, cohort)
               SELECT :uid, :co, :idea, :inc, :st, :ju, :ch
               WHERE NOT EXISTS (
                 SELECT 1 FROM spinout_applications
                 WHERE user_id = :uid AND status = 'pending'
               )"""
        ).bindparams(
            uid=user.id, co=company[:200], idea=idea[:4000],
            inc=incorporated, st=(req.stage or "").strip()[:100] or None,
            ju=(req.jurisdiction or "").strip()[:100] or None, ch=cohort[:50],
        )
    )
    session.commit()
    if getattr(result, "rowcount", 1) == 0:
        raise HTTPException(status_code=409, detail="You already have an application in review")
    return {"ok": True, "emailed": False, "application": _latest_application(session, user.id)}


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

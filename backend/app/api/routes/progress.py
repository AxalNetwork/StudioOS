"""Task #28 — Customer discovery, roadmap, and metrics.

Three sub-surfaces under `/build` that replace self-reported scoring inputs
with observable signals:

  • discovery — Mom-Test interview log + per-interview hypothesis grid
  • roadmap   — Now / Next / Later kanban backed by OKRs
  • metrics   — MRR / ARR / CAC / LTV / churn snapshots (manual + Stripe pull)

A `/signals/{project_id}` endpoint distills these tables into 0..10 slider
values for the v2 scoring engine's `traction` category (users / revenue /
signals factors).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field as PydField, field_validator

VALID_HYPOTHESIS_STATUSES = {"validated", "invalidated", "inconclusive"}
from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.api.deps import can_access_founder_resource, is_privileged
from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    ActivityLog,
    Integration,
    Interview,
    MetricsSnapshot,
    MvpFeature,
    OKR,
    PainGroup,
    PainGroupAlias,
    Project,
    User,
    UserRole,
)
from backend.app.services.pain_groups import (
    get_pain_groups_view,
    materialize_title_norm_aliases,
    norm_phrase,
)
from backend.app.services import email_service

router = APIRouter(prefix="/progress", tags=["Discovery / Roadmap / Metrics"])

logger = logging.getLogger("studioos.progress")


# ---------------------------------------------------------------------------
# Authorization (mirrors financials.py)
# ---------------------------------------------------------------------------
def _ensure_can_view(project: Project, user: User) -> None:
    if is_privileged(user):
        return
    if not can_access_founder_resource(user, project.founder_id):
        raise HTTPException(status_code=403, detail="Forbidden")


def _ensure_can_edit(project: Project, user: User) -> None:
    if user.role == UserRole.ADMIN:
        return
    if user.role == UserRole.FOUNDER and can_access_founder_resource(user, project.founder_id):
        return
    # Active Spin-Out Lab members log interviews/OKRs as program deliverables
    # regardless of account role (admitted users keep e.g. 'exploring').
    # Deliberately an EXPLICIT ownership comparison, not
    # can_access_founder_resource(): that predicate treats partner/investor as
    # privileged readers, which must never widen into cross-project writes.
    if (
        int(getattr(user, "spinout_lab_active", 0) or 0) == 1
        and project.founder_id is not None
        and user.founder_id == project.founder_id
    ):
        return
    raise HTTPException(status_code=403, detail="Read-only for non-founder roles")


def _get_project_or_404(session: Session, project_id: int) -> Project:
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


# ---------------------------------------------------------------------------
# Startup Lifecycle module (FOUNDER_UX_AUDIT.md Critical #1) — dev mirror of the
# Worker's GET|PUT /progress/lifecycle/:projectId. Prod = Cloudflare Worker on
# D1; this keeps the dev FastAPI surface in parity so the founder Overview tab
# works against `npm run dev`. Stage is founder-editable via the NEW PUT here —
# never via the privileged projects.stage/status trio.
# ---------------------------------------------------------------------------
LIFECYCLE_STAGES = ["idea", "validate", "build", "launch", "grow", "raise"]
LIFECYCLE_STAGE_META = {
    "idea": {"label": "Idea", "goal": "Shape the concept and capture it"},
    "validate": {"label": "Validate", "goal": "Prove someone wants it"},
    "build": {"label": "Build", "goal": "Ship the MVP with the right people"},
    "launch": {"label": "Launch", "goal": "Get to market"},
    "grow": {"label": "Grow", "goal": "Find repeatable traction"},
    "raise": {"label": "Raise", "goal": "Fund the next stage"},
}


def _normalize_lifecycle_stage(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    v = raw.strip().lower()
    return v if v in LIFECYCLE_STAGES else None


def _parse_manual_checks(raw: Any) -> dict:
    if not raw:
        return {}
    try:
        v = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return {}
    if not isinstance(v, dict):
        return {}
    return {k: (val is True) for k, val in v.items() if isinstance(k, str) and len(k) <= 64}


def _ensure_lifecycle_columns(session: Session) -> None:
    """Dev safety net so the columns exist even if the migration bootstrap ran
    before this feature landed. Postgres supports IF NOT EXISTS."""
    for col in ("lifecycle_stage", "lifecycle_manual_checks"):
        try:
            # Justification: f-string interpolates a static column name from a local literal
            # tuple, dev-only FastAPI not exposed to user input
            session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                f"ALTER TABLE projects ADD COLUMN IF NOT EXISTS {col} VARCHAR"
            ))
            session.commit()
        except Exception:
            session.rollback()


def _compute_lifecycle_signals(session: Session, project_id: int) -> dict:
    out: dict = {
        "landing_published": False,
        "interview_count": 0,
        "latest_mrr": None,
        "active_users": None,
        "monthly_churn_pct": None,
        "new_users": None,
        "active_prospects": 0,
    }
    try:
        row = session.exec(text(
            "SELECT published FROM landing_pages WHERE project_id = :pid"
        ), params={"pid": project_id}).mappings().first()
        out["landing_published"] = bool(row and int(row.get("published") or 0) == 1)
    except Exception:
        logger.debug("lifecycle: landing_pages lookup failed", exc_info=True)
    try:
        row = session.exec(text(
            "SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = :pid"
        ), params={"pid": project_id}).mappings().first()
        out["interview_count"] = int(row["n"]) if row and row.get("n") is not None else 0
    except Exception:
        logger.debug("lifecycle: discovery_interviews count failed", exc_info=True)
    try:
        row = session.exec(text(
            "SELECT mrr, active_users, monthly_churn_pct, new_users "
            "FROM metrics_snapshots WHERE project_id = :pid "
            "ORDER BY snapshot_date DESC, id DESC LIMIT 1"
        ), params={"pid": project_id}).mappings().first()
        if row:
            out["latest_mrr"] = None if row.get("mrr") is None else float(row["mrr"])
            out["active_users"] = None if row.get("active_users") is None else int(row["active_users"])
            out["monthly_churn_pct"] = None if row.get("monthly_churn_pct") is None else float(row["monthly_churn_pct"])
            out["new_users"] = None if row.get("new_users") is None else int(row["new_users"])
    except Exception:
        logger.debug("lifecycle: metrics_snapshots lookup failed", exc_info=True)
    try:
        row = session.exec(text(
            "SELECT COUNT(*) AS n FROM raise_prospects WHERE project_id = :pid AND stage != 'passed'"
        ), params={"pid": project_id}).mappings().first()
        out["active_prospects"] = int(row["n"]) if row and row.get("n") is not None else 0
    except Exception:
        logger.debug("lifecycle: raise_prospects count failed", exc_info=True)
    return out


def _infer_stage_from_signals(s: dict) -> str:
    if s["active_prospects"] > 0:
        return "raise"
    if (s["latest_mrr"] or 0) > 0:
        return "grow"
    if s["landing_published"] and s["interview_count"] >= 5:
        return "validate"
    return "idea"


def _build_lifecycle_checklist(stage: str, s: dict, manual: dict) -> list:
    def m(k: str) -> bool:
        return manual.get(k) is True

    if stage == "idea":
        return [
            {"key": "concept_summary", "label": "Write a one-line concept summary", "done": m("concept_summary"), "href": "/build/command-center?tab=founder-portal", "manual": True},
            {"key": "talk_cofounders", "label": "Talk to 3 potential co-founders", "done": m("talk_cofounders"), "href": "/build/team?tab=cofounder", "manual": True},
            {"key": "first_hypothesis", "label": "Note your riskiest assumption", "done": m("first_hypothesis"), "href": "/build/discovery", "manual": True},
        ]
    if stage == "validate":
        return [
            {"key": "landing_published", "label": "Publish a landing page", "done": s["landing_published"], "href": "/build/brand", "manual": False},
            {"key": "interviews_5", "label": "Log 5 customer interviews", "done": s["interview_count"] >= 5, "href": "/build/discovery", "manual": False},
            {"key": "validated_hypothesis", "label": "Validate a key hypothesis", "done": m("validated_hypothesis"), "href": "/build/discovery", "manual": True},
        ]
    if stage == "build":
        return [
            {"key": "roadmap_set", "label": "Set a 90-day roadmap", "done": m("roadmap_set"), "href": "/build/roadmap", "manual": True},
            {"key": "key_role_filled", "label": "Fill a key team role", "done": m("key_role_filled"), "href": "/build/team", "manual": True},
            {"key": "mvp_shipped", "label": "Ship your MVP", "done": m("mvp_shipped"), "href": "/build/roadmap", "manual": True},
        ]
    if stage == "launch":
        return [
            {"key": "launch_page", "label": "Publish your public launch page", "done": s["landing_published"], "href": "/build/brand", "manual": False},
            {"key": "first_campaign", "label": "Run your first campaign", "done": m("first_campaign"), "href": "/build/brand", "manual": True},
            {"key": "launch_checklist", "label": "Complete your launch checklist", "done": m("launch_checklist"), "href": "/build/roadmap", "manual": True},
        ]
    if stage == "grow":
        return [
            {"key": "metrics_logged", "label": "Log weekly metrics / connect Stripe", "done": (s["latest_mrr"] or 0) > 0 or (s["active_users"] or 0) > 0, "href": "/build/metrics", "manual": False},
            {"key": "mrr_positive", "label": "Reach positive MRR", "done": (s["latest_mrr"] or 0) > 0, "href": "/build/metrics", "manual": False},
            {"key": "retention_tracked", "label": "Track retention & churn", "done": m("retention_tracked"), "href": "/build/metrics", "manual": True},
        ]
    if stage == "raise":
        return [
            {"key": "investors_10", "label": "Add 10 investors to your pipeline", "done": s["active_prospects"] >= 10, "href": "/raise/capital", "manual": False},
            {"key": "pitch_ready", "label": "Prepare your pitch deck", "done": m("pitch_ready"), "href": "/raise/pitch", "manual": True},
            {"key": "data_room", "label": "Assemble your data room", "done": m("data_room"), "href": "/raise/capital", "manual": True},
        ]
    return []


def _build_lifecycle_suggestions(stage: str, s: dict) -> list:
    if stage == "idea" and (s["landing_published"] or s["interview_count"] >= 1):
        return [{"to": "validate", "reason": "You've started talking to customers — ready to Validate?"}]
    if stage == "validate" and s["landing_published"] and s["interview_count"] >= 5:
        return [{"to": "build", "reason": "Landing page live and 5+ interviews logged — time to Build?"}]
    if stage == "launch" and (s["latest_mrr"] or 0) > 0:
        return [{"to": "grow", "reason": "You're generating revenue — move to Grow?"}]
    if stage == "grow" and s["active_prospects"] > 0:
        return [{"to": "raise", "reason": "Investors are in your pipeline — ready to Raise?"}]
    return []


def _load_lifecycle_row(session: Session, project_id: int):
    return session.exec(text(
        "SELECT lifecycle_stage, lifecycle_manual_checks FROM projects WHERE id = :pid"
    ), params={"pid": project_id}).mappings().first()


def _build_lifecycle_response(session: Session, project_id: int) -> dict:
    row = _load_lifecycle_row(session, project_id)
    signals = _compute_lifecycle_signals(session, project_id)
    stored_stage = _normalize_lifecycle_stage(row.get("lifecycle_stage") if row else None)
    stage = stored_stage or _infer_stage_from_signals(signals)
    manual = _parse_manual_checks(row.get("lifecycle_manual_checks") if row else None)
    return {
        "project_id": project_id,
        "stage": stage,
        "stored": bool(stored_stage),
        "stages": [{"id": sid, **LIFECYCLE_STAGE_META[sid]} for sid in LIFECYCLE_STAGES],
        "signals": signals,
        "checklist": _build_lifecycle_checklist(stage, signals, manual),
        "suggestions": _build_lifecycle_suggestions(stage, signals),
    }


@router.get("/lifecycle/{project_id}")
def get_lifecycle(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_view(p, user)
    _ensure_lifecycle_columns(session)
    return _build_lifecycle_response(session, project_id)


@router.put("/lifecycle/{project_id}")
def update_lifecycle(
    project_id: int,
    body: dict,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)
    _ensure_lifecycle_columns(session)

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body required")

    sets: list = []
    params: dict = {"pid": project_id}

    if "stage" in body:
        stage = _normalize_lifecycle_stage(body.get("stage"))
        if not stage:
            raise HTTPException(status_code=400, detail=f"stage must be one of: {', '.join(LIFECYCLE_STAGES)}")
        sets.append("lifecycle_stage = :stage")
        params["stage"] = stage

    if "manual_checks" in body:
        mc = body.get("manual_checks")
        if mc is None:
            sets.append("lifecycle_manual_checks = :mc")
            params["mc"] = None
        elif isinstance(mc, dict):
            # Merge (PATCH-like) so toggling a check on one stage never wipes
            # another stage's saved check-offs. `None` above still clears all.
            existing_row = _load_lifecycle_row(session, project_id)
            existing = _parse_manual_checks(existing_row.get("lifecycle_manual_checks") if existing_row else None)
            merged = {**existing, **_parse_manual_checks(mc)}
            serialized = json.dumps(merged)
            if len(serialized) > 4000:
                raise HTTPException(status_code=400, detail="manual_checks too large")
            sets.append("lifecycle_manual_checks = :mc")
            params["mc"] = serialized
        else:
            raise HTTPException(status_code=400, detail="manual_checks must be an object")

    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to update")

    # Justification: SET clause is built from static code-defined column assignments; all values
    # are bound params, dev-only FastAPI not exposed to user input
    session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        f"UPDATE projects SET {', '.join(sets)} WHERE id = :pid"
    ), params=params)
    session.commit()
    return _build_lifecycle_response(session, project_id)


# ---------------------------------------------------------------------------
# Discovery — interviews & hypotheses
# ---------------------------------------------------------------------------
class HypothesisItem(BaseModel):
    hypothesis: str
    status: str = PydField(default="inconclusive")  # validated | invalidated | inconclusive
    evidence: Optional[str] = None

    @field_validator("status")
    @classmethod
    def _check_status(cls, v: str) -> str:
        v = (v or "inconclusive").lower()
        if v not in VALID_HYPOTHESIS_STATUSES:
            raise ValueError(f"status must be one of {sorted(VALID_HYPOTHESIS_STATUSES)}")
        return v


_VALID_ICP_FIT = {"strong", "partial", "none"}


def _norm_icp_fit(raw) -> Optional[str]:
    """Mirror the Worker's asIcpFit(): unknown values become None ("not yet
    assessed") rather than being stored verbatim."""
    if raw is None or raw == "":
        return None
    s = str(raw).strip().lower()
    return s if s in _VALID_ICP_FIT else None


class InterviewIn(BaseModel):
    interviewee_name: str
    interviewee_role: Optional[str] = None
    interview_date: Optional[date] = None
    notes: str = ""
    hypotheses: list[HypothesisItem] = []
    pains: list[str] = []
    # Assessment fields (Worker parity — D1 migrations 072 / 074 / 161).
    icp_fit: Optional[str] = None
    featured: bool = False
    validation_rating: Optional[int] = None
    validation_comment: Optional[str] = None


def _serialize_interview(i: Interview) -> dict:
    return {
        "id": i.id,
        "project_id": i.project_id,
        "interviewee_name": i.interviewee_name,
        "interviewee_role": i.interviewee_role,
        "interview_date": i.interview_date.isoformat() if i.interview_date else None,
        "notes": i.notes,
        "hypotheses": json.loads(i.hypotheses_json or "[]"),
        "pains": json.loads(i.pains_json or "[]"),
        "icp_fit": getattr(i, "icp_fit", None),
        "featured": bool(getattr(i, "featured", False)),
        "validation_rating": getattr(i, "validation_rating", None),
        "validation_comment": getattr(i, "validation_comment", None),
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "updated_at": i.updated_at.isoformat() if i.updated_at else None,
    }


@router.get("/discovery/{project_id}")
def list_interviews(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_view(p, user)
    rows = session.exec(
        select(Interview)
        .where(Interview.project_id == project_id)
        .order_by(Interview.interview_date.desc(), Interview.id.desc())
    ).all()
    return {"project_id": project_id, "interviews": [_serialize_interview(i) for i in rows]}


@router.post("/discovery/{project_id}")
def create_interview(
    project_id: int,
    body: InterviewIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)
    i = Interview(
        project_id=project_id,
        interviewee_name=body.interviewee_name,
        interviewee_role=body.interviewee_role,
        interview_date=body.interview_date or date.today(),
        notes=body.notes,
        hypotheses_json=json.dumps([h.model_dump() for h in body.hypotheses]),
        pains_json=json.dumps(body.pains),
        icp_fit=_norm_icp_fit(body.icp_fit),
        featured=bool(body.featured),
        validation_rating=body.validation_rating,
        validation_comment=body.validation_comment,
        created_by=user.id,
    )
    session.add(i)
    session.add(ActivityLog(action="interview_logged", details=f"Project {p.name}: {body.interviewee_name}", actor=user.email))
    session.commit()
    session.refresh(i)
    return _serialize_interview(i)


@router.put("/discovery/interview/{interview_id}")
def update_interview(
    interview_id: int,
    body: InterviewIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    i = session.get(Interview, interview_id)
    if not i:
        raise HTTPException(status_code=404, detail="Interview not found")
    p = _get_project_or_404(session, i.project_id)
    _ensure_can_edit(p, user)
    i.interviewee_name = body.interviewee_name
    i.interviewee_role = body.interviewee_role
    if body.interview_date:
        i.interview_date = body.interview_date
    i.notes = body.notes
    i.hypotheses_json = json.dumps([h.model_dump() for h in body.hypotheses])
    i.pains_json = json.dumps(body.pains)
    # Preserve-on-omit, mirroring the Worker: these fields have non-None
    # defaults, so a partial payload that predates them would otherwise clear
    # a founder's assessment on every re-save.
    sent = body.model_fields_set
    if "icp_fit" in sent:
        i.icp_fit = _norm_icp_fit(body.icp_fit)
    if "featured" in sent:
        i.featured = bool(body.featured)
    if "validation_rating" in sent:
        i.validation_rating = body.validation_rating
    if "validation_comment" in sent:
        i.validation_comment = body.validation_comment
    i.updated_at = datetime.utcnow()
    session.add(i)
    session.commit()
    session.refresh(i)
    return _serialize_interview(i)


@router.delete("/discovery/interview/{interview_id}")
def delete_interview(
    interview_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    i = session.get(Interview, interview_id)
    if not i:
        raise HTTPException(status_code=404, detail="Interview not found")
    p = _get_project_or_404(session, i.project_id)
    _ensure_can_edit(p, user)
    session.delete(i)
    session.commit()
    return {"deleted": interview_id}


# ---------------------------------------------------------------------------
# Waitlist customers (Task #5) — dev mirror of the Worker's
# /progress/discovery/{pid}/waitlist[/{sid}/{action}] routes. Surfaces
# customer-audience waitlist signups inside Customer Discovery with a
# lightweight CRM layer (promote-to-interview, product-invitation email,
# follow-up email, per-signup status + activity).
#
# Customer-audience ONLY (strict audience = 'customer'), matching brand.py.
# waitlist_signups has no SQLModel entity, so reads/writes use raw text() SQL
# scoped by id + project_id + audience after the project auth check (IDOR-safe).
# ---------------------------------------------------------------------------
_WAITLIST_CRM_READY = False

# Monotonic CRM precedence — an invite never demotes a 'promoted' signup. The
# *_at timestamps are independent activity marks.
_CRM_STATUS_RANK = {"new": 0, "invited": 1, "followed_up": 2, "promoted": 3}

_WAITLIST_SELECT = (
    "SELECT id, project_id, email, name, source, audience, created_at, "
    "crm_status, invited_at, followed_up_at, promoted_at, promoted_interview_id "
    "FROM waitlist_signups"
)


def _ensure_waitlist_crm_schema(session: Session) -> None:
    global _WAITLIST_CRM_READY
    if _WAITLIST_CRM_READY:
        return
    for s in [
        # The base table is normally created lazily by brand.py; on a fresh DB
        # where no brand endpoint ever ran, the CRM list would 500 without it.
        """
        CREATE TABLE IF NOT EXISTS waitlist_signups (
            id BIGSERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL,
            landing_page_id INTEGER,
            email TEXT NOT NULL,
            name TEXT,
            source TEXT,
            ip_hash TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS audience TEXT",
        "ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS crm_status TEXT DEFAULT 'new'",
        "ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS invited_at TEXT",
        "ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS followed_up_at TEXT",
        "ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS promoted_at TEXT",
        "ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS promoted_interview_id INTEGER",
        "CREATE INDEX IF NOT EXISTS idx_waitlist_crm ON waitlist_signups(project_id, crm_status)",
    ]:
        try:
            session.exec(text(s))
            session.commit()
        except Exception:
            session.rollback()
    _WAITLIST_CRM_READY = True


def _normalize_crm_status(raw: Optional[str]) -> str:
    s = (raw or "new").lower()
    return s if s in _CRM_STATUS_RANK else "new"


def _bump_crm_status(current: Optional[str], nxt: str) -> str:
    cur = _normalize_crm_status(current)
    return nxt if _CRM_STATUS_RANK[nxt] >= _CRM_STATUS_RANK[cur] else cur


def _iso_or_str(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


def _serialize_signup(r: Any) -> dict:
    return {
        "id": r["id"],
        "project_id": r["project_id"],
        "email": r["email"],
        "name": r["name"],
        "source": r["source"],
        "audience": r.get("audience") or None,
        "created_at": _iso_or_str(r["created_at"]),
        "crm_status": _normalize_crm_status(r.get("crm_status")),
        "invited_at": _iso_or_str(r.get("invited_at")),
        "followed_up_at": _iso_or_str(r.get("followed_up_at")),
        "promoted_at": _iso_or_str(r.get("promoted_at")),
        "promoted_interview_id": r.get("promoted_interview_id"),
    }


def _load_customer_signup(session: Session, project_id: int, signup_id: int):
    # Justification: concatenates a module-constant SELECT with a static WHERE clause; all
    # values are bound params, dev-only FastAPI not exposed to user input
    return session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        _WAITLIST_SELECT + " WHERE id = :sid AND project_id = :pid AND audience = 'customer'"
    ), params={"sid": signup_id, "pid": project_id}).mappings().first()


def _app_base_url() -> str:
    domain = os.environ.get("REPLIT_DEV_DOMAIN", "")
    base = f"https://{domain}" if domain else os.environ.get("APP_URL", "https://axal.vc")
    return base.rstrip("/")


def _landing_cta_url(session: Session, project_id: int) -> str:
    base = _app_base_url()
    try:
        row = session.exec(text(
            "SELECT slug FROM landing_pages WHERE project_id = :pid"
        ), params={"pid": project_id}).mappings().first()
        if row and row.get("slug"):
            return f"{base}/landing/{row['slug']}"
    except Exception:
        # landing_pages table/row absent — fall back to the base URL
        logger.debug("progress: landing CTA lookup failed, using base URL", exc_info=True)
    return base


def _waitlist_email_content(kind: str, name: str, product_name: str, founder_name: str, cta_url: str):
    if kind == "invite":
        subject = f"You're invited to try {product_name}"
        intro = f"Thanks for joining the {product_name} waitlist — we'd love for you to be one of the first to try it."
        cta_label = "Get started"
        closing = "If you have any questions, just reply to this email."
    else:
        subject = f"Following up from {product_name}"
        intro = (
            f"Just circling back from the {product_name} team — we wanted to check in and see "
            "if you're still interested in getting early access."
        )
        cta_label = "Take a look"
        closing = "Happy to answer anything — just reply to this email."
    optout = (
        f"You're receiving this because you joined the {product_name} waitlist. "
        "Reply to this email if you'd prefer not to hear from us."
    )
    plain = f"Hi {name},\n\n{intro}\n\n{cta_label} here:\n{cta_url}\n\n{closing}\n\n— {founder_name}\n\n{optout}"
    html = (
        f'<p style="margin:0 0 16px;">Hi {name},</p>'
        f'<p style="margin:0 0 16px;">{intro}</p>'
        '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">'
        f'<a href="{cta_url}" style="display:inline-block;background:#7c3aed;color:#ffffff;'
        f'text-decoration:none;font-size:16px;font-weight:600;padding:16px 28px;border-radius:14px;">{cta_label}</a>'
        '</td></tr></table>'
        f'<p style="margin:0 0 16px;">{closing}</p>'
        f'<p style="margin:0 0 4px;">— {founder_name}</p>'
        f'<p style="font-size:12px;color:#9ca3af;margin:24px 0 0;line-height:1.6;">{optout}</p>'
    )
    return subject, html, plain


def _waitlist_outreach(kind: str, project_id: int, signup_id: int, session: Session, user: User) -> dict:
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)
    _ensure_waitlist_crm_schema(session)
    signup = _load_customer_signup(session, project_id, signup_id)
    if not signup:
        raise HTTPException(status_code=404, detail="Signup not found")

    recipient_name = (signup["name"] or "").strip() or "there"
    founder_name = user.name or "The team"
    product_name = p.name
    cta_url = _landing_cta_url(session, project_id)
    subject, html, plain = _waitlist_email_content(kind, recipient_name, product_name, founder_name, cta_url)

    # Email-send semantics mirror the worker: a configured-but-failed send is a
    # hard 502 (no CRM advance); a not-configured environment (dev without
    # Gmail) is a SOFT path that still records the CRM action.
    email_sent = False
    email_reason: Optional[str] = None
    if email_service.is_gmail_configured():
        ok = email_service.send_html_email(
            to_email=signup["email"], subject=subject, html_body=html,
            plain_text=plain, sender_label=product_name, reply_to="support@axal.vc",
        )
        if not ok:
            raise HTTPException(status_code=502, detail={"code": "email_send_failed"})
        email_sent = True
    else:
        email_reason = "not_configured"

    now_iso = datetime.utcnow().isoformat()
    if kind == "invite":
        next_status = _bump_crm_status(signup.get("crm_status"), "invited")
        session.exec(text(
            "UPDATE waitlist_signups SET invited_at = :ts, crm_status = :st "
            "WHERE id = :sid AND project_id = :pid"
        ), params={"ts": now_iso, "st": next_status, "sid": signup_id, "pid": project_id})
        action, verb = "waitlist_invited", "sent product invitation to"
    else:
        next_status = _bump_crm_status(signup.get("crm_status"), "followed_up")
        session.exec(text(
            "UPDATE waitlist_signups SET followed_up_at = :ts, crm_status = :st "
            "WHERE id = :sid AND project_id = :pid"
        ), params={"ts": now_iso, "st": next_status, "sid": signup_id, "pid": project_id})
        action, verb = "waitlist_followed_up", "sent follow-up to"

    suffix = "" if email_sent else " (email not delivered: not configured)"
    session.add(ActivityLog(
        action=action,
        details=f"Project {p.name}: {verb} {signup['email']}{suffix}",
        actor=user.email, user_id=user.id, project_id=project_id,
    ))
    session.commit()

    updated = _load_customer_signup(session, project_id, signup_id)
    out: dict = {"signup": _serialize_signup(updated), "email_sent": email_sent}
    if email_reason:
        out["email_reason"] = email_reason
    return out


@router.get("/discovery/{project_id}/waitlist")
def list_waitlist_customers(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_view(p, user)
    _ensure_waitlist_crm_schema(session)
    # Justification: concatenates a module-constant SELECT with a static WHERE clause; all
    # values are bound params, dev-only FastAPI not exposed to user input
    rows = session.exec(text(  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        _WAITLIST_SELECT + " WHERE project_id = :pid AND audience = 'customer' "
        "ORDER BY created_at DESC, id DESC LIMIT 500"
    ), params={"pid": project_id}).mappings().all()
    return {"project_id": project_id, "signups": [_serialize_signup(r) for r in rows]}


@router.post("/discovery/{project_id}/waitlist/{signup_id}/promote")
def promote_waitlist_customer(
    project_id: int,
    signup_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)
    _ensure_waitlist_crm_schema(session)
    signup = _load_customer_signup(session, project_id, signup_id)
    if not signup:
        raise HTTPException(status_code=404, detail="Signup not found")

    # Idempotent — return the existing interview on a repeat promote unless its
    # row was since deleted (dangling promoted_interview_id).
    existing_iid = signup.get("promoted_interview_id")
    if existing_iid:
        existing = session.get(Interview, existing_iid)
        if existing:
            return {
                "signup": _serialize_signup(signup),
                "interview": _serialize_interview(existing),
                "already_promoted": True,
            }

    name = (signup["name"] or "").strip() or signup["email"]
    notes = f"Promoted from waitlist signup ({signup['source'] or 'landing'}). Contact: {signup['email']}"
    i = Interview(
        project_id=project_id,
        interviewee_name=name,
        interviewee_role=None,
        interview_date=date.today(),
        notes=notes,
        hypotheses_json="[]",
        pains_json="[]",
        created_by=user.id,
    )
    session.add(i)
    session.commit()
    session.refresh(i)

    now_iso = datetime.utcnow().isoformat()
    # Atomic claim (mirrors the Worker): only the request that flips the NULL
    # promoted_interview_id wins; a concurrent loser deletes its interview and
    # returns the winner's, so a double-click never creates duplicates.
    claim = session.exec(text(
        "UPDATE waitlist_signups SET crm_status = 'promoted', promoted_at = :ts, "
        "promoted_interview_id = :iid WHERE id = :sid AND project_id = :pid "
        "AND promoted_interview_id IS NULL"
    ), params={"ts": now_iso, "iid": i.id, "sid": signup_id, "pid": project_id})
    if getattr(claim, "rowcount", 1) == 0:
        session.delete(i)
        session.commit()
        lost = _load_customer_signup(session, project_id, signup_id)
        winner = session.get(Interview, lost.get("promoted_interview_id")) if lost else None
        return {
            "signup": _serialize_signup(lost) if lost else None,
            "interview": _serialize_interview(winner) if winner else None,
            "already_promoted": True,
        }
    session.add(ActivityLog(
        action="waitlist_promoted",
        details=f"Project {p.name}: promoted {signup['email']} to interview",
        actor=user.email, user_id=user.id, project_id=project_id,
    ))
    session.commit()

    updated = _load_customer_signup(session, project_id, signup_id)
    return {"signup": _serialize_signup(updated), "interview": _serialize_interview(i)}


@router.post("/discovery/{project_id}/waitlist/{signup_id}/invite")
def invite_waitlist_customer(
    project_id: int,
    signup_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return _waitlist_outreach("invite", project_id, signup_id, session, user)


@router.post("/discovery/{project_id}/waitlist/{signup_id}/follow-up")
def follow_up_waitlist_customer(
    project_id: int,
    signup_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return _waitlist_outreach("follow_up", project_id, signup_id, session, user)


# ---------------------------------------------------------------------------
# Pain groups (Task #29) — founder-curated grouping of logged discovery pains
# that feeds the Spin-Out deck's "PAIN FREQUENCY ACROSS INTERVIEWS" slide.
# Dev mirror of the Worker's /progress/pain-groups/* routes. Logged pains stay
# plain strings; these endpoints only manage the curation layer.
# ---------------------------------------------------------------------------
MAX_PAIN_TITLE = 120
MAX_PAIN_PHRASE = 200


class PainAssignIn(BaseModel):
    phrase: str
    group_id: Optional[int] = None
    new_title: Optional[str] = None


class PainGroupRename(BaseModel):
    title: str


@router.get("/pain-groups/{project_id}")
def get_pain_groups(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_view(p, user)
    return get_pain_groups_view(session, project_id)


@router.post("/pain-groups/{project_id}/assign")
def assign_pain(
    project_id: int,
    body: PainAssignIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Assign / re-assign a logged pain phrase to a group.

      {phrase, group_id}   — move into an existing group
      {phrase, new_title}  — create a group titled new_title + assign
      {phrase}             — un-assign (revert to its own implicit theme)
    """
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)

    display = (body.phrase or "").strip()[:MAX_PAIN_PHRASE]
    norm = norm_phrase(display)
    if not display or not norm:
        raise HTTPException(status_code=400, detail="phrase is required")

    new_title = (body.new_title or "").strip()[:MAX_PAIN_TITLE] if body.new_title else None
    has_group = body.group_id is not None
    now = datetime.utcnow()

    if not new_title and not has_group:
        existing = session.exec(
            select(PainGroupAlias).where(
                PainGroupAlias.project_id == project_id, PainGroupAlias.phrase_norm == norm
            )
        ).first()
        if existing:
            session.delete(existing)
            session.commit()
        return get_pain_groups_view(session, project_id)

    if new_title:
        max_sort = session.exec(
            select(PainGroup.sort_order)
            .where(PainGroup.project_id == project_id)
            .order_by(PainGroup.sort_order.desc())
        ).first()
        g = PainGroup(
            project_id=project_id,
            title=new_title,
            sort_order=(max_sort + 1) if max_sort is not None else 0,
        )
        session.add(g)
        session.commit()
        session.refresh(g)
        group_id = g.id
    else:
        group_id = body.group_id
        g = session.get(PainGroup, group_id)
        if not g or g.project_id != project_id:
            raise HTTPException(status_code=404, detail="Group not found")

    existing = session.exec(
        select(PainGroupAlias).where(
            PainGroupAlias.project_id == project_id, PainGroupAlias.phrase_norm == norm
        )
    ).first()
    if existing:
        existing.group_id = group_id
        existing.display_phrase = display
        existing.updated_at = now
        session.add(existing)
    else:
        session.add(
            PainGroupAlias(
                project_id=project_id, group_id=group_id, phrase_norm=norm, display_phrase=display
            )
        )
    session.commit()
    return get_pain_groups_view(session, project_id)


@router.patch("/pain-groups/{group_id}")
def rename_pain_group(
    group_id: int,
    body: PainGroupRename,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    g = session.get(PainGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    p = _get_project_or_404(session, g.project_id)
    _ensure_can_edit(p, user)
    title = (body.title or "").strip()[:MAX_PAIN_TITLE]
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    # Freeze title-norm memberships into explicit aliases before the title
    # changes, so the rename doesn't silently move logged pains back to
    # implicit themes.
    if norm_phrase(title) != norm_phrase(g.title):
        materialize_title_norm_aliases(session, g)
    g.title = title
    g.updated_at = datetime.utcnow()
    session.add(g)
    session.commit()
    return get_pain_groups_view(session, g.project_id)


@router.delete("/pain-groups/{group_id}")
def delete_pain_group(
    group_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    g = session.get(PainGroup, group_id)
    if not g:
        raise HTTPException(status_code=404, detail="Group not found")
    p = _get_project_or_404(session, g.project_id)
    _ensure_can_edit(p, user)
    project_id = g.project_id
    for a in session.exec(
        select(PainGroupAlias).where(PainGroupAlias.group_id == group_id)
    ).all():
        session.delete(a)
    session.delete(g)
    session.commit()
    return get_pain_groups_view(session, project_id)


# ---------------------------------------------------------------------------
# Roadmap — OKR kanban (now / next / later / done)
# ---------------------------------------------------------------------------
KANBAN_STATUSES = {"now", "next", "later", "done"}


class KeyResult(BaseModel):
    text: str
    target: Optional[float] = None
    current: Optional[float] = None
    unit: Optional[str] = None


class OKRIn(BaseModel):
    objective: str
    key_results: list[KeyResult] = []
    kanban_status: str = "now"
    quarter: Optional[str] = None
    sort_order: int = 0


class OKRMove(BaseModel):
    kanban_status: str
    sort_order: int = 0


def _serialize_okr(o: OKR) -> dict:
    krs = json.loads(o.key_results_json or "[]")
    progress: Optional[float] = None
    if krs:
        ratios = []
        for kr in krs:
            tgt = kr.get("target")
            cur = kr.get("current")
            if tgt and tgt != 0 and cur is not None:
                ratios.append(max(0.0, min(1.0, float(cur) / float(tgt))))
        if ratios:
            progress = round(sum(ratios) / len(ratios), 3)
    return {
        "id": o.id,
        "uid": o.uid,
        "project_id": o.project_id,
        "objective": o.objective,
        "key_results": krs,
        "kanban_status": o.kanban_status,
        "quarter": o.quarter,
        "sort_order": o.sort_order,
        "progress": progress,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "updated_at": o.updated_at.isoformat() if o.updated_at else None,
    }


@router.get("/roadmap/{project_id}")
def list_okrs(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_view(p, user)
    rows = session.exec(
        select(OKR)
        .where(OKR.project_id == project_id)
        .order_by(OKR.kanban_status, OKR.sort_order, OKR.id)
    ).all()
    return {"project_id": project_id, "okrs": [_serialize_okr(o) for o in rows]}


@router.post("/roadmap/{project_id}")
def create_okr(
    project_id: int,
    body: OKRIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)
    if body.kanban_status not in KANBAN_STATUSES:
        raise HTTPException(status_code=400, detail=f"kanban_status must be one of {sorted(KANBAN_STATUSES)}")
    o = OKR(
        project_id=project_id,
        objective=body.objective,
        key_results_json=json.dumps([k.model_dump() for k in body.key_results]),
        kanban_status=body.kanban_status,
        quarter=body.quarter,
        sort_order=body.sort_order,
        created_by=user.id,
    )
    session.add(o)
    session.commit()
    session.refresh(o)
    return _serialize_okr(o)


@router.put("/roadmap/okr/{okr_id}")
def update_okr(
    okr_id: int,
    body: OKRIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    o = session.get(OKR, okr_id)
    if not o:
        raise HTTPException(status_code=404, detail="OKR not found")
    p = _get_project_or_404(session, o.project_id)
    _ensure_can_edit(p, user)
    if body.kanban_status not in KANBAN_STATUSES:
        raise HTTPException(status_code=400, detail=f"kanban_status must be one of {sorted(KANBAN_STATUSES)}")
    o.objective = body.objective
    o.key_results_json = json.dumps([k.model_dump() for k in body.key_results])
    o.kanban_status = body.kanban_status
    o.quarter = body.quarter
    o.sort_order = body.sort_order
    o.updated_at = datetime.utcnow()
    session.add(o)
    session.commit()
    session.refresh(o)
    return _serialize_okr(o)


@router.post("/roadmap/okr/{okr_id}/move")
def move_okr(
    okr_id: int,
    body: OKRMove,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    o = session.get(OKR, okr_id)
    if not o:
        raise HTTPException(status_code=404, detail="OKR not found")
    p = _get_project_or_404(session, o.project_id)
    _ensure_can_edit(p, user)
    if body.kanban_status not in KANBAN_STATUSES:
        raise HTTPException(status_code=400, detail=f"kanban_status must be one of {sorted(KANBAN_STATUSES)}")
    o.kanban_status = body.kanban_status
    o.sort_order = body.sort_order
    o.updated_at = datetime.utcnow()
    session.add(o)
    session.commit()
    session.refresh(o)
    return _serialize_okr(o)


@router.delete("/roadmap/okr/{okr_id}")
def delete_okr(
    okr_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    o = session.get(OKR, okr_id)
    if not o:
        raise HTTPException(status_code=404, detail="OKR not found")
    p = _get_project_or_404(session, o.project_id)
    _ensure_can_edit(p, user)
    session.delete(o)
    session.commit()
    return {"deleted": okr_id}


# ---------------------------------------------------------------------------
# MVP Scope — value-ranked feature prioritization (Task #13, Roadmap module)
# ---------------------------------------------------------------------------
# Priority is derived, not chosen: High value → Core / active cycle,
# Medium → v2 / next-cycle candidate, Low → out of scope / deferred.
# Mirror any change into cloudflare-worker/src/routes/progress.ts.
MVP_VALUES = {"High", "Medium", "Low"}
MVP_EFFORTS = {"S", "M", "L", "XL"}
MVP_STATUSES = {"Backlog", "In Progress", "Review", "Done", "Blocked"}


class MvpFeatureIn(BaseModel):
    title: str
    added_value: str = "High"
    effort: str = "M"
    priority_reason: Optional[str] = None
    delivery_status: str = "Backlog"
    sort_order: int = 0


def _mvp_derived(value: str) -> dict:
    if value == "High":
        return {"scope_tier": "Core", "cycle_assigned": "Active cycle"}
    if value == "Medium":
        return {"scope_tier": "v2", "cycle_assigned": "Next cycle candidate"}
    return {"scope_tier": "Out of scope", "cycle_assigned": "Deferred from MVP"}


def _serialize_mvp(f: MvpFeature) -> dict:
    return {
        "id": f.id,
        "uid": f.uid,
        "project_id": f.project_id,
        "title": f.title,
        "added_value": f.added_value,
        "effort": f.effort,
        "priority_reason": f.priority_reason,
        "delivery_status": f.delivery_status,
        "sort_order": f.sort_order,
        **_mvp_derived(f.added_value),
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }


def _validate_mvp_body(body: MvpFeatureIn) -> None:
    if not body.title or not body.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if body.added_value not in MVP_VALUES:
        raise HTTPException(status_code=400, detail=f"added_value must be one of {sorted(MVP_VALUES)}")
    if body.effort not in MVP_EFFORTS:
        raise HTTPException(status_code=400, detail=f"effort must be one of {sorted(MVP_EFFORTS)}")
    if body.delivery_status not in MVP_STATUSES:
        raise HTTPException(status_code=400, detail=f"delivery_status must be one of {sorted(MVP_STATUSES)}")


@router.get("/mvp-scope/{project_id}")
def list_mvp_features(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_view(p, user)
    rows = session.exec(
        select(MvpFeature)
        .where(MvpFeature.project_id == project_id)
        .order_by(MvpFeature.sort_order, MvpFeature.id)
    ).all()
    return {"project_id": project_id, "features": [_serialize_mvp(f) for f in rows]}


@router.post("/mvp-scope/{project_id}")
def create_mvp_feature(
    project_id: int,
    body: MvpFeatureIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)
    _validate_mvp_body(body)
    f = MvpFeature(
        project_id=project_id,
        title=body.title.strip(),
        added_value=body.added_value,
        effort=body.effort,
        priority_reason=(body.priority_reason or "").strip() or None,
        delivery_status=body.delivery_status,
        sort_order=body.sort_order,
        created_by=user.id,
    )
    session.add(f)
    session.commit()
    session.refresh(f)
    return _serialize_mvp(f)


@router.put("/mvp-scope/feature/{feature_id}")
def update_mvp_feature(
    feature_id: int,
    body: MvpFeatureIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    f = session.get(MvpFeature, feature_id)
    if not f:
        raise HTTPException(status_code=404, detail="Feature not found")
    p = _get_project_or_404(session, f.project_id)
    _ensure_can_edit(p, user)
    _validate_mvp_body(body)
    f.title = body.title.strip()
    f.added_value = body.added_value
    f.effort = body.effort
    f.priority_reason = (body.priority_reason or "").strip() or None
    f.delivery_status = body.delivery_status
    f.sort_order = body.sort_order
    f.updated_at = datetime.utcnow()
    session.add(f)
    session.commit()
    session.refresh(f)
    return _serialize_mvp(f)


@router.delete("/mvp-scope/feature/{feature_id}")
def delete_mvp_feature(
    feature_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    f = session.get(MvpFeature, feature_id)
    if not f:
        raise HTTPException(status_code=404, detail="Feature not found")
    p = _get_project_or_404(session, f.project_id)
    _ensure_can_edit(p, user)
    session.delete(f)
    session.commit()
    return {"deleted": feature_id}


# ---------------------------------------------------------------------------
# Metrics — snapshots + Stripe pull (with manual fallback)
# ---------------------------------------------------------------------------
class MetricsIn(BaseModel):
    snapshot_date: Optional[date] = None
    mrr: Optional[float] = PydField(default=None, ge=0)
    arr: Optional[float] = PydField(default=None, ge=0)
    cac: Optional[float] = PydField(default=None, ge=0)
    ltv: Optional[float] = PydField(default=None, ge=0)
    monthly_churn_pct: Optional[float] = PydField(default=None, ge=0, le=100)
    active_users: Optional[int] = PydField(default=None, ge=0)
    new_users: Optional[int] = PydField(default=None, ge=0)
    notes: Optional[str] = None


def _serialize_metrics(m: MetricsSnapshot) -> dict:
    return {
        "id": m.id,
        "project_id": m.project_id,
        "snapshot_date": m.snapshot_date.isoformat() if m.snapshot_date else None,
        "mrr": m.mrr,
        "arr": m.arr,
        "cac": m.cac,
        "ltv": m.ltv,
        "monthly_churn_pct": m.monthly_churn_pct,
        "active_users": m.active_users,
        "new_users": m.new_users,
        "source": m.source,
        "notes": m.notes,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("/metrics/{project_id}")
def list_metrics(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_view(p, user)
    rows = session.exec(
        select(MetricsSnapshot)
        .where(MetricsSnapshot.project_id == project_id)
        .order_by(MetricsSnapshot.snapshot_date.desc(), MetricsSnapshot.id.desc())
    ).all()
    return {"project_id": project_id, "snapshots": [_serialize_metrics(m) for m in rows]}


@router.post("/metrics/{project_id}")
def create_metrics(
    project_id: int,
    body: MetricsIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)
    m = MetricsSnapshot(
        project_id=project_id,
        snapshot_date=body.snapshot_date or date.today(),
        mrr=body.mrr,
        arr=body.arr if body.arr is not None else (body.mrr * 12 if body.mrr is not None else None),
        cac=body.cac,
        ltv=body.ltv,
        monthly_churn_pct=body.monthly_churn_pct,
        active_users=body.active_users,
        new_users=body.new_users,
        source="manual",
        notes=body.notes,
        created_by=user.id,
    )
    session.add(m)
    session.commit()
    session.refresh(m)
    return _serialize_metrics(m)


@router.delete("/metrics/{snapshot_id}")
def delete_metrics(
    snapshot_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    m = session.get(MetricsSnapshot, snapshot_id)
    if not m:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    p = _get_project_or_404(session, m.project_id)
    _ensure_can_edit(p, user)
    session.delete(m)
    session.commit()
    return {"deleted": snapshot_id}


@router.post("/metrics/{project_id}/import-stripe")
def import_from_stripe(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Pull billing metrics from a connected Stripe integration.

    The codebase ships with a Stripe Atlas integration provider in
    `routes/integrations.py` (incorporation, not billing). When a Stripe
    billing connection is wired up, this endpoint will read the latest sync
    payload from `integrations.last_sync_payload` and project it onto a new
    snapshot. Until then, the endpoint returns 400 with a precise reason so
    the founder UI can prompt a manual entry — no silent fallback.
    """
    p = _get_project_or_404(session, project_id)
    _ensure_can_edit(p, user)

    integ = session.exec(
        select(Integration)
        .where(Integration.provider_name.in_(["stripe", "stripe_billing"]))
        .where(Integration.user_id == user.id)
    ).first()
    if not integ:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "stripe_not_connected",
                "message": "No Stripe billing integration connected. Use manual entry instead.",
            },
        )

    payload_raw: Any = getattr(integ, "last_sync_payload", None)
    payload = {}
    if isinstance(payload_raw, str):
        try:
            payload = json.loads(payload_raw)
        except Exception:
            payload = {}
    elif isinstance(payload_raw, dict):
        payload = payload_raw

    if not payload:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "stripe_no_data",
                "message": "Stripe is connected but has not synced billing data yet.",
            },
        )

    mrr = payload.get("mrr")
    m = MetricsSnapshot(
        project_id=project_id,
        snapshot_date=date.today(),
        mrr=mrr,
        arr=payload.get("arr") if payload.get("arr") is not None else (mrr * 12 if mrr is not None else None),
        cac=payload.get("cac"),
        ltv=payload.get("ltv"),
        monthly_churn_pct=payload.get("monthly_churn_pct") or payload.get("churn_pct"),
        active_users=payload.get("active_users") or payload.get("active_subscribers"),
        new_users=payload.get("new_users") or payload.get("new_subscribers"),
        source="stripe",
        notes="Imported from Stripe",
        created_by=user.id,
    )
    session.add(m)
    session.commit()
    session.refresh(m)
    return _serialize_metrics(m)


# ---------------------------------------------------------------------------
# Scoring signals — feed traction category sliders (0..10).
#
# v2 traction factors (`services/scoring.py::SCORING_V2_WEIGHTS["traction"]`):
#   • users    (max 6)  ← active_users + new_user growth
#   • revenue  (max 6)  ← MRR / ARR
#   • signals  (max 3)  ← validated hypotheses + interview cadence
# ---------------------------------------------------------------------------
def _users_slider(latest: Optional[MetricsSnapshot], prior: Optional[MetricsSnapshot]) -> tuple[float, dict]:
    if not latest or not latest.active_users:
        return 0.0, {"reason": "no_active_users"}
    au = float(latest.active_users)
    base = max(0.0, min(7.0, (au ** 0.5) / 5.0))  # ~625 users → 5/10, 10k users → 7/10 (cap before growth)
    growth_bonus = 0.0
    if prior and prior.active_users:
        delta = (au - float(prior.active_users)) / max(1.0, float(prior.active_users))
        growth_bonus = max(0.0, min(3.0, delta * 10.0))  # 30%/period growth → +3
    score = max(0.0, min(10.0, base + growth_bonus))
    return round(score, 2), {"active_users": int(au), "growth_bonus": round(growth_bonus, 2)}


def _revenue_slider(latest: Optional[MetricsSnapshot]) -> tuple[float, dict]:
    if not latest:
        return 0.0, {"reason": "no_metrics"}
    mrr = latest.mrr or (latest.arr / 12.0 if latest.arr else None)
    if not mrr or mrr <= 0:
        return 0.0, {"reason": "no_revenue"}
    # log scale: $1k=4, $10k=6, $100k=8, $1M+=10
    import math
    # Simplification: 4 + 2*(log10(mrr) - log10(1000)) → $1k=4, $10k=6, $100k=8, $1M=10
    score = max(0.0, min(10.0, 4.0 + 2.0 * (math.log10(max(mrr, 1.0)) - 3.0)))
    churn = latest.monthly_churn_pct or 0
    if churn > 10:
        score = max(0.0, score - 2.0)  # high churn penalty
    return round(score, 2), {"mrr": round(mrr, 2), "monthly_churn_pct": churn}


def _signals_slider(interviews: list[Interview]) -> tuple[float, dict]:
    if not interviews:
        return 0.0, {"reason": "no_interviews"}
    total = len(interviews)
    validated = 0
    invalidated = 0
    for i in interviews:
        for h in json.loads(i.hypotheses_json or "[]"):
            s = (h.get("status") or "").lower()
            if s == "validated":
                validated += 1
            elif s == "invalidated":
                invalidated += 1
    cadence_score = max(0.0, min(5.0, total / 4.0))     # 20+ interviews → 5/5
    learning_score = max(0.0, min(5.0, validated * 0.5)) # 10+ validated → 5/5
    score = max(0.0, min(10.0, cadence_score + learning_score))
    return round(score, 2), {
        "interviews": total,
        "validated_hypotheses": validated,
        "invalidated_hypotheses": invalidated,
    }


@router.get("/signals/{project_id}")
def get_signals(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Aggregate the three sub-pages into traction-category sliders."""
    p = _get_project_or_404(session, project_id)
    _ensure_can_view(p, user)

    latest_metrics = session.exec(
        select(MetricsSnapshot)
        .where(MetricsSnapshot.project_id == project_id)
        .order_by(MetricsSnapshot.snapshot_date.desc(), MetricsSnapshot.id.desc())
        .limit(2)
    ).all()
    latest = latest_metrics[0] if latest_metrics else None
    prior = latest_metrics[1] if len(latest_metrics) > 1 else None

    interviews = session.exec(
        select(Interview).where(Interview.project_id == project_id)
    ).all()

    okrs = session.exec(
        select(OKR).where(OKR.project_id == project_id)
    ).all()
    okrs_done = sum(1 for o in okrs if o.kanban_status == "done")

    users_score, users_meta = _users_slider(latest, prior)
    revenue_score, revenue_meta = _revenue_slider(latest)
    signals_score, signals_meta = _signals_slider(interviews)

    # Convert sliders → category points (max 6/6/3)
    users_pts = round((users_score / 10.0) * 6.0, 2)
    revenue_pts = round((revenue_score / 10.0) * 6.0, 2)
    signals_pts = round((signals_score / 10.0) * 3.0, 2)
    total = round(min(users_pts + revenue_pts + signals_pts, 15), 2)

    return {
        "project_id": project_id,
        "category": "traction",
        "max": 15,
        "total": total,
        "factors": {
            "users":   {"raw": users_score,   "points": users_pts,   "max": 6, "label": "User adoption",    "meta": users_meta},
            "revenue": {"raw": revenue_score, "points": revenue_pts, "max": 6, "label": "Revenue / pipeline", "meta": revenue_meta},
            "signals": {"raw": signals_score, "points": signals_pts, "max": 3, "label": "Validation signals", "meta": signals_meta},
        },
        "summary": {
            "interviews": len(interviews),
            "okrs_total": len(okrs),
            "okrs_done": okrs_done,
            "latest_metrics_date": latest.snapshot_date.isoformat() if latest and latest.snapshot_date else None,
            "latest_mrr": latest.mrr if latest else None,
            "latest_active_users": latest.active_users if latest else None,
        },
    }

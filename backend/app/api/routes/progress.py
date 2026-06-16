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
from datetime import date, datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field as PydField, field_validator

VALID_HYPOTHESIS_STATUSES = {"validated", "invalidated", "inconclusive"}
from sqlmodel import Session, select

from backend.app.api.deps import can_access_founder_resource, is_privileged
from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    ActivityLog,
    Integration,
    Interview,
    MetricsSnapshot,
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

router = APIRouter(prefix="/progress", tags=["Discovery / Roadmap / Metrics"])


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
    raise HTTPException(status_code=403, detail="Read-only for non-founder roles")


def _get_project_or_404(session: Session, project_id: int) -> Project:
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return p


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


class InterviewIn(BaseModel):
    interviewee_name: str
    interviewee_role: Optional[str] = None
    interview_date: Optional[date] = None
    notes: str = ""
    hypotheses: list[HypothesisItem] = []
    pains: list[str] = []


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
    score = max(0.0, min(10.0, 4.0 + math.log10(max(mrr, 1.0)) * 2.0 - 2.0 * math.log10(1000)/math.log10(10)))
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

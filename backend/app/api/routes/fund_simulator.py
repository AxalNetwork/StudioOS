"""Task #46 — Reserve allocation + waterfall simulator routes.

Two surfaces (mounted under ``/api/fund-sim``):

* ``/funds/{fund_id}/reserves`` — GET/PUT per-company follow-on plan.
* ``/funds/{fund_id}/reserves/simulate`` — POST: project deployment + IRR.
* ``/funds/{fund_id}/waterfall/simulate`` — POST: exit-at-$X distribution.
* ``/funds/{fund_id}/scenarios`` — GET/POST saved runs.
* ``/scenarios/{scenario_uid}`` — GET/DELETE individual scenario.

All routes are admin-or-investor only — same gate as the rest of `/capital`
and `/funds`. Scenarios are scoped to the calling user via
``created_by_user_id`` for visibility filtering (admins see all).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field as PField
from sqlmodel import Session, select

from backend.app.api.deps import require_admin_or_investor
from backend.app.database import get_session
from backend.app.models.entities import (
    FundReserveAllocation,
    FundScenario,
    LimitedPartner,
    Project,
    User,
    VCFund,
)
from backend.app.services.fund_simulator import (
    simulate_reserves,
    simulate_waterfall,
)


router = APIRouter(prefix="/fund-sim", tags=["Fund Simulator (Task #46)"])


def _is_admin(user: User) -> bool:
    return (getattr(user.role, "value", user.role) or "").lower() == "admin"


def _require_fund(session: Session, fund_id: int) -> VCFund:
    f = session.get(VCFund, fund_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fund not found")
    return f


def _portfolio_projects(session: Session) -> list[Project]:
    """Active portfolio companies — same filter as /api/capital/portfolio."""
    return session.exec(
        select(Project).where(Project.status.in_(["spinout", "active", "tier_1", "tier_2"]))
    ).all()


def _alloc_dto(a: FundReserveAllocation, project_name: Optional[str] = None) -> dict:
    return {
        "uid": a.uid,
        "project_id": a.project_id,
        "project_name": project_name,
        "reserve_amount": a.reserve_amount,
        "initial_check": a.initial_check,
        "next_round_label": a.next_round_label,
        "target_ownership_pct": a.target_ownership_pct,
        "confidence": a.confidence,
        "notes": a.notes,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def _scenario_dto(s: FundScenario) -> dict:
    try:
        inputs = json.loads(s.inputs_json or "{}")
    except Exception:
        inputs = {}
    try:
        result = json.loads(s.result_json or "{}")
    except Exception:
        result = {}
    return {
        "uid": s.uid,
        "fund_id": s.fund_id,
        "kind": s.kind,
        "name": s.name,
        "description": s.description,
        "inputs": inputs,
        "result": result,
        "created_by_user_id": s.created_by_user_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Reserves — list / replace
# ---------------------------------------------------------------------------
@router.get("/funds/{fund_id}/reserves")
def list_reserves(
    fund_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin_or_investor),
):
    """Return every active portfolio company joined with its current reserve
    allocation (if any). The frontend renders this directly as the editable
    table on /portfolio/reserves."""
    fund = _require_fund(session, fund_id)
    projects = _portfolio_projects(session)
    by_project: dict[int, FundReserveAllocation] = {
        a.project_id: a for a in session.exec(
            select(FundReserveAllocation).where(FundReserveAllocation.fund_id == fund.id)
        ).all()
    }
    rows: list[dict] = []
    for p in projects:
        a = by_project.get(p.id)
        if a is not None:
            rows.append(_alloc_dto(a, project_name=p.name))
        else:
            rows.append({
                "uid": None,
                "project_id": p.id,
                "project_name": p.name,
                "reserve_amount": 0.0,
                "initial_check": 0.0,
                "next_round_label": None,
                "target_ownership_pct": None,
                "confidence": "medium",
                "notes": None,
                "updated_at": None,
            })
    summary = simulate_reserves(
        total_commitment=fund.total_commitment or 0.0,
        allocations=[
            {
                "project_id": r["project_id"],
                "project_name": r["project_name"],
                "initial_check": r["initial_check"],
                "reserve_amount": r["reserve_amount"],
                "target_ownership_pct": r["target_ownership_pct"],
                "confidence": r["confidence"],
            }
            for r in rows
        ],
    )["summary"]
    return {
        "fund": {
            "id": fund.id,
            "uid": fund.uid,
            "name": fund.name,
            "vintage_year": fund.vintage_year,
            "total_commitment": fund.total_commitment,
            "deployed_capital": fund.deployed_capital,
            "status": fund.status,
        },
        "items": rows,
        "summary": summary,
    }


class AllocationIn(BaseModel):
    project_id: int
    reserve_amount: float = PField(0.0, ge=0)
    initial_check: float = PField(0.0, ge=0)
    next_round_label: Optional[str] = PField(default=None, max_length=64)
    target_ownership_pct: Optional[float] = PField(default=None, ge=0, le=100)
    confidence: str = PField(default="medium")
    notes: Optional[str] = PField(default=None, max_length=2000)


class ReservesPutBody(BaseModel):
    items: list[AllocationIn]


@router.put("/funds/{fund_id}/reserves")
def replace_reserves(
    fund_id: int,
    body: ReservesPutBody,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin_or_investor),
):
    """Bulk upsert. Rows present in `items` are upserted by (fund_id,
    project_id); rows absent are zeroed out (reserve_amount=0,
    initial_check=0) so the table reflects exactly what was sent.

    The unique index on (fund_id, project_id) created in the migration
    makes the upsert race-safe: a concurrent PUT will either win or surface
    a clean integrity error rather than corrupt the table.
    """
    fund = _require_fund(session, fund_id)
    valid_project_ids = {p.id for p in _portfolio_projects(session)}
    existing = {
        a.project_id: a for a in session.exec(
            select(FundReserveAllocation).where(FundReserveAllocation.fund_id == fund.id)
        ).all()
    }
    seen: set[int] = set()
    for it in body.items:
        if it.project_id not in valid_project_ids:
            raise HTTPException(status_code=400, detail=f"Project {it.project_id} not in active portfolio")
        seen.add(it.project_id)
        a = existing.get(it.project_id)
        if a is None:
            a = FundReserveAllocation(
                fund_id=fund.id,
                project_id=it.project_id,
                reserve_amount=it.reserve_amount,
                initial_check=it.initial_check,
                next_round_label=it.next_round_label,
                target_ownership_pct=it.target_ownership_pct,
                confidence=it.confidence,
                notes=it.notes,
            )
        else:
            a.reserve_amount = it.reserve_amount
            a.initial_check = it.initial_check
            a.next_round_label = it.next_round_label
            a.target_ownership_pct = it.target_ownership_pct
            a.confidence = it.confidence
            a.notes = it.notes
            a.updated_at = datetime.utcnow()
        session.add(a)
    # Zero-out rows the caller dropped from the bulk PUT — keeps the table
    # in lockstep with the UI state on /portfolio/reserves.
    for pid, a in existing.items():
        if pid not in seen:
            a.reserve_amount = 0.0
            a.initial_check = 0.0
            a.updated_at = datetime.utcnow()
            session.add(a)
    session.commit()
    return list_reserves(fund_id=fund.id, session=session, user=user)


# ---------------------------------------------------------------------------
# Reserves — simulate (no persistence; pure preview)
# ---------------------------------------------------------------------------
class ReserveSimBody(BaseModel):
    allocations: list[AllocationIn]
    expected_moic_per_company: Optional[float] = PField(default=None, ge=0, le=50)
    years_to_exit: float = PField(default=5.0, ge=0.25, le=15)
    fund_expense_pct: float = PField(default=0.20, ge=0, le=0.95)


@router.post("/funds/{fund_id}/reserves/simulate")
def simulate_reserves_endpoint(
    fund_id: int,
    body: ReserveSimBody,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin_or_investor),
):
    fund = _require_fund(session, fund_id)
    name_by_id = {p.id: p.name for p in _portfolio_projects(session)}
    payload = [
        {
            "project_id": a.project_id,
            "project_name": name_by_id.get(a.project_id),
            "initial_check": a.initial_check,
            "reserve_amount": a.reserve_amount,
            "target_ownership_pct": a.target_ownership_pct,
            "confidence": a.confidence,
        }
        for a in body.allocations
    ]
    return simulate_reserves(
        total_commitment=fund.total_commitment or 0.0,
        allocations=payload,
        expected_moic_per_company=body.expected_moic_per_company,
        years_to_exit=body.years_to_exit,
        fund_expense_pct=body.fund_expense_pct,
    )


# ---------------------------------------------------------------------------
# Waterfall — simulate exit at $X
# ---------------------------------------------------------------------------
class WaterfallBody(BaseModel):
    exit_value: float = PField(..., ge=0)
    carry_pct: float = PField(default=0.20, ge=0, le=0.50)
    hurdle_rate: float = PField(default=0.08, ge=0, le=0.50)
    years_held: float = PField(default=5.0, ge=0, le=20)
    gp_catchup: bool = True
    # Optional overrides — when omitted, we pull from the LP roster.
    total_committed: Optional[float] = PField(default=None, ge=0)
    total_invested: Optional[float] = PField(default=None, ge=0)


@router.post("/funds/{fund_id}/waterfall/simulate")
def simulate_waterfall_endpoint(
    fund_id: int,
    body: WaterfallBody,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin_or_investor),
):
    fund = _require_fund(session, fund_id)
    lps = session.exec(
        select(LimitedPartner).where(LimitedPartner.fund_id == fund.id)
    ).all()
    sum_commit = sum(lp.commitment_amount or 0.0 for lp in lps)
    sum_invested = sum(lp.invested_amount or 0.0 for lp in lps)
    committed = body.total_committed if body.total_committed is not None else (sum_commit or fund.total_commitment or 0.0)
    invested = body.total_invested if body.total_invested is not None else (sum_invested or fund.deployed_capital or 0.0)
    return simulate_waterfall(
        exit_value=body.exit_value,
        total_committed=committed,
        total_invested=invested,
        carry_pct=body.carry_pct,
        hurdle_rate=body.hurdle_rate,
        years_held=body.years_held,
        gp_catchup=body.gp_catchup,
        lps=[
            {
                "name": lp.name,
                "commitment_amount": lp.commitment_amount,
                "invested_amount": lp.invested_amount,
            }
            for lp in lps
        ],
    )


# ---------------------------------------------------------------------------
# Scenarios — save / list / load / delete
# ---------------------------------------------------------------------------
class ScenarioCreateBody(BaseModel):
    kind: str = PField(..., pattern="^(reserves|waterfall)$")
    name: str = PField(..., min_length=1, max_length=120)
    description: Optional[str] = PField(default=None, max_length=2000)
    inputs: dict
    result: Optional[dict] = None


@router.get("/funds/{fund_id}/scenarios")
def list_scenarios(
    fund_id: int,
    kind: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin_or_investor),
):
    fund = _require_fund(session, fund_id)
    stmt = select(FundScenario).where(FundScenario.fund_id == fund.id)
    if kind in ("reserves", "waterfall"):
        stmt = stmt.where(FundScenario.kind == kind)
    # Investors only see their own scenarios; admins see all.
    if not _is_admin(user):
        stmt = stmt.where(FundScenario.created_by_user_id == user.id)
    stmt = stmt.order_by(FundScenario.created_at.desc())
    return {"items": [_scenario_dto(s) for s in session.exec(stmt).all()]}


@router.post("/funds/{fund_id}/scenarios", status_code=201)
def create_scenario(
    fund_id: int,
    body: ScenarioCreateBody,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin_or_investor),
):
    fund = _require_fund(session, fund_id)
    s = FundScenario(
        fund_id=fund.id,
        kind=body.kind,
        name=body.name.strip(),
        description=body.description,
        inputs_json=json.dumps(body.inputs or {}),
        result_json=json.dumps(body.result or {}),
        created_by_user_id=user.id,
    )
    session.add(s)
    session.commit()
    session.refresh(s)
    return _scenario_dto(s)


@router.get("/scenarios/{scenario_uid}")
def get_scenario(
    scenario_uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin_or_investor),
):
    s = session.exec(select(FundScenario).where(FundScenario.uid == scenario_uid)).first()
    if not s:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if not _is_admin(user) and s.created_by_user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your scenario")
    return _scenario_dto(s)


@router.delete("/scenarios/{scenario_uid}", status_code=204)
def delete_scenario(
    scenario_uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(require_admin_or_investor),
):
    s = session.exec(select(FundScenario).where(FundScenario.uid == scenario_uid)).first()
    if not s:
        raise HTTPException(status_code=404, detail="Scenario not found")
    if not _is_admin(user) and s.created_by_user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your scenario")
    session.delete(s)
    session.commit()
    return None

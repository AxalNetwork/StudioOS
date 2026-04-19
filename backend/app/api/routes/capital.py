"""Capital & Investment routes.

Backed by the canonical `vc_funds` + `limited_partners` tables. The legacy
`lp_investors` table is no longer written to; the startup migration in
`backend/app/models/migrations.py` keeps any historical rows mirrored into
the new tables.

Response shapes preserve the legacy field names (`committed_capital`,
`called_capital`, `fund_name`) so the existing frontend continues to work
without changes.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, func, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    CapitalCall,
    LimitedPartner,
    LPInvestor,
    Partner,
    Project,
    ScoreSnapshot,
    User,
    VCFund,
)
from backend.app.schemas.scoring import (
    CapitalCallCreate,
    CapitalCallRequest,
    LPInvestorCreate,
)

router = APIRouter(prefix="/capital", tags=["Capital & Investment"])


# ---------------------------------------------------------------------------
# Serialization helpers — preserve legacy keys for the frontend.
# ---------------------------------------------------------------------------
def _lp_dto(lp: LimitedPartner, fund: VCFund | None) -> dict:
    return {
        "id": lp.id,
        "uid": lp.uid,
        "name": lp.name,
        "email": lp.email,
        "fund_id": lp.fund_id,
        "fund_name": fund.name if fund else None,
        "commitment_amount": lp.commitment_amount,
        "invested_amount": lp.invested_amount,
        "returns": lp.returns,
        # Backward-compatible aliases:
        "committed_capital": lp.commitment_amount,
        "called_capital": lp.invested_amount,
        "status": lp.status,
        "created_at": lp.created_at.isoformat() if lp.created_at else None,
    }


def _call_dto(c: CapitalCall) -> dict:
    # For frontend compat the legacy `lp_investor_id` field is aliased to the
    # canonical FK. If the canonical FK is missing (legacy row not yet
    # backfilled), fall back to the original legacy column so the value is
    # never spuriously null.
    lp_id = c.limited_partner_id or c.lp_investor_id
    return {
        "id": c.id,
        "uid": c.uid,
        "limited_partner_id": c.limited_partner_id,
        "lp_investor_id": lp_id,  # backward-compat alias
        "project_id": c.project_id,
        "amount": c.amount,
        "status": c.status,
        "due_date": str(c.due_date) if c.due_date else None,
        "paid_date": str(c.paid_date) if c.paid_date else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _get_or_create_fund(session: Session, name: str) -> VCFund:
    fund = session.exec(select(VCFund).where(VCFund.name == name)).first()
    if not fund:
        fund = VCFund(name=name, status="active")
        session.add(fund)
        session.commit()
        session.refresh(fund)
    return fund


# ---------------------------------------------------------------------------
# Investors (LPs)
# ---------------------------------------------------------------------------
@router.get("/investors")
def list_investors(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    lps = session.exec(select(LimitedPartner).order_by(LimitedPartner.created_at.desc())).all()
    funds = {f.id: f for f in session.exec(select(VCFund)).all()}
    return [_lp_dto(lp, funds.get(lp.fund_id)) for lp in lps]


@router.post("/investors")
def create_investor(
    data: LPInvestorCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    fund_name = data.fund_name or "Axal Fund I"
    fund = _get_or_create_fund(session, fund_name)

    # Enforce uniqueness on (email, fund_id) — same person may LP into multiple funds.
    existing = session.exec(
        select(LimitedPartner).where(
            LimitedPartner.email == data.email,
            LimitedPartner.fund_id == fund.id,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Investor {data.email} already exists for fund '{fund.name}'",
        )

    lp = LimitedPartner(
        fund_id=fund.id,
        name=data.name,
        email=data.email,
        commitment_amount=data.committed_capital,
        invested_amount=0,
        status="active",
    )
    session.add(lp)
    # Keep fund.lp_count + total_commitment aggregate in sync.
    fund.lp_count += 1
    fund.total_commitment += data.committed_capital
    fund.updated_at = datetime.utcnow()
    session.add(fund)
    session.commit()
    session.refresh(lp)
    return _lp_dto(lp, fund)


@router.get("/investors/{investor_id}")
def get_investor(
    investor_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    lp = session.get(LimitedPartner, investor_id)
    if not lp:
        raise HTTPException(status_code=404, detail="Investor not found")
    fund = session.get(VCFund, lp.fund_id)
    calls = session.exec(
        select(CapitalCall).where(CapitalCall.limited_partner_id == investor_id)
    ).all()
    return {**_lp_dto(lp, fund), "capital_calls": [_call_dto(c) for c in calls]}


# ---------------------------------------------------------------------------
# Capital calls
# ---------------------------------------------------------------------------
@router.post("/calls")
def create_capital_call(
    data: CapitalCallCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    lp_id = data.limited_partner_id or data.lp_investor_id
    if not lp_id:
        raise HTTPException(status_code=422, detail="limited_partner_id is required")

    lp = session.get(LimitedPartner, lp_id)
    if not lp and data.lp_investor_id is not None and data.limited_partner_id is None:
        # Backward compat: caller may have sent a TRUE legacy `lp_investors.id`.
        # Map it to the canonical `limited_partners.id` via (email, fund_name).
        legacy = session.get(LPInvestor, data.lp_investor_id)
        if legacy and legacy.email:
            # Deterministic pick on the off-chance pre-unique-index history
            # left a duplicate (fund_id, email) row behind: lowest id wins.
            lp = session.exec(
                select(LimitedPartner)
                .join(VCFund, VCFund.id == LimitedPartner.fund_id)
                .where(
                    LimitedPartner.email == legacy.email,
                    VCFund.name == (legacy.fund_name or "Axal Fund I"),
                )
                .order_by(LimitedPartner.id)
            ).first()
    if not lp:
        raise HTTPException(status_code=404, detail="Investor not found")

    due = None
    if data.due_date:
        try:
            due = datetime.strptime(data.due_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date format. Use YYYY-MM-DD.")

    call = CapitalCall(
        limited_partner_id=lp.id,
        project_id=data.project_id,
        amount=data.amount,
        due_date=due,
    )
    session.add(call)
    session.commit()
    session.refresh(call)
    return _call_dto(call)


@router.get("/lp-portal")
def lp_portal(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """LP-facing list of capital calls visible to the current user.

    Local dev returns an empty list when the caller is not linked to an LP
    record (real production logic lives in the Cloudflare worker). This
    replaces the previous broken `/legalcap/capital/lp-portal` URL the
    frontend was calling, which produced an Internal Server Error.
    """
    try:
        lp = session.exec(
            select(LimitedPartner).where(LimitedPartner.email == user.email)
        ).first()
        if not lp:
            return []
        calls = session.exec(
            select(CapitalCall)
            .where(CapitalCall.limited_partner_id == lp.id)
            .order_by(CapitalCall.created_at.desc())
        ).all()
        return [_call_dto(c) for c in calls]
    except Exception:
        # Schema drift (legacy DBs without limited_partner_id) shouldn't
        # surface as a 500 to the LP — degrade to an empty list.
        return []


@router.get("/calls")
def list_capital_calls(
    status: str | None = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = select(CapitalCall).order_by(CapitalCall.created_at.desc())
    if status:
        stmt = stmt.where(CapitalCall.status == status)
    return [_call_dto(c) for c in session.exec(stmt).all()]


@router.post("/calls/{call_id}/pay")
def mark_call_paid(
    call_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    call = session.get(CapitalCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Capital call not found")
    if call.status == "paid":
        return {"status": "paid", "call": _call_dto(call)}

    call.status = "paid"
    call.paid_date = datetime.utcnow().date()
    session.add(call)

    lp_id = call.limited_partner_id
    if lp_id:
        lp = session.get(LimitedPartner, lp_id)
        if lp:
            lp.invested_amount += call.amount
            lp.updated_at = datetime.utcnow()
            session.add(lp)
            fund = session.get(VCFund, lp.fund_id)
            if fund:
                fund.deployed_capital += call.amount
                fund.updated_at = datetime.utcnow()
                session.add(fund)

    session.commit()
    session.refresh(call)
    return {"status": "paid", "call": _call_dto(call)}


@router.post("/capitalCall")
def capital_call_with_partners(
    data: CapitalCallRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    project = session.get(Project, data.startup_id)
    if not project:
        raise HTTPException(status_code=404, detail="Startup/project not found")

    lps = session.exec(
        select(LimitedPartner).where(LimitedPartner.status == "active")
    ).all()
    if not lps:
        raise HTTPException(status_code=404, detail="No active investors found")

    per_lp = round(data.amount / len(lps), 2)
    calls_created = []

    for lp in lps:
        call = CapitalCall(
            limited_partner_id=lp.id,
            project_id=data.startup_id,
            amount=per_lp,
        )
        session.add(call)
        calls_created.append({
            "investor_id": lp.id,
            "investor_name": lp.name,
            "amount": per_lp,
        })

    partners = session.exec(select(Partner).where(Partner.status == "active")).all()
    participating_partners = []
    for p in partners:
        if p.specialization and project.sector and project.sector.lower() in p.specialization.lower():
            participating_partners.append({
                "partner_id": p.id,
                "name": p.name,
                "company": p.company,
                "specialization": p.specialization,
            })

    session.commit()

    return {
        "startup_id": data.startup_id,
        "startup_name": project.name,
        "total_amount": data.amount,
        "calls_created": calls_created,
        "participating_partners": participating_partners,
    }


# ---------------------------------------------------------------------------
# Funds
# ---------------------------------------------------------------------------
@router.get("/funds")
def list_funds(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """Canonical fund listing. Replaces the old `entities` rows with type=vc_fund."""
    funds = session.exec(select(VCFund).order_by(VCFund.created_at.desc())).all()
    return [
        {
            "id": f.id,
            "uid": f.uid,
            "name": f.name,
            "vintage_year": f.vintage_year,
            "total_commitment": f.total_commitment,
            "deployed_capital": f.deployed_capital,
            "lp_count": f.lp_count,
            "status": f.status,
            "jurisdiction": f.jurisdiction,
            "uncalled_capital": (f.total_commitment or 0) - (f.deployed_capital or 0),
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in funds
    ]


# ---------------------------------------------------------------------------
# Portfolio
# ---------------------------------------------------------------------------
@router.get("/portfolio")
def portfolio_overview(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    projects = session.exec(
        select(Project).where(Project.status.in_(["spinout", "active", "tier_1", "tier_2"]))
    ).all()

    portfolio = []
    for p in projects:
        latest_score = session.exec(
            select(ScoreSnapshot)
            .where(ScoreSnapshot.project_id == p.id)
            .order_by(ScoreSnapshot.created_at.desc())
        ).first()

        portfolio.append({
            "id": p.id,
            "name": p.name,
            "sector": p.sector,
            "status": p.status,
            "playbook_week": p.playbook_week,
            "score": latest_score.total_score if latest_score else None,
            "tier": latest_score.tier if latest_score else None,
            "revenue": p.revenue,
            "users": p.users_count,
        })

    total_committed = session.exec(select(func.sum(LimitedPartner.commitment_amount))).first() or 0
    total_called = session.exec(select(func.sum(LimitedPartner.invested_amount))).first() or 0

    return {
        "projects": portfolio,
        "total_projects": len(portfolio),
        "fund_metrics": {
            "total_committed": total_committed,
            "total_called": total_called,
        },
    }

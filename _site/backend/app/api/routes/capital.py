from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from backend.app.database import get_session
from backend.app.models.entities import LPInvestor, CapitalCall, Project, ScoreSnapshot
from backend.app.schemas.scoring import LPInvestorCreate, CapitalCallCreate
from datetime import datetime

router = APIRouter(prefix="/capital", tags=["Capital & Investment"])


@router.get("/investors")
def list_investors(session: Session = Depends(get_session)):
    return session.exec(select(LPInvestor).order_by(LPInvestor.created_at.desc())).all()


@router.post("/investors")
def create_investor(data: LPInvestorCreate, session: Session = Depends(get_session)):
    investor = LPInvestor(
        name=data.name,
        email=data.email,
        committed_capital=data.committed_capital,
        fund_name=data.fund_name,
    )
    session.add(investor)
    session.commit()
    session.refresh(investor)
    return investor


@router.get("/investors/{investor_id}")
def get_investor(investor_id: int, session: Session = Depends(get_session)):
    inv = session.get(LPInvestor, investor_id)
    if not inv:
        raise HTTPException(status_code=404, detail="Investor not found")
    stmt = select(CapitalCall).where(CapitalCall.lp_investor_id == investor_id)
    calls = session.exec(stmt).all()
    return {**inv.model_dump(), "capital_calls": [c.model_dump() for c in calls]}


@router.post("/calls")
def create_capital_call(data: CapitalCallCreate, session: Session = Depends(get_session)):
    investor = session.get(LPInvestor, data.lp_investor_id)
    if not investor:
        raise HTTPException(status_code=404, detail="Investor not found")

    call = CapitalCall(
        lp_investor_id=data.lp_investor_id,
        project_id=data.project_id,
        amount=data.amount,
        due_date=datetime.strptime(data.due_date, "%Y-%m-%d").date() if data.due_date else None,
    )
    session.add(call)
    session.commit()
    session.refresh(call)
    return call


@router.get("/calls")
def list_capital_calls(status: str = None, session: Session = Depends(get_session)):
    stmt = select(CapitalCall).order_by(CapitalCall.created_at.desc())
    if status:
        stmt = stmt.where(CapitalCall.status == status)
    return session.exec(stmt).all()


@router.post("/calls/{call_id}/pay")
def mark_call_paid(call_id: int, session: Session = Depends(get_session)):
    call = session.get(CapitalCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Capital call not found")
    call.status = "paid"
    call.paid_date = datetime.utcnow().date()
    session.add(call)

    investor = session.get(LPInvestor, call.lp_investor_id)
    if investor:
        investor.called_capital += call.amount
        session.add(investor)

    session.commit()
    return {"status": "paid", "call": call}


@router.get("/portfolio")
def portfolio_overview(session: Session = Depends(get_session)):
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

    total_committed = session.exec(select(func.sum(LPInvestor.committed_capital))).first() or 0
    total_called = session.exec(select(func.sum(LPInvestor.called_capital))).first() or 0

    return {
        "projects": portfolio,
        "total_projects": len(portfolio),
        "fund_metrics": {
            "total_committed": total_committed,
            "total_called": total_called,
        },
    }

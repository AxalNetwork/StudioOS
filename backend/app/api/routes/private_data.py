from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from datetime import datetime
from backend.app.database import get_session
from backend.app.models.entities import (
    User, UserRole, Project, ScoreSnapshot, Founder, Partner,
    LPInvestor, CapitalCall, Deal, ActivityLog
)
from backend.app.api.routes.auth import get_current_user
from backend.app.api.routes.market_intel import MARKET_PULSE, STUDIO_BENCHMARKS

router = APIRouter(prefix="/private-data", tags=["Private Data API"])


def require_role(*roles):
    def checker(user: User = Depends(get_current_user)):
        if user.role not in roles and user.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Insufficient permissions for this endpoint")
        return user
    return checker


@router.get("/profile")
def get_user_profile(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    result = {
        "id": user.id,
        "uid": user.uid,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
        "email_verified": user.email_verified,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }

    if user.founder_id:
        founder = session.get(Founder, user.founder_id)
        if founder:
            result["founder_profile"] = {
                "id": founder.id,
                "name": founder.name,
                "email": founder.email,
                "linkedin_url": founder.linkedin_url,
                "domain_expertise": founder.domain_expertise,
                "experience_years": founder.experience_years,
                "bio": founder.bio,
            }

    if user.partner_id:
        partner = session.get(Partner, user.partner_id)
        if partner:
            result["partner_profile"] = {
                "id": partner.id,
                "name": partner.name,
                "email": partner.email,
                "company": partner.company,
                "specialization": partner.specialization,
                "status": partner.status,
            }

    return result


@router.get("/market/private-signals")
def get_private_signals(user: User = Depends(require_role(UserRole.ADMIN, UserRole.PARTNER))):
    signals = []
    for s in MARKET_PULSE:
        conviction = "neutral"
        if s["sentiment"] == "Aggressive" and s["multiple"] > 20:
            conviction = "aggressive"
        elif s["sentiment"] == "Wait-and-See" or s["multiple"] < 15:
            conviction = "wait-and-see"

        signals.append({
            "sector": s["sector"],
            "revenue_multiple": s["multiple"],
            "sentiment": s["sentiment"],
            "conviction": conviction,
            "hiring_signal": s["hiring_surge"],
            "technographic_signal": s["technographic_signal"],
            "gap_opportunity": s["gap_opportunity"],
        })

    aggressive_count = sum(1 for s in signals if s["conviction"] == "aggressive")
    cautious_count = sum(1 for s in signals if s["conviction"] == "wait-and-see")
    global_conviction = "Aggressive" if aggressive_count > cautious_count else "Wait-and-See"

    return {
        "global_conviction": global_conviction,
        "signals": signals,
        "studio_benchmarks": STUDIO_BENCHMARKS,
        "updated_at": datetime.utcnow().isoformat(),
    }


@router.get("/portfolio/metrics")
def get_portfolio_metrics(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    role = user.role

    if role == UserRole.FOUNDER:
        return _founder_portfolio(user, session)
    elif role == UserRole.PARTNER:
        return _partner_portfolio(user, session)
    elif role == UserRole.ADMIN:
        return _admin_portfolio(session)
    else:
        raise HTTPException(status_code=403, detail="Unknown role")


def _founder_portfolio(user: User, session: Session):
    projects = []
    if user.founder_id:
        projects = session.exec(
            select(Project).where(Project.founder_id == user.founder_id)
        ).all()

    results = []
    for p in projects:
        score = session.exec(
            select(ScoreSnapshot)
            .where(ScoreSnapshot.project_id == p.id)
            .order_by(ScoreSnapshot.created_at.desc())
        ).first()

        burn_multiple = None
        ltv_cac = None
        if p.revenue and p.revenue > 0:
            burn_rate = (p.cost_to_mvp or 0) / max(12, 1)
            burn_multiple = round(burn_rate / p.revenue, 2) if p.revenue else None
        if p.users_count and p.users_count > 0 and p.revenue:
            ltv_cac = round((p.revenue / p.users_count) * 12 / max(p.cost_to_mvp or 1, 1) * 100, 2)

        results.append({
            "project_id": p.id,
            "name": p.name,
            "sector": p.sector,
            "status": p.status,
            "stage": p.stage,
            "playbook_week": p.playbook_week,
            "score": score.total_score if score else None,
            "tier": score.tier if score else None,
            "metrics": {
                "revenue": p.revenue,
                "users": p.users_count,
                "burn_multiple": burn_multiple,
                "ltv_cac_ratio": ltv_cac,
                "cost_to_mvp": p.cost_to_mvp,
                "funding_needed": p.funding_needed,
            },
        })

    return {
        "role": "founder",
        "projects": results,
        "total_projects": len(results),
    }


def _partner_portfolio(user: User, session: Session):
    if not user.partner_id:
        return {
            "role": "partner",
            "deals": [],
            "total_deals": 0,
            "active_deals": 0,
            "message": "No partner profile linked to this account",
        }

    deals_query = select(Deal).where(Deal.partner_id == user.partner_id).order_by(Deal.created_at.desc())
    deals = session.exec(deals_query).all()

    deal_results = []
    for d in deals:
        project = session.get(Project, d.project_id)
        score = None
        if project:
            score = session.exec(
                select(ScoreSnapshot)
                .where(ScoreSnapshot.project_id == project.id)
                .order_by(ScoreSnapshot.created_at.desc())
            ).first()

        deal_results.append({
            "deal_id": d.id,
            "project_name": project.name if project else f"Project #{d.project_id}",
            "sector": project.sector if project else None,
            "status": d.status,
            "amount": d.amount,
            "score": score.total_score if score else None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        })

    investors = session.exec(select(LPInvestor)).all()
    total_committed = sum(i.committed_capital or 0 for i in investors)
    total_called = sum(i.called_capital or 0 for i in investors)

    calls = session.exec(
        select(CapitalCall).order_by(CapitalCall.created_at.desc())
    ).all()

    projects = session.exec(
        select(Project).where(Project.status.in_(["spinout", "active", "tier_1", "tier_2"]))
    ).all()

    portfolio_companies = []
    for p in projects:
        score = session.exec(
            select(ScoreSnapshot)
            .where(ScoreSnapshot.project_id == p.id)
            .order_by(ScoreSnapshot.created_at.desc())
        ).first()

        portfolio_companies.append({
            "id": p.id,
            "name": p.name,
            "sector": p.sector,
            "status": p.status,
            "score": score.total_score if score else None,
            "revenue": p.revenue,
            "users": p.users_count,
        })

    tvpi = round(total_committed / total_called, 2) if total_called > 0 else 0

    return {
        "role": "partner",
        "deals": deal_results,
        "total_deals": len(deal_results),
        "active_deals": sum(1 for d in deal_results if d["status"] in ["applied", "scored", "active"]),
        "fund_metrics": {
            "total_committed": total_committed,
            "total_called": total_called,
            "uncalled_capital": total_committed - total_called,
            "tvpi": tvpi,
            "portfolio_companies": len(portfolio_companies),
        },
        "capital_calls": [
            {
                "id": c.id,
                "amount": c.amount,
                "status": c.status,
                "due_date": str(c.due_date) if c.due_date else None,
                "paid_date": str(c.paid_date) if c.paid_date else None,
            }
            for c in calls[:20]
        ],
        "portfolio": portfolio_companies,
    }


def _admin_portfolio(session: Session):
    all_projects = session.exec(select(Project)).all()
    active = [p for p in all_projects if p.status in ("spinout", "active", "tier_1", "tier_2")]

    total_committed = session.exec(select(func.sum(LPInvestor.committed_capital))).first() or 0
    total_called = session.exec(select(func.sum(LPInvestor.called_capital))).first() or 0
    total_deals = session.exec(select(func.count(Deal.id))).first() or 0
    active_deals = session.exec(
        select(func.count(Deal.id)).where(Deal.status.in_(["applied", "scored", "active"]))
    ).first() or 0

    portfolio_data = []
    for p in active:
        score = session.exec(
            select(ScoreSnapshot)
            .where(ScoreSnapshot.project_id == p.id)
            .order_by(ScoreSnapshot.created_at.desc())
        ).first()

        burn_multiple = None
        if p.revenue and p.revenue > 0 and p.cost_to_mvp:
            burn_rate = p.cost_to_mvp / 12
            burn_multiple = round(burn_rate / p.revenue, 2)

        portfolio_data.append({
            "id": p.id,
            "name": p.name,
            "sector": p.sector,
            "status": p.status,
            "stage": p.stage,
            "score": score.total_score if score else None,
            "tier": score.tier if score else None,
            "revenue": p.revenue,
            "users": p.users_count,
            "burn_multiple": burn_multiple,
            "playbook_week": p.playbook_week,
        })

    return {
        "role": "admin",
        "overview": {
            "total_projects": len(all_projects),
            "active_projects": len(active),
            "total_deals": total_deals,
            "active_deals": active_deals,
            "total_committed": total_committed,
            "total_called": total_called,
        },
        "portfolio": portfolio_data,
    }


@router.get("/founder/{user_id}")
def get_founder_data(
    user_id: int,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    if current_user.role != UserRole.ADMIN and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="You can only access your own data")

    target = session.get(User, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role != UserRole.FOUNDER:
        raise HTTPException(status_code=400, detail="User is not a founder")

    return _founder_portfolio(target, session)

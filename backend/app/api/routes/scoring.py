from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Project, ScoreSnapshot, DealMemo, Founder, Deal, ActivityLog, User
from backend.app.schemas.scoring import ScoreRequest, GenerateMemoRequest
from backend.app.services.scoring import run_full_score, tier_label
from backend.app.services.ai_memo import generate_memo_with_ai
from backend.app.api.routes.auth import get_current_user
from backend.app.api.deps import require_role, ensure_founder_access
from datetime import datetime

router = APIRouter(prefix="/scoring", tags=["Scoring Engine"])

require_partner = require_role("partner")


@router.post("/score")
def score_startup(req: ScoreRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    result = run_full_score(req.model_dump())

    if req.project_id:
        project = session.get(Project, req.project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        # IDOR guard: founders may only score their own project; partner/admin can score any.
        ensure_founder_access(user, project.founder_id)

        snapshot = ScoreSnapshot(
            project_id=project.id,
            total_score=result["total_score"],
            tier=result["tier"],
            market_size=result["breakdown"]["market"]["size"],
            market_urgency=result["breakdown"]["market"]["urgency"],
            market_trend=result["breakdown"]["market"]["trend"],
            market_total=result["breakdown"]["market"]["total"],
            team_expertise=result["breakdown"]["team"]["expertise"],
            team_execution=result["breakdown"]["team"]["execution"],
            team_network=result["breakdown"]["team"]["network"],
            team_total=result["breakdown"]["team"]["total"],
            product_mvp_time=result["breakdown"]["product"]["mvp_time"],
            product_complexity=result["breakdown"]["product"]["complexity"],
            product_dependency=result["breakdown"]["product"]["dependency"],
            product_total=result["breakdown"]["product"]["total"],
            capital_cost_mvp=result["breakdown"]["capital"]["cost_mvp"],
            capital_time_revenue=result["breakdown"]["capital"]["time_revenue"],
            capital_burn_traction=result["breakdown"]["capital"]["burn_traction"],
            capital_total=result["breakdown"]["capital"]["total"],
            fit_alignment=result["breakdown"]["fit"]["alignment"],
            fit_synergy=result["breakdown"]["fit"]["synergy"],
            fit_total=result["breakdown"]["fit"]["total"],
            distribution_channels=result["breakdown"]["distribution"]["channels"],
            distribution_virality=result["breakdown"]["distribution"]["virality"],
            distribution_total=result["breakdown"]["distribution"]["total"],
            ai_adjustment=result["ai_adjustment"],
        )
        session.add(snapshot)

        if result["total_score"] >= 85:
            project.status = "tier_1"
        elif result["total_score"] >= 70:
            project.status = "tier_2"
        else:
            project.status = "rejected"
        project.updated_at = datetime.utcnow()
        session.add(project)
        session.commit()
        session.refresh(snapshot)
        result["snapshot_id"] = snapshot.id

    return result


@router.post("/score/{project_id}/deal-memo")
def generate_deal_memo(project_id: int, session: Session = Depends(get_session), user: User = Depends(require_partner)):
    # Memo creation is partner/admin only.
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    stmt = (
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == project_id)
        .order_by(ScoreSnapshot.created_at.desc())
    )
    snapshot = session.exec(stmt).first()
    if not snapshot:
        raise HTTPException(status_code=404, detail="No score found. Run scoring first.")

    founder = session.get(Founder, project.founder_id) if project.founder_id else None
    founder_name = founder.name if founder else "Unknown"

    decision = "INVEST / SPINOUT" if snapshot.tier == "TIER_1" else ("CONDITIONAL" if snapshot.tier == "TIER_2" else "PASS")

    memo = DealMemo(
        project_id=project.id,
        score_snapshot_id=snapshot.id,
        startup_name=project.name,
        founders=founder_name,
        sector=project.sector,
        stage=project.stage,
        total_score=snapshot.total_score,
        tier=snapshot.tier,
        problem=project.problem_statement,
        solution=project.solution,
        why_now=project.why_now,
        users=str(project.users_count) if project.users_count else None,
        revenue_info=str(project.revenue) if project.revenue else None,
        growth_signals=project.growth_signals,
        cost_to_mvp=str(project.cost_to_mvp) if project.cost_to_mvp else None,
        funding_needed=str(project.funding_needed) if project.funding_needed else None,
        use_of_funds=project.use_of_funds,
        decision=decision,
    )
    session.add(memo)
    session.commit()
    session.refresh(memo)

    return {
        "id": memo.id,
        "startup_name": memo.startup_name,
        "founders": memo.founders,
        "sector": memo.sector,
        "stage": memo.stage,
        "score": memo.total_score,
        "tier": memo.tier,
        "tier_label": tier_label(memo.tier),
        "problem": memo.problem,
        "solution": memo.solution,
        "why_now": memo.why_now,
        "traction": {
            "users": memo.users,
            "revenue": memo.revenue_info,
            "growth_signals": memo.growth_signals,
        },
        "economics": {
            "cost_to_mvp": memo.cost_to_mvp,
            "funding_needed": memo.funding_needed,
            "use_of_funds": memo.use_of_funds,
        },
        "axal_fit": {
            "strategic_alignment": memo.strategic_alignment,
            "partner_synergies": memo.partner_synergies,
        },
        "risks": memo.risks,
        "decision": memo.decision,
        "terms": {
            "amount": memo.terms_amount,
            "equity": memo.terms_equity,
            "structure": memo.terms_structure,
        },
    }


@router.get("/scores/{project_id}")
def get_project_scores(project_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    # IDOR guard: founders may only see their own project's scores.
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ensure_founder_access(user, project.founder_id)
    stmt = (
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == project_id)
        .order_by(ScoreSnapshot.created_at.desc())
    )
    snapshots = session.exec(stmt).all()
    return snapshots


@router.get("/deal-memos/{project_id}")
def get_deal_memos(project_id: int, session: Session = Depends(get_session), _: User = Depends(require_partner)):
    stmt = (
        select(DealMemo)
        .where(DealMemo.project_id == project_id)
        .order_by(DealMemo.created_at.desc())
    )
    memos = session.exec(stmt).all()
    return memos


@router.get("/queue")
def scoring_queue(session: Session = Depends(get_session), _: User = Depends(require_partner)):
    stmt = (
        select(Project)
        .where(Project.status.in_(["intake", "scoring"]))
        .order_by(Project.created_at.desc())
    )
    projects = session.exec(stmt).all()
    return projects


@router.post("/generateMemo")
def generate_memo_standalone(data: GenerateMemoRequest, session: Session = Depends(get_session), _: User = Depends(require_partner)):
    memo_input = {
        "startup_name": data.startup_name,
        "problem": data.problem,
        "solution": data.solution,
        "traction": data.traction,
        "sector": data.sector,
        "tam": data.tam or 0,
        "team_info": data.team_info,
        "funding_needed": data.funding_needed or 0,
        "use_of_funds": data.use_of_funds,
        "risks": data.risks,
    }

    result = generate_memo_with_ai(memo_input)

    return {
        "startup_name": data.startup_name,
        "ai_generated": result["ai_generated"],
        "memo": result["memo"],
    }

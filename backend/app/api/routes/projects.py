from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Project, Founder, ScoreSnapshot, Deal, ActivityLog, User
from backend.app.schemas.scoring import ProjectCreate, ProjectUpdate, FounderSubmitRequest
from backend.app.services.scoring import run_full_score
from backend.app.api.routes.auth import get_current_user
from datetime import datetime

router = APIRouter(prefix="/projects", tags=["Projects"])


@router.get("/")
def list_projects(status: str = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Project).order_by(Project.created_at.desc())
    if status:
        stmt = stmt.where(Project.status == status)
    return session.exec(stmt).all()


@router.get("/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    founder = session.get(Founder, project.founder_id) if project.founder_id else None
    return {**project.model_dump(), "founder": founder.model_dump() if founder else None}


@router.post("/")
def create_project(data: ProjectCreate, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    founder_id = None
    if data.founder_email:
        stmt = select(Founder).where(Founder.email == data.founder_email)
        founder = session.exec(stmt).first()
        if not founder:
            founder = Founder(
                name=data.founder_name or "Unknown",
                email=data.founder_email,
            )
            session.add(founder)
            session.commit()
            session.refresh(founder)
        founder_id = founder.id

    project = Project(
        name=data.name,
        description=data.description,
        sector=data.sector,
        stage=data.stage,
        founder_id=founder_id,
        problem_statement=data.problem_statement,
        solution=data.solution,
        why_now=data.why_now,
        tam=data.tam,
        sam=data.sam,
        cost_to_mvp=data.cost_to_mvp,
        funding_needed=data.funding_needed,
        use_of_funds=data.use_of_funds,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    deal = Deal(project_id=project.id, status="applied")
    session.add(deal)

    log = ActivityLog(
        project_id=project.id,
        action="project_created",
        details=f"Project '{project.name}' submitted",
    )
    session.add(log)
    session.commit()

    return project


@router.post("/submit")
def founder_submit_startup(data: FounderSubmitRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Founder).where(Founder.email == data.founder_email)
    founder = session.exec(stmt).first()
    if not founder:
        founder = Founder(
            name=data.founder_name,
            email=data.founder_email,
        )
        session.add(founder)
        session.commit()
        session.refresh(founder)

    project = Project(
        name=data.name,
        description=data.description,
        sector=data.sector,
        stage="idea",
        founder_id=founder.id,
        problem_statement=data.problem_statement,
        solution=data.solution,
        why_now=data.why_now,
        tam=data.tam,
        sam=data.sam,
        cost_to_mvp=data.cost_to_mvp,
        funding_needed=data.funding_needed,
        use_of_funds=data.use_of_funds,
    )
    session.add(project)
    session.commit()
    session.refresh(project)

    score_data = {
        "tam": data.tam or 0,
        "market_urgency": data.market_urgency,
        "market_trend": data.market_trend,
        "team_expertise": data.team_expertise,
        "team_execution": data.team_execution,
        "team_network": data.team_network,
        "mvp_time_days": data.mvp_time_days,
        "product_complexity": data.product_complexity,
        "product_dependencies": data.product_dependencies,
        "cost_to_mvp": data.cost_to_mvp or 100000,
        "time_to_revenue_months": data.time_to_revenue_months,
        "burn_risk": data.burn_risk,
        "fit_alignment": data.fit_alignment,
        "fit_synergy": data.fit_synergy,
        "distribution_channels": data.distribution_channels,
        "distribution_virality": data.distribution_virality,
    }

    result = run_full_score(score_data)

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
        ai_adjustment=0,
        scored_by="auto",
    )
    session.add(snapshot)

    if result["total_score"] >= 85:
        project.status = "tier_1"
        project.stage = "build"
        deal_status = "active"
    elif result["total_score"] >= 70:
        project.status = "tier_2"
        deal_status = "scored"
    else:
        project.status = "rejected"
        deal_status = "rejected"

    project.updated_at = datetime.utcnow()
    session.add(project)

    deal = Deal(project_id=project.id, status=deal_status)
    session.add(deal)

    log = ActivityLog(
        project_id=project.id,
        action="auto_scored",
        details=f"Score: {result['total_score']}, Tier: {result['tier']}, Status: {project.status}",
        actor="system",
    )
    session.add(log)

    session.commit()
    session.refresh(project)
    session.refresh(snapshot)

    return {
        "project": project,
        "score": result,
        "auto_decision": {
            "status": project.status,
            "stage": project.stage,
            "tier": result["tier"],
            "tier_label": result["tier_label"],
        },
    }


@router.put("/{project_id}")
def update_project(project_id: int, data: ProjectUpdate, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(project, key, val)
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    session.delete(project)
    session.commit()
    return {"ok": True}


@router.post("/{project_id}/advance-week")
def advance_playbook_week(project_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    order = ["week_1", "week_2", "week_3", "week_4", "complete"]
    current_idx = order.index(project.playbook_week) if project.playbook_week in order else 0
    if current_idx < len(order) - 1:
        project.playbook_week = order[current_idx + 1]
        project.updated_at = datetime.utcnow()
        session.add(project)
        session.commit()
        session.refresh(project)
    return project

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Project, Founder
from backend.app.schemas.scoring import ProjectCreate, ProjectUpdate
from datetime import datetime

router = APIRouter(prefix="/projects", tags=["Projects"])


@router.get("/")
def list_projects(status: str = None, session: Session = Depends(get_session)):
    stmt = select(Project).order_by(Project.created_at.desc())
    if status:
        stmt = stmt.where(Project.status == status)
    return session.exec(stmt).all()


@router.get("/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    founder = session.get(Founder, project.founder_id) if project.founder_id else None
    return {**project.model_dump(), "founder": founder.model_dump() if founder else None}


@router.post("/")
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
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
    return project


@router.put("/{project_id}")
def update_project(project_id: int, data: ProjectUpdate, session: Session = Depends(get_session)):
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
def delete_project(project_id: int, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    session.delete(project)
    session.commit()
    return {"ok": True}


@router.post("/{project_id}/advance-week")
def advance_playbook_week(project_id: int, session: Session = Depends(get_session)):
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

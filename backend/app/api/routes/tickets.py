from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Ticket
from backend.app.schemas.scoring import TicketCreate
from backend.app.services.github_service import create_github_issue
from datetime import datetime

router = APIRouter(prefix="/tickets", tags=["Support"])


@router.get("/")
def list_tickets(status: str = None, session: Session = Depends(get_session)):
    stmt = select(Ticket).order_by(Ticket.created_at.desc())
    if status:
        stmt = stmt.where(Ticket.status == status)
    return session.exec(stmt).all()


@router.post("/")
async def create_ticket(data: TicketCreate, session: Session = Depends(get_session)):
    ticket = Ticket(
        title=data.title,
        description=data.description,
        priority=data.priority,
        submitted_by=data.submitted_by,
        project_id=data.project_id,
    )
    session.add(ticket)
    session.commit()
    session.refresh(ticket)

    github_result = await create_github_issue(
        title=data.title,
        description=data.description,
        priority=data.priority,
        submitted_by=data.submitted_by,
    )

    response = ticket.model_dump() if hasattr(ticket, 'model_dump') else dict(ticket)
    if github_result:
        response["github_issue"] = github_result

    return response


@router.get("/{ticket_id}")
def get_ticket(ticket_id: int, session: Session = Depends(get_session)):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return ticket


@router.put("/{ticket_id}")
def update_ticket(ticket_id: int, status: str = None, assigned_to: str = None, session: Session = Depends(get_session)):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if status:
        ticket.status = status
    if assigned_to:
        ticket.assigned_to = assigned_to
    ticket.updated_at = datetime.utcnow()
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    return ticket

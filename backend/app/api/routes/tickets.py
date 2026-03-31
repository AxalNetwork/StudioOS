from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Ticket, User, UserRole
from backend.app.schemas.scoring import TicketCreate
from backend.app.api.routes.auth import get_current_user
from backend.app.services.github_service import create_github_issue
from datetime import datetime

router = APIRouter(prefix="/tickets", tags=["Support"])


@router.get("/")
def list_tickets(
    status: str = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    stmt = select(Ticket).order_by(Ticket.created_at.desc())

    if user.role != UserRole.ADMIN:
        stmt = stmt.where(Ticket.user_id == user.id)

    if status:
        stmt = stmt.where(Ticket.status == status)

    return session.exec(stmt).all()


@router.post("/")
async def create_ticket(
    data: TicketCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    ticket = Ticket(
        title=data.title,
        description=data.description,
        priority=data.priority,
        submitted_by=user.name or user.email,
        user_id=user.id,
        project_id=data.project_id,
    )
    session.add(ticket)
    session.commit()
    session.refresh(ticket)

    github_result = await create_github_issue(
        title=data.title,
        description=data.description,
        priority=data.priority,
        submitted_by=user.name or user.email,
    )

    response = ticket.model_dump() if hasattr(ticket, 'model_dump') else dict(ticket)
    if github_result:
        response["github_issue"] = github_result
        response["github_sync_status"] = "synced"
    else:
        response["github_sync_status"] = "failed"

    return response


@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if user.role != UserRole.ADMIN and ticket.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only view your own tickets")
    return ticket


@router.put("/{ticket_id}")
def update_ticket(
    ticket_id: int,
    status: str = None,
    assigned_to: str = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if user.role != UserRole.ADMIN and ticket.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only update your own tickets")
    if status:
        ticket.status = status
    if assigned_to:
        if user.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Only admins can assign tickets")
        ticket.assigned_to = assigned_to
    ticket.updated_at = datetime.utcnow()
    session.add(ticket)
    session.commit()
    session.refresh(ticket)
    return ticket

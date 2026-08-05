from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Ticket, User, UserRole
from backend.app.schemas.scoring import TicketCreate
from backend.app.api.routes.auth import get_current_user
from backend.app.services.github_service import create_github_issue
from datetime import datetime

router = APIRouter(prefix="/tickets", tags=["Support"])

_type_column_ensured = False


def _ensure_type_column(session: Session):
    """Task #9 dev parity — the prod Worker adds tickets.type at runtime;
    mirror that here so create_all-provisioned dev DBs pick it up without a
    migration (same in-route ensure pattern as brand.py)."""
    global _type_column_ensured
    if _type_column_ensured:
        return
    from sqlalchemy import text
    # Postgres path first; SQLite (no IF NOT EXISTS) falls back to a plain
    # ADD COLUMN whose duplicate-column error is the signal it already exists.
    for stmt in (
        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'task'",
        "ALTER TABLE tickets ADD COLUMN type TEXT DEFAULT 'task'",
    ):
        try:
            session.exec(text(stmt))
            session.commit()
            break
        except Exception:
            session.rollback()
    _type_column_ensured = True


@router.get("")
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


@router.post("")
@router.post("/")
async def create_ticket(
    data: TicketCreate,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_type_column(session)
    ticket = Ticket(
        title=data.title,
        description=data.description,
        priority=data.priority,
        type=data.type,
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
        session=session,
    )

    if github_result:
        # Persist the issue mirror so the webhook + pull-sync can match this
        # ticket back to its GitHub issue by number.
        ticket.github_issue_number = github_result.get("number")
        ticket.github_issue_url = github_result.get("url")
        session.add(ticket)
        session.commit()
        session.refresh(ticket)

    response = ticket.model_dump() if hasattr(ticket, 'model_dump') else dict(ticket)
    if github_result:
        response["github_issue"] = github_result
        response["github_sync_status"] = "synced"
    else:
        response["github_sync_status"] = "failed"

    return response


@router.post("/sync")
def sync_tickets(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Task #38 dev parity. The prod Worker pulls fresh issues from GitHub;
    the dev backend has no such sync, so we simply return the caller's
    current tickets. Declared before /{ticket_id} so POST /tickets/sync no
    longer 405s by matching the int path param."""
    stmt = select(Ticket).order_by(Ticket.created_at.desc())
    if user.role != UserRole.ADMIN:
        stmt = stmt.where(Ticket.user_id == user.id)
    tickets = session.exec(stmt).all()
    return {"tickets": tickets, "synced": 0}


@router.post("/{ticket_id}/comments")
def comment_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Task #9 dev parity — comments are GitHub-canonical and only the prod
    Worker can post them. Explicit dev stub (no silent success)."""
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if user.role != UserRole.ADMIN and ticket.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only comment on your own tickets")
    return {"ok": False, "github_sync_status": "dev-stub",
            "message": "Comments post to GitHub in production only."}


@router.get("/{ticket_id}/mapping")
def ticket_mapping(
    ticket_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Task #9 dev parity — mapping/debug endpoint (admin only)."""
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin only")
    ticket = session.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return {
        "ticket_id": ticket.id,
        "github_issue_number": ticket.github_issue_number,
        "github_issue_url": ticket.github_issue_url,
        "status": str(ticket.status),
        "priority": str(ticket.priority),
        "type": getattr(ticket, "type", "task"),
        "github_labels": [],
        "github_assignees": [],
        "last_sync_events": [],
    }


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

    # Phase 0.2 — notify ticket owner of any update by another actor.
    if ticket.user_id and ticket.user_id != user.id:
        try:
            from backend.app.services.notify import notify
            notify(
                user_id=ticket.user_id,
                type="ticket_update",
                title=f"Ticket updated: {ticket.title}",
                body=f"Status: {ticket.status}" + (f" · Assigned to {ticket.assigned_to}" if ticket.assigned_to else ""),
                link="/tickets",
                payload={"ticket_id": ticket.id, "status": str(ticket.status)},
                channels=("in_app", "email", "slack"),
            )
        except Exception:
            pass
    return ticket

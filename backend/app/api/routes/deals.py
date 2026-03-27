from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Deal, Project, Partner
from backend.app.schemas.scoring import DealCreate, DealUpdate
from datetime import datetime

router = APIRouter(prefix="/deals", tags=["Deal Flow"])


@router.get("/")
def list_deals(status: str = None, session: Session = Depends(get_session)):
    stmt = select(Deal).order_by(Deal.created_at.desc())
    if status:
        stmt = stmt.where(Deal.status == status)
    deals = session.exec(stmt).all()

    result = []
    for d in deals:
        project = session.get(Project, d.project_id)
        partner = session.get(Partner, d.partner_id) if d.partner_id else None
        result.append({
            **d.model_dump(),
            "project_name": project.name if project else None,
            "project_sector": project.sector if project else None,
            "partner_name": partner.name if partner else None,
        })
    return result


@router.post("/")
def create_deal(data: DealCreate, session: Session = Depends(get_session)):
    project = session.get(Project, data.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    deal = Deal(
        project_id=data.project_id,
        partner_id=data.partner_id,
        status=data.status,
        notes=data.notes,
        amount=data.amount,
    )
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return deal


@router.get("/{deal_id}")
def get_deal(deal_id: int, session: Session = Depends(get_session)):
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    project = session.get(Project, deal.project_id)
    partner = session.get(Partner, deal.partner_id) if deal.partner_id else None
    return {
        **deal.model_dump(),
        "project_name": project.name if project else None,
        "partner_name": partner.name if partner else None,
    }


@router.put("/{deal_id}")
def update_deal(deal_id: int, data: DealUpdate, session: Session = Depends(get_session)):
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, val in update_data.items():
        setattr(deal, key, val)
    deal.updated_at = datetime.utcnow()
    session.add(deal)
    session.commit()
    session.refresh(deal)
    return deal

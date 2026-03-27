from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Partner
from backend.app.schemas.scoring import PartnerCreate
import uuid

router = APIRouter(prefix="/partners", tags=["Partner Ecosystem"])


@router.get("/")
def list_partners(session: Session = Depends(get_session)):
    return session.exec(select(Partner).order_by(Partner.created_at.desc())).all()


@router.post("/")
def create_partner(data: PartnerCreate, session: Session = Depends(get_session)):
    partner = Partner(
        name=data.name,
        company=data.company,
        email=data.email,
        specialization=data.specialization,
        referral_code=f"AXAL-{uuid.uuid4().hex[:8].upper()}",
    )
    session.add(partner)
    session.commit()
    session.refresh(partner)
    return partner


@router.get("/{partner_id}")
def get_partner(partner_id: int, session: Session = Depends(get_session)):
    partner = session.get(Partner, partner_id)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    return partner


@router.get("/referral/{referral_code}")
def get_by_referral(referral_code: str, session: Session = Depends(get_session)):
    stmt = select(Partner).where(Partner.referral_code == referral_code)
    partner = session.exec(stmt).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Invalid referral code")
    return partner


@router.post("/referral/{referral_code}/use")
def use_referral(referral_code: str, session: Session = Depends(get_session)):
    stmt = select(Partner).where(Partner.referral_code == referral_code)
    partner = session.exec(stmt).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Invalid referral code")
    partner.referrals_count += 1
    session.add(partner)
    session.commit()
    session.refresh(partner)
    return {"message": "Referral tracked", "partner": partner}


@router.get("/matchmaking/recommend")
def recommend_partners(sector: str = None, session: Session = Depends(get_session)):
    stmt = select(Partner).where(Partner.status == "active")
    if sector:
        stmt = stmt.where(Partner.specialization.ilike(f"%{sector}%"))
    partners = session.exec(stmt).all()
    return {"matches": partners, "count": len(partners)}

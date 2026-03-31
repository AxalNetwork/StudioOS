from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Partner, User
from backend.app.schemas.scoring import PartnerCreate, MatchPartnersRequest
from backend.app.api.routes.auth import get_current_user
import uuid

router = APIRouter(prefix="/partners", tags=["Partner Ecosystem"])


@router.get("/")
def list_partners(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return session.exec(select(Partner).order_by(Partner.created_at.desc())).all()


@router.post("/")
def create_partner(data: PartnerCreate, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
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
def get_partner(partner_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    partner = session.get(Partner, partner_id)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    return partner


@router.get("/referral/{referral_code}")
def get_by_referral(referral_code: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Partner).where(Partner.referral_code == referral_code)
    partner = session.exec(stmt).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Invalid referral code")
    return partner


@router.post("/referral/{referral_code}/use")
def use_referral(referral_code: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
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
def recommend_partners(sector: str = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Partner).where(Partner.status == "active")
    if sector:
        stmt = stmt.where(Partner.specialization.ilike(f"%{sector}%"))
    partners = session.exec(stmt).all()
    return {"matches": partners, "count": len(partners)}


@router.post("/matchPartners")
def match_partners(data: MatchPartnersRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    sector = data.sector
    expertise_needed = data.expertise_needed
    startup_id = data.startup_id

    stmt = select(Partner).where(Partner.status == "active")
    partners = session.exec(stmt).all()

    ranked = []
    for p in partners:
        score = 0
        reasons = []

        if sector and p.specialization:
            spec_parts = [s.strip().lower() for s in p.specialization.replace("/", ",").split(",")]
            if sector.lower() in spec_parts or any(sector.lower() == part for part in spec_parts):
                score += 40
                reasons.append(f"Sector match: {p.specialization}")

        if expertise_needed and p.specialization:
            for keyword in expertise_needed.split(","):
                if keyword.strip().lower() in p.specialization.lower():
                    score += 20
                    reasons.append(f"Expertise match: {keyword.strip()}")

        if p.referrals_count > 0:
            score += min(p.referrals_count * 5, 20)
            reasons.append(f"Referral track record: {p.referrals_count} referrals")

        score += 10

        ranked.append({
            "partner_id": p.id,
            "name": p.name,
            "company": p.company,
            "specialization": p.specialization,
            "match_score": min(score, 100),
            "reasons": reasons,
            "referral_code": p.referral_code,
        })

    ranked.sort(key=lambda x: x["match_score"], reverse=True)

    return {
        "startup_id": startup_id,
        "matches": ranked,
        "total_matched": len(ranked),
    }

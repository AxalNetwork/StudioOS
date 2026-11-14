from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from backend.app.database import get_session
from backend.app.models.entities import Partner, User
from backend.app.schemas.scoring import PartnerCreate, MatchPartnersRequest
from backend.app.api.routes.auth import get_current_user
from backend.app.services.pii import mask_email
from backend.app.services.access_policy import can_view_personal_contact
import uuid

router = APIRouter(prefix="/partners", tags=["Partner Ecosystem"])


def _partner_dto(p: Partner, viewer: User) -> dict:
    """Serialise a partner with email masked unless the viewer is privileged
    (admin) or is the partner themselves."""
    data = p.model_dump()
    if not can_view_personal_contact(viewer, subject_partner_id=p.id):
        data["email"] = mask_email(data.get("email"))
    return data


@router.patch("/{partner_id}/accepting-intros")
def update_accepting_intros(partner_id: int, data: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    partner = session.get(Partner, partner_id)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    if not can_view_personal_contact(user, subject_partner_id=partner.id):
        raise HTTPException(status_code=403, detail="Not allowed")
    partner.accepting_intros = 1 if data.get("accepting_intros", True) in (1, True) else 0
    session.add(partner)
    session.commit()
    session.refresh(partner)
    return _partner_dto(partner, user)


@router.get("/")
def list_partners(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    rows = session.exec(select(Partner).order_by(Partner.created_at.desc())).all()
    return [_partner_dto(p, user) for p in rows]


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
    return _partner_dto(partner, user)


@router.get("/{partner_id}")
def get_partner(partner_id: int, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    partner = session.get(Partner, partner_id)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    return _partner_dto(partner, user)


@router.get("/referral/{referral_code}")
def get_by_referral(referral_code: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Partner).where(Partner.referral_code == referral_code)
    partner = session.exec(stmt).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Invalid referral code")
    return _partner_dto(partner, user)


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
    return {"message": "Referral tracked", "partner": _partner_dto(partner, user)}


@router.get("/matchmaking/recommend")
def recommend_partners(sector: str = None, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    stmt = select(Partner).where(Partner.status == "active").where(Partner.accepting_intros == 1)
    if sector:
        stmt = stmt.where(Partner.specialization.ilike(f"%{sector}%"))
    partners = session.exec(stmt).all()
    return {"matches": [_partner_dto(p, user) for p in partners], "count": len(partners)}


@router.post("/matchPartners")
def match_partners(data: MatchPartnersRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    sector = data.sector
    expertise_needed = data.expertise_needed
    startup_id = data.startup_id

    stmt = select(Partner).where(Partner.status == "active").where(Partner.accepting_intros == 1)
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


@router.post("/match")
def match_intent(data: MatchPartnersRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    """Task #15 — Intent-scoped partner matching.

    Weights: domain_fit 0.50, track_record 0.25, values_alignment 0.15,
    availability_capacity 0.10.
    """
    intent = data.intent or ""
    VALID_INTENTS = {
        "product", "engineering", "design", "gtm_sales",
        "marketing_brand", "finance_ops", "legal_compliance", "capital_network",
    }
    if intent not in VALID_INTENTS:
        raise HTTPException(status_code=400, detail="Invalid intent")

    stmt = select(Partner).where(Partner.status == "active").where(Partner.accepting_intros == 1)
    partners = session.exec(stmt).all()

    ranked = []
    for p in partners:
        reasons = []
        # domain_fit: keyword fallback (0-100)
        domain_score = 0
        if intent and p.specialization:
            intent_keywords = {
                "product": ["product"],
                "engineering": ["engineering", "technical"],
                "design": ["design"],
                "gtm_sales": ["gtm", "sales"],
                "marketing_brand": ["marketing", "brand"],
                "finance_ops": ["finance", "operations", "ops"],
                "legal_compliance": ["legal", "compliance"],
                "capital_network": ["fundraising", "recruiting", "capital"],
            }.get(intent, [intent])
            spec = p.specialization.lower()
            for kw in intent_keywords:
                if kw in spec:
                    domain_score = 60
                    reasons.append(f"Keyword match: {kw}")
                    break

        # track_record (0-100)
        track_score = min(p.referrals_count * 10, 40) + 20
        reasons.append(f"Track record: {p.referrals_count} referrals")

        # values_alignment (0-100) — placeholder; FastAPI dev path mirrors
        # the worker logic but skips the radar / values computation because
        # the dev DB may not have the full taxonomy seeded.
        values_score = 0

        # availability_capacity (0-100) — placeholder
        avail_score = 50

        overall = round(
            domain_score * 0.50 +
            track_score * 0.25 +
            values_score * 0.15 +
            avail_score * 0.10,
        )

        ranked.append({
            "partner_id": p.id,
            "name": p.name,
            "company": p.company,
            "specialization": p.specialization,
            "referral_code": p.referral_code,
            "match_score": overall,
            "breakdown": {
                "domain_fit": domain_score,
                "track_record": track_score,
                "values_alignment": values_score,
                "availability_capacity": avail_score,
            },
            "reasons": reasons,
        })

    ranked.sort(key=lambda x: x["match_score"], reverse=True)

    return {
        "intent": intent,
        "matches": ranked,
        "total_matched": len(ranked),
    }

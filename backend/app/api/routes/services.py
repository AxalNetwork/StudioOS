"""Task #51 — Service catalogue (productised partner offerings).

Founders can browse and book a partner's `ServiceOffering` directly —
this short-circuits the needs/quote loop with a known-price, known-SLA
package. Booking materialises an `Engagement` in the new lifecycle's
`accepted` state.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field as PydField
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.api.routes.marketplace import VALID_CATEGORIES
from backend.app.database import get_session
from backend.app.models.entities import (
    ActivityLog,
    Engagement,
    Founder,
    Partner,
    Project,
    ServiceOffering,
    User,
    UserRole,
)

router = APIRouter(prefix="/services", tags=["Service Catalogue"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _is_admin(u: User) -> bool:
    return u.role == UserRole.ADMIN


def _partner_for_user(session: Session, user: User) -> Partner | None:
    if user.partner_id:
        return session.get(Partner, user.partner_id)
    return None


def _offering_dto(o: ServiceOffering, partner: Partner | None) -> dict:
    return {
        "id": o.id,
        "uid": o.uid,
        "partner_id": o.partner_id,
        "partner_name": partner.name if partner else None,
        "partner_company": partner.company if partner else None,
        "partner_listed": bool(partner.listed) if partner else False,
        "partner_kyb_status": partner.kyb_status if partner else None,
        "title": o.title,
        "description": o.description,
        "deliverables": o.deliverables,
        "category": o.category,
        "price": o.price,
        "currency": o.currency,
        "sla_days": o.sla_days,
        "listed": bool(o.listed),
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "updated_at": o.updated_at.isoformat() if o.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Pydantic input models
# ---------------------------------------------------------------------------
class OfferingIn(BaseModel):
    title: str = PydField(min_length=3, max_length=200)
    description: str = PydField(min_length=1)
    deliverables: str = PydField(min_length=1)
    category: str
    price: float = PydField(ge=0)
    currency: str = PydField(default="usd", min_length=3, max_length=8)
    sla_days: Optional[int] = PydField(default=None, ge=1, le=365)
    listed: bool = True


class OfferingPatch(BaseModel):
    title: Optional[str] = PydField(default=None, min_length=3, max_length=200)
    description: Optional[str] = None
    deliverables: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = PydField(default=None, ge=0)
    currency: Optional[str] = PydField(default=None, min_length=3, max_length=8)
    sla_days: Optional[int] = PydField(default=None, ge=1, le=365)
    listed: Optional[bool] = None


class EngageIn(BaseModel):
    project_id: int
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Browse / read
# ---------------------------------------------------------------------------
@router.get("/offerings")
def list_offerings(
    category: Optional[str] = Query(default=None),
    partner_id: Optional[int] = Query(default=None),
    listed_only: bool = Query(default=True),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    stmt = select(ServiceOffering).order_by(ServiceOffering.created_at.desc())
    if category:
        if category not in VALID_CATEGORIES:
            raise HTTPException(status_code=400, detail=f"unknown category {category}")
        stmt = stmt.where(ServiceOffering.category == category)
    if partner_id:
        stmt = stmt.where(ServiceOffering.partner_id == partner_id)
    # Non-admins only see listed offerings unless they own them.
    own_partner_id = user.partner_id if user.role == UserRole.PARTNER else None
    if listed_only and not _is_admin(user):
        if own_partner_id:
            from sqlalchemy import or_
            stmt = stmt.where(or_(
                ServiceOffering.listed == True,  # noqa: E712
                ServiceOffering.partner_id == own_partner_id,
            ))
        else:
            stmt = stmt.where(ServiceOffering.listed == True)  # noqa: E712
    rows = session.exec(stmt).all()
    out = []
    for o in rows:
        p = session.get(Partner, o.partner_id)
        out.append(_offering_dto(o, p))
    return {"offerings": out}


@router.get("/offerings/{offering_id}")
def get_offering(
    offering_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    o = session.get(ServiceOffering, offering_id)
    if not o:
        raise HTTPException(status_code=404, detail="Offering not found")
    p = session.get(Partner, o.partner_id)
    own = user.role == UserRole.PARTNER and user.partner_id == o.partner_id
    if not o.listed and not (_is_admin(user) or own):
        raise HTTPException(status_code=404, detail="Offering not found")
    return _offering_dto(o, p)


@router.get("/partners/{partner_id}/offerings")
def list_partner_offerings(
    partner_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    p = session.get(Partner, partner_id)
    if not p:
        raise HTTPException(status_code=404, detail="Partner not found")
    own = user.role == UserRole.PARTNER and user.partner_id == partner_id
    stmt = select(ServiceOffering).where(ServiceOffering.partner_id == partner_id)
    if not (_is_admin(user) or own):
        stmt = stmt.where(ServiceOffering.listed == True)  # noqa: E712
    rows = session.exec(stmt.order_by(ServiceOffering.created_at.desc())).all()
    return {"offerings": [_offering_dto(o, p) for o in rows]}


# ---------------------------------------------------------------------------
# Write — partner-only on own offerings
# ---------------------------------------------------------------------------
@router.post("/offerings", status_code=201)
def create_offering(
    body: OfferingIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    partner = _partner_for_user(session, user)
    if not partner:
        raise HTTPException(status_code=403, detail="Only partner accounts may publish offerings")
    if body.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"unknown category {body.category}")
    o = ServiceOffering(
        partner_id=partner.id,
        title=body.title.strip(),
        description=body.description.strip(),
        deliverables=body.deliverables.strip(),
        category=body.category,
        price=float(body.price),
        currency=body.currency.lower(),
        sla_days=body.sla_days,
        listed=bool(body.listed),
    )
    session.add(o)
    session.add(ActivityLog(
        action="offering_created", actor=user.email, user_id=user.id,
        details=f"offering={o.uid} partner={partner.id} category={o.category} price={o.price}",
    ))
    session.commit()
    session.refresh(o)
    return _offering_dto(o, partner)


@router.put("/offerings/{offering_id}")
def update_offering(
    offering_id: int,
    body: OfferingPatch,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    o = session.get(ServiceOffering, offering_id)
    if not o:
        raise HTTPException(status_code=404, detail="Offering not found")
    partner = session.get(Partner, o.partner_id)
    own = user.role == UserRole.PARTNER and user.partner_id == o.partner_id
    if not (_is_admin(user) or own):
        raise HTTPException(status_code=403, detail="You may only edit your own offerings")
    if body.category is not None:
        if body.category not in VALID_CATEGORIES:
            raise HTTPException(status_code=400, detail=f"unknown category {body.category}")
        o.category = body.category
    for attr in ("title", "description", "deliverables", "sla_days", "listed"):
        v = getattr(body, attr)
        if v is not None:
            setattr(o, attr, v.strip() if isinstance(v, str) else v)
    if body.price is not None:
        o.price = float(body.price)
    if body.currency is not None:
        o.currency = body.currency.lower()
    o.updated_at = datetime.utcnow()
    session.add(o)
    session.commit()
    session.refresh(o)
    return _offering_dto(o, partner)


@router.delete("/offerings/{offering_id}", status_code=204)
def delete_offering(
    offering_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    o = session.get(ServiceOffering, offering_id)
    if not o:
        raise HTTPException(status_code=404, detail="Offering not found")
    own = user.role == UserRole.PARTNER and user.partner_id == o.partner_id
    if not (_is_admin(user) or own):
        raise HTTPException(status_code=403, detail="You may only delete your own offerings")
    # Soft-delete by unlisting if any engagement references it; hard-delete otherwise.
    in_use = session.exec(
        select(Engagement).where(Engagement.service_offering_id == offering_id).limit(1)
    ).first()
    if in_use:
        o.listed = False
        o.updated_at = datetime.utcnow()
        session.add(o)
    else:
        session.delete(o)
    session.commit()
    return None


# ---------------------------------------------------------------------------
# Engage — founder books an offering directly (skips needs/quotes loop)
# ---------------------------------------------------------------------------
@router.post("/offerings/{offering_id}/engage", status_code=201)
def engage_offering(
    offering_id: int,
    body: EngageIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if user.role != UserRole.FOUNDER or not user.founder_id:
        raise HTTPException(status_code=403, detail="Only founders may book an offering")
    o = session.get(ServiceOffering, offering_id)
    if not o or not o.listed:
        raise HTTPException(status_code=404, detail="Offering not available")
    partner = session.get(Partner, o.partner_id)
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Project ownership: founder MUST own the project. Strict check —
    # a missing/null founder_id on the project is treated as forbidden,
    # not as a free pass (would otherwise allow IDOR-style booking
    # against unowned projects).
    project_founder_id = getattr(project, "founder_id", None)
    if not project_founder_id or project_founder_id != user.founder_id:
        raise HTTPException(status_code=403, detail="You do not own this project")

    now = datetime.utcnow()
    notes_suffix = f"\n\nFounder notes: {body.notes.strip()}" if (body.notes and body.notes.strip()) else ""
    eng = Engagement(
        quote_id=None,
        need_id=None,
        service_offering_id=o.id,
        project_id=project.id,
        founder_id=user.founder_id,
        partner_id=partner.id,
        price=o.price,
        currency=o.currency,
        deliverables=(o.deliverables + notes_suffix),
        timeline_weeks=None,
        sla_days=o.sla_days,
        status="accepted",
        accepted_at=now,
    )
    session.add(eng)
    session.add(ActivityLog(
        action="offering_engaged", project_id=project.id, actor=user.email, user_id=user.id,
        details=f"offering={o.uid} partner={partner.id} price={o.price}",
    ))
    session.commit()
    session.refresh(eng)
    return {
        "engagement_id": eng.id,
        "engagement_uid": eng.uid,
        "status": eng.status,
        "offering": _offering_dto(o, partner),
    }

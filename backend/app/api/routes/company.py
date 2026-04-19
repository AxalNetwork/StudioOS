"""Company Profile System — backend API.

Endpoints for the dedicated Company profile (Task 1 of the Growth & Expansion
Track). A company is a many-to-many object linked to users via the
`user_company_links` junction table, with one `is_primary_admin=True` owner
plus optional Founder / Admin / Advisor / Member rows.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.app.database import get_session
from backend.app.models.entities import (
    User, UserRole, CompanyProfile, UserCompanyLink,
)
from backend.app.api.routes.auth import get_current_user

router = APIRouter(tags=["Company Profiles"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class CompanyCreate(BaseModel):
    company_name: str
    stage: Optional[str] = None
    revenue_range: Optional[str] = None
    employee_count: Optional[int] = None
    current_products: Optional[str] = None
    international_presence: Optional[str] = None
    expansion_goals: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None
    linkedin_url: Optional[str] = None
    description: Optional[str] = None


class CompanyUpdate(BaseModel):
    company_name: Optional[str] = None
    stage: Optional[str] = None
    revenue_range: Optional[str] = None
    employee_count: Optional[int] = None
    current_products: Optional[str] = None
    international_presence: Optional[str] = None
    expansion_goals: Optional[str] = None
    logo_url: Optional[str] = None
    website: Optional[str] = None
    linkedin_url: Optional[str] = None
    description: Optional[str] = None


class MemberCreate(BaseModel):
    user_id: Optional[int] = None
    email: Optional[str] = None
    role_in_company: str = "Member"
    is_primary_admin: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _is_admin(user: User) -> bool:
    return user.role == UserRole.ADMIN


def _get_company_or_404(session: Session, uid: str) -> CompanyProfile:
    company = session.exec(select(CompanyProfile).where(CompanyProfile.uid == uid)).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


def _get_link(session: Session, company_id: int, user_id: int) -> Optional[UserCompanyLink]:
    return session.exec(
        select(UserCompanyLink).where(
            UserCompanyLink.company_id == company_id,
            UserCompanyLink.user_id == user_id,
        )
    ).first()


def _can_edit(session: Session, company: CompanyProfile, user: User) -> bool:
    """Owner (primary admin) or Admin role in company, or platform admin."""
    if _is_admin(user):
        return True
    link = _get_link(session, company.id, user.id)
    if not link:
        return False
    return link.is_primary_admin or link.role_in_company in ("Owner", "Admin", "Founder")


def _company_dto(session: Session, company: CompanyProfile, *, include_members: bool = False) -> dict:
    out = {
        "id": company.id,
        "uid": company.uid,
        "company_name": company.company_name,
        "stage": company.stage,
        "revenue_range": company.revenue_range,
        "employee_count": company.employee_count,
        "current_products": company.current_products,
        "international_presence": company.international_presence,
        "expansion_goals": company.expansion_goals,
        "logo_url": company.logo_url,
        "website": company.website,
        "linkedin_url": company.linkedin_url,
        "description": company.description,
        "created_at": company.created_at.isoformat() if company.created_at else None,
        "updated_at": company.updated_at.isoformat() if company.updated_at else None,
    }
    if include_members:
        links = session.exec(
            select(UserCompanyLink).where(UserCompanyLink.company_id == company.id)
        ).all()
        members = []
        for lnk in links:
            u = session.get(User, lnk.user_id)
            if not u:
                continue
            members.append({
                "user_id": u.id,
                "name": u.name,
                "email": u.email,
                "role_in_company": lnk.role_in_company,
                "is_primary_admin": lnk.is_primary_admin,
                "joined_at": lnk.created_at.isoformat() if lnk.created_at else None,
            })
        out["members"] = members
        out["member_count"] = len(members)
    return out


# ---------------------------------------------------------------------------
# /api/company/me — what the current user belongs to
# ---------------------------------------------------------------------------
@router.get("/company/me")
def my_company(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Returns the company the current user is linked to (any role).
    Returns null when the user has no company yet."""
    link = session.exec(
        select(UserCompanyLink)
        .where(UserCompanyLink.user_id == user.id)
        .order_by(UserCompanyLink.is_primary_admin.desc(), UserCompanyLink.created_at.asc())
    ).first()
    if not link:
        return None
    company = session.get(CompanyProfile, link.company_id)
    if not company:
        return None
    return {
        **_company_dto(session, company, include_members=True),
        "my_role": link.role_in_company,
        "is_primary_admin": link.is_primary_admin,
    }


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------
@router.post("/company/create")
def create_company(
    data: CompanyCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    from backend.app.services.audit import log_audit, AuditAction
    company = CompanyProfile(**data.model_dump())
    session.add(company)
    # Flush so company.id / company.uid are populated without committing.
    # Keeping the company row, primary-admin link, and audit insert in one
    # transaction means we can never end up with a company that has no
    # `company.created` audit trail.
    session.flush()

    # Caller becomes primary admin
    link = UserCompanyLink(
        company_id=company.id,
        user_id=user.id,
        role_in_company="Admin",
        is_primary_admin=True,
    )
    session.add(link)
    log_audit(
        session,
        action=AuditAction.COMPANY_CREATED,
        actor=user,
        target_uid=company.uid,
        summary=f"{user.email} created company '{company.company_name}'",
        meta={"stage": company.stage, "primary_admin_user_id": user.id},
    )
    session.commit()
    session.refresh(company)

    return _company_dto(session, company, include_members=True)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------
@router.patch("/company/{uid}")
def update_company(
    uid: str,
    data: CompanyUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    company = _get_company_or_404(session, uid)
    if not _can_edit(session, company, user):
        raise HTTPException(status_code=403, detail="Not authorized to edit this company")

    from backend.app.services.audit import log_audit, AuditAction
    payload = data.model_dump(exclude_unset=True)
    # Capture the changed-fields list for the audit trail (values themselves
    # may contain sensitive data, so we only record which keys changed).
    changed_keys = sorted(payload.keys())
    for k, v in payload.items():
        setattr(company, k, v)
    company.updated_at = datetime.utcnow()
    session.add(company)
    log_audit(
        session,
        action=AuditAction.COMPANY_UPDATED,
        actor=user,
        target_uid=company.uid,
        summary=f"{user.email} updated company '{company.company_name}' ({len(changed_keys)} field(s))",
        meta={"changed_fields": changed_keys},
    )
    session.commit()
    session.refresh(company)
    return _company_dto(session, company, include_members=True)


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------
@router.get("/company/{uid}")
def get_company(
    uid: str,
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    company = _get_company_or_404(session, uid)
    return _company_dto(session, company, include_members=True)


# ---------------------------------------------------------------------------
# List (basis for matching/market-intel in Tasks 3 & 4)
# ---------------------------------------------------------------------------
@router.get("/companies")
def list_companies(
    stage: Optional[str] = None,
    revenue_range: Optional[str] = None,
    q: Optional[str] = Query(None, description="Search company_name / description"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    _: User = Depends(get_current_user),
):
    stmt = select(CompanyProfile).order_by(CompanyProfile.created_at.desc())
    if stage:
        stmt = stmt.where(CompanyProfile.stage == stage)
    if revenue_range:
        stmt = stmt.where(CompanyProfile.revenue_range == revenue_range)
    rows = session.exec(stmt).all()

    if q:
        needle = q.lower()
        rows = [
            r for r in rows
            if (r.company_name or "").lower().find(needle) >= 0
            or (r.description or "").lower().find(needle) >= 0
        ]

    total = len(rows)
    items = [_company_dto(session, r) for r in rows[offset: offset + limit]]
    return {"total": total, "limit": limit, "offset": offset, "items": items}


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------
@router.post("/company/{uid}/members")
def add_member(
    uid: str,
    data: MemberCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    company = _get_company_or_404(session, uid)
    if not _can_edit(session, company, user):
        raise HTTPException(status_code=403, detail="Not authorized to manage members")

    target: Optional[User] = None
    if data.user_id:
        target = session.get(User, data.user_id)
    elif data.email:
        target = session.exec(select(User).where(User.email == data.email)).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found (provide user_id or registered email)")

    if _get_link(session, company.id, target.id):
        raise HTTPException(status_code=409, detail="User is already a member of this company")

    # Only the existing primary admin (or platform admin) may transfer primary status
    if data.is_primary_admin and not _is_admin(user):
        my_link = _get_link(session, company.id, user.id)
        if not (my_link and my_link.is_primary_admin):
            raise HTTPException(status_code=403, detail="Only the primary admin can grant primary admin status")

    from backend.app.services.audit import log_audit, AuditAction
    link = UserCompanyLink(
        company_id=company.id,
        user_id=target.id,
        role_in_company=data.role_in_company,
        is_primary_admin=data.is_primary_admin,
    )
    session.add(link)
    log_audit(
        session,
        action=AuditAction.COMPANY_MEMBER_ADDED,
        actor=user,
        target_uid=company.uid,
        summary=f"{user.email} added {target.email} to '{company.company_name}' as {data.role_in_company}",
        meta={
            "member_user_id": target.id,
            "member_uid": target.uid,
            "role_in_company": data.role_in_company,
            "is_primary_admin": bool(data.is_primary_admin),
        },
    )
    session.commit()
    return _company_dto(session, company, include_members=True)


@router.delete("/company/{uid}/members/{user_id}")
def remove_member(
    uid: str,
    user_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    company = _get_company_or_404(session, uid)
    if not _can_edit(session, company, user):
        raise HTTPException(status_code=403, detail="Not authorized to manage members")

    link = _get_link(session, company.id, user_id)
    if not link:
        raise HTTPException(status_code=404, detail="Member not found on this company")

    # Refuse to remove the last primary admin
    if link.is_primary_admin:
        primary_count = len(session.exec(
            select(UserCompanyLink).where(
                UserCompanyLink.company_id == company.id,
                UserCompanyLink.is_primary_admin == True,  # noqa: E712
            )
        ).all())
        if primary_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the only primary admin — assign another first")

    from backend.app.services.audit import log_audit, AuditAction
    target_user = session.get(User, user_id)
    target_email = target_user.email if target_user else f"user#{user_id}"
    target_uid_str = target_user.uid if target_user else None
    session.delete(link)
    log_audit(
        session,
        action=AuditAction.COMPANY_MEMBER_REMOVED,
        actor=user,
        target_uid=company.uid,
        summary=f"{user.email} removed {target_email} from '{company.company_name}'",
        meta={
            "member_user_id": user_id,
            "member_uid": target_uid_str,
            "role_in_company": link.role_in_company,
            "was_primary_admin": bool(link.is_primary_admin),
        },
    )
    session.commit()
    return {"ok": True}

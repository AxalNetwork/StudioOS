"""Company Profile System — backend API.

Endpoints for the dedicated Company profile (Task 1 of the Growth & Expansion
Track). A company is a many-to-many object linked to users via the
`user_company_links` junction table, with one `is_primary_admin=True` owner
plus optional Founder / Admin / Advisor / Member rows.
"""

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, func, select

from backend.app.database import get_session
from backend.app.models.entities import (
    User, UserRole, CompanyProfile, UserCompanyLink,
)
from backend.app.api.routes.auth import get_current_user
from backend.app.services.company_fields import GENERAL_FIELDS, validate_company_fields

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


def _can_write(session: Session, company: CompanyProfile, user: User) -> bool:
    """D4960/D4962 — who may WRITE: a seat that is primary admin, Owner, Admin or Founder.

    A platform admin reads every company and writes only through a seat they hold, as the Worker's
    `companyWriteDenial` does. `_can_edit` (which passes any admin) stays for what an admin may read."""
    link = _get_link(session, company.id, user.id)
    if not link:
        return False
    return bool(link.is_primary_admin) or link.role_in_company in ("Owner", "Admin", "Founder")


def _viewer_capability(session: Session, company: CompanyProfile, viewer: User) -> dict:
    """What the server will accept from this viewer (the Worker's `viewer`); there are no support sessions here."""
    link = _get_link(session, company.id, viewer.id)
    can_edit = _can_write(session, company, viewer)
    if can_edit:
        reason = None
    elif _is_admin(viewer) and not link:
        reason = "hq_access"
    else:
        reason = "not_an_editor"
    return {"member": link is not None, "can_edit": can_edit, "read_only": not can_edit, "read_only_reason": reason}


# ---------------------------------------------------------------------------
# Response shapes (Security Item #5: separate public-vs-private DTOs)
#
# Three layers of detail, picked based on the viewer's relationship to the
# company:
#
#   _company_summary_dto(c, member_count)
#       Public-list shape. Returned to ANY authenticated user from
#       `/api/companies`. Strips business-sensitive fields like
#       `revenue_range`, `employee_count`, `current_products`, and
#       `expansion_goals` — those belong only on the owner-detail view
#       (otherwise they're competitive intel exposed to every signed-in user).
#
#   _company_detail_dto(session, c, viewer)
#       Full-detail shape. Returns every business field. A member's email is
#       served to that member only (D4962, as the Worker does), and the route
#       answers 404 to anyone who is not a member, so a UID lookup scrapes
#       nothing.
#
# A single `_company_dto(... include_members=...)` previously served all
# routes; that mixed concerns and over-shared. This module replaces it.
# ---------------------------------------------------------------------------
_PUBLIC_FIELDS = (
    "id", "uid", "company_name", "stage",
    "logo_url", "website", "linkedin_url", "description",
    "international_presence",
)
_PRIVATE_FIELDS = (
    "revenue_range", "employee_count",
    "current_products", "expansion_goals",
)


def _viewer_is_company_member(session: Session, company: CompanyProfile, viewer: User) -> bool:
    """Predicate used to decide if member PII may be unmasked in a detail
    response. Thin wrapper around the central access-policy rule
    (`can_view_company_member_list`) — kept here for call-site clarity.
    Platform admins always pass."""
    from backend.app.services.access_policy import can_view_company_member_list
    return can_view_company_member_list(viewer, company, session)


def _member_count(session: Session, company_id: int) -> int:
    return session.exec(
        select(func.count()).select_from(UserCompanyLink).where(UserCompanyLink.company_id == company_id)
    ).first() or 0


def _company_summary_dto(session: Session, company: CompanyProfile) -> dict:
    """Safe shape for list endpoints. NO business-sensitive fields, NO
    member emails. Aggregate counts only."""
    out = {f: getattr(company, f) for f in _PUBLIC_FIELDS}
    out["member_count"] = _member_count(session, company.id)
    out["created_at"] = company.created_at.isoformat() if company.created_at else None
    return out


def _company_detail_dto(session: Session, company: CompanyProfile, viewer: User) -> dict:
    """Owner / admin / member detail shape. Includes private business
    fields and the member roster. Co-member emails are masked unless the
    viewer is a member or platform admin."""
    out = {f: getattr(company, f) for f in _PUBLIC_FIELDS}
    for f in _PRIVATE_FIELDS:
        out[f] = getattr(company, f)
    out["created_at"] = company.created_at.isoformat() if company.created_at else None
    out["updated_at"] = company.updated_at.isoformat() if company.updated_at else None

    is_member = _viewer_is_company_member(session, company, viewer)
    # #4964: one joined read for the roster, not a user lookup per member
    # (the Worker's detailDto does the same; dev parity only).
    rows = session.exec(
        select(UserCompanyLink, User)
        .join(User, User.id == UserCompanyLink.user_id)
        .where(UserCompanyLink.company_id == company.id)
        .order_by(UserCompanyLink.id)
    ).all()
    members = []
    for lnk, u in rows:
        if not u:
            continue
        # D4962: a member's email goes to that member only, as the Worker serves it. Another member's
        # address is absent, not masked: the roster names people, it is not a contact list.
        # #4964: the link and the account come from one join.
        entry = {
            "user_id": u.id,
            "name": u.name,
            "role_in_company": lnk.role_in_company,
            "is_primary_admin": lnk.is_primary_admin,
            "joined_at": lnk.created_at.isoformat() if lnk.created_at else None,
        }
        if u.id == viewer.id:
            entry["email"] = u.email
        members.append(entry)
    out["members"] = members
    out["member_count"] = len(members)
    out["viewer_is_member"] = is_member
    out["viewer"] = _viewer_capability(session, company, viewer)
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
        **_company_detail_dto(session, company, viewer=user),
        "my_role": link.role_in_company,
        "is_primary_admin": link.is_primary_admin,
    }


# ---------------------------------------------------------------------------
# /api/company/memberships — all companies the current user belongs to
# ---------------------------------------------------------------------------
@router.get("/company/memberships")
def my_memberships(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Returns ALL companies the current user is linked to (any role),
    ordered by primary-admin status first, then creation time.
    Returns an empty list when the user has no company memberships."""
    links = session.exec(
        select(UserCompanyLink)
        .where(UserCompanyLink.user_id == user.id)
        .order_by(UserCompanyLink.is_primary_admin.desc(), UserCompanyLink.created_at.asc())
    ).all()
    result = []
    for link in links:
        company = session.get(CompanyProfile, link.company_id)
        if not company:
            continue
        result.append({
            **_company_detail_dto(session, company, viewer=user),
            "my_role": link.role_in_company,
            "is_primary_admin": link.is_primary_admin,
        })
    return result


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------
@router.post("/company/create")
def create_company(
    body: Any = Body(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    from backend.app.services.audit import log_audit, AuditAction
    if not isinstance(body, dict):
        return JSONResponse(status_code=400, content={
            "code": "body_invalid", "field": "", "detail": "Send the fields as a JSON object.",
        })
    name = str(body.get("company_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="company_name required")
    if len(name) > 200:
        raise HTTPException(status_code=400, detail="Company names must be at most 200 characters.")
    # D4962: the Worker's contract for the General fields; the dev backend has no default_currency column.
    general = {k: v for k, v in body.items() if k in GENERAL_FIELDS and k not in ("company_name", "default_currency")}
    if "logo_url" in body:
        general["logo_url"] = body["logo_url"]
    values, error = validate_company_fields(general, [f for f in GENERAL_FIELDS if f not in ("company_name", "default_currency")])
    if error:
        return JSONResponse(status_code=400, content=error)
    company = CompanyProfile(company_name=name, **values)
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

    return _company_detail_dto(session, company, viewer=user)


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------
@router.patch("/company/{uid}")
def update_company(
    uid: str,
    body: Any = Body(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    company = _get_company_or_404(session, uid)
    if not _can_write(session, company, user):
        if _is_admin(user) and not _get_link(session, company.id, user.id):
            return JSONResponse(status_code=403, content={
                "code": "company_read_only", "reason": "hq_access",
                "detail": "HQ reads this company. Its members make the changes here.",
            })
        raise HTTPException(status_code=403, detail="Not authorized to edit this company")

    if not isinstance(body, dict):
        return JSONResponse(status_code=400, content={
            "code": "body_invalid", "field": "", "detail": "Send the fields as a JSON object.",
        })

    from backend.app.services.audit import log_audit, AuditAction
    # D4962: the Worker's contract; an unknown field, a logo link, a bad stage or head count is refused, not stored.
    fields = [f for f in GENERAL_FIELDS if f != "default_currency"]
    if "company_name" in body:
        new_name = body["company_name"].strip() if isinstance(body["company_name"], str) else ""
        if not new_name or len(new_name) > 200:
            return JSONResponse(status_code=400, content={
                "code": "invalid_company_name", "field": "company_name",
                "detail": "Enter a company name between 1 and 200 characters.",
            })
    values, error = validate_company_fields(body, fields)
    if error:
        return JSONResponse(status_code=400, content=error)
    payload = dict(values)
    if "company_name" in body:
        payload["company_name"] = new_name
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
    return _company_detail_dto(session, company, viewer=user)


# ---------------------------------------------------------------------------
# Detail
# ---------------------------------------------------------------------------
@router.get("/company/{uid}")
def get_company(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    company = _get_company_or_404(session, uid)
    # D4962: companies are private workspaces, as the Worker serves them. A member (or a platform admin)
    # gets the detail; anyone else gets 404, the same answer as an unknown uid, so the route does not
    # confirm that a company exists. (It used to hand a stranger the summary.)
    if not _viewer_is_company_member(session, company, user):
        raise HTTPException(status_code=404, detail="Company not found")
    return _company_detail_dto(session, company, viewer=user)


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
    user: User = Depends(get_current_user),
):
    stmt = select(CompanyProfile).order_by(CompanyProfile.created_at.desc())
    if stage:
        stmt = stmt.where(CompanyProfile.stage == stage)
    # Side-channel guard: even though `_company_summary_dto` strips
    # `revenue_range` from the response, *filtering* by it would let any
    # authenticated user binary-search the value of any company's hidden
    # bucket (issue: just probe `?company_name=...&revenue_range=...` and
    # observe presence/absence in results). Restrict the filter itself to
    # platform admins.
    if revenue_range:
        if not _is_admin(user):
            raise HTTPException(
                status_code=403,
                detail="Filtering by revenue_range is restricted to administrators",
            )
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
    items = [_company_summary_dto(session, r) for r in rows[offset: offset + limit]]
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
    if not _can_write(session, company, user):
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
    return _company_detail_dto(session, company, viewer=user)


@router.delete("/company/{uid}/members/{user_id}")
def remove_member(
    uid: str,
    user_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    company = _get_company_or_404(session, uid)
    if not _can_write(session, company, user):
        raise HTTPException(status_code=403, detail="Not authorized to manage members")

    link = _get_link(session, company.id, user_id)
    if not link:
        raise HTTPException(status_code=404, detail="Member not found on this company")

    # Refuse to remove the last primary admin
    if link.is_primary_admin:
        primary_count = session.exec(
            select(func.count()).select_from(UserCompanyLink).where(
                UserCompanyLink.company_id == company.id,
                UserCompanyLink.is_primary_admin == True,  # noqa: E712
            )
        ).first() or 0
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

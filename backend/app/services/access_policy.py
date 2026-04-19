"""Sensitive-data access policy — single source of truth.

This module is the **only** place where the rules for "who may view which
sensitive resource" should live. Other modules (route handlers, DTO
builders, redactors) MUST delegate to the predicates here rather than
re-implementing the logic, so the policy can be audited, tested, and
changed in one place.

================================================================
POLICY TABLE  (resource → who may view → enforcement point)
================================================================

1) CONTRACTS  (`Document` rows, including body/`file_sha256`)
   - Admin                                                       ✓
   - Partner (privileged role)                                   ✓
   - Founder who owns the document (matched via project owner)   ✓
   - Anyone else                                                 ✗
   Enforcement:
     * Detail endpoint (`GET /api/legal/documents/{id}`):
       FastAPI dependency `require_contract_view`.
     * List endpoints: scoped query + `_hydrate_doc_content(include_content=False)`.

2) SIGNATURES  (signer email + `signed_ip` legal proof)
   2a) `signed_ip` (IP address used at signing time)
       - Admin only.   Everyone else: stripped from response.
   2b) `signed_by` (signer email)
       - Admin                                                   ✓
       - The signer themselves                                   ✓
       - The document owner (founder of the owning project)      ✓
       - Anyone else (incl. partners not matching above)         masked via `mask_email`
   Enforcement:
     * `services.signatures.redact_signature_for_viewer` — must be
       called on every Document DTO returned to a non-admin viewer.

3) PERSONAL CONTACT INFO  (User.email, Founder.email, Partner.email,
   Partner.contact_info JSON which may carry phone/website/linkedin)
   NOTE: this codebase does not currently store physical postal
   addresses. If/when an `address` field is added to `User` /
   `Founder` / `LimitedPartner`, route it through this same rule —
   admin or self only, masked otherwise.
   - Admin                                                       ✓
   - The PII subject themselves                                  ✓
   - Co-members of the same company (for member rosters)         ✓ (email only)
   - Anyone else                                                 masked
   Enforcement:
     * `services.pii.serialize_user_safe`, `mask_email`, `mask_phone`
     * Partners route, founders route, company member roster.

4) COMPANY MEMBER LISTS  (the roster of users linked to a company)
   - Admin                                                       ✓
   - Members of that company                                     ✓ (un-masked emails)
   - Strangers (any other authenticated user)                    list visible
                                                                  but emails
                                                                  masked
   - Unauthenticated                                             ✗ (auth required)
   Enforcement:
     * `_company_detail_dto` in `routes/company.py` calls
       `can_view_company_member_list` to decide masking.
     * Public list endpoint `/api/companies` returns `_company_summary_dto`
       (no roster, no business-sensitive fields) — see Item #5.

================================================================
Design notes
================================================================
* Predicates take an optional viewer (`User | None`) so they're safe to
  call from anonymous code paths. They return False on unauthenticated
  callers — the route layer is responsible for emitting 401/403.
* Predicates never raise. Use the `require_*` FastAPI dependencies if
  you want hard enforcement at the routing layer (preferred for new
  endpoints — 'enforce in backend dependencies, not just frontend UI').
* All predicates are pure (no DB writes). Some accept a `Session` so
  they can resolve membership; those queries are read-only.
"""

from __future__ import annotations

from typing import Optional

from fastapi import Depends, HTTPException, Path
from sqlmodel import Session, select

from backend.app.api.deps import (
    can_access_founder_resource,
    is_privileged,
)
from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    CompanyProfile,
    Document,
    Project,
    User,
    UserCompanyLink,
    UserRole,
)
from backend.app.services.pii import can_see_full_pii, is_privileged_viewer


# ---------------------------------------------------------------------------
# 1. CONTRACTS
# ---------------------------------------------------------------------------
def _doc_owner_founder_id(session: Session, doc: Document) -> Optional[int]:
    """Resolve the founder who owns the project that owns this document."""
    if doc.project_id is None:
        return None
    project = session.get(Project, doc.project_id)
    return project.founder_id if project else None


def can_view_contract(
    viewer: Optional[User],
    *,
    owner_founder_id: Optional[int],
) -> bool:
    """Rule 1: contract visibility.

    Admins and partners always pass. Founders pass iff they own the
    project that owns the document. Everyone else is denied.
    """
    if viewer is None:
        return False
    return can_access_founder_resource(viewer, owner_founder_id)


# ---------------------------------------------------------------------------
# 2. SIGNATURES
# ---------------------------------------------------------------------------
def can_view_signed_ip(viewer: Optional[User]) -> bool:
    """Rule 2a: legal-proof IP. Admin only."""
    return is_privileged_viewer(viewer)


def can_view_signer_email(
    viewer: Optional[User],
    *,
    signer_email: Optional[str],
    owner_user_id: Optional[int] = None,
    owner_founder_id: Optional[int] = None,
) -> bool:
    """Rule 2b: un-masked signer email.

    Admin, the signer themselves, or the document owner pass; everyone
    else gets a masked email at the redactor.
    """
    if viewer is None:
        return False
    if can_see_full_pii(
        viewer,
        subject_user_id=owner_user_id,
        subject_founder_id=owner_founder_id,
    ):
        return True
    viewer_email = getattr(viewer, "email", None)
    if viewer_email and signer_email and viewer_email.lower() == signer_email.lower():
        return True
    return False


# ---------------------------------------------------------------------------
# 3. PERSONAL CONTACT INFO  (alias of can_see_full_pii under a clearer name)
# ---------------------------------------------------------------------------
def can_view_personal_contact(
    viewer: Optional[User],
    *,
    subject_user_id: Optional[int] = None,
    subject_founder_id: Optional[int] = None,
    subject_partner_id: Optional[int] = None,
) -> bool:
    """Rule 3: un-masked personal contact info (email/phone/contact_info).

    Same semantics as `pii.can_see_full_pii` — re-exported here so route
    handlers depend on the policy module rather than reaching into the
    PII helpers directly.
    """
    return can_see_full_pii(
        viewer,
        subject_user_id=subject_user_id,
        subject_founder_id=subject_founder_id,
        subject_partner_id=subject_partner_id,
    )


# ---------------------------------------------------------------------------
# 4. COMPANY MEMBER LISTS
# ---------------------------------------------------------------------------
def can_view_company_member_list(
    viewer: Optional[User],
    company: CompanyProfile,
    session: Session,
) -> bool:
    """Rule 4: un-masked company member roster.

    True for admins and for users who are themselves members of the
    company. False for strangers — they may still receive the roster
    (member name + role) but with emails masked.
    """
    if viewer is None:
        return False
    if is_privileged_viewer(viewer):
        return True
    link = session.exec(
        select(UserCompanyLink).where(
            UserCompanyLink.company_id == company.id,
            UserCompanyLink.user_id == viewer.id,
        )
    ).first()
    return link is not None


# ===========================================================================
# FastAPI DEPENDENCIES — preferred enforcement point for new routes
# ===========================================================================
def require_contract_view(
    doc_id: int = Path(..., description="Document ID"),
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
) -> Document:
    """Load the document, enforce Rule 1, and return it.

    Use as `doc: Document = Depends(require_contract_view)` on any
    endpoint that returns a single contract. Raises 404 if missing,
    403 if the viewer is not allowed.
    """
    doc = session.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if not can_view_contract(viewer, owner_founder_id=_doc_owner_founder_id(session, doc)):
        raise HTTPException(status_code=403, detail="Forbidden: you do not own this resource")
    return doc


def require_company_member_view(
    uid: str = Path(..., description="Company UID"),
    session: Session = Depends(get_session),
    viewer: User = Depends(get_current_user),
) -> CompanyProfile:
    """Load the company and require viewer to be a member (or admin).

    Use on any endpoint that exposes the un-masked member roster or
    other member-only fields. Raises 404/403.
    """
    company = session.exec(
        select(CompanyProfile).where(CompanyProfile.uid == uid)
    ).first()
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    if not can_view_company_member_list(viewer, company, session):
        raise HTTPException(status_code=403, detail="Forbidden: company members only")
    return company


__all__ = [
    "can_view_contract",
    "can_view_signed_ip",
    "can_view_signer_email",
    "can_view_personal_contact",
    "can_view_company_member_list",
    "require_contract_view",
    "require_company_member_view",
]

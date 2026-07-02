"""Task #38 — Co-founder matching routes.

Mounted at ``/api/cofounder``.

  GET    /me                   — my profile (or 404 if not set)
  PUT    /me                   — upsert my profile
  DELETE /me                   — un-list (sets profile.listed = false)

  GET    /vocab                — suggested skills + sectors for typeahead
  GET    /browse               — ranked, redacted candidate cards
  POST   /interest             — express interest in another founder (uid)
  DELETE /interest/{user_uid}  — withdraw

  GET    /connections          — my connections + NDA state
  GET    /connections/{uid}    — one connection detail (+ identity if active)
  GET    /connections/{uid}/nda — preview my NDA body
  POST   /connections/{uid}/nda/sign — sign my side
  DELETE /connections/{uid}    — close (mutual block)
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field as PField
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    CofounderConnection, User,
)
from backend.app.services import cofounder as svc

logger = logging.getLogger("studioos.cofounder")
router = APIRouter(prefix="/cofounder", tags=["Co-founder Matching"])


def _role(user: User) -> str:
    return (getattr(user.role, "value", user.role) or "").lower()


def _is_admin(user: User) -> bool:
    return _role(user) == "admin"


def _can_use_cofounder(user: User) -> bool:
    """Founders + admins only. The brief frames this as a founder-on-
    founder feature; partners/investors/mentors don't get a profile."""
    return _role(user) in ("admin", "founder")


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _gate(user: User) -> None:
    if not _can_use_cofounder(user):
        raise HTTPException(status_code=403, detail="Co-founder matching is for founder accounts")


def _resolve_user_uid(session: Session, user_uid: str) -> User:
    """Look up a User by their public `uid` (NOT their numeric id, which
    we never expose externally for the cofounder marketplace)."""
    u = session.exec(select(User).where(User.uid == user_uid)).first()
    if not u or not u.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    return u


# ===========================================================================
# Profile
# ===========================================================================
class ProfileIn(BaseModel):
    skills: list[str] = PField(default_factory=list)
    sectors: list[str] = PField(default_factory=list)
    commitment: str = "full_time"
    location_city: Optional[str] = None
    location_country: Optional[str] = None
    remote_ok: bool = True
    equity_expectation_min: Optional[float] = None
    equity_expectation_max: Optional[float] = None
    bio: Optional[str] = PField(default=None, max_length=2000)
    looking_for: Optional[str] = PField(default=None, max_length=400)
    listed: bool = True


@router.get("/me")
def get_me(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    p = svc.get_my_profile(session, user)
    if not p:
        raise HTTPException(status_code=404, detail="No co-founder profile yet")
    return svc.serialize_profile_self(p, user_uid=user.uid)


@router.put("/me")
def upsert_me(
    body: ProfileIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    try:
        p = svc.upsert_profile(session, user, body.dict())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return svc.serialize_profile_self(p, user_uid=user.uid)


@router.delete("/me")
def unlist_me(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Soft-delete: sets `listed=false` so the profile drops out of
    `/browse`. Existing connections + interest signals are preserved
    (the user can re-list later by PUT /me with `listed=true`)."""
    _gate(user)
    p = svc.get_my_profile(session, user)
    if not p:
        return {"ok": True, "listed": False}
    p.listed = False
    session.add(p); session.commit()
    return {"ok": True, "listed": False}


@router.get("/vocab")
def vocab(user: User = Depends(get_current_user)):
    return {
        "skills": svc.SUGGESTED_SKILLS,
        "sectors": svc.SUGGESTED_SECTORS,
        "commitments": sorted(svc.ALLOWED_COMMITMENT),
    }


# ===========================================================================
# Browse + interest
# ===========================================================================
@router.get("/browse")
def browse(
    q: Optional[str] = None,
    skill: Optional[str] = None,
    sector: Optional[str] = None,
    commitment: Optional[str] = None,
    remote_only: bool = False,
    limit: int = Query(default=50, ge=1, le=100),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    try:
        cards = svc.browse(
            session, user,
            q=q, skill=skill, sector=sector, commitment=commitment,
            remote_only=remote_only, limit=limit,
        )
    except PermissionError:
        raise HTTPException(status_code=400,
                            detail="Create your co-founder profile first (PUT /api/cofounder/me)")
    return {"items": cards}


class InterestIn(BaseModel):
    user_uid: str
    message: Optional[str] = PField(default=None, max_length=500)


@router.post("/interest")
def express_interest(
    body: InterestIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    target = _resolve_user_uid(session, body.user_uid)
    try:
        result = svc.express_interest(
            session, user, target_user_id=target.id, message=body.message,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True, **result}


@router.delete("/interest/{user_uid}")
def withdraw_interest(
    user_uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    target = _resolve_user_uid(session, user_uid)
    changed = svc.withdraw_interest(session, user, target.id)
    return {"ok": True, "withdrew": changed}


# ===========================================================================
# Connections + NDA
# ===========================================================================
def _get_connection_or_403(session: Session, uid: str, user: User) -> CofounderConnection:
    c = session.exec(
        select(CofounderConnection).where(CofounderConnection.uid == uid)
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Connection not found")
    if user.id not in (c.user_a_id, c.user_b_id) and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Not a party to this connection")
    return c


@router.get("/connections")
def my_connections(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    return {"items": svc.list_connections(session, user)}


@router.get("/connections/{uid}")
def connection_detail(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    c = _get_connection_or_403(session, uid, user)
    return svc.serialize_connection_for(session, c, user)


@router.get("/connections/{uid}/nda")
def get_my_nda(
    uid: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    c = _get_connection_or_403(session, uid, user)
    doc = svc.get_my_nda_for_connection(session, c, user)
    if not doc:
        raise HTTPException(status_code=404, detail="NDA document not found")
    return {
        "title": doc.title,
        "body": doc.content,
        "status": getattr(doc.status, "value", doc.status),
        "document_id": doc.id,
    }


class NdaSignIn(BaseModel):
    signer_name: str = PField(min_length=1, max_length=200)
    accepted: bool


@router.post("/connections/{uid}/nda/sign")
def sign_nda(
    uid: str,
    body: NdaSignIn,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    if not body.accepted:
        raise HTTPException(status_code=400, detail="You must affirmatively accept the NDA terms")
    c = _get_connection_or_403(session, uid, user)
    try:
        c = svc.sign_connection_nda(
            session, c, user,
            signer_name=body.signer_name, ip=_client_ip(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    return svc.serialize_connection_for(session, c, user)


class CloseIn(BaseModel):
    reason: Optional[str] = PField(default=None, max_length=200)


@router.delete("/connections/{uid}")
def close_connection(
    uid: str,
    reason: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _gate(user)
    c = _get_connection_or_403(session, uid, user)
    try:
        c = svc.close_connection(session, c, user, reason=reason)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    return svc.serialize_connection_for(session, c, user)

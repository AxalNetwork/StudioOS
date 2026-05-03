"""Task #55 — Public profile pages (``/u/<handle>``).

A single unauthenticated read endpoint that resolves a user by their
public ``handle`` and returns a role-tailored payload. What gets
included is governed by the owner's ``privacy_prefs.public_profile``
flag map: the renderer never returns a field whose flag is False, so
the owner controls leakage at field granularity.

Defaults (when a flag is absent) are role-specific:

* **founder** — name, bio, headshot, projects, traction visible;
  socials hidden.
* **investor** — name, bio, headshot, thesis visible; portfolio
  summary and socials hidden by default (investors are often more
  private about deal flow).
* **partner** — name, bio, headshot, services, reviews visible;
  pricing hidden.

Hard rules independent of flags:

* Inactive users (``is_active=False``) and deletion-requested users
  return 404 — they are not addressable in public.
* Email is **never** returned. Only the handle, display name (when
  opted in), and role-specific shape.
* Handle resolution is case-insensitive; the canonical handle is
  always echoed back.
* Mentor users are deliberately excluded for now (the mentor surface
  has its own listing in /mentors); they 404 here to avoid leaking
  rosters before owner-side privacy is wired.

Out of scope per the task brief: public-facing project pages.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select, text

from backend.app.database import get_session
from backend.app.models.entities import (
    Founder,
    Investor,
    Partner,
    PartnerReview,
    Project,
    User,
)

router = APIRouter(prefix="/public", tags=["public-profiles"])
logger = logging.getLogger("studioos.public_profiles")


# Per-role default visibility. Anything not listed here is hidden by
# default. The merged result is ``DEFAULTS[role] | privacy_prefs``.
_DEFAULTS: dict[str, dict[str, bool]] = {
    "founder": {
        "name": True, "bio": True, "headshot": True, "socials": False,
        "projects": True, "traction": True,
    },
    "investor": {
        "name": True, "bio": True, "headshot": True, "socials": False,
        "thesis": True, "portfolio_summary": False,
    },
    "partner": {
        "name": True, "bio": True, "headshot": True, "socials": False,
        "services": True, "reviews": True, "pricing": False,
    },
    "admin": {  # admins get the founder-style default if they ever expose
        "name": True, "bio": True, "headshot": True, "socials": False,
    },
}


def _role(user: User) -> str:
    return (user.role.value if hasattr(user.role, "value") else str(user.role)).lower()


def _safe_json(raw: Any, fallback: Any) -> Any:
    if not raw:
        return fallback
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _flags(extras: dict[str, Any], role: str) -> dict[str, bool]:
    """Effective per-field privacy flags for a role.

    Owner overrides win, but any field the owner hasn't explicitly
    decided defaults to the role's policy above.
    """
    base = dict(_DEFAULTS.get(role, _DEFAULTS["admin"]))
    pp = (_safe_json(extras.get("privacy_prefs"), {}) or {}).get("public_profile") or {}
    if isinstance(pp, dict):
        for k, v in pp.items():
            base[k] = bool(v)
    return base


def _load_extras(session: Session, user_id: int) -> dict[str, Any]:
    """Fetch the user-extras row created by ``settings.py`` (bio,
    socials, headshot path, privacy_prefs). All columns are optional
    — a fresh user may have none of them yet."""
    try:
        row = session.exec(text(
            "SELECT bio, headshot_local_path, socials, privacy_prefs, "
            "       deletion_requested_at "
            "FROM users WHERE id = :uid"
        ).bindparams(uid=user_id)).first()
    except Exception as exc:  # noqa: BLE001
        logger.warning("public profile: extras fetch failed user=%s err=%s", user_id, exc)
        return {}
    return dict(row._mapping) if row else {}  # type: ignore[attr-defined]


def _founder_block(session: Session, user: User, flags: dict[str, bool], extras: dict) -> dict:
    """Founder-specific projects + traction summary."""
    out: dict[str, Any] = {}
    if not user.founder_id:
        return out
    founder = session.get(Founder, user.founder_id)
    if founder and flags.get("bio") and founder.bio and not extras.get("bio"):
        # If the user-extras row has no bio, fall back to the founder
        # profile bio (older accounts were seeded that way).
        out["bio"] = founder.bio[:2000]
    if flags.get("projects") or flags.get("traction"):
        projects = session.exec(
            select(Project).where(Project.founder_id == user.founder_id)
        ).all()
        # Hide sandbox / archived states from the public view; founders
        # often experiment in 'intake' before they want a public footprint.
        public_projects = [p for p in projects if (p.status or "").lower() not in ("archived", "rejected")]
        if flags.get("projects"):
            out["projects"] = [
                {
                    "name": p.name,
                    "sector": p.sector,
                    "stage": p.stage,
                    "week": getattr(p.playbook_week, "value", str(p.playbook_week)),
                }
                for p in public_projects[:10]
            ]
        if flags.get("traction"):
            users_total = sum(int(p.users_count or 0) for p in public_projects)
            revenue_total = sum(float(p.revenue or 0) for p in public_projects)
            out["traction"] = {
                "active_projects": len(public_projects),
                "users": users_total or None,
                "revenue": revenue_total or None,
            }
    return out


def _investor_block(session: Session, user: User, flags: dict[str, bool]) -> dict:
    """Investor thesis + (very coarse) portfolio summary."""
    out: dict[str, Any] = {}
    if not user.investor_id:
        return out
    inv = session.get(Investor, user.investor_id)
    if not inv:
        return out
    if flags.get("thesis"):
        out["thesis"] = {
            "investor_type": inv.investor_type,
            "sector_focus": inv.sector_focus or None,
            "stage_focus": inv.stage_focus or None,
            "check_size_min": inv.check_size_min,
            "check_size_max": inv.check_size_max,
            "accredited": (inv.accreditation_status or "") == "verified",
        }
    if flags.get("portfolio_summary"):
        # Deliberately just a count — never names, never amounts. The
        # default flag is False; an investor must opt in.
        try:
            count = session.exec(text(
                "SELECT COUNT(*) AS c FROM capital_calls WHERE limited_partner_id IN "
                "(SELECT id FROM limited_partners WHERE primary_user_id = :uid)"
            ).bindparams(uid=user.id)).first()
            n = int((count._mapping["c"] if count else 0) or 0)  # type: ignore[attr-defined]
        except Exception:
            n = 0
        out["portfolio_summary"] = {"engagements": n}
    return out


def _partner_block(session: Session, user: User, flags: dict[str, bool]) -> dict:
    """Partner services catalogue + review summary."""
    out: dict[str, Any] = {}
    if not user.partner_id:
        return out
    p = session.get(Partner, user.partner_id)
    if not p:
        return out
    if flags.get("services"):
        out["services"] = {
            "headline": p.headline,
            "categories": _safe_json(p.categories_json, []),
            "sectors": _safe_json(p.sectors_json, []),
            "specialization": p.specialization,
            "capacity_status": p.capacity_status,
            "response_time_hours": p.response_time_hours,
            "kyb_verified": (p.kyb_status or "") == "verified",
            "directory_slug": p.slug,
        }
    if flags.get("pricing"):
        out["pricing"] = {
            "tier": p.pricing_tier,
            "hourly_min": p.hourly_rate_min,
            "hourly_max": p.hourly_rate_max,
        }
    if flags.get("reviews"):
        agg = session.exec(
            select(func.avg(PartnerReview.rating), func.count(PartnerReview.id))
            .where(PartnerReview.partner_id == p.id)
        ).first()
        avg, count = (agg or (None, 0))
        out["reviews"] = {
            "avg_rating": round(float(avg), 2) if avg else None,
            "count": int(count or 0),
        }
    return out


@router.get("/u/{handle}")
def get_public_profile(handle: str, session: Session = Depends(get_session)):
    """Public, unauthenticated read of a user's profile by ``handle``."""
    h = (handle or "").strip().lower()
    if not h or len(h) > 64:
        raise HTTPException(status_code=404, detail="Profile not found")

    user = session.exec(
        select(User).where(func.lower(User.handle) == h)  # type: ignore[attr-defined]
    ).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="Profile not found")

    role = _role(user)
    # Mentors are out of scope for public profiles in this iteration.
    if role == "mentor":
        raise HTTPException(status_code=404, detail="Profile not found")

    extras = _load_extras(session, user.id)
    if extras.get("deletion_requested_at"):
        raise HTTPException(status_code=404, detail="Profile not found")
    flags = _flags(extras, role)

    socials = _safe_json(extras.get("socials"), {}) or {}

    payload: dict[str, Any] = {
        "handle": user.handle,
        "role": role,
        "joined_at": str(user.created_at) if user.created_at else None,
        "name": (user.name if flags.get("name") else None),
        "bio": (extras.get("bio") if flags.get("bio") else None),
        "headshot_url": (
            f"/api/settings/headshot/{user.uid}"
            if flags.get("headshot") and extras.get("headshot_local_path")
            else None
        ),
        "socials": (
            {k: v for k, v in socials.items() if isinstance(v, str) and v}
            if flags.get("socials") else {}
        ),
        # Echo the effective flag map so the owner-side editor can show
        # "this is what visitors see" without a second round-trip.
        "visible_fields": flags,
    }

    if role == "founder":
        block = _founder_block(session, user, flags, extras)
        if "bio" in block and not payload.get("bio"):
            payload["bio"] = block.pop("bio")
        payload.update(block)
    elif role == "investor":
        payload.update(_investor_block(session, user, flags))
    elif role == "partner":
        payload.update(_partner_block(session, user, flags))

    return payload

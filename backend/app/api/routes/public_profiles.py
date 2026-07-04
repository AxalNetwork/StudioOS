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
from typing import Any

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
    ScoreSnapshot,
    User,
    VCFund,
)

router = APIRouter(prefix="/public", tags=["public-profiles"])
logger = logging.getLogger("studioos.public_profiles")


@router.get("/stats")
def public_stats(session: Session = Depends(get_session)) -> dict[str, int]:
    """Dev (FastAPI) mirror of the Worker's ``GET /api/public/stats``.

    Unauthenticated landing-page headline counts. Each count is best-effort:
    a failure on one query must not break the others or the page.
    """
    def _count(stmt) -> int:
        try:
            return session.exec(stmt).one() or 0
        except Exception:
            logger.exception("public_stats: count query failed")
            return 0

    partners = _count(
        select(func.count(Partner.id)).where(Partner.status == "active")
    )
    funds = _count(
        select(func.count(VCFund.id)).where(VCFund.status == "active")
    )
    deals_scored = _count(
        select(func.count(func.distinct(ScoreSnapshot.project_id))).where(
            ScoreSnapshot.is_sandbox == False  # noqa: E712
        )
    )
    spinouts = _count(
        select(func.count(Project.id)).where(Project.status == "spinout")
    )
    return {
        "partners": partners,
        "funds": funds,
        "deals_scored": deals_scored,
        "spinouts": spinouts,
    }


def _safe_rollback(session: Session) -> None:
    """Best-effort rollback; a failure here must not mask the original error."""
    try:
        session.rollback()
    except Exception:
        logger.debug("session rollback failed", exc_info=True)


# Per-role default visibility. Anything not listed here is hidden by
# default. The merged result is ``DEFAULTS[role] | privacy_prefs``.
_DEFAULTS: dict[str, dict[str, bool]] = {
    "founder": {
        "name": True, "bio": True, "headshot": True, "socials": False,
        "projects": True, "traction": True, "background": True,
    },
    "investor": {
        "name": True, "bio": True, "headshot": True, "socials": False,
        "thesis": True, "portfolio_summary": False, "background": True,
    },
    "partner": {
        "name": True, "bio": True, "headshot": True, "socials": False,
        "services": True, "reviews": True, "pricing": False, "background": True,
    },
    "admin": {  # admins get the founder-style default if they ever expose
        "name": True, "bio": True, "headshot": True, "socials": False,
        "background": True,
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
            "       deletion_requested_at, experience, education, certifications, website "
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

    # Task #66 — follower count (public, best-effort).
    followers = 0
    try:
        row = session.exec(text(
            "SELECT COUNT(*) AS c FROM follows WHERE entity_type = 'user' AND entity_id = :uid"
        ).bindparams(uid=user.id)).first()
        followers = int((row._mapping["c"] if row else 0) or 0)  # type: ignore[attr-defined]
    except Exception:
        _safe_rollback(session)
        followers = 0

    _name = (user.name if flags.get("name") else None)
    payload: dict[str, Any] = {
        "id": user.id,
        "handle": user.handle,
        "role": role,
        "joined_at": str(user.created_at) if user.created_at else None,
        "name": _name,
        # Frontend reads display_name || name — echo name for parity.
        "display_name": _name,
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
        # Task #66 — public website (background-gated; falls back to socials.website).
        "website": (
            (extras.get("website") or socials.get("website") or None)
            if flags.get("background") else None
        ),
        "followers": followers,
        # Echo the effective flag map so the owner-side editor can show
        # "this is what visitors see" without a second round-trip.
        "visible_fields": flags,
    }

    # Task #66 — structured career background (public, LinkedIn-style).
    if flags.get("background"):
        payload["experience"] = _safe_json(extras.get("experience"), [])
        payload["education"] = _safe_json(extras.get("education"), [])
        payload["certifications"] = _safe_json(extras.get("certifications"), [])

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


# Task #66 — Public, shareable startup profile. Handle is the project uid.
# Mirrors cloudflare-worker/src/routes/public.ts GET /startup/:handle. Returns
# only fields safe for anonymous sharing (no data-room links, no financial
# internals beyond headline traction), founder cards for cross-linking, recent
# SUBMITTED updates, and the published landing URL. Projects that are
# archived/rejected/intake (or soft-deleted) are not addressable in public.
@router.get("/startup/{handle}")
def get_public_startup(handle: str, session: Session = Depends(get_session)):
    h = (handle or "").strip().lower()
    if not h or len(h) > 64:
        raise HTTPException(status_code=404, detail="Not found")

    proj = session.exec(
        select(Project).where(func.lower(Project.uid) == h)  # type: ignore[attr-defined]
    ).first()
    if not proj:
        raise HTTPException(status_code=404, detail="Not found")
    # Soft-delete guard (best-effort — the dev schema may not have the column).
    if getattr(proj, "deleted_at", None):
        raise HTTPException(status_code=404, detail="Not found")
    status = (getattr(proj.status, "value", str(proj.status)) or "").lower()
    if status in ("archived", "rejected", "intake"):
        raise HTTPException(status_code=404, detail="Not found")

    # Founder card(s) — the primary founder user(s), safe fields only.
    founders: list[dict[str, Any]] = []
    if proj.founder_id:
        try:
            f_users = session.exec(
                select(User).where(
                    User.founder_id == proj.founder_id,  # type: ignore[arg-type]
                    User.is_active == True,  # noqa: E712
                )
            ).all()
            for u in f_users:
                ex = _load_extras(session, u.id)
                founders.append({
                    "handle": u.uid,
                    "name": u.name or None,
                    "headline": None,
                    "role": _role(u),
                    "headshot_url": (
                        f"/api/settings/headshot/{u.uid}"
                        if ex.get("headshot_local_path") else None
                    ),
                })
        except Exception:  # noqa: BLE001
            _safe_rollback(session)

    # Recent submitted updates (news feed) — table is dev-managed / optional.
    updates: list[dict[str, Any]] = []
    try:
        rows = session.exec(text(
            "SELECT uid, period, title, submitted_at FROM portfolio_updates "
            "WHERE project_id = :pid AND status = 'submitted' "
            "ORDER BY COALESCE(submitted_at, updated_at) DESC LIMIT 6"
        ).bindparams(pid=proj.id)).all()
        updates = [
            {
                "uid": r._mapping["uid"],  # type: ignore[attr-defined]
                "period": r._mapping["period"],  # type: ignore[attr-defined]
                "title": r._mapping["title"],  # type: ignore[attr-defined]
                "submitted_at": str(r._mapping["submitted_at"]) if r._mapping["submitted_at"] else None,  # type: ignore[attr-defined]
            }
            for r in rows
        ]
    except Exception:
        _safe_rollback(session)
        updates = []

    # Site/Website button target: an explicit startup website URL wins; when
    # absent, fall back to a published Brand & Landing page (Brand Builder output).
    website: str | None = None
    _explicit = (getattr(proj, "website", None) or "").strip() or None
    if _explicit:
        website = _explicit
    else:
        try:
            lp = session.exec(text(
                "SELECT slug, published FROM landing_pages WHERE project_id = :pid"
            ).bindparams(pid=proj.id)).first()
            if lp and lp._mapping.get("published"):  # type: ignore[attr-defined]
                website = f"https://axal.vc/landing/{lp._mapping['slug']}"  # type: ignore[attr-defined]
        except Exception:
            _safe_rollback(session)
            website = None

    # Follower count (public, best-effort).
    followers = 0
    try:
        row = session.exec(text(
            "SELECT COUNT(*) AS c FROM follows WHERE entity_type = 'project' AND entity_id = :pid"
        ).bindparams(pid=proj.id)).first()
        followers = int((row._mapping["c"] if row else 0) or 0)  # type: ignore[attr-defined]
    except Exception:
        _safe_rollback(session)
        followers = 0

    return {
        "id": proj.id,
        "handle": proj.uid,
        "name": proj.name,
        "sector": proj.sector or None,
        "stage": proj.stage or None,
        "status": status,
        "description": proj.description or None,
        "problem_statement": proj.problem_statement or None,
        "solution": proj.solution or None,
        "why_now": proj.why_now or None,
        "founded_year": getattr(proj, "founded_year", None) or None,
        "hq": getattr(proj, "hq", None) or None,
        "traction": {
            "users": proj.users_count or None,
            "revenue": proj.revenue or None,
            "funding_needed": proj.funding_needed or None,
        },
        "founders": founders,
        "updates": updates,
        "website": website,
        "followers": followers,
        "joined_at": str(proj.created_at) if proj.created_at else None,
    }

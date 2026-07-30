"""Task #12 — Secure introductions & matching flow.

The Network → Introductions experience: a privacy-preserving intro/matching
flow between founders, investors, advisors and partners.

CORE INVARIANT (enforced here, server-side — not just in the UI): neither
party's private contact details (email) are revealed to the other until BOTH
sides have accepted and the record reaches status `connected`. Every response
DTO is built through `_to_dto`, which strips contact fields unless the viewer
is a participant AND the row is connected.

This router lives under its OWN namespace (`/api/network-introductions/*`) and
must NOT be confused with the credits-based `/api/introductions/*` proposition
system (served by a separate Cloudflare worker).

Recipients are either:
  * on-platform  — a registered User (in-app notification + inbox item), or
  * off-platform — an admin-created Investor profile with no linked user; a
    branded invite is emailed to its private `contact_email` carrying a
    single-use tokenized review link to accept/decline before seeing the full
    profile, plus a register-at-axal.vc CTA to claim the profile.
"""
from __future__ import annotations

import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field as PydField
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.api.deps import require_admin
from backend.app.database import get_session
from backend.app.models.entities import (
    ActivityLog,
    Founder,
    Investor,
    NetworkIntroduction,
    NetworkIntroMessage,
    User,
    UserRole,
)
from backend.app.services import email_service
from backend.app.services.notify import notify

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/network-introductions", tags=["Network Introductions"])

TERMINAL_STATUSES = {"declined", "connected", "expired"}
INVITE_TTL_DAYS = 14


# ---------------------------------------------------------------------------
# Token helpers (single-use tokenized review link — hash-at-rest, like refs)
# ---------------------------------------------------------------------------
def _mint_invite_token() -> tuple[str, str, datetime]:
    raw = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    expires = datetime.utcnow() + timedelta(days=INVITE_TTL_DAYS)
    return raw, token_hash, expires


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _invite_url(raw_token: str) -> str:
    domain = os.environ.get("REPLIT_DEV_DOMAIN", "")
    base = f"https://{domain}" if domain else os.environ.get("APP_URL", "http://localhost:5000")
    return f"{base}/network-intro/{raw_token}"


# ---------------------------------------------------------------------------
# Summaries — SAFE (no contact details) party descriptions
# ---------------------------------------------------------------------------
def _user_summary(session: Session, user: Optional[User]) -> dict:
    """Public-safe summary of a platform user — name/role/company/headline/
    photo only. NEVER includes email."""
    if not user:
        return {"name": "Unknown", "role": None, "company": None, "headline": None, "photo_url": None}
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    company = None
    headline = None
    photo_url = None
    if user.investor_id:
        inv = session.get(Investor, user.investor_id)
        if inv:
            company = inv.company
            headline = inv.headline
            photo_url = inv.photo_url
    if headline is None and user.founder_id:
        f = session.get(Founder, user.founder_id)
        if f:
            headline = f.bio
            company = company or f.domain_expertise
    return {
        "name": user.name,
        "role": role,
        "company": company,
        "headline": headline,
        "photo_url": photo_url,
    }


def _recipient_contact_email(session: Session, intro: NetworkIntroduction) -> Optional[str]:
    """Resolve the recipient's real email — ONLY call this once connected."""
    if intro.recipient_user_id:
        u = session.get(User, intro.recipient_user_id)
        return u.email if u else None
    return intro.recipient_email


def _to_dto(session: Session, intro: NetworkIntroduction, viewer: User) -> dict:
    """Build a privacy-filtered DTO for `viewer`.

    Contact details (email) are included ONLY when the row is `connected` and
    the viewer is a participant. Pre-connection responses carry summaries only.
    """
    is_initiator = intro.initiator_user_id == viewer.id
    is_recipient = (
        intro.recipient_user_id is not None and intro.recipient_user_id == viewer.id
    )
    is_admin = viewer.role == UserRole.ADMIN
    connected = intro.status == "connected"

    initiator = session.get(User, intro.initiator_user_id)
    initiator_summary = _user_summary(session, initiator)
    recipient_summary = {
        "name": intro.recipient_name,
        "role": "investor",
        "company": intro.recipient_company,
        "headline": intro.recipient_headline,
        "photo_url": intro.recipient_photo_url,
        "on_platform": intro.recipient_user_id is not None,
    }

    # Viewer-relative "counterpart" — who the other side is from your POV.
    if is_recipient:
        direction = "incoming"
        counterpart = initiator_summary
    else:
        # initiator or admin observer
        direction = "outgoing"
        counterpart = recipient_summary

    dto = {
        "id": intro.id,
        "uid": intro.uid,
        "status": intro.status,
        "direction": direction,
        "off_platform": intro.off_platform,
        "initiator": initiator_summary,
        "recipient": recipient_summary,
        "counterpart": counterpart,
        "draft_message": intro.draft_message,
        "initiator_accepted": intro.initiator_accepted,
        "recipient_accepted": intro.recipient_accepted,
        "is_initiator": is_initiator,
        "is_recipient": is_recipient,
        "can_message": connected and (is_initiator or is_recipient),
        "created_at": intro.created_at.isoformat() if intro.created_at else None,
        "viewed_at": intro.viewed_at.isoformat() if intro.viewed_at else None,
        "accepted_at": intro.accepted_at.isoformat() if intro.accepted_at else None,
        "declined_at": intro.declined_at.isoformat() if intro.declined_at else None,
        "connected_at": intro.connected_at.isoformat() if intro.connected_at else None,
        # Privacy flag the UI uses to show the "hidden until connected" notice.
        "contact_unlocked": bool(connected and (is_initiator or is_recipient)),
    }

    # Contact details — the ONLY place email is ever emitted, gated on connected.
    if connected and (is_initiator or is_recipient or is_admin):
        dto["contact"] = {
            "initiator_email": initiator.email if initiator else None,
            "recipient_email": _recipient_contact_email(session, intro),
        }
    return dto


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class IntroCreate(BaseModel):
    recipient_investor_id: Optional[int] = None
    recipient_user_id: Optional[int] = None
    message: Optional[str] = PydField(default=None, max_length=2000)


class InvestorProfileCreate(BaseModel):
    display_name: str = PydField(min_length=1, max_length=200)
    contact_email: str = PydField(min_length=3, max_length=320)
    company: Optional[str] = None
    headline: Optional[str] = None
    photo_url: Optional[str] = None
    investor_type: str = "vc"


class MessageCreate(BaseModel):
    body: str = PydField(min_length=1, max_length=4000)


# ---------------------------------------------------------------------------
# Claim-on-register hook
# ---------------------------------------------------------------------------
def claim_offplatform_introductions(session: Session, user: User) -> int:
    """Link any off-platform introductions addressed to this user's email to
    their new account, and adopt the matching admin-created Investor profile.

    Called from the registration flow. Returns the number of intros claimed.
    Safe / idempotent — matches on lowercased email, skips already-linked rows.
    """
    if not user or not user.email:
        return 0
    email_lc = user.email.strip().lower()
    rows = session.exec(
        select(NetworkIntroduction).where(
            NetworkIntroduction.recipient_user_id.is_(None)  # type: ignore[union-attr]
        )
    ).all()
    claimed = 0
    for intro in rows:
        if not intro.recipient_email:
            continue
        if intro.recipient_email.strip().lower() != email_lc:
            continue
        intro.recipient_user_id = user.id
        intro.off_platform = False
        intro.updated_at = datetime.utcnow()
        # Adopt the off-platform Investor profile if it isn't linked yet.
        if intro.recipient_investor_id:
            inv = session.get(Investor, intro.recipient_investor_id)
            if inv and inv.user_id is None:
                inv.user_id = user.id
                inv.updated_at = datetime.utcnow()
                session.add(inv)
                if user.investor_id is None:
                    user.investor_id = inv.id
                    session.add(user)
        session.add(intro)
        claimed += 1
    if claimed:
        session.commit()
    return claimed


# ---------------------------------------------------------------------------
# Targets — who a member can request an introduction to
# ---------------------------------------------------------------------------
@router.get("/targets")
def list_targets(
    q: Optional[str] = None,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Investor profiles (on- and off-platform) a member can request an intro
    to. SAFE fields only — contact_email is never included here."""
    investors = session.exec(select(Investor)).all()
    out = []
    for inv in investors:
        linked_user = session.get(User, inv.user_id) if inv.user_id else None
        # Don't offer the caller an intro to themselves.
        if linked_user and linked_user.id == user.id:
            continue
        name = inv.display_name or (linked_user.name if linked_user else None)
        if not name:
            continue
        row = {
            "investor_id": inv.id,
            "user_id": inv.user_id,
            "on_platform": inv.user_id is not None,
            "name": name,
            "company": inv.company,
            "headline": inv.headline,
            "photo_url": inv.photo_url,
            "investor_type": inv.investor_type,
        }
        if q:
            hay = f"{name} {inv.company or ''} {inv.headline or ''}".lower()
            if q.lower() not in hay:
                continue
        out.append(row)
    out.sort(key=lambda r: r["name"].lower())
    return out


@router.post("/investor-profiles")
def create_investor_profile(
    data: InvestorProfileCreate,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
):
    """Admin-only: create an Investor profile for someone not yet on the
    platform (no linked user). The `contact_email` is stored privately and is
    only ever used to send the branded off-platform invite."""
    if "@" not in data.contact_email:
        raise HTTPException(status_code=400, detail="Valid contact_email required")
    inv = Investor(
        user_id=None,
        investor_type=data.investor_type or "vc",
        display_name=data.display_name.strip(),
        company=data.company,
        headline=data.headline,
        photo_url=data.photo_url,
        contact_email=data.contact_email.strip(),
    )
    session.add(inv)
    session.commit()
    session.refresh(inv)
    session.add(ActivityLog(
        action="network_intro_profile_created",
        details=f"Off-platform investor profile '{inv.display_name}' created (id={inv.id})",
        actor=admin.email,
        user_id=admin.id,
    ))
    session.commit()
    return {
        "investor_id": inv.id,
        "name": inv.display_name,
        "company": inv.company,
        "headline": inv.headline,
        "on_platform": False,
    }


# ===========================================================================
# Task #24 — People matchmaking (Discover) + connect credits
# ---------------------------------------------------------------------------
# The redesigned Network → Introductions surface is a people-only, card-based
# matchmaking experience. This ranks OTHER members for the viewer by shared
# values, complementary skills, archetype compatibility, specialization and
# location, surfaces a derived trust score + an Axal fit graph, and gates the
# Connect action behind per-plan connect credits.
#
# DEV-PARITY NOTE: prod (the Cloudflare Worker) holds the real Axal scoring
# data (axal_values / user_skills / profile_archetypes / axal_fit_scores) and
# the intro_credit_ledger. The dev FastAPI backend has none of those tables,
# so — exactly like the skills.py / profiling.py dev shims — the scoring
# fields below are DERIVED DETERMINISTICALLY from a stable per-member seed so
# the experience renders and round-trips in the local preview. Connect itself
# is fully real: it reuses the privacy-preserving create → notify → accept
# pipeline, so the recipient really is notified and contact stays hidden until
# both sides connect. The additive fit-v1 contract is honoured: the fit
# "overall" is the mean of the 5 canonical AXAL values only (ambition is shown
# as a 6th graph axis but never folded into the v1 mean).
# ===========================================================================
import hashlib as _hashlib

# The 5 canonical AXAL values (v1) + the v2-only ambition axis (display only).
_AXAL_VALUE_KEYS = [
    ("integrity", "Integrity"),
    ("stewardship", "Stewardship"),
    ("curiosity", "Curiosity"),
    ("resilience", "Resilience"),
    ("collaboration", "Collaboration"),
]
_AMBITION_AXIS = ("ambition", "Ambition")
_ALL_VALUE_AXES = _AXAL_VALUE_KEYS + [_AMBITION_AXIS]

_ARCHETYPES = [
    ("builder", "Builder"), ("visionary", "Visionary"),
    ("connector", "Connector"), ("operator", "Operator"),
    ("scout", "Scout"), ("steward", "Steward"),
]
_SKILL_POOL = [
    "Backend", "Frontend", "Product", "Design", "Growth", "Sales",
    "Fundraising", "Operations", "Data", "Legal", "Finance", "Marketing",
]
_SPEC_POOL = [
    "Fintech", "AI/ML", "Healthcare", "Climate", "SaaS", "Marketplaces",
    "DevTools", "Consumer", "Web3", "Deeptech", "Biotech", "Cybersecurity",
]
_LOCATION_POOL = [
    "San Francisco, US", "New York, US", "London, UK", "Berlin, DE",
    "Paris, FR", "Singapore", "Toronto, CA", "Tel Aviv, IL", "Remote",
]

# Per-plan monthly connect-credit allowance. Prod derives this from the real
# subscription tier via the worker's monthlyAllowanceFor(); dev keys off role.
_CONNECT_CAP_BY_ROLE = {
    "admin": 999,
    "investor": 15,
    "founder": 10,
    "partner": 12,
    "advisor": 12,
}
_DEFAULT_CONNECT_CAP = 8


def _seed(*parts) -> int:
    raw = "|".join(str(p) for p in parts)
    return int(_hashlib.sha256(raw.encode()).hexdigest()[:12], 16)


def _pick(pool: list, seed: int, n: int) -> list:
    """Deterministic distinct picks from a pool (stable per seed)."""
    if not pool:
        return []
    n = min(n, len(pool))
    step = 1 + (seed // len(pool)) % (len(pool) - 1 or 1)
    idx = seed % len(pool)
    out: list = []
    seen: set = set()
    while len(out) < n:
        if idx not in seen:
            seen.add(idx)
            out.append(pool[idx])
        idx = (idx + step) % len(pool)
    return out


def _split_tags(raw: Optional[str]) -> list:
    if not raw:
        return []
    return [t.strip() for t in raw.replace(";", ",").split(",") if t.strip()]


def _derive_profile(
    seed_key: str,
    *,
    role: str,
    on_platform: bool,
    accredited: bool,
    base_specs: Optional[list] = None,
    base_location: Optional[str] = None,
) -> dict:
    """Deterministic scoring/profile fields for a member (dev-parity shim)."""
    s = _seed(seed_key)
    values = [
        {"key": k, "label": label, "score": 55 + (_seed(seed_key, k) % 46)}
        for k, label in _ALL_VALUE_AXES
    ]
    arche_slug, arche_label = _ARCHETYPES[s % len(_ARCHETYPES)]
    skills = _pick(_SKILL_POOL, _seed(seed_key, "sk"), 3 + (s % 3))
    specs = (base_specs or [])[:4] or _pick(_SPEC_POOL, _seed(seed_key, "sp"), 2 + (s % 2))
    location = base_location or _LOCATION_POOL[_seed(seed_key, "loc") % len(_LOCATION_POOL)]
    trust = 45 + (_seed(seed_key, "tr") % 30)
    if on_platform:
        trust += 8
    if accredited:
        trust += 14
    trust = max(40, min(99, trust))
    # v1 fit = mean of the 5 canonical AXAL values only (ambition excluded).
    fit_overall = round(sum(v["score"] for v in values[:5]) / 5)
    return {
        "values": values,
        "archetype": {"slug": arche_slug, "label": arche_label},
        "skills": skills,
        "specializations": specs,
        "location": location,
        "trust_score": trust,
        "fit": {"overall": fit_overall, "axes": values},
    }


def _viewer_profile(session: Session, user: User) -> dict:
    accredited = False
    specs = None
    if user.investor_id:
        inv = session.get(Investor, user.investor_id)
        if inv:
            accredited = inv.accreditation_status == "verified"
            specs = _split_tags(inv.sector_focus) or None
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return _derive_profile(
        f"user:{user.id}", role=role, on_platform=True,
        accredited=accredited, base_specs=specs,
    )


def _candidate_from_user(session: Session, u: User) -> dict:
    summ = _user_summary(session, u)
    role = summ["role"]
    accredited = False
    specs = None
    if u.investor_id:
        inv = session.get(Investor, u.investor_id)
        if inv:
            accredited = inv.accreditation_status == "verified"
            specs = _split_tags(inv.sector_focus) or None
    prof = _derive_profile(
        f"user:{u.id}", role=role or "member", on_platform=True,
        accredited=accredited, base_specs=specs,
    )
    return {
        "key": f"user:{u.id}", "user_id": u.id, "investor_id": u.investor_id,
        "on_platform": True, "name": summ["name"], "role": role,
        "company": summ["company"], "headline": summ["headline"],
        "photo_url": summ["photo_url"], **prof,
    }


def _candidate_from_investor(inv: Investor) -> dict:
    prof = _derive_profile(
        f"inv:{inv.id}", role="investor", on_platform=False,
        accredited=(inv.accreditation_status == "verified"),
        base_specs=(_split_tags(inv.sector_focus) or None),
    )
    return {
        "key": f"inv:{inv.id}", "user_id": None, "investor_id": inv.id,
        "on_platform": False, "name": inv.display_name, "role": "investor",
        "company": inv.company, "headline": inv.headline,
        "photo_url": inv.photo_url, **prof,
    }


def _score_candidate(c: dict, viewer: dict) -> None:
    """Populate match_score + why[] for a candidate relative to the viewer."""
    reasons: list = []
    pts = 0
    label_by_key = {k: lbl for k, lbl in _ALL_VALUE_AXES}

    v_top = {v["key"] for v in sorted(viewer["values"], key=lambda x: -x["score"])[:3]}
    c_top = {v["key"] for v in sorted(c["values"], key=lambda x: -x["score"])[:3]}
    shared = [k for k in c_top if k in v_top]
    shared_labels = [label_by_key[k] for k in shared]
    if shared:
        pts += 12 * len(shared)
        reasons.append(f"Shares your top values: {', '.join(shared_labels)}")

    comp = [sk for sk in c["skills"] if sk not in viewer["skills"]][:3]
    if comp:
        pts += 8 * len(comp)
        reasons.append(f"Complementary skills: {', '.join(comp)}")

    if viewer["archetype"]["slug"] == c["archetype"]["slug"]:
        pts += 8
        reasons.append(f"Matching archetype: {c['archetype']['label']}")
    else:
        pts += 12
        reasons.append(
            f"Complementary archetypes: {viewer['archetype']['label']} × {c['archetype']['label']}"
        )

    overlap = [sp for sp in c["specializations"] if sp in viewer["specializations"]]
    if overlap:
        pts += 6 * len(overlap)
        reasons.append(f"Specialization overlap: {', '.join(overlap[:3])}")

    if c["location"] == viewer["location"]:
        pts += 8
        reasons.append(f"Both based in {c['location']}")

    pts += round(c["fit"]["overall"] * 0.15)
    c["match_score"] = max(1, min(100, pts))
    c["why"] = reasons[:4] or ["A fresh connection to broaden your network"]
    c["shared_values"] = shared_labels
    c["complementary_skills"] = comp


def _existing_intro_partners(session: Session, user: User) -> tuple:
    rows = session.exec(
        select(NetworkIntroduction).where(
            NetworkIntroduction.initiator_user_id == user.id
        )
    ).all()
    uids: set = set()
    iids: set = set()
    for r in rows:
        if r.recipient_user_id:
            uids.add(r.recipient_user_id)
        if r.recipient_investor_id:
            iids.add(r.recipient_investor_id)
    return uids, iids


@router.get("/candidates")
def list_candidates(
    location: Optional[str] = None,
    role: Optional[str] = None,
    specialization: Optional[str] = None,
    value: Optional[str] = None,
    archetype: Optional[str] = None,
    min_trust: int = 0,
    min_fit: int = 0,
    q: Optional[str] = None,
    limit: int = 40,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Ranked people-only matchmaking feed for the viewer. SAFE fields only —
    no contact details are ever emitted here (they unlock only on connect)."""
    viewer = _viewer_profile(session, user)
    skip_uids, skip_iids = _existing_intro_partners(session, user)

    pool: list = []
    for u in session.exec(select(User).where(User.is_active == True)).all():  # noqa: E712
        if u.id == user.id or u.role == UserRole.ADMIN:
            continue
        if u.id in skip_uids:
            continue
        if not u.name:
            continue
        pool.append(_candidate_from_user(session, u))
    for inv in session.exec(select(Investor).where(Investor.user_id.is_(None))).all():  # type: ignore[union-attr]
        if inv.id in skip_iids or not inv.display_name:
            continue
        pool.append(_candidate_from_investor(inv))

    for c in pool:
        _score_candidate(c, viewer)

    # Filter options come from the UNFILTERED pool so the controls stay stable.
    filter_options = {
        "locations": sorted({c["location"] for c in pool}),
        "roles": sorted({c["role"] for c in pool if c["role"]}),
        "specializations": sorted({s for c in pool for s in c["specializations"]}),
        "values": [{"key": k, "label": lbl} for k, lbl in _ALL_VALUE_AXES],
        "archetypes": [{"slug": s, "label": lbl} for s, lbl in _ARCHETYPES],
    }

    def _keep(c: dict) -> bool:
        if location and c["location"] != location:
            return False
        if role and (c["role"] or "") != role:
            return False
        if specialization and specialization not in c["specializations"]:
            return False
        if value:
            strong = {v["key"] for v in c["values"] if v["score"] >= 70}
            if value not in strong:
                return False
        if archetype and c["archetype"]["slug"] != archetype:
            return False
        if c["trust_score"] < min_trust or c["fit"]["overall"] < min_fit:
            return False
        if q:
            hay = (
                f"{c['name']} {c.get('company') or ''} {c.get('headline') or ''} "
                f"{' '.join(c['specializations'])} {' '.join(c['skills'])}"
            ).lower()
            if q.lower() not in hay:
                return False
        return True

    matched = [c for c in pool if _keep(c)]
    matched.sort(key=lambda c: (c["match_score"], c["trust_score"]), reverse=True)

    return {
        "candidates": matched[:max(1, min(limit, 100))],
        "total": len(matched),
        "viewer": {
            "archetype": viewer["archetype"],
            "location": viewer["location"],
            "top_values": [
                {"key": v["key"], "label": v["label"]}
                for v in sorted(viewer["values"], key=lambda x: -x["score"])[:3]
            ],
        },
        "filter_options": filter_options,
    }


def _referral_bonus(session: Session, user: User) -> int:
    """Connect credits earned via referrals. Real signal where cheaply
    available (members this user referred); prod uses the ledger referral
    bucket. Capped so it degrades gracefully."""
    if not user.partner_id:
        return 0
    referred = session.exec(
        select(User).where(User.referrer_partner_id == user.partner_id)
    ).all()
    return min(len(referred), 10)


def _connect_used_this_month(session: Session, user: User) -> int:
    now = datetime.utcnow()
    start = datetime(now.year, now.month, 1)
    rows = session.exec(
        select(NetworkIntroduction).where(
            NetworkIntroduction.initiator_user_id == user.id
        )
    ).all()
    return sum(1 for r in rows if r.created_at and r.created_at >= start)


def _connect_credit_state(session: Session, user: User) -> dict:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    cap = _CONNECT_CAP_BY_ROLE.get(role, _DEFAULT_CONNECT_CAP)
    referral = _referral_bonus(session, user)
    total = cap + referral
    used = _connect_used_this_month(session, user)
    return {
        "plan": role,
        "monthly_allowance": cap,
        "referral_bonus": referral,
        "total": total,
        "used": used,
        "balance": max(0, total - used),
        "buckets": {"allowance": cap, "referral": referral, "purchased": 0},
    }


@router.get("/connect-credits")
def connect_credits(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return _connect_credit_state(session, user)


# ---------------------------------------------------------------------------
# Create / list / detail
# ---------------------------------------------------------------------------
@router.post("")
def create_introduction(
    data: IntroCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    if not data.recipient_investor_id and not data.recipient_user_id:
        raise HTTPException(status_code=400, detail="A recipient investor or user is required")

    recipient_user: Optional[User] = None
    inv: Optional[Investor] = None

    if data.recipient_investor_id:
        inv = session.get(Investor, data.recipient_investor_id)
        if not inv:
            raise HTTPException(status_code=404, detail="Investor profile not found")
        if inv.user_id:
            recipient_user = session.get(User, inv.user_id)
    elif data.recipient_user_id:
        recipient_user = session.get(User, data.recipient_user_id)
        if not recipient_user:
            raise HTTPException(status_code=404, detail="Recipient not found")
        inv = (
            session.get(Investor, recipient_user.investor_id)
            if recipient_user.investor_id
            else None
        )

    if recipient_user and recipient_user.id == user.id:
        raise HTTPException(status_code=400, detail="You cannot request an introduction to yourself")

    off_platform = recipient_user is None
    if off_platform and not (inv and inv.contact_email):
        raise HTTPException(
            status_code=400,
            detail="This off-platform profile has no contact email on file",
        )

    # Guard against duplicate live requests to the same recipient.
    existing_q = select(NetworkIntroduction).where(
        NetworkIntroduction.initiator_user_id == user.id,
    )
    for row in session.exec(existing_q).all():
        same = (
            (recipient_user and row.recipient_user_id == recipient_user.id)
            or (inv and row.recipient_investor_id == inv.id)
        )
        if same and row.status not in TERMINAL_STATUSES:
            raise HTTPException(status_code=409, detail="You already have a pending introduction with this person")

    # Connect credits — gate the request behind the viewer's monthly allowance
    # (+ referral bonus). Exhaustion returns 402 so the UI can surface the
    # earn-more flow inline rather than tripping the global paywall.
    credit_state = _connect_credit_state(session, user)
    if credit_state["balance"] <= 0:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "connect_credits_exhausted",
                "message": (
                    "You've used all your connect credits this month. "
                    "Earn more through referrals or wait for your allowance to reset."
                ),
                "balance": 0,
                "total": credit_state["total"],
            },
        )

    recipient_name = (
        (inv.display_name if inv and inv.display_name else None)
        or (recipient_user.name if recipient_user else None)
        or "Unknown"
    )
    intro = NetworkIntroduction(
        initiator_user_id=user.id,
        recipient_user_id=recipient_user.id if recipient_user else None,
        recipient_investor_id=inv.id if inv else None,
        off_platform=off_platform,
        recipient_name=recipient_name,
        recipient_company=inv.company if inv else None,
        recipient_headline=inv.headline if inv else None,
        recipient_photo_url=inv.photo_url if inv else None,
        recipient_email=(inv.contact_email if off_platform and inv else None),
        draft_message=(data.message or None),
        status="pending",
        initiator_accepted=True,
        recipient_accepted=False,
    )
    session.add(intro)
    session.commit()
    session.refresh(intro)

    initiator_summary = _user_summary(session, user)

    if off_platform:
        # Mint a single-use tokenized review link and email the branded invite.
        raw, token_hash, expires = _mint_invite_token()
        intro.invite_token_hash = token_hash
        intro.invite_token_expires = expires
        review_url = _invite_url(raw)
        sent, _ = email_service.send_network_intro_invite(
            to_email=inv.contact_email,  # type: ignore[union-attr]
            recipient_name=recipient_name,
            requester=initiator_summary,
            message=intro.draft_message,
            review_url=review_url,
        )
        intro.email_sent = bool(sent)
        intro.email_sent_at = datetime.utcnow() if sent else None
        intro.status = "invited"
        session.add(intro)
        session.commit()
        session.refresh(intro)
    else:
        # On-platform recipient — in-app notification + inbox item. NEVER put
        # the recipient's email anywhere; never leak the initiator's email.
        intro.status = "invited"
        session.add(intro)
        session.commit()
        session.refresh(intro)
        try:
            notify(
                user_id=recipient_user.id,  # type: ignore[union-attr]
                type="network_intro_request",
                title=f"{initiator_summary['name']} wants an introduction",
                body=(intro.draft_message or "")[:280] or None,
                link="/advisor/network/introductions",
                payload={
                    "introduction_id": intro.id,
                    "introduction_uid": intro.uid,
                    "initiator_name": initiator_summary["name"],
                    "initiator_role": initiator_summary["role"],
                },
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("network intro notify failed: %s", exc)

    session.add(ActivityLog(
        action="network_intro_requested",
        details=f"intro #{intro.id} to {recipient_name} (off_platform={off_platform})",
        actor=user.email,
        user_id=user.id,
    ))
    session.commit()
    return _to_dto(session, intro, user)


@router.get("")
def list_introductions(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """All introductions where the caller is a participant (initiator or
    on-platform recipient), privacy-filtered."""
    stmt = select(NetworkIntroduction).where(
        (NetworkIntroduction.initiator_user_id == user.id)
        | (NetworkIntroduction.recipient_user_id == user.id)
    ).order_by(NetworkIntroduction.created_at.desc())
    rows = session.exec(stmt).all()
    return [_to_dto(session, r, user) for r in rows]


def _load_participant(session: Session, intro_id: int, user: User) -> NetworkIntroduction:
    intro = session.get(NetworkIntroduction, intro_id)
    if not intro:
        raise HTTPException(status_code=404, detail="Introduction not found")
    is_participant = (
        intro.initiator_user_id == user.id
        or (intro.recipient_user_id is not None and intro.recipient_user_id == user.id)
        or user.role == UserRole.ADMIN
    )
    if not is_participant:
        raise HTTPException(status_code=403, detail="Not a participant in this introduction")
    return intro


@router.get("/{intro_id}")
def get_introduction(
    intro_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    intro = _load_participant(session, intro_id, user)
    # Mark viewed when the recipient opens it for the first time.
    if (
        intro.recipient_user_id == user.id
        and intro.status in ("invited", "pending")
    ):
        intro.status = "viewed"
        intro.viewed_at = datetime.utcnow()
        intro.updated_at = datetime.utcnow()
        session.add(intro)
        session.commit()
        session.refresh(intro)
    return _to_dto(session, intro, user)


# ---------------------------------------------------------------------------
# Accept / decline (on-platform recipient)
# ---------------------------------------------------------------------------
def _apply_accept(session: Session, intro: NetworkIntroduction) -> None:
    now = datetime.utcnow()
    intro.recipient_accepted = True
    intro.accepted_at = now
    if intro.initiator_accepted:
        intro.status = "connected"
        intro.connected_at = now
    else:
        intro.status = "accepted"
    intro.updated_at = now


def _apply_decline(session: Session, intro: NetworkIntroduction) -> None:
    now = datetime.utcnow()
    intro.recipient_accepted = False
    intro.status = "declined"
    intro.declined_at = now
    intro.updated_at = now


@router.post("/{intro_id}/accept")
def accept_introduction(
    intro_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    intro = _load_participant(session, intro_id, user)
    if intro.recipient_user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the recipient can accept")
    if intro.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Introduction already {intro.status}")
    _apply_accept(session, intro)
    session.add(intro)
    session.commit()
    session.refresh(intro)
    _notify_initiator_outcome(session, intro, user, accepted=True)
    return _to_dto(session, intro, user)


@router.post("/{intro_id}/decline")
def decline_introduction(
    intro_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    intro = _load_participant(session, intro_id, user)
    if intro.recipient_user_id != user.id:
        raise HTTPException(status_code=403, detail="Only the recipient can decline")
    if intro.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Introduction already {intro.status}")
    _apply_decline(session, intro)
    session.add(intro)
    session.commit()
    session.refresh(intro)
    _notify_initiator_outcome(session, intro, user, accepted=False)
    return _to_dto(session, intro, user)


def _notify_initiator_outcome(
    session: Session, intro: NetworkIntroduction, recipient: User, *, accepted: bool
) -> None:
    try:
        verb = "accepted" if accepted else "declined"
        notify(
            user_id=intro.initiator_user_id,
            type=f"network_intro_{verb}",
            title=(
                f"{intro.recipient_name} accepted your introduction"
                if accepted
                else f"{intro.recipient_name} declined your introduction"
            ),
            body=(
                "You're now connected — contact details are unlocked."
                if accepted
                else None
            ),
            link="/advisor/network/introductions",
            payload={"introduction_id": intro.id, "introduction_uid": intro.uid},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("network intro outcome notify failed: %s", exc)


# ---------------------------------------------------------------------------
# Public tokenized review link (off-platform recipient, no auth)
# ---------------------------------------------------------------------------
def _load_by_token(session: Session, token: str) -> NetworkIntroduction:
    token_hash = _hash_token(token)
    intro = session.exec(
        select(NetworkIntroduction).where(
            NetworkIntroduction.invite_token_hash == token_hash
        )
    ).first()
    if not intro:
        raise HTTPException(status_code=404, detail="Invalid or expired review link")
    if intro.invite_token_expires and datetime.utcnow() > intro.invite_token_expires:
        if intro.status not in TERMINAL_STATUSES:
            intro.status = "expired"
            intro.expired_at = datetime.utcnow()
            session.add(intro)
            session.commit()
        raise HTTPException(status_code=400, detail="This review link has expired")
    return intro


def _public_dto(session: Session, intro: NetworkIntroduction) -> dict:
    """SAFE payload for the off-platform review page — the requester summary
    (no requester email) + the message + status. Contains NO email at all."""
    initiator = session.get(User, intro.initiator_user_id)
    return {
        "uid": intro.uid,
        "status": intro.status,
        "requester": _user_summary(session, initiator),
        "message": intro.draft_message,
        "recipient_name": intro.recipient_name,
        "already_responded": intro.status in TERMINAL_STATUSES,
        "register_url": (
            f"https://{os.environ.get('REPLIT_DEV_DOMAIN')}/register"
            if os.environ.get("REPLIT_DEV_DOMAIN")
            else "/register"
        ),
    }


@router.get("/invite/{token}")
def view_invite(token: str, session: Session = Depends(get_session)):
    intro = _load_by_token(session, token)
    if intro.status in ("invited", "pending"):
        intro.status = "viewed"
        intro.viewed_at = datetime.utcnow()
        intro.updated_at = datetime.utcnow()
        session.add(intro)
        session.commit()
        session.refresh(intro)
    return _public_dto(session, intro)


@router.post("/invite/{token}/accept")
def accept_invite(token: str, session: Session = Depends(get_session)):
    intro = _load_by_token(session, token)
    if intro.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Introduction already {intro.status}")
    _apply_accept(session, intro)
    intro.invite_used_at = datetime.utcnow()
    session.add(intro)
    session.commit()
    session.refresh(intro)
    _notify_initiator_outcome(session, intro, None, accepted=True)  # type: ignore[arg-type]
    return _public_dto(session, intro)


@router.post("/invite/{token}/decline")
def decline_invite(token: str, session: Session = Depends(get_session)):
    intro = _load_by_token(session, token)
    if intro.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Introduction already {intro.status}")
    _apply_decline(session, intro)
    intro.invite_used_at = datetime.utcnow()
    session.add(intro)
    session.commit()
    session.refresh(intro)
    _notify_initiator_outcome(session, intro, None, accepted=False)  # type: ignore[arg-type]
    return _public_dto(session, intro)


# ---------------------------------------------------------------------------
# Messaging — unlocked ONLY once connected
# ---------------------------------------------------------------------------
@router.get("/{intro_id}/messages")
def list_messages(
    intro_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    intro = _load_participant(session, intro_id, user)
    if intro.status != "connected":
        raise HTTPException(status_code=403, detail="Messaging unlocks once both sides connect")
    rows = session.exec(
        select(NetworkIntroMessage)
        .where(NetworkIntroMessage.introduction_id == intro.id)
        .order_by(NetworkIntroMessage.created_at.asc())
    ).all()
    out = []
    for m in rows:
        sender = session.get(User, m.sender_user_id)
        out.append({
            "id": m.id,
            "uid": m.uid,
            "body": m.body,
            "mine": m.sender_user_id == user.id,
            "sender_name": sender.name if sender else "Unknown",
            "created_at": m.created_at.isoformat() if m.created_at else None,
        })
    return out


@router.post("/{intro_id}/messages")
def post_message(
    intro_id: int,
    data: MessageCreate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    intro = _load_participant(session, intro_id, user)
    if intro.status != "connected":
        raise HTTPException(status_code=403, detail="Messaging unlocks once both sides connect")
    if user.role == UserRole.ADMIN and intro.initiator_user_id != user.id and intro.recipient_user_id != user.id:
        raise HTTPException(status_code=403, detail="Only participants can message")
    msg = NetworkIntroMessage(
        introduction_id=intro.id,
        sender_user_id=user.id,
        body=data.body.strip(),
    )
    session.add(msg)
    session.commit()
    session.refresh(msg)

    # Notify the other participant (on-platform only).
    other_id = (
        intro.recipient_user_id
        if intro.initiator_user_id == user.id
        else intro.initiator_user_id
    )
    if other_id:
        try:
            notify(
                user_id=other_id,
                type="network_intro_message",
                title=f"New message from {user.name}",
                body=data.body[:280],
                link="/advisor/network/introductions",
                payload={"introduction_id": intro.id},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("network intro message notify failed: %s", exc)
    return {
        "id": msg.id,
        "uid": msg.uid,
        "body": msg.body,
        "mine": True,
        "sender_name": user.name,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }

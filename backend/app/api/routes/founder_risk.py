"""Task #41 — Founder risk profile.

Auto-pulls external signal on a founder (LinkedIn / Crunchbase via the
existing PitchBook integration) and surfaces a deterministic risk score on
the deal record. Visible to admin / partner / investor. Founders cannot
read their own risk profile (it's an internal due-diligence signal).

Endpoints (all under /api/founder-risk):
  GET  /by-founder/{founder_id}   — read profile (404 if not yet pulled)
  GET  /by-deal/{deal_id}         — read profile via deal → project → founder
  POST /{founder_id}/pull         — pull from PitchBook (or synthetic) +
                                    recompute the score (admin/partner/investor)
  POST /{founder_id}/recompute    — recompute score from existing signal only
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from backend.app.api.deps import is_privileged
from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    Deal, Founder, FounderRiskProfile, Integration, Project, User,
)
from backend.app.services.crypto_box import decrypt
from backend.app.services.scoring import compute_founder_risk_score

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/founder-risk", tags=["Founder Risk"])


# ---------------------------------------------------------------------------
# Authz
# ---------------------------------------------------------------------------
def _ensure_internal(user: User) -> None:
    """Risk profiles are an internal DD signal — never exposed to the founder
    being profiled."""
    if not is_privileged(user):
        raise HTTPException(status_code=403, detail="Internal DD surface — admin / partner / investor only")


# ---------------------------------------------------------------------------
# DTO
# ---------------------------------------------------------------------------
def _to_dto(profile: FounderRiskProfile, founder: Optional[Founder] = None) -> dict:
    def _j(s):
        if not s: return None
        try: return json.loads(s)
        except Exception: return None
    return {
        "id": profile.id,
        "founder_id": profile.founder_id,
        "founder_name": founder.name if founder else None,
        "exits_count": profile.exits_count,
        "failures_count": profile.failures_count,
        "domain_expertise_years": profile.domain_expertise_years,
        "domain_tags": _j(profile.domain_tags_json) or [],
        "prior_roles": _j(profile.prior_roles_json) or [],
        "notable_signals": _j(profile.notable_signals_json) or [],
        "risk_score": profile.risk_score,
        "risk_band": profile.risk_band,
        "score_breakdown": _j(profile.score_breakdown_json) or {},
        "source_provider": profile.source_provider,
        "pulled_at": profile.pulled_at.isoformat() if profile.pulled_at else None,
        "computed_at": profile.computed_at.isoformat() if profile.computed_at else None,
    }


# ---------------------------------------------------------------------------
# PitchBook pull (with deterministic synthetic fallback)
# ---------------------------------------------------------------------------
PITCHBOOK_BASE = os.environ.get("PITCHBOOK_API_BASE", "https://api.pitchbook.com/v1")


def _pitchbook_search(api_key: str, founder: Founder) -> Optional[dict]:
    """Best-effort live PitchBook lookup. Returns the parsed founder
    payload, or None if the API is unreachable / returns nothing useful.

    NB: PitchBook's actual search endpoint isn't standardised across their
    tiers; we wrap a typical /people/search shape so this works against
    most account configurations and fails closed otherwise."""
    try:
        with httpx.Client(timeout=8.0) as client:
            r = client.get(
                f"{PITCHBOOK_BASE}/people/search",
                params={"q": founder.name, "email": founder.email},
                headers={"Authorization": f"Bearer {api_key}"},
            )
            if r.status_code != 200:
                logger.info("pitchbook search non-200 (%s) for founder %s",
                            r.status_code, founder.id)
                return None
            data = r.json()
            results = data.get("results") or data.get("people") or []
            if not results:
                return None
            person = results[0]
            roles = []
            for emp in (person.get("employment_history") or person.get("positions") or []):
                roles.append({
                    "title": emp.get("title") or emp.get("role"),
                    "company": (emp.get("company") or {}).get("name") or emp.get("company_name"),
                    "years": emp.get("duration_years"),
                    "seniority": _classify_seniority(emp.get("title") or ""),
                    "outcome": emp.get("outcome"),
                })
            exits = sum(1 for r in roles if (r.get("outcome") or "").lower() in ("acquired", "ipo", "exit"))
            failures = sum(1 for r in roles if (r.get("outcome") or "").lower() in ("shutdown", "shut_down", "failed", "dissolved"))
            years = int(person.get("years_of_experience") or sum(int(r.get("years") or 0) for r in roles))
            return {
                "prior_roles": roles,
                "exits_count": exits,
                "failures_count": failures,
                "domain_expertise_years": years,
                "domain_tags": person.get("industries") or person.get("domain_tags") or [],
                "notable_signals": person.get("highlights") or [],
                "raw": data,
                "provider": "pitchbook",
            }
    except Exception as exc:  # noqa: BLE001
        logger.warning("pitchbook lookup failed for founder %s: %s", founder.id, exc)
        return None


_SENIOR_TOKENS = ("ceo", "cto", "cfo", "coo", "vp", "vice president", "head of", "founder", "chief", "director")


def _classify_seniority(title: str) -> str:
    t = (title or "").lower()
    if any(tok in t for tok in _SENIOR_TOKENS):
        return "senior"
    return "individual"


def _synthetic_profile(founder: Founder) -> dict:
    """Deterministic synthetic profile derived from the founder's identity
    so the workflow is demonstrable without PitchBook credentials. Uses
    a stable hash of email so re-pulls return identical data."""
    seed = int(hashlib.sha256((founder.email or founder.name or str(founder.id)).encode()).hexdigest()[:8], 16)
    rng = lambda mod: seed % mod  # noqa: E731
    exits = rng(4)                                          # 0..3
    failures = (seed >> 4) % 3                              # 0..2
    years = max(int(getattr(founder, "experience_years", 0) or 0),
                3 + (seed >> 8) % 18)                       # 3..20
    domain = (founder.domain_expertise or "").strip()
    tags = [t.strip().lower() for t in (domain.split(",") if domain else []) if t.strip()]
    if not tags:
        tags = [["fintech", "ai/ml", "b2b-saas", "consumer", "biotech"][rng(5)]]
    role_pool = [
        ("CEO", "Acme Co", "senior", "acquired" if exits > 0 else None),
        ("VP Engineering", "Beta Labs", "senior", None),
        ("Senior PM", "Gamma Inc", "individual", None),
        ("Founder", "Delta Studio", "senior", "shutdown" if failures > 0 else None),
        ("Engineer", "Epsilon Tech", "individual", None),
    ]
    n_roles = 2 + rng(3)  # 2..4
    roles = []
    for i in range(n_roles):
        title, company, sen, outcome = role_pool[i % len(role_pool)]
        roles.append({"title": title, "company": company,
                       "years": 2 + ((seed >> (i * 3)) % 5),
                       "seniority": sen, "outcome": outcome})
    signals = []
    if exits >= 2: signals.append(f"{exits} prior exits")
    if years >= 10: signals.append(f"{years}+ yrs domain experience")
    if failures >= 2: signals.append(f"{failures} prior shut-downs")
    return {
        "prior_roles": roles,
        "exits_count": exits,
        "failures_count": failures,
        "domain_expertise_years": years,
        "domain_tags": tags,
        "notable_signals": signals,
        "raw": {"synthetic": True, "seed": seed},
        "provider": "synthetic",
    }


def _resolve_pitchbook_integration(session: Session) -> tuple[Optional[str], Optional[str]]:
    """Find any active pitchbook integration on the platform. Returns
    (api_key, integration_uid) or (None, None)."""
    integ = session.exec(
        select(Integration)
        .where(Integration.provider_name == "pitchbook")
        .where(Integration.status == "active")
    ).first()
    if not integ or not integ.api_key_encrypted:
        return None, None
    try:
        return decrypt(integ.api_key_encrypted), integ.uid
    except Exception as exc:  # noqa: BLE001
        logger.warning("pitchbook key decrypt failed: %s", exc)
        return None, integ.uid


def _persist_profile(session: Session, founder: Founder, signal: dict,
                     integration_uid: Optional[str]) -> FounderRiskProfile:
    scored = compute_founder_risk_score(signal)
    now = datetime.utcnow()
    profile = session.exec(
        select(FounderRiskProfile).where(FounderRiskProfile.founder_id == founder.id)
    ).first()
    if not profile:
        profile = FounderRiskProfile(founder_id=founder.id)
    profile.prior_roles_json       = json.dumps(signal.get("prior_roles") or [])
    profile.exits_count            = int(signal.get("exits_count") or 0)
    profile.failures_count         = int(signal.get("failures_count") or 0)
    profile.domain_expertise_years = int(signal.get("domain_expertise_years") or 0)
    profile.domain_tags_json       = json.dumps(signal.get("domain_tags") or [])
    profile.notable_signals_json   = json.dumps(signal.get("notable_signals") or [])
    profile.raw_payload_json       = json.dumps(signal.get("raw") or {})[:200_000]
    profile.source_provider        = signal.get("provider")
    profile.source_integration_uid = integration_uid
    profile.pulled_at              = now
    profile.risk_score             = scored["risk_score"]
    profile.risk_band              = scored["risk_band"]
    profile.score_breakdown_json   = json.dumps(scored["breakdown"])
    profile.computed_at            = now
    profile.updated_at             = now
    session.add(profile); session.commit(); session.refresh(profile)
    return profile


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/by-founder/{founder_id}")
def read_by_founder(
    founder_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_internal(user)
    founder = session.get(Founder, founder_id)
    if not founder:
        raise HTTPException(status_code=404, detail="Founder not found")
    profile = session.exec(
        select(FounderRiskProfile).where(FounderRiskProfile.founder_id == founder_id)
    ).first()
    if not profile:
        return {"founder_id": founder_id, "founder_name": founder.name, "profile": None}
    return {"founder_id": founder_id, "founder_name": founder.name, "profile": _to_dto(profile, founder)}


@router.get("/by-deal/{deal_id}")
def read_by_deal(
    deal_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_internal(user)
    deal = session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    project = session.get(Project, deal.project_id) if deal.project_id else None
    if not project or not project.founder_id:
        return {"deal_id": deal_id, "founder_id": None, "profile": None}
    founder = session.get(Founder, project.founder_id)
    profile = session.exec(
        select(FounderRiskProfile).where(FounderRiskProfile.founder_id == project.founder_id)
    ).first()
    return {
        "deal_id": deal_id,
        "founder_id": project.founder_id,
        "founder_name": founder.name if founder else None,
        "profile": _to_dto(profile, founder) if profile else None,
    }


@router.post("/{founder_id}/pull")
def pull_profile(
    founder_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _ensure_internal(user)
    founder = session.get(Founder, founder_id)
    if not founder:
        raise HTTPException(status_code=404, detail="Founder not found")

    api_key, integ_uid = _resolve_pitchbook_integration(session)
    signal = None
    if api_key:
        signal = _pitchbook_search(api_key, founder)
    if not signal:
        signal = _synthetic_profile(founder)
    profile = _persist_profile(session, founder, signal, integ_uid)
    return {
        "founder_id": founder_id,
        "founder_name": founder.name,
        "profile": _to_dto(profile, founder),
        "source": signal["provider"],
    }


@router.post("/{founder_id}/recompute")
def recompute(
    founder_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    """Re-run the deterministic scoring against existing signal — useful
    after weights are tuned. Does NOT re-pull from the upstream provider."""
    _ensure_internal(user)
    profile = session.exec(
        select(FounderRiskProfile).where(FounderRiskProfile.founder_id == founder_id)
    ).first()
    if not profile:
        raise HTTPException(status_code=404, detail="No profile on file — call /pull first")
    signal = {
        "prior_roles": json.loads(profile.prior_roles_json or "[]"),
        "exits_count": profile.exits_count,
        "failures_count": profile.failures_count,
        "domain_expertise_years": profile.domain_expertise_years,
    }
    scored = compute_founder_risk_score(signal)
    now = datetime.utcnow()
    profile.risk_score = scored["risk_score"]
    profile.risk_band = scored["risk_band"]
    profile.score_breakdown_json = json.dumps(scored["breakdown"])
    profile.computed_at = now
    profile.updated_at = now
    session.add(profile); session.commit(); session.refresh(profile)
    founder = session.get(Founder, founder_id)
    return {"founder_id": founder_id, "profile": _to_dto(profile, founder)}

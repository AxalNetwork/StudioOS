"""Dev-parity port of the production Worker's ``/matches`` router.

The production API for the AI Matching Engine is the Cloudflare Worker at
``cloudflare-worker/src/routes/matches.ts`` (Workers AI + D1). The dev FastAPI
backend has neither Workers AI nor the Worker's richer schema, so this module
mirrors the Worker's RESPONSE SHAPES and its rule-based scoring fallback so the
``/matches`` page works end-to-end in the Replit preview. Behavioural
divergences from prod (all explicit, dev-only):

* No Cloudflare Workers AI → rule-based scoring only. Every item reports
  ``model: 'rule-based'`` and ``cached: False`` (no ``match_scores`` cache).
* No matching-consent table (``user_settings.matching_opt_in``) in dev, so
  every investor-role user is a candidate. The Worker's privacy-first consent
  gate (``filterOptedInUserIds``) is untouched in prod.
* Investor thesis data lives in the dev ``investors`` table (the Worker reads
  the richer ``investor_profiles``); ``user_values`` and
  ``investor_introductions`` do not exist in dev, so values_alignment and
  network_warmth always score 0.
"""

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import (
    Deal,
    DealStatus,
    Investor,
    Project,
    ProjectStatus,
    User,
    UserRole,
)

# Every matching endpoint requires an authenticated session.
router = APIRouter(
    prefix="/matches",
    tags=["AI Matching Engine"],
    dependencies=[Depends(get_current_user)],
)

logger = logging.getLogger("studioos.matches")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _enum_value(v: Any) -> Optional[str]:
    if v is None:
        return None
    return v.value if hasattr(v, "value") else str(v)


def _parse_list(raw: Any) -> list[str]:
    """Parse a stored list that may be a JSON array string OR a comma-separated
    string (the dev ``investors.sector_focus`` / ``stage_focus`` columns use the
    latter). Returns a list of non-empty, stripped strings."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    s = str(raw).strip()
    if not s:
        return []
    try:
        parsed = json.loads(s)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except (ValueError, TypeError):
        # not a JSON list — fall through to comma-split parsing below
        logger.debug("matches: value is not JSON, using comma-split parse", exc_info=True)
    return [part.strip() for part in s.split(",") if part.strip()]


def _project_dict(p: Project) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "sector": p.sector,
        "stage": p.stage,
        "status": _enum_value(p.status),
        "problem_statement": p.problem_statement,
        "solution": p.solution,
        "why_now": p.why_now,
        "funding_needed": p.funding_needed,
        "tam": p.tam,
        "revenue": p.revenue,
        "users_count": p.users_count,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _load_prefs(session: Session, uid: int) -> Optional[dict]:
    row = session.exec(
        text(
            "SELECT investment_focus, preferred_stages, preferred_roles, "
            "min_check_cents, max_check_cents, risk_tolerance, bio, updated_at "
            "FROM user_preferences WHERE user_id = :uid"
        ).bindparams(uid=uid)
    ).first()
    return dict(row._mapping) if row else None


def _rule_score_deal_flow(project: dict, prefs: Optional[dict]) -> tuple[float, list[str]]:
    """Port of ``ruleScoreDealFlow`` from the Worker. Deterministic, 0-100."""
    score = 50.0
    reasons: list[str] = []
    focus = _parse_list(prefs.get("investment_focus")) if prefs else []
    stages = _parse_list(prefs.get("preferred_stages")) if prefs else []

    sector = project.get("sector")
    if focus and sector:
        sector_lower = sector.lower()
        hit = any(sector_lower in f.lower() or f.lower() in sector_lower for f in focus)
        if hit:
            score += 25
            reasons.append(f"Sector match: {sector}")
        else:
            score -= 10
            reasons.append(f"Sector mismatch: {sector} not in focus")

    stage = project.get("stage")
    if stages and stage and stage in stages:
        score += 15
        reasons.append(f"Stage match: {stage}")

    status = project.get("status")
    if status == "tier_1":
        score += 15
        reasons.append("Tier-1 vetted")
    elif status == "tier_2":
        score += 5
        reasons.append("Tier-2 vetted")
    elif status == "rejected":
        score -= 30
        reasons.append("Rejected by scoring engine")

    funding_min = (prefs.get("min_check_cents") / 100) if prefs and prefs.get("min_check_cents") else None
    funding_max = (prefs.get("max_check_cents") / 100) if prefs and prefs.get("max_check_cents") else None
    funding = project.get("funding_needed")
    if funding:
        if funding_max and funding > funding_max:
            score -= 8
            reasons.append("Above max check size")
        elif funding_min and funding < funding_min:
            score -= 5
            reasons.append("Below min check size")
        elif funding_min or funding_max:
            score += 8
            reasons.append("Within check size range")

    return max(0.0, min(100.0, score)), reasons


# ---------------------------------------------------------------------------
# Deal flow
# ---------------------------------------------------------------------------
@router.get("/deal-flow")
def deal_flow(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    prefs = _load_prefs(session, user.id)
    projects = session.exec(
        select(Project)
        .where(Project.status != ProjectStatus.REJECTED)
        .order_by(Project.created_at.desc())
        .limit(50)
    ).all()

    items = []
    for p in projects:
        proj = _project_dict(p)
        score, reasons = _rule_score_deal_flow(proj, prefs)
        items.append({
            "project": proj,
            "score": score,
            "explanation": "; ".join(reasons),
            "model": "rule-based",
            "cached": False,
        })
    items.sort(key=lambda x: x["score"], reverse=True)
    # No Workers AI in dev → no LLM budget is consumed.
    return {"user_id": user.id, "items": items, "llm_budget_remaining": 0}


# ---------------------------------------------------------------------------
# Co-investment
# ---------------------------------------------------------------------------
@router.get("/co-invest")
def co_invest(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    prefs = _load_prefs(session, user.id)
    projects = session.exec(
        select(Project)
        .join(Deal, Deal.project_id == Project.id)
        .where(
            Project.status.in_([ProjectStatus.TIER_1, ProjectStatus.TIER_2]),
            Deal.status.in_([DealStatus.ACTIVE, DealStatus.SCORED]),
        )
        .order_by(Project.created_at.desc())
        .limit(30)
    ).all()

    items = []
    for p in projects:
        proj = _project_dict(p)
        score, reasons = _rule_score_deal_flow(proj, prefs)
        items.append({
            "project": proj,
            "score": score,
            "explanation": "; ".join(reasons),
            "cached": False,
        })
    items.sort(key=lambda x: x["score"], reverse=True)
    return {"items": items[:10], "total": len(items)}


# ---------------------------------------------------------------------------
# Referral quality
# ---------------------------------------------------------------------------
@router.get("/referral-scores")
def referral_scores(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    rows = session.exec(
        text(
            """
            SELECT r.id AS id, r.status AS status, r.created_at AS created_at,
                   r.converted_at AS converted_at,
                   u.id AS referred_user_id, u.name AS name, u.email AS email,
                   COALESCE((
                       SELECT SUM(amount_cents) FROM commissions
                       WHERE source_id = 'kyc:' || u.id AND user_id = r.referrer_id
                   ), 0) AS earned_cents
            FROM referrals r
            JOIN users u ON u.id = r.referred_id
            WHERE r.referrer_id = :uid
            ORDER BY r.created_at DESC
            """
        ).bindparams(uid=user.id)
    ).all()

    items = []
    for row in rows:
        m = row._mapping
        # Rule-based quality (the Worker's fallback path). Dev users have no
        # kyc_status column, so KYC contributes nothing and surfaces as
        # 'not_started' in the UI.
        base = 20
        if m["status"] == "converted":
            base += 20
        earned = int(m["earned_cents"] or 0)
        if earned > 0:
            base += min(30, earned // 5000)
        score = min(100, base)
        items.append({
            "referral": {
                "id": m["id"],
                "name": m["name"],
                "email": m["email"],
                "kyc_status": "not_started",
                "status": m["status"],
            },
            "score": score,
            "explanation": f"status={m['status']}, earned=${earned / 100:.2f}",
            "cached": False,
        })
    items.sort(key=lambda x: x["score"], reverse=True)
    return {"items": items, "count": len(items)}


# ---------------------------------------------------------------------------
# Investor matching (founder-facing, Task #16)
# ---------------------------------------------------------------------------
_MATCH_WEIGHTS = {
    "thesis_fit": 0.45,
    "traction_fit": 0.20,
    "values_alignment": 0.20,
    "network_warmth": 0.15,
}


@router.post("/investor-match")
def investor_match(
    payload: dict = Body(default={}),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be an object")
    raw_pid = payload.get("project_id")
    try:
        project_id = int(raw_pid) if raw_pid is not None else None
    except (ValueError, TypeError):
        project_id = None
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id required")

    role_str = (_enum_value(user.role) or "").lower()
    if role_str not in ("founder", "admin"):
        raise HTTPException(status_code=403, detail="founder_required")

    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # Ownership check: admins match-make for any project; founders only for
    # their own. (The dev `projects` table has no `user_id` column, so we gate
    # on `founder_id`.) A NULL founder_id on either side must NOT match —
    # otherwise a founder with no founder_id could reach orphaned projects.
    # Mirror the Worker by 404-ing on a non-owned project.
    if role_str != "admin":
        if (
            user.founder_id is None
            or project.founder_id is None
            or project.founder_id != user.founder_id
        ):
            raise HTTPException(status_code=404, detail="Project not found")

    # Candidate investors. Dev has no matching-consent gate, so every
    # investor-role user is a candidate (see module docstring).
    investor_users = session.exec(
        select(User).where(User.role == UserRole.INVESTOR).order_by(User.id)
    ).all()
    profiles: dict[int, Investor] = {}
    investor_ids = [u.id for u in investor_users]
    if investor_ids:
        for inv in session.exec(
            select(Investor).where(Investor.user_id.in_(investor_ids))
        ).all():
            if inv.user_id is not None:
                profiles[inv.user_id] = inv

    project_sector = (project.sector or "").strip().lower()
    project_stage = (project.stage or "").strip().lower()
    project_status = _enum_value(project.status)
    project_funding = float(project.funding_needed) if project.funding_needed is not None else None
    project_revenue = float(project.revenue) if project.revenue else 0.0
    project_users = int(project.users_count) if project.users_count else 0

    scored = []
    for cand in investor_users:
        prof = profiles.get(cand.id)
        name = cand.name or cand.email or "Investor"
        sectors = _parse_list(prof.sector_focus) if prof else []
        stages = _parse_list(prof.stage_focus) if prof else []
        eff_min = float(prof.check_size_min) if prof and prof.check_size_min is not None else 0.0
        eff_max = float(prof.check_size_max) if prof and prof.check_size_max is not None else 5_000_000.0
        empty_breakdown = {"thesis_fit": 0, "traction_fit": 0, "values_alignment": 0, "network_warmth": 0}

        # ---- Check-size band gate (hard exclude) ----
        if project_funding is not None and project_funding < eff_min:
            scored.append({
                "investor_id": prof.id if prof else None,
                "user_id": cand.id, "name": name, "excluded": True,
                "reason": "Below minimum check size", "match_score": 0,
                "breakdown": empty_breakdown,
            })
            continue
        if project_funding is not None and project_funding > eff_max:
            scored.append({
                "investor_id": prof.id if prof else None,
                "user_id": cand.id, "name": name, "excluded": True,
                "reason": "Above maximum check size", "match_score": 0,
                "breakdown": empty_breakdown,
            })
            continue

        reasons: list[str] = []

        # ---- Thesis fit (0-100) ----
        thesis = 0
        if sectors and project_sector:
            hit = any(project_sector in s.lower() or s.lower() in project_sector for s in sectors)
            if hit:
                thesis += 40
                reasons.append(f"Sector match: {project.sector}")
            else:
                thesis -= 10
                reasons.append(f"Sector mismatch: {project.sector}")
        if stages and project_stage:
            hit = any(project_stage in s.lower() or s.lower() in project_stage for s in stages)
            if hit:
                thesis += 30
                reasons.append(f"Stage match: {project.stage}")
            else:
                thesis -= 5
                reasons.append(f"Stage mismatch: {project.stage}")
        thesis = max(0, min(100, thesis))

        # ---- Traction fit (0-100) ----
        traction = 0
        if project_status == "tier_1":
            traction += 40
            reasons.append("Tier-1 vetted")
        elif project_status == "tier_2":
            traction += 25
            reasons.append("Tier-2 vetted")
        elif project_status == "active":
            traction += 15
        if project_revenue > 0:
            traction += 20
            reasons.append("Revenue traction")
        if project_users > 0:
            traction += 10
            reasons.append("User traction")
        traction = max(0, min(100, traction))

        # ---- Values / network: no source data in dev ----
        values_alignment = 0
        network_warmth = 0

        overall = round(
            thesis * _MATCH_WEIGHTS["thesis_fit"]
            + traction * _MATCH_WEIGHTS["traction_fit"]
            + values_alignment * _MATCH_WEIGHTS["values_alignment"]
            + network_warmth * _MATCH_WEIGHTS["network_warmth"]
        )

        scored.append({
            "investor_id": prof.id if prof else None,
            "user_id": cand.id,
            "name": name,
            "excluded": False,
            "match_score": overall,
            "breakdown": {
                "thesis_fit": thesis,
                "traction_fit": traction,
                "values_alignment": values_alignment,
                "network_warmth": network_warmth,
            },
            "reasons": reasons[:6],
            "thesis": {
                "sectors": sectors,
                "stages": stages,
                "ticket_band": None,
                "check_size_min": eff_min,
                "check_size_max": eff_max,
            },
        })

    ranked = sorted(
        [s for s in scored if not s["excluded"]],
        key=lambda x: x["match_score"],
        reverse=True,
    )
    excluded = [s for s in scored if s["excluded"]]
    return {
        "project_id": project_id,
        "project_name": project.name,
        "ranked": ranked,
        "excluded": excluded[:10],
        "total_investors": len(scored),
    }

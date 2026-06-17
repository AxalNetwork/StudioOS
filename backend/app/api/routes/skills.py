"""Task #38 — DEV-ONLY skills shim.

The production Cloudflare Worker hosts ``/api/skills/*`` (taxonomy, self
ratings, peer endorsements, blended aggregates) backed by D1
(``cloudflare-worker/src/routes/skills.ts``). The dev FastAPI backend has
no skills tables, so the Skills Profile page used to 404 ("Error: Not
found") in the local preview.

This is a dev-only parity shim: it serves a small seeded taxonomy and
keeps each user's self-ratings in-process so the page loads, renders, and
round-trips a save within a dev session. It deliberately does NOT
implement peer endorsements/blending (returns empty aggregates) — the dev
backend never deploys (replit.md), so this can never serve prod traffic.
Response shapes mirror the Worker so the API↔Worker drift checker matches
them to the ``/api/skills`` mount.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends

from backend.app.api.routes.auth import get_current_user
from backend.app.models.entities import User

router = APIRouter(prefix="/skills", tags=["Skills"])

_SENIORITY = ["Junior", "Mid", "Senior", "Lead", "Principal"]

# (category_slug, label, is_radar_axis, [(skill_slug, label, description)])
_CATEGORY_DEFS = [
    ("engineering", "Engineering", True, [
        ("backend", "Backend Development", "APIs, services, data modeling."),
        ("frontend", "Frontend Development", "Web UI, state, accessibility."),
        ("infra", "DevOps & Infrastructure", "CI/CD, cloud, observability."),
        ("data_eng", "Data Engineering", "Pipelines, warehousing, ETL."),
    ]),
    ("product", "Product", True, [
        ("product_mgmt", "Product Management", "Roadmap, discovery, delivery."),
        ("ux_design", "UX / Product Design", "Flows, wireframes, visual design."),
        ("user_research", "User Research", "Interviews, usability, synthesis."),
    ]),
    ("gtm", "Go-to-Market", True, [
        ("sales", "Sales", "Pipeline, closing, account management."),
        ("marketing", "Marketing", "Positioning, content, demand gen."),
        ("growth", "Growth", "Funnels, experimentation, retention."),
    ]),
    ("operations", "Operations", True, [
        ("finance", "Finance & Accounting", "Modeling, budgeting, reporting."),
        ("legal", "Legal & Compliance", "Contracts, governance, risk."),
        ("people", "People & Talent", "Hiring, culture, org design."),
    ]),
]


def _build_taxonomy() -> tuple[list[dict], set[int]]:
    categories: list[dict] = []
    valid_ids: set[int] = set()
    next_id = 1
    for c_order, (slug, label, is_axis, skills) in enumerate(_CATEGORY_DEFS):
        skill_payload = []
        for s_order, (s_slug, s_label, s_desc) in enumerate(skills):
            skill_payload.append({
                "id": next_id,
                "slug": s_slug,
                "label": s_label,
                "description": s_desc,
                "seniority_levels": _SENIORITY,
                "display_order": s_order,
            })
            valid_ids.add(next_id)
            next_id += 1
        categories.append({
            "slug": slug,
            "label": label,
            "description": None,
            "is_radar_axis": is_axis,
            "radar_weight": 1,
            "display_order": c_order,
            "skills": skill_payload,
        })
    return categories, valid_ids


_TAXONOMY, _VALID_SKILL_IDS = _build_taxonomy()
_TAXONOMY_ETAG = f'W/"sktax-dev-{len(_VALID_SKILL_IDS)}"'

# In-process self-ratings: user_id -> {skill_id -> rating dict}. A module
# dict is fine for a single-worker dev server; it resets on --reload but
# survives a page reload within a dev session.
_RATINGS: dict[int, dict[int, dict]] = {}


def _clamp_level(raw: Any) -> int:
    try:
        n = int(round(float(raw)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(5, n))


def _norm_years(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        y = float(raw)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(60.0, y))


def _norm_evidence(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if not (s.startswith("http://") or s.startswith("https://")):
        return ""  # sentinel: invalid (caller turns into 400)
    return s[:500]


def _ratings_list(user_id: int) -> list[dict]:
    rows = _RATINGS.get(user_id, {})
    return [
        {
            "skill_id": sid,
            "self_level": r.get("self_level", 0),
            "evidence_url": r.get("evidence_url") or None,
            "years": r.get("years"),
            "updated_at": r.get("updated_at"),
        }
        for sid, r in sorted(rows.items())
    ]


@router.get("/taxonomy")
def get_taxonomy(user: User = Depends(get_current_user)):
    return {"categories": _TAXONOMY, "etag": _TAXONOMY_ETAG}


@router.get("/me")
def get_my_skills(user: User = Depends(get_current_user)):
    return {"ratings": _ratings_list(user.id)}


@router.put("/me")
def put_my_skills(payload: dict, user: User = Depends(get_current_user)):
    from fastapi import HTTPException
    ratings = (payload or {}).get("ratings")
    if not isinstance(ratings, list):
        raise HTTPException(status_code=400, detail="Expected { ratings: [...] }.")
    if len(ratings) > 500:
        raise HTTPException(status_code=400, detail="Too many ratings in one request.")
    store = _RATINGS.setdefault(user.id, {})
    now = datetime.utcnow().isoformat()
    for raw in ratings:
        try:
            skill_id = int(raw.get("skill_id"))
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(status_code=400, detail=f"Unknown skill_id: {raw}")
        if skill_id not in _VALID_SKILL_IDS:
            raise HTTPException(status_code=400, detail=f"Unknown skill_id: {skill_id}")
        level = _clamp_level(raw.get("self_level"))
        if level <= 0:
            store.pop(skill_id, None)
            continue
        evidence = None
        if raw.get("evidence_url") not in (None, ""):
            evidence = _norm_evidence(raw.get("evidence_url"))
            if evidence == "":
                raise HTTPException(status_code=400, detail="Evidence link must start with http:// or https://")
        store[skill_id] = {
            "self_level": level,
            "evidence_url": evidence,
            "years": _norm_years(raw.get("years")),
            "updated_at": now,
        }
    return {"ratings": _ratings_list(user.id)}


@router.get("/me/aggregate")
def get_my_aggregate(user: User = Depends(get_current_user)):
    # Dev has no peer endorsements, so the blended score is just the self
    # rating with empty peer signal — enough for the page to render.
    skills = [
        {
            "skill_id": r["skill_id"],
            "self_level": r["self_level"],
            "peer_avg": 0,
            "peer_count": 0,
            "blended": r["self_level"],
        }
        for r in _ratings_list(user.id)
    ]
    return {"user_id": user.id, "skills": skills}


@router.post("/endorsements")
def post_endorsement(payload: dict, user: User = Depends(get_current_user)):
    from fastapi import HTTPException
    body = payload or {}
    try:
        endorsee_id = int(body.get("endorsee_id"))
        skill_id = int(body.get("skill_id"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="endorsee_id and skill_id are required.")
    if skill_id not in _VALID_SKILL_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown skill_id: {skill_id}")
    if endorsee_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot endorse yourself.")
    level = _clamp_level(body.get("level"))
    if level < 1:
        raise HTTPException(status_code=400, detail="Endorsement level must be between 1 and 5.")
    note = None
    if body.get("note"):
        note = str(body["note"]).strip()[:1000]
    return {
        "endorsement": {
            "endorser_id": user.id,
            "endorsee_id": endorsee_id,
            "skill_id": skill_id,
            "level": level,
            "note": note,
            "updated_at": datetime.utcnow().isoformat(),
        }
    }


@router.get("/users/{user_id}/aggregate")
def get_user_aggregate(user_id: int, user: User = Depends(get_current_user)):
    # Dev stub: only the caller's own ratings are known in-process; for any
    # other user we return an empty (but valid) aggregate.
    if user_id == user.id:
        return get_my_aggregate(user)
    return {"user_id": user_id, "skills": []}

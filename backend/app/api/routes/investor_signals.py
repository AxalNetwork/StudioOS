"""Dev-only port of the worker's /investor-signals + /investor-profile routes.

The production aggregator runs in the Cloudflare Worker (k-anonymity ≥5,
sector/stage/geo/ticket cells masked when below the threshold). This dev
port keeps the same response shapes so the Market Intelligence "Axal
Investor Signals" tab renders without 404s; profiles are stored as a JSON
blob in a single-row helper table per user, and the snapshot endpoint
always returns `snapshot: null` (no aggregator runs in dev).
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from sqlalchemy import text

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User

router = APIRouter()
investor_profile = APIRouter(prefix="/investor-profile", tags=["investor-profile"])
investor_signals = APIRouter(prefix="/investor-signals", tags=["investor-signals"])

MIN_CELL_SIZE = 5

SECTOR_OPTIONS = {
    "AI/ML", "Climate", "Fintech", "Healthtech", "Consumer",
    "Enterprise SaaS", "Crypto", "Bio", "Defense", "Robotics", "Energy",
}
STAGE_OPTIONS = {"Pre-seed", "Seed", "Series A", "Series B+", "Growth"}
GEO_OPTIONS = {"North America", "Europe", "LATAM", "APAC", "MENA", "Africa"}
TICKET_BANDS = {"<$10k", "$10k-$50k", "$50k-$250k", "$250k-$1M", "$1M+"}
TICKET_RANGES = {
    "<$10k": (0, 10_000),
    "$10k-$50k": (10_000, 50_000),
    "$50k-$250k": (50_000, 250_000),
    "$250k-$1M": (250_000, 1_000_000),
    "$1M+": (1_000_000, 5_000_000),
}

_schema_ready = False


def _ensure_schema(session: Session) -> None:
    global _schema_ready
    if _schema_ready:
        return
    try:
        session.exec(text("""
            CREATE TABLE IF NOT EXISTS investor_profiles_dev (
                user_id INTEGER PRIMARY KEY,
                payload TEXT NOT NULL DEFAULT '{}',
                completed_at TIMESTAMP NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """))
        session.commit()
        _schema_ready = True
    except Exception:
        session.rollback()


def _empty_profile(user_id: int) -> dict:
    return {
        "user_id": user_id,
        "investor_type": None,
        "sectors": [],
        "stages": [],
        "geos": [],
        "ticket_band": None,
        "ticket_min_usd": None,
        "ticket_max_usd": None,
        "thesis_text": None,
        "thesis_keywords": [],
        "contribute_to_signals": True,
        "anti_thesis_sectors": [],
        "anti_thesis_stages": [],
        "value_weights": {},
        "accreditation_status": None,
        "country": None,
        "firm_name": None,
        "lp_intent": None,
        "lp_target_usd": None,
        "notes": None,
        "completed_at": None,
        "updated_at": None,
    }


def _shape(payload: dict, completed_at: Optional[str], updated_at: Optional[str], user_id: int) -> dict:
    base = _empty_profile(user_id)
    base.update(payload or {})
    base["completed_at"] = completed_at
    base["updated_at"] = updated_at
    return base


def _load(session: Session, user_id: int) -> dict:
    _ensure_schema(session)
    row = session.exec(
        text("SELECT payload, completed_at, updated_at FROM investor_profiles_dev WHERE user_id = :uid"),
        params={"uid": user_id},
    ).first()
    if row is None:
        return _shape({}, None, None, user_id)
    m = dict(row._mapping)  # type: ignore[attr-defined]
    try:
        payload = json.loads(m.get("payload") or "{}")
    except Exception:
        payload = {}
    return _shape(payload, m.get("completed_at"), m.get("updated_at"), user_id)


def _filter_set(raw: Any, allowed: set[str]) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for v in raw:
        if isinstance(v, str) and v in allowed and v not in out:
            out.append(v)
    return out


def _extract_keywords(text_in: str) -> list[str]:
    import re
    words = re.findall(r"[a-z0-9]{3,}", (text_in or "").lower())
    stop = {"the", "and", "for", "with", "are", "this", "that", "from", "but",
            "not", "you", "our", "their", "they", "have", "has", "will", "can"}
    seen: list[str] = []
    for w in words:
        if w in stop or w in seen:
            continue
        seen.append(w)
        if len(seen) >= 20:
            break
    return seen


@investor_profile.get("/me")
def get_my_profile(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return {"profile": _load(session, user.id)}


@investor_profile.put("/me")
def update_my_profile(payload: dict, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    _ensure_schema(session)
    body = payload or {}
    investor_type = body.get("investor_type")
    if not isinstance(investor_type, str):
        investor_type = None
    else:
        investor_type = investor_type[:32]
    sectors = _filter_set(body.get("sectors"), SECTOR_OPTIONS)
    stages = _filter_set(body.get("stages"), STAGE_OPTIONS)
    geos = _filter_set(body.get("geos"), GEO_OPTIONS)
    ticket_band = body.get("ticket_band") if body.get("ticket_band") in TICKET_BANDS else None
    rng = TICKET_RANGES.get(ticket_band) if ticket_band else None
    thesis_text = body.get("thesis_text")
    if isinstance(thesis_text, str):
        thesis_text = thesis_text[:2000].strip() or None
    else:
        thesis_text = None
    contribute = True if body.get("contribute_to_signals") is None else bool(body.get("contribute_to_signals"))

    is_complete = bool(investor_type and sectors and stages and ticket_band)
    existing = _load(session, user.id)
    completed_at = existing.get("completed_at") or (datetime.utcnow().isoformat(timespec="seconds") if is_complete else None)

    anti_sectors = _filter_set(body.get("anti_thesis_sectors"), SECTOR_OPTIONS)
    anti_stages = _filter_set(body.get("anti_thesis_stages"), STAGE_OPTIONS)
    value_weights = body.get("value_weights") or {}
    if not isinstance(value_weights, dict):
        value_weights = {}
    else:
        value_weights = {k: min(1.0, max(0.0, float(v))) for k, v in value_weights.items() if isinstance(v, (int, float, str))}

    # Onboarding fields the Settings cards don't send. Preserve-if-absent so a
    # Settings-card save (fixed subset) never wipes onboarding's accreditation/
    # firm/LP/notes data. Mirrors the worker PUT.
    accred_options = {"accredited", "qp", "non_us", "not_sure"}
    lp_intent_options = {"yes_now", "maybe", "deal_only", "no"}

    def _clamp_str(v: Any, limit: int) -> Optional[str]:
        return v.strip()[:limit] if isinstance(v, str) and v.strip() else None

    def _to_int_nn(v: Any) -> Optional[int]:
        try:
            n = int(v)
            return n if n >= 0 else None
        except (ValueError, TypeError):
            return None

    if "accreditation_status" in body:
        accreditation_status = body.get("accreditation_status") if body.get("accreditation_status") in accred_options else None
    else:
        accreditation_status = existing.get("accreditation_status")
    country = _clamp_str(body.get("country"), 80) if "country" in body else existing.get("country")
    firm_name = _clamp_str(body.get("firm_name"), 120) if "firm_name" in body else existing.get("firm_name")
    if "lp_intent" in body:
        lp_intent = body.get("lp_intent") if body.get("lp_intent") in lp_intent_options else None
    else:
        lp_intent = existing.get("lp_intent")
    lp_target_usd = _to_int_nn(body.get("lp_target_usd")) if "lp_target_usd" in body else existing.get("lp_target_usd")
    notes = _clamp_str(body.get("notes"), 2000) if "notes" in body else existing.get("notes")

    next_payload = {
        "user_id": user.id,
        "investor_type": investor_type,
        "sectors": sectors,
        "stages": stages,
        "geos": geos,
        "ticket_band": ticket_band,
        "ticket_min_usd": rng[0] if rng else None,
        "ticket_max_usd": rng[1] if rng else None,
        "thesis_text": thesis_text,
        "thesis_keywords": _extract_keywords(thesis_text or ""),
        "contribute_to_signals": contribute,
        "anti_thesis_sectors": anti_sectors,
        "anti_thesis_stages": anti_stages,
        "value_weights": value_weights,
        "accreditation_status": accreditation_status,
        "country": country,
        "firm_name": firm_name,
        "lp_intent": lp_intent,
        "lp_target_usd": lp_target_usd,
        "notes": notes,
    }
    try:
        session.exec(text("""
            INSERT INTO investor_profiles_dev (user_id, payload, completed_at, updated_at)
            VALUES (:uid, :payload, :completed_at, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                payload = excluded.payload,
                completed_at = excluded.completed_at,
                updated_at = CURRENT_TIMESTAMP
        """), params={"uid": user.id, "payload": json.dumps(next_payload), "completed_at": completed_at})
        session.commit()
    except Exception:
        session.rollback()
        raise HTTPException(status_code=500, detail="Update failed")
    return {"profile": _load(session, user.id)}


@investor_profile.post("/me/opt-out")
def opt_out(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    existing = _load(session, user.id)
    existing_payload = {k: v for k, v in existing.items() if k not in ("completed_at", "updated_at")}
    existing_payload["contribute_to_signals"] = False
    _ensure_schema(session)
    try:
        session.exec(text("""
            INSERT INTO investor_profiles_dev (user_id, payload, completed_at, updated_at)
            VALUES (:uid, :payload, :completed_at, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                payload = excluded.payload,
                updated_at = CURRENT_TIMESTAMP
        """), params={
            "uid": user.id,
            "payload": json.dumps(existing_payload),
            "completed_at": existing.get("completed_at"),
        })
        session.commit()
    except Exception:
        session.rollback()
        raise HTTPException(status_code=500, detail="Opt-out failed")
    return {"ok": True, "contribute_to_signals": False}


@investor_signals.get("/latest")
def latest_signals(user: User = Depends(get_current_user)):
    # Dev backend has no aggregator; return the same empty shape the worker
    # returns before its first cron run. The Market Intel UI handles this
    # gracefully ("No snapshot yet — the aggregator runs every 6 hours").
    _ = user
    return {
        "snapshot": None,
        "message": "No snapshot computed yet — the dev backend does not run the aggregator.",
        "min_cell_size": MIN_CELL_SIZE,
        "trend": [],
    }


router.include_router(investor_profile)
router.include_router(investor_signals)

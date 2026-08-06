"""Phase 0.2 / Task #23 — Per-role onboarding wizards (FastAPI dev mirror).

Persists step-by-step wizard state in `onboarding_progress`, keyed by
user. The frontend calls these endpoints from the founder/investor/
partner wizard pages; on login, the shell asks `GET /progress` and
redirects unfinished users to the right `/onboarding/<role>` step.

Endpoints
    GET  /api/onboarding/progress
    PUT  /api/onboarding/progress   {flow, step, total_steps, data}
    POST /api/onboarding/complete   {flow}

Task #6 (IF) — Settings → Onboarding checklist (FastAPI dev mirror).
    GET  /api/onboarding/checklist
    POST /api/onboarding/checklist/{item}/complete
    POST /api/onboarding/checklist/{item}/skip
    POST /api/onboarding/checklist/reset
    POST /api/onboarding/meta        {tour_seen?, rerun_tour?, celebration_shown?, panel_collapsed?}

The catalogue (5 roles x 10 items), response shape, and meta semantics mirror
`cloudflare-worker/src/services/onboardingChecklist.ts` so the SPA renders the
same against dev and prod. The prod worker also runs a lazy auto-detect pass
(50 best-effort SELECTs across many feature tables) to flip items it can infer;
the dev mirror deliberately omits that — items start pending and are driven by
the manual complete/skip controls only. Dev FastAPI is never deployed, so this
gap is a dev-only convenience, not a contract drift (the drift check compares
the SPA against the worker, not against this mirror).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import Project, User, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/onboarding", tags=["Onboarding"])

VALID_FLOWS = {"founder", "investor", "partner"}

_migrated = False


def _ensure_schema(session: Session) -> None:
    global _migrated
    if _migrated:
        return
    try:
        session.exec(text(
            """
            CREATE TABLE IF NOT EXISTS onboarding_progress (
                user_id INTEGER PRIMARY KEY,
                flow TEXT NOT NULL,
                step INTEGER NOT NULL DEFAULT 0,
                total_steps INTEGER NOT NULL DEFAULT 0,
                data TEXT,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        ))
        session.commit()
        _migrated = True
    except Exception:
        session.rollback()


def _row_to_dto(row) -> Dict[str, Any]:
    if row is None:
        return {"flow": None, "step": 0, "total_steps": 0, "data": {}, "completed_at": None}
    data = {}
    raw = row["data"] if "data" in row.keys() else None
    if raw:
        try:
            data = json.loads(raw)
        except Exception:
            data = {}
    # `completed_at` may come back as datetime (Postgres TIMESTAMP) or
    # plain string (SQLite TEXT). Normalize to an ISO string defensively
    # so the FastAPI dev mirror matches the worker D1 path on the wire.
    completed = row["completed_at"]
    if isinstance(completed, datetime):
        completed_out: Optional[str] = completed.isoformat()
    elif completed:
        completed_out = str(completed)
    else:
        completed_out = None
    return {
        "flow": row["flow"],
        "step": row["step"] or 0,
        "total_steps": row["total_steps"] or 0,
        "data": data,
        "completed_at": completed_out,
    }


def _flow_for(user: User) -> Optional[str]:
    """Map authenticated user.role → wizard flow. The role enum may come
    through as either a `RoleEnum` or a bare string depending on entry
    path, so unwrap defensively."""
    role = getattr(user, "role", None)
    role_str = getattr(role, "value", role)
    if isinstance(role_str, str):
        role_str = role_str.lower()
    return role_str if role_str in VALID_FLOWS else None


def _enforce_flow_match(user: User, flow: str) -> None:
    """Server-side role-flow binding. Admins can manage any flow (used
    when seeding / impersonation). Everyone else may only touch their
    own role's wizard."""
    role = getattr(user, "role", None)
    role_str = (getattr(role, "value", role) or "").lower() if role else ""
    if role_str == "admin":
        return
    if flow != _flow_for(user):
        raise HTTPException(status_code=403, detail="flow does not match your role")


@router.get("/progress")
def get_progress(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT flow, step, total_steps, data, completed_at FROM onboarding_progress WHERE user_id = :uid"
    ), params={"uid": user.id}).mappings().first()
    # Task #24 — admins are never subject to the onboarding chatbot. A
    # leftover incomplete flow='chat' row (e.g. account created as a partner,
    # then promoted) must not report as an active chat flow, or the SPA gate
    # would pin the admin to /onboarding/chat. Treat it as no active flow.
    role = getattr(user, "role", None)
    role_str = (getattr(role, "value", role) or "").lower() if role else ""
    if role_str == "admin" and row is not None and row["flow"] == "chat" and not row["completed_at"]:
        return _row_to_dto(None)
    return _row_to_dto(row)


class ProgressUpsert(BaseModel):
    flow: str
    step: int = 0
    total_steps: int = 0
    data: Optional[Dict[str, Any]] = None


@router.put("/progress")
def upsert_progress(
    payload: ProgressUpsert,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if payload.flow not in VALID_FLOWS:
        raise HTTPException(status_code=400, detail="invalid flow")
    _enforce_flow_match(user, payload.flow)
    _ensure_schema(session)
    data_json = json.dumps(payload.data or {})
    if len(data_json) > 64_000:
        raise HTTPException(status_code=400, detail="data too large")
    # UPSERT — Postgres ON CONFLICT, falling back to manual upsert for SQLite.
    try:
        session.exec(text(
            """
            INSERT INTO onboarding_progress (user_id, flow, step, total_steps, data, updated_at)
            VALUES (:uid, :flow, :step, :total, :data, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) DO UPDATE SET
                flow = EXCLUDED.flow,
                step = EXCLUDED.step,
                total_steps = EXCLUDED.total_steps,
                data = EXCLUDED.data,
                updated_at = CURRENT_TIMESTAMP
            """
        ), params={"uid": user.id, "flow": payload.flow, "step": payload.step,
                   "total": payload.total_steps, "data": data_json})
        session.commit()
    except Exception:
        session.rollback()
        existing = session.exec(text(
            "SELECT user_id FROM onboarding_progress WHERE user_id = :uid"
        ), params={"uid": user.id}).first()
        if existing:
            session.exec(text(
                "UPDATE onboarding_progress SET flow=:flow, step=:step, total_steps=:total, "
                "data=:data, updated_at=CURRENT_TIMESTAMP WHERE user_id=:uid"
            ), params={"uid": user.id, "flow": payload.flow, "step": payload.step,
                       "total": payload.total_steps, "data": data_json})
        else:
            session.exec(text(
                "INSERT INTO onboarding_progress (user_id, flow, step, total_steps, data) "
                "VALUES (:uid, :flow, :step, :total, :data)"
            ), params={"uid": user.id, "flow": payload.flow, "step": payload.step,
                       "total": payload.total_steps, "data": data_json})
        session.commit()
    return {"ok": True}


class CompletePayload(BaseModel):
    flow: str


@router.post("/complete")
def complete(
    payload: CompletePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if payload.flow not in VALID_FLOWS:
        raise HTTPException(status_code=400, detail="invalid flow")
    _enforce_flow_match(user, payload.flow)
    _ensure_schema(session)
    session.exec(text(
        "UPDATE onboarding_progress SET completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP "
        "WHERE user_id=:uid"
    ), params={"uid": user.id})
    # If no row exists (user finished without ever PUT'ing) insert a stub.
    existing = session.exec(text(
        "SELECT user_id FROM onboarding_progress WHERE user_id=:uid"
    ), params={"uid": user.id}).first()
    if not existing:
        session.exec(text(
            "INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at) "
            "VALUES (:uid, :flow, 0, 0, CURRENT_TIMESTAMP)"
        ), params={"uid": user.id, "flow": payload.flow})
    session.commit()

    projection = None
    if payload.flow == "founder":
        projection = _project_founder_onboarding(session, user)
    return {"ok": True, "completed_at": True, **({"projection": projection} if projection else {})}


# Mirrors cloudflare-worker/src/services/onboardingProjection.ts. Keep the
# field mapping and the never-clobber rule identical — see that file for why
# `stage`, `journey`, `primary_need`, `notes` and `linkedin` are left out.
_ONBOARDING_TO_PROJECT = {
    "tagline": "tagline",
    "problem": "problem_statement",
    "solution": "solution",
    "why_now": "why_now",
}


def _clean(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _project_founder_onboarding(session: Session, user: User) -> Optional[str]:
    """Write the founder's stored answers onto their project record.

    Until this existed, `onboarding_progress.data` was written on every step
    and read back only by the wizard rehydrating itself, so a founder's
    problem / solution / why-now became unreachable the moment they finished —
    and the next surface asked for all three again as empty textareas.

    Best-effort by contract: onboarding is already complete when this runs, and
    no projection failure may strand a founder in the wizard.
    """
    try:
        if user.role != UserRole.FOUNDER or not user.founder_id:
            return "skipped"
        row = session.exec(text(
            "SELECT data FROM onboarding_progress WHERE user_id=:uid"
        ), params={"uid": user.id}).first()
        raw = row[0] if row else None
        try:
            answers = json.loads(raw) if raw else None
        except (TypeError, ValueError):
            answers = None
        if not isinstance(answers, dict):
            return "skipped"

        name = _clean(answers.get("company_name"))
        if not name:  # projects.name is NOT NULL
            return "skipped"

        # The dev SQLModel lags the D1 schema — it has no `tagline` (migration
        # 069) and no `deleted_at`. Writing to a column the model doesn't
        # declare is silently dropped on commit, so filter the mapping to what
        # actually exists rather than pretending it landed.
        mapping = {s: c for s, c in _ONBOARDING_TO_PROJECT.items() if hasattr(Project, c)}

        project = session.exec(
            select(Project)
            .where(Project.founder_id == user.founder_id)
            .order_by(Project.created_at.asc(), Project.id.asc())
        ).first()

        if project is None:
            project = Project(name=name, founder_id=user.founder_id)
            for src, col in mapping.items():
                setattr(project, col, _clean(answers.get(src)))
            session.add(project)
            session.commit()
            return "created"

        # Fill only what is still blank — onboarding is the weakest source of
        # truth here, and must never revert an edit the founder made later.
        touched = False
        for src, col in mapping.items():
            value = _clean(answers.get(src))
            if value and not _clean(getattr(project, col, None)):
                setattr(project, col, value)
                touched = True
        if not touched:
            return "noop"
        project.updated_at = datetime.utcnow()
        session.add(project)
        session.commit()
        return "filled"
    except Exception as exc:  # noqa: BLE001 — never block completion
        session.rollback()
        logger.warning("onboarding project projection failed: %s", exc)
        return "error"


# ---------------------------------------------------------------------------
# Task #6 (IF) — Settings → Onboarding checklist (dev mirror of the worker).
# ---------------------------------------------------------------------------

_TOTAL_ITEMS = 10
_CELEBRATION_THRESHOLD = 8

# Mirrors CATALOG in cloudflare-worker/src/services/onboardingChecklist.ts.
# Item keys are NEVER renamed; new items append to the end of a role.
_CHECKLIST_CATALOG: Dict[str, list] = {
    "newFounder": [
        {"key": "nf.persona", "label": "Complete persona chatbot", "route": "/onboarding/persona"},
        {"key": "nf.project", "label": "Add your project", "route": "/projects"},
        {"key": "nf.discovery", "label": "Log 3 customer-discovery interviews", "route": "/customer-discovery"},
        {"key": "nf.okrs", "label": "Add 3 quarterly OKRs", "route": "/build/roadmap"},
        {"key": "nf.calendar", "label": "Connect Google or Outlook Calendar", "route": "/calendar"},
        {"key": "nf.brand", "label": "Upload or generate brand basics", "route": "/build/brand"},
        {"key": "nf.deck", "label": "Draft pitch deck (5+ slides)", "route": "/build/deck"},
        {"key": "nf.scoring", "label": "Run your first scoring", "route": "/projects"},
        {"key": "nf.advisor", "label": "Book an advisor session", "route": "/advisors"},
        {"key": "nf.team", "label": "Invite a team member", "route": "/settings/account"},
    ],
    "existingFounder": [
        {"key": "ef.persona", "label": "Complete persona chatbot", "route": "/onboarding/persona"},
        {"key": "ef.stripe", "label": "Connect Stripe (verify MRR)", "route": "/settings/integrations"},
        {"key": "ef.plaid", "label": "Connect Plaid (verify cash)", "route": "/settings/integrations"},
        {"key": "ef.captable", "label": "Connect or upload cap table", "route": "/build/captable"},
        {"key": "ef.financials", "label": "Populate financial model", "route": "/build/financials"},
        {"key": "ef.83b", "label": "Confirm 83(b) status", "route": "/spinout-lab/83b"},
        {"key": "ef.ip", "label": "Confirm IP assignments signed", "route": "/compliance"},
        {"key": "ef.okrs", "label": "Add 3 quarterly OKRs", "route": "/build/roadmap"},
        {"key": "ef.scoring", "label": "Run scoring with verified evidence", "route": "/projects"},
        {"key": "ef.nda", "label": "Send first NDA to an investor", "route": "/trust"},
    ],
    "investor": [
        {"key": "inv.persona", "label": "Complete persona chatbot", "route": "/onboarding/persona"},
        {"key": "inv.kyc", "label": "Complete KYC + Accreditation", "route": "/kyc"},
        {"key": "inv.nda", "label": "Sign Investor NDA with Axal", "route": "/trust"},
        {"key": "inv.thesis", "label": "Save your thesis + watchlist", "route": "/watchlist"},
        {"key": "inv.crm", "label": "Connect Affinity / HubSpot (optional)", "route": "/integrations"},
        {"key": "inv.review", "label": "Review 3 matched founders", "route": "/matches"},
        {"key": "inv.intro", "label": "Request your first intro", "route": "/matches"},
        {"key": "inv.target", "label": "Set deployment target + reserve %", "route": "/settings/profile"},
        {"key": "inv.dealroom", "label": "Open your first deal-room", "route": "/deals"},
        {"key": "inv.notifs", "label": "Configure notifications", "route": "/settings/notifications"},
    ],
    "operatingPartner": [
        {"key": "op.accept", "label": "Accept partner invitation", "route": "/partner-portal"},
        {"key": "op.profile", "label": "Complete profiling chatbot", "route": "/onboarding/persona"},
        {"key": "op.conflicts", "label": "Disclose conflicts", "route": "/partner-portal"},
        {"key": "op.deal_type", "label": "Pick deal-type proposal + sign", "route": "/partner-portal"},
        {"key": "op.kyb", "label": "Configure KYB documents", "route": "/partner-portal"},
        {"key": "op.service", "label": "Add at least one service / offer", "route": "/services"},
        {"key": "op.refs", "label": "Provide 2 references", "route": "/settings/profile"},
        {"key": "op.referral", "label": "Receive one-time referral code", "route": "/refer"},
        {"key": "op.intro", "label": "Make first qualified intro", "route": "/pipeline"},
        {"key": "op.notifs", "label": "Configure notifications", "route": "/settings/notifications"},
    ],
    "advisor": [
        {"key": "mt.persona", "label": "Complete profiling chatbot", "route": "/settings/profile"},
        {"key": "mt.tags", "label": "Add expertise tags + sectors + stages", "route": "/settings/profile"},
        {"key": "mt.comp", "label": "Pick comp model", "route": "/advisors"},
        {"key": "mt.calendar", "label": "Connect Calendly or Google Calendar", "route": "/calendar"},
        {"key": "mt.refs", "label": "Provide 2 references", "route": "/settings/profile"},
        {"key": "mt.nda", "label": "Sign Advisor NDA + disclaimer", "route": "/settings/security"},
        {"key": "mt.capacity", "label": "Set weekly capacity", "route": "/office-hours"},
        {"key": "mt.slots", "label": "Surface availability slots", "route": "/office-hours"},
        {"key": "mt.booking", "label": "Accept first session booking", "route": "/office-hours"},
        {"key": "mt.notifs", "label": "Configure notifications", "route": "/settings/notifications"},
    ],
}

_checklist_migrated = False


def _ensure_checklist_schema(session: Session) -> None:
    global _checklist_migrated
    if _checklist_migrated:
        return
    try:
        session.exec(text(
            """
            CREATE TABLE IF NOT EXISTS onboarding_checklist_progress (
                user_id INTEGER NOT NULL,
                item_key TEXT NOT NULL,
                completed_at TIMESTAMP,
                skipped_at TIMESTAMP,
                source TEXT,
                PRIMARY KEY (user_id, item_key)
            )
            """
        ))
        session.exec(text(
            """
            CREATE TABLE IF NOT EXISTS onboarding_meta (
                user_id INTEGER PRIMARY KEY,
                tour_seen_at TIMESTAMP,
                celebration_shown_at TIMESTAMP,
                panel_collapsed INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        ))
        session.commit()
        _checklist_migrated = True
    except Exception:
        session.rollback()


def _iso(value) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value) if value else None


def _primary_persona_id(session: Session, user_id: int) -> Optional[str]:
    """Best-effort: dev personas live in `user_personas` (see personas.py).
    Returns None if the table is absent so the role still resolves."""
    try:
        row = session.exec(text(
            "SELECT persona_id FROM user_personas WHERE user_id = :uid AND is_primary = 1 "
            "ORDER BY updated_at DESC"
        ), params={"uid": user_id}).mappings().first()
        return row["persona_id"] if row else None
    except Exception:
        session.rollback()
        return None


def _resolve_checklist_role(user: User, primary_persona_id: Optional[str]) -> str:
    """Mirror resolveRole() in the worker service."""
    role = getattr(user, "role", None)
    role_str = (getattr(role, "value", role) or "")
    role_str = str(role_str).lower()
    if role_str == "investor":
        return "investor"
    if role_str == "partner":
        return "operatingPartner"
    if role_str == "advisor":
        return "advisor"
    if role_str in ("founder", "admin"):
        p = str(primary_persona_id or "").lower()
        if (
            p == "founder_existing"
            or p.startswith("existing_")
            or "existing-founder" in p
            or "existing_founder" in p
        ):
            return "existingFounder"
        return "newFounder"
    return "newFounder"


def _is_known_item(key: str) -> bool:
    return any(it["key"] == key for items in _CHECKLIST_CATALOG.values() for it in items)


def _load_checklist(session: Session, user: User) -> Dict[str, Any]:
    _ensure_checklist_schema(session)
    persona = _primary_persona_id(session, user.id)
    role = _resolve_checklist_role(user, persona)
    items = _CHECKLIST_CATALOG[role]

    existing: Dict[str, Any] = {}
    try:
        rows = session.exec(text(
            "SELECT item_key, completed_at, skipped_at, source "
            "FROM onboarding_checklist_progress WHERE user_id = :uid"
        ), params={"uid": user.id}).mappings().all()
        for r in rows:
            existing[r["item_key"]] = r
    except Exception:
        session.rollback()

    meta_row = None
    try:
        meta_row = session.exec(text(
            "SELECT tour_seen_at, celebration_shown_at, panel_collapsed "
            "FROM onboarding_meta WHERE user_id = :uid"
        ), params={"uid": user.id}).mappings().first()
    except Exception:
        session.rollback()

    rows_out = []
    for it in items:
        e = existing.get(it["key"])
        completed_at = _iso(e["completed_at"]) if e else None
        skipped_at = _iso(e["skipped_at"]) if e else None
        source = (e["source"] if e else None) or None
        status = "completed" if completed_at else ("skipped" if skipped_at else "pending")
        rows_out.append({
            "key": it["key"],
            "label": it["label"],
            "route": it["route"],
            "autoDetect": False,  # dev mirror has no auto-detect pass
            "completed_at": completed_at,
            "skipped_at": skipped_at,
            "source": source,
            "status": status,
        })

    completed = sum(1 for r in rows_out if r["status"] == "completed")
    skipped = sum(1 for r in rows_out if r["status"] == "skipped")
    pending = sum(1 for r in rows_out if r["status"] == "pending")
    nxt = [r for r in rows_out if r["status"] == "pending"][:3]

    celeb_shown = meta_row["celebration_shown_at"] if meta_row else None
    should_celebrate = completed >= _CELEBRATION_THRESHOLD and not celeb_shown

    return {
        "role": role,
        "total": _TOTAL_ITEMS,
        "completed": completed,
        "pending": pending,
        "skipped": skipped,
        "items": rows_out,
        "next": nxt,
        "meta": {
            "tour_seen_at": _iso(meta_row["tour_seen_at"]) if meta_row else None,
            "celebration_shown_at": _iso(celeb_shown) if celeb_shown else None,
            "panel_collapsed": (int(meta_row["panel_collapsed"] or 0) == 1) if meta_row else False,
            "should_celebrate": should_celebrate,
        },
    }


def _mark_item(session: Session, user_id: int, item_key: str, action: str) -> None:
    _ensure_checklist_schema(session)
    completed = action == "complete"
    now = datetime.utcnow()
    session.exec(text(
        """
        INSERT INTO onboarding_checklist_progress (user_id, item_key, completed_at, skipped_at, source)
        VALUES (:uid, :key, :completed, :skipped, 'manual')
        ON CONFLICT (user_id, item_key) DO UPDATE SET
            completed_at = EXCLUDED.completed_at,
            skipped_at = EXCLUDED.skipped_at,
            source = EXCLUDED.source
        """
    ), params={
        "uid": user_id,
        "key": item_key,
        "completed": now if completed else None,
        "skipped": None if completed else now,
    })
    session.commit()


@router.get("/checklist")
def get_checklist(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    return _load_checklist(session, user)


@router.post("/checklist/reset")
def reset_checklist(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_checklist_schema(session)
    session.exec(text(
        "DELETE FROM onboarding_checklist_progress WHERE user_id = :uid"
    ), params={"uid": user.id})
    # Clear celebration so it can re-fire after reset; keep tour_seen unless the
    # user explicitly re-runs it (mirrors resetAll() in the worker service).
    session.exec(text(
        """
        INSERT INTO onboarding_meta (user_id, celebration_shown_at, updated_at)
        VALUES (:uid, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE SET
            celebration_shown_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        """
    ), params={"uid": user.id})
    session.commit()
    return {"ok": True, **_load_checklist(session, user)}


@router.post("/checklist/{item}/complete")
def complete_checklist_item(
    item: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not _is_known_item(item):
        raise HTTPException(status_code=400, detail="unknown item")
    _mark_item(session, user.id, item, "complete")
    return {"ok": True}


@router.post("/checklist/{item}/skip")
def skip_checklist_item(
    item: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not _is_known_item(item):
        raise HTTPException(status_code=400, detail="unknown item")
    _mark_item(session, user.id, item, "skip")
    return {"ok": True}


class MetaPatch(BaseModel):
    tour_seen: Optional[bool] = None
    rerun_tour: Optional[bool] = None
    celebration_shown: Optional[bool] = None
    panel_collapsed: Optional[bool] = None


@router.post("/meta")
def patch_meta(
    payload: MetaPatch,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _ensure_checklist_schema(session)
    row = session.exec(text(
        "SELECT tour_seen_at, celebration_shown_at, panel_collapsed "
        "FROM onboarding_meta WHERE user_id = :uid"
    ), params={"uid": user.id}).mappings().first()
    tour_seen_at = row["tour_seen_at"] if row else None
    celebration_shown_at = row["celebration_shown_at"] if row else None
    panel_collapsed = int(row["panel_collapsed"] or 0) if row else 0

    now = datetime.utcnow()
    touched = False
    if payload.tour_seen is not None:
        tour_seen_at = now if payload.tour_seen else None
        touched = True
    if payload.rerun_tour:
        tour_seen_at = None
        touched = True
    if payload.celebration_shown is not None:
        celebration_shown_at = now if payload.celebration_shown else None
        touched = True
    if payload.panel_collapsed is not None:
        panel_collapsed = 1 if payload.panel_collapsed else 0
        touched = True
    if not touched:
        return {"ok": True}

    session.exec(text(
        """
        INSERT INTO onboarding_meta (user_id, tour_seen_at, celebration_shown_at, panel_collapsed, updated_at)
        VALUES (:uid, :tour, :celeb, :panel, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE SET
            tour_seen_at = EXCLUDED.tour_seen_at,
            celebration_shown_at = EXCLUDED.celebration_shown_at,
            panel_collapsed = EXCLUDED.panel_collapsed,
            updated_at = CURRENT_TIMESTAMP
        """
    ), params={
        "uid": user.id,
        "tour": tour_seen_at,
        "celeb": celebration_shown_at,
        "panel": panel_collapsed,
    })
    session.commit()
    return {"ok": True}

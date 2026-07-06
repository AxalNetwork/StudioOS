"""Onboarding profiling chatbot — FastAPI dev mirror (Task #10 follow-up).

The production profiling chatbot lives only in the Cloudflare Worker
(`cloudflare-worker/src/routes/profiling.ts`) and drives each turn through
Workers AI (`@cf/meta/llama-*`) via the resilient AI router. The dev FastAPI
backend has no LLM access, so the chat endpoints were never mirrored here —
which meant that in the dev preview the SPA's `POST /api/profiling/chat`
404'd and the onboarding chat dead-ended on the "I'm having trouble reaching
the AI assistant" fallback after the very first reply.

This module restores a working onboarding chatbot in dev with a
**deterministic, scripted** persona-profiling flow (no LLM). It asks the same
sequence of persona questions the worker's SYSTEM_PROMPT describes, classifies
the persona from the answers, and on save:
  * upserts `partner_profiles` (mirrors the worker's table + columns),
  * logs `profile_captured` to `activity_logs`,
  * conservatively promotes role (partner → founder/investor, never demotes),
  * releases the onboarding-chatbot gate by writing `onboarding_progress`
    `flow='chat'` + `completed_at` (the exact row App.jsx's RequireAuth checks).

Endpoints (mounted under /api by main.py):
    POST /api/profiling/chat   {email?, messages:[{role,content}]} -> {reply, degraded}
    POST /api/profiling/save   {email?, messages:[{role,content}]} -> {saved, persona, ...}

Like the rest of the dev mirror, this is never deployed; prod parity for the
AI-driven flow stays the worker's responsibility. The `email` field in the
body is accepted for client compatibility but ignored — the user is always
resolved from the authenticated session (mirrors the worker's Task #66 fix).
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User

router = APIRouter(prefix="/profiling", tags=["Profiling"])

CLOSING = (
    "Thanks — that's everything I need for now. Profile captured. An Axal admin "
    'will review and propose your Closing Binder shortly. Click "Save & continue" '
    "to finish."
)


# ---------------------------------------------------------------------------
# Scripted persona flow
# ---------------------------------------------------------------------------

def _persona_key(answer: str) -> str:
    """Classify the first free-text answer into a coarse persona bucket."""
    a = (answer or "").lower()
    if any(k in a for k in ["found", "build", "startup", "entrepreneur"]):
        return "founder"
    if any(k in a for k in ["invest", "lp", "capital", "fund", "angel", "vc"]):
        return "investor"
    if any(k in a for k in ["operator", "operating", "advisor", "advisory"]):
        return "operator"
    if any(k in a for k in ["legal", "counsel", "lawyer", "attorney"]):
        return "legal"
    if any(k in a for k in ["technical", "tech", "engineer", "developer", "cto"]):
        return "technical"
    if any(k in a for k in ["liquidity", "secondary", "m&a", "acquisition"]):
        return "liquidity"
    if any(k in a for k in ["advisor", "coach"]):
        return "advisor"
    if "service" in a:
        return "service"
    return "unknown"


def _founder_track(answer: str) -> Optional[str]:
    """Map the founder gatekeeping answer to 'new' or 'existing'."""
    a = (answer or "").strip().lower()
    if a in ("a", "a.", "a)", "option a"):
        return "new"
    if a in ("b", "b.", "b)", "option b"):
        return "existing"
    if any(k in a for k in ["new", "spin", "start", "idea", "greenfield"]):
        return "new"
    if any(
        k in a
        for k in [
            "exist",
            "scal",
            "capital",
            "m&a",
            "distribut",
            "series",
            "seed",
            "revenue",
            "profitable",
        ]
    ):
        return "existing"
    return None


def _resolve_founder_track(answers: List[str]):
    """Scan every answer after the persona answer for the first recognizable
    founder track. Returns (track, index). Scanning all later answers (not just
    answers[1]) prevents the clarification loop when the first gatekeeping reply
    is ambiguous and the user clarifies on a subsequent turn."""
    for i in range(1, len(answers)):
        t = _founder_track(answers[i])
        if t:
            return t, i
    return None, None


def _user_answers(messages: List[Dict[str, Any]]) -> List[str]:
    return [
        str(m.get("content", "") or "")
        for m in messages
        if (m.get("role") or "") == "user"
    ]


def _next_reply(answers: List[str]) -> str:
    """Return the next scripted assistant question given the answers so far."""
    n = len(answers)
    if n == 0:
        return (
            "Welcome to Axal VC. Which best describes your interest — are you a "
            "founder, investor, operator, or service partner?"
        )

    persona = _persona_key(answers[0])

    if persona == "founder":
        if n == 1:
            return (
                "Great — as a Founder, are you (A) starting a NEW venture you want to "
                "spin out in 30 days, or (B) scaling an EXISTING company looking for "
                "capital, AI integration, distribution, or M&A support?"
            )
        track, track_idx = _resolve_founder_track(answers)
        if track is None:
            return (
                "Just to route you correctly — is it (A) a NEW venture to spin out, "
                "or (B) an EXISTING company seeking a strategic partner?"
            )
        if track == "new":
            qs = [
                "Have you already established a legal entity? If yes, share the entity " +
                "name, type and jurisdiction; if not, which jurisdiction do you want to " +
                "incorporate in — Delaware, UK, or Singapore?",
                "What sector or industry is your venture in?",
                "In one line, describe your idea or MVP.",
            ]
        else:
            qs = [
                "What stage are you at — Pre-seed, Seed, Series A, Series B+, or " +
                "Bootstrapped/Profitable?",
                "What is your primary goal — (i) Capital, (ii) AI integration via " +
                "StudioOS, (iii) Distribution / GTM, or (iv) M&A / Liquidity?",
                "Share your legal entity name, type and jurisdiction, plus your name and " +
                "title as the signatory.",
            ]
        idx = n - 1 - track_idx
        return qs[idx] if idx < len(qs) else CLOSING

    if persona == "investor":
        qs = [
            "Which best fits — (i) LP committing to the main fund, (ii) Syndicate " +
            "investing deal-by-deal, or (iii) Co-Investor / VC firm joining rounds?",
            "What's your typical check size and which sectors interest you?",
            "Share your legal entity name, type and jurisdiction (and EIN if US), plus " +
            "your name and title as the signatory.",
        ]
        idx = n - 1
        return qs[idx] if idx < len(qs) else CLOSING

    if persona == "operator":
        qs = [
            "What's your area of expertise — GTM, product / MVP, growth, operations, or " +
            "something else?",
            "Are you offering sweat equity, advisory-for-equity, or an MSA " +
            "(equity-for-services)?",
            "Share your name, title, and legal entity (if any) for the agreement.",
        ]
        idx = n - 1
        return qs[idx] if idx < len(qs) else CLOSING

    if persona == "service":
        qs = [
            "Which service partner type fits best — Legal Counsel, Technical Partner, " +
            "Liquidity Provider, or Advisor?",
            "Briefly describe your offering and typical engagement model.",
            "Share your legal entity name, type and jurisdiction, plus your signatory " +
            "name and title.",
        ]
        idx = n - 1
        return qs[idx] if idx < len(qs) else CLOSING

    if persona in ("legal", "technical", "liquidity", "advisor"):
        qs = [
            "Briefly describe your offering and typical engagement model.",
            "Share your legal entity name, type and jurisdiction, plus your signatory " +
            "name and title.",
        ]
        idx = n - 1
        return qs[idx] if idx < len(qs) else CLOSING

    # Unknown persona — one clarifying turn, then capture and close.
    qs = [
        "Got it. Could you tell me a bit more about what you're looking for from Axal?",
        "Share your legal entity name, type and jurisdiction, plus your name and title.",
    ]
    idx = n - 1
    return qs[idx] if idx < len(qs) else CLOSING


def _classify(messages: List[Dict[str, Any]]) -> Dict[str, Optional[str]]:
    """Derive the persona label + founder track for persistence."""
    answers = _user_answers(messages)
    if not answers:
        return {"persona": None, "founder_track": None, "summary": None}

    key = _persona_key(answers[0])
    persona: Optional[str] = None
    founder_track: Optional[str] = None
    sub = answers[1].lower() if len(answers) >= 2 else ""

    if key == "founder":
        persona = "Founder"
        t, _ = _resolve_founder_track(answers)
        if t == "new":
            founder_track = "Spin-Out (New)"
        elif t == "existing":
            founder_track = "Strategic Scale (Existing)"
    elif key == "investor":
        if "syndicate" in sub:
            persona = "Investor — Syndicate"
        elif any(k in sub for k in ["co-invest", "co invest", "coinvest", "firm", "round"]):
            persona = "Investor — Co-Investor"
        else:
            persona = "Investor — LP"
    elif key == "operator":
        persona = "Operator / Advisor"
    elif key == "legal":
        persona = "Legal Counsel"
    elif key == "technical":
        persona = "Technical Partner"
    elif key == "liquidity":
        persona = "Liquidity Provider"
    elif key == "advisor":
        persona = "Advisor"
    elif key == "service":
        if "legal" in sub or "counsel" in sub:
            persona = "Legal Counsel"
        elif "tech" in sub:
            persona = "Technical Partner"
        elif "liquid" in sub:
            persona = "Liquidity Provider"
        elif "advisor" in sub:
            persona = "Advisor"
        else:
            persona = "Operator / Advisor"

    label = f"{persona} / {founder_track}" if founder_track else (persona or "unknown")
    summary = f"Prospective Axal partner — {label} (captured via dev onboarding chat)."
    return {"persona": persona, "founder_track": founder_track, "summary": summary}


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

def _ensure_profile_table(session: Session) -> None:
    try:
        session.exec(text(
            """
            CREATE TABLE IF NOT EXISTS partner_profiles (
                email TEXT PRIMARY KEY,
                user_id INTEGER,
                persona TEXT,
                legal_entity_name TEXT,
                entity_type TEXT,
                ein TEXT,
                signatory_name TEXT,
                signatory_title TEXT,
                company_established INTEGER,
                founder_track TEXT,
                current_stage TEXT,
                partnership_goal TEXT,
                existing_jurisdiction TEXT,
                product_strategy TEXT,
                existing_investors TEXT,
                chat_history TEXT,
                extracted_data TEXT,
                admin_status TEXT DEFAULT 'pending',
                agreement_type TEXT,
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        ))
        session.commit()
    except Exception:
        session.rollback()
    # Worker-style idempotent column guards: an older dev DB may have an existing
    # partner_profiles table predating columns this route writes. SQLite has no
    # ADD COLUMN IF NOT EXISTS, so attempt each and swallow the duplicate-column
    # error so /save doesn't 500 on stale dev databases.
    for col, ddl in (
        ("user_id", "INTEGER"),
        ("persona", "TEXT"),
        ("founder_track", "TEXT"),
        ("chat_history", "TEXT"),
        ("extracted_data", "TEXT"),
        ("admin_status", "TEXT DEFAULT 'pending'"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ):
        try:
            session.exec(text(f"ALTER TABLE partner_profiles ADD COLUMN {col} {ddl}"))  # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- f-string interpolates static schema identifiers from local lists, dev-only FastAPI not exposed to user input
            session.commit()
        except Exception:
            session.rollback()


def _ensure_progress_table(session: Session) -> None:
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
    except Exception:
        session.rollback()


def _role_str(user: User) -> str:
    role = getattr(user, "role", None)
    role_str = getattr(role, "value", role)
    return (role_str or "").lower() if isinstance(role_str, str) else ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class ProfilingPayload(BaseModel):
    email: Optional[str] = None
    messages: List[Dict[str, Any]] = []


@router.post("/chat")
def chat(
    payload: ProfilingPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not isinstance(payload.messages, list) or len(payload.messages) == 0:
        raise HTTPException(status_code=400, detail="messages required")
    answers = _user_answers(payload.messages[-24:])
    reply = _next_reply(answers)
    return {"reply": reply, "degraded": False}


@router.post("/save")
def save(
    payload: ProfilingPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not isinstance(payload.messages, list):
        raise HTTPException(status_code=400, detail="messages required")

    _ensure_profile_table(session)
    _ensure_progress_table(session)

    email = user.email
    info = _classify(payload.messages)
    persona = info["persona"]
    founder_track = info["founder_track"]
    summary = info["summary"]
    chat_json = json.dumps(payload.messages)
    extracted_json = json.dumps(info)

    # Upsert partner_profiles (email is the PK, mirrors the worker).
    existing = session.exec(
        text("SELECT email FROM partner_profiles WHERE email = :e"),
        params={"e": email},
    ).first()
    if existing:
        session.exec(
            text(
                """
                UPDATE partner_profiles SET
                    user_id = :uid,
                    persona = :persona,
                    founder_track = :track,
                    chat_history = :chat,
                    extracted_data = :extracted,
                    updated_at = CURRENT_TIMESTAMP
                WHERE email = :e
                """
            ),
            params={
                "uid": user.id,
                "persona": persona,
                "track": founder_track,
                "chat": chat_json,
                "extracted": extracted_json,
                "e": email,
            },
        )
    else:
        session.exec(
            text(
                """
                INSERT INTO partner_profiles
                    (email, user_id, persona, founder_track, chat_history, extracted_data)
                VALUES (:e, :uid, :persona, :track, :chat, :extracted)
                """
            ),
            params={
                "e": email,
                "uid": user.id,
                "persona": persona,
                "track": founder_track,
                "chat": chat_json,
                "extracted": extracted_json,
            },
        )
    session.commit()

    # Activity log (best-effort).
    persona_label = f"{persona} / {founder_track}" if founder_track else (persona or "unknown")
    try:
        session.exec(
            text(
                """
                INSERT INTO activity_logs (action, details, actor, user_id)
                VALUES ('profile_captured', :d, :a, :uid)
                """
            ),
            params={
                "d": f"Profile captured — {persona_label} — pending admin verification",
                "a": email,
                "uid": user.id,
            },
        )
        session.commit()
    except Exception:
        session.rollback()

    # Conservative role promotion — only partner → founder/investor, never demote.
    inferred_role: Optional[str] = None
    if persona == "Founder":
        inferred_role = "founder"
    elif isinstance(persona, str) and persona.startswith("Investor"):
        inferred_role = "investor"
    elif persona:
        inferred_role = "partner"
    if inferred_role in ("founder", "investor") and _role_str(user) == "partner":
        try:
            session.exec(
                text("UPDATE users SET role = :r WHERE id = :uid"),
                params={"r": inferred_role, "uid": user.id},
            )
            session.commit()
        except Exception:
            session.rollback()

    # Release the onboarding-chatbot gate (App.jsx RequireAuth checks
    # onboarding_progress flow='chat' + completed_at).
    try:
        session.exec(
            text(
                """
                INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at, updated_at)
                VALUES (:uid, 'chat', 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id) DO UPDATE SET
                    flow = 'chat',
                    completed_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                """
            ),
            params={"uid": user.id},
        )
        session.commit()
    except Exception:
        session.rollback()
        # SQLite fallback for environments without ON CONFLICT support.
        try:
            row = session.exec(
                text("SELECT user_id FROM onboarding_progress WHERE user_id = :uid"),
                params={"uid": user.id},
            ).first()
            if row:
                session.exec(
                    text(
                        "UPDATE onboarding_progress SET flow='chat', "
                        "completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP "
                        "WHERE user_id=:uid"
                    ),
                    params={"uid": user.id},
                )
            else:
                session.exec(
                    text(
                        "INSERT INTO onboarding_progress (user_id, flow, step, total_steps, completed_at) "
                        "VALUES (:uid, 'chat', 0, 0, CURRENT_TIMESTAMP)"
                    ),
                    params={"uid": user.id},
                )
            session.commit()
        except Exception:
            session.rollback()

    return {
        "saved": True,
        "persona": persona,
        "founder_track": founder_track,
        "role": inferred_role,
        "summary": summary,
    }

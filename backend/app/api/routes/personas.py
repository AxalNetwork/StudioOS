"""Epic 1 — Onboarding persona expansion (FastAPI mirror).

Heuristic-only classifier in dev (no Cloudflare AI binding here). Same
endpoint shapes as the worker:

- GET  /api/personas/taxonomy             public
- GET  /api/personas/me                   current user
- POST /api/personas/classify             email + first_message → persona
- POST /api/personas/answer                persist follow-up answer
- POST /api/personas/finalize              write user_personas row(s)
- GET  /api/personas/admin/list           admin
- POST /api/personas/admin/{user_id}/retag admin re-tag w/ manual_override=1
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import User

router = APIRouter(prefix="/personas", tags=["personas"])


# --- Canonical taxonomy (mirrors cloudflare-worker/src/personas.ts) ----------

PERSONAS: list[dict[str, Any]] = [
    {
        "id": "lp_individual",
        "label": "LP — Individual",
        "short_description": "Individual limited partner committing personal capital to the main fund.",
        "role_alignment": "partner",
        "email_domain_hints": ["gmail.com", "yahoo.com", "outlook.com", "icloud.com", "hotmail.com", "me.com"],
        "follow_up_questions": [
            {"key": "check_size_usd", "prompt": "Typical check size you write per fund (USD)?", "type": "number"},
            {"key": "accreditation", "prompt": "Are you a US-accredited investor? (yes / no / non-US)", "type": "choice", "choices": ["yes", "no", "non-US"]},
            {"key": "sector_focus", "prompt": "Any sector/thesis focus you care about?", "type": "text"},
            {"key": "liquidity_horizon", "prompt": "Comfortable lock-up horizon? (3-5y / 5-10y / 10y+)", "type": "choice", "choices": ["3-5y", "5-10y", "10y+"]},
        ],
    },
    {
        "id": "lp_institutional",
        "label": "LP — Institutional",
        "short_description": "Institutional LP (endowment, foundation, pension, fund-of-funds).",
        "role_alignment": "partner",
        "email_domain_hints": [],
        "follow_up_questions": [
            {"key": "institution_name", "prompt": "Institution name?", "type": "text"},
            {"key": "aum_usd", "prompt": "Approximate AUM (USD)?", "type": "number"},
            {"key": "allocation_target_usd", "prompt": "Target allocation to venture this cycle (USD)?", "type": "number"},
            {"key": "mandate_constraints", "prompt": "Any mandate constraints (geography, sector, ESG, ticket cap)?", "type": "text"},
        ],
    },
    {
        "id": "gp_external",
        "label": "GP — External Fund",
        "short_description": "GP running an external fund interested in deal-by-deal collaboration.",
        "role_alignment": "partner",
        "email_domain_hints": ["vc", "capital", "ventures", "partners"],
        "follow_up_questions": [
            {"key": "fund_name", "prompt": "Fund name?", "type": "text"},
            {"key": "fund_stage", "prompt": "Stage focus? (Pre-seed / Seed / Series A / Multi-stage)", "type": "choice", "choices": ["Pre-seed", "Seed", "Series A", "Multi-stage"]},
            {"key": "avg_check_size_usd", "prompt": "Average check size (USD)?", "type": "number"},
            {"key": "collab_intent", "prompt": "Looking for co-investment, deal sharing, or both?", "type": "choice", "choices": ["co-investment", "deal sharing", "both"]},
        ],
    },
    {
        "id": "angel_scout",
        "label": "Angel / Scout",
        "short_description": "Individual angel or scout sourcing and writing small early checks.",
        "role_alignment": "partner",
        "email_domain_hints": [],
        "follow_up_questions": [
            {"key": "check_size_usd", "prompt": "Typical angel check size (USD)?", "type": "number"},
            {"key": "deals_per_year", "prompt": "How many deals per year do you write?", "type": "number"},
            {"key": "sector_focus", "prompt": "Sectors you focus on?", "type": "text"},
            {"key": "value_add", "prompt": "Primary value-add to founders (intros, GTM, hiring, technical)?", "type": "text"},
        ],
    },
    {
        "id": "corporate_vc",
        "label": "Corporate VC",
        "short_description": "Strategic / corporate VC arm of an operating company.",
        "role_alignment": "partner",
        "email_domain_hints": [],
        "follow_up_questions": [
            {"key": "parent_company", "prompt": "Parent company?", "type": "text"},
            {"key": "strategic_thesis", "prompt": "Strategic thesis (what unlocks value for the parent)?", "type": "text"},
            {"key": "avg_check_size_usd", "prompt": "Average check size (USD)?", "type": "number"},
            {"key": "commercial_attachment", "prompt": "Do you typically attach commercial agreements (POC, distribution, M&A right of first refusal)?", "type": "choice", "choices": ["yes", "no", "sometimes"]},
        ],
    },
    {
        "id": "sovereign_family_office",
        "label": "Sovereign / Family Office",
        "short_description": "Sovereign wealth, family office, or multi-family office investor.",
        "role_alignment": "partner",
        "email_domain_hints": ["fo", "family", "office"],
        "follow_up_questions": [
            {"key": "office_name", "prompt": "Office name?", "type": "text"},
            {"key": "aum_usd", "prompt": "Approximate AUM (USD)?", "type": "number"},
            {"key": "allocation_target_usd", "prompt": "Venture allocation target (USD)?", "type": "number"},
            {"key": "co_invest_appetite", "prompt": "Appetite for direct co-investment alongside fund commitments?", "type": "choice", "choices": ["yes", "no", "selective"]},
        ],
    },
    {
        "id": "academic",
        "label": "Academic / Lab",
        "short_description": "Academic researcher, university tech-transfer office, or research lab.",
        "role_alignment": "partner",
        "email_domain_hints": ["edu", "ac.uk", "edu.sg", "edu.au", "mit.edu", "stanford.edu", "ox.ac.uk", "cam.ac.uk"],
        "follow_up_questions": [
            {"key": "institution", "prompt": "Institution / lab name?", "type": "text"},
            {"key": "research_area", "prompt": "Primary research area?", "type": "text"},
            {"key": "commercial_intent", "prompt": "Spin-out, license, or just collaboration?", "type": "choice", "choices": ["spin-out", "license", "collaboration"]},
            {"key": "ip_status", "prompt": "IP status (filed / granted / disclosure-only / none)?", "type": "choice", "choices": ["filed", "granted", "disclosure-only", "none"]},
        ],
    },
    {
        "id": "founder_new",
        "label": "Founder — New Venture",
        "short_description": "Founder spinning out a brand-new venture through the 30-day engine.",
        "role_alignment": "founder",
        "email_domain_hints": [],
        "follow_up_questions": [
            {"key": "venture_idea", "prompt": "One-line description of the venture?", "type": "text"},
            {"key": "sector", "prompt": "Sector / industry?", "type": "text"},
            {"key": "jurisdiction", "prompt": "Preferred incorporation jurisdiction? (Delaware / UK / Singapore)", "type": "choice", "choices": ["Delaware", "UK", "Singapore"]},
            {"key": "cofounders", "prompt": "Co-founders (names + roles), or solo?", "type": "text"},
        ],
    },
    {
        "id": "founder_existing",
        "label": "Founder — Existing Company",
        "short_description": "Founder of an existing company on the Strategic Scale partnership track.",
        "role_alignment": "founder",
        "email_domain_hints": [],
        "follow_up_questions": [
            {"key": "company_name", "prompt": "Company name?", "type": "text"},
            {"key": "current_stage", "prompt": "Current stage? (Pre-seed / Seed / Series A / Series B+ / Bootstrapped/Profitable)", "type": "choice", "choices": ["Pre-seed", "Seed", "Series A", "Series B+", "Bootstrapped/Profitable"]},
            {"key": "partnership_goal", "prompt": "Primary goal? (Capital / AI integration / Distribution / M&A)", "type": "choice", "choices": ["Capital", "AI Integration (StudioOS)", "Distribution / GTM", "M&A / Liquidity"]},
            {"key": "existing_investors", "prompt": "Existing investors / cap-table summary (one line)?", "type": "text"},
        ],
    },
    {
        "id": "operator_advisor",
        "label": "Operator / Advisor",
        "short_description": "Operating partner or advisor offering sweat-equity expertise to spin-outs.",
        "role_alignment": "partner",
        "email_domain_hints": [],
        "follow_up_questions": [
            {"key": "expertise", "prompt": "Primary expertise area (e.g. GTM, eng, finance, product)?", "type": "text"},
            {"key": "years_experience", "prompt": "Years of senior operating experience?", "type": "number"},
            {"key": "time_per_week_hours", "prompt": "Hours per week you can commit?", "type": "number"},
            {"key": "compensation_pref", "prompt": "Compensation preference (equity / cash / hybrid)?", "type": "choice", "choices": ["equity", "cash", "hybrid"]},
        ],
    },
    {
        "id": "service_provider",
        "label": "Service Provider",
        "short_description": "Legal, technical, or other service provider to the studio.",
        "role_alignment": "partner",
        "email_domain_hints": ["law", "legal", "consulting", "cpa"],
        "follow_up_questions": [
            {"key": "service_type", "prompt": "Type of service (Legal / Technical / Accounting / Other)?", "type": "choice", "choices": ["Legal", "Technical", "Accounting", "Other"]},
            {"key": "firm_name", "prompt": "Firm name?", "type": "text"},
            {"key": "pricing_model", "prompt": "Pricing model (fixed-fee / hourly / equity / hybrid)?", "type": "choice", "choices": ["fixed-fee", "hourly", "equity", "hybrid"]},
            {"key": "jurisdictions", "prompt": "Jurisdictions you cover?", "type": "text"},
        ],
    },
    {
        "id": "press_analyst",
        "label": "Press / Analyst",
        "short_description": "Journalist, industry analyst, or research publication.",
        "role_alignment": "partner",
        "email_domain_hints": ["press", "media", "news", "journal", "gartner", "forrester"],
        "follow_up_questions": [
            {"key": "outlet", "prompt": "Outlet / publication?", "type": "text"},
            {"key": "beat", "prompt": "Coverage beat?", "type": "text"},
            {"key": "engagement_type", "prompt": "Looking for briefings, embargoed news, or both?", "type": "choice", "choices": ["briefings", "embargoed news", "both"]},
        ],
    },
]

PERSONA_BY_ID: dict[str, dict[str, Any]] = {p["id"]: p for p in PERSONAS}
CONFIDENCE_THRESHOLD = 0.6
FOUNDER_IDS = {"founder_new", "founder_existing"}


def _is_allowed_overlap(a: str, b: str) -> bool:
    if a == b:
        return False
    return (a in FOUNDER_IDS and b == "operator_advisor") or (
        b in FOUNDER_IDS and a == "operator_advisor"
    )


# --- Schema bootstrap (Postgres) --------------------------------------------

_personas_schema_ready = False


def _ensure_personas_schema(db: Session) -> None:
    """Idempotent schema bootstrap. Only flips the cached flag if every DDL
    statement succeeds — a half-applied schema must keep retrying on the
    next request rather than masking the failure forever."""
    global _personas_schema_ready
    if _personas_schema_ready:
        return
    statements = [
        """
        CREATE TABLE IF NOT EXISTS user_personas (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            persona_id TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0,
            manual_override INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT 'router',
            is_primary INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, persona_id)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_user_personas_user ON user_personas(user_id)",
        """
        CREATE TABLE IF NOT EXISTS user_profile_extras (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            persona_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            source TEXT NOT NULL DEFAULT 'onboarding',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, persona_id, key)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_user_profile_extras_user ON user_profile_extras(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_user_profile_extras_persona ON user_profile_extras(user_id, persona_id)",
    ]
    try:
        for stmt in statements:
            db.execute(text(stmt))
        db.commit()
    except Exception:
        db.rollback()
        raise
    _personas_schema_ready = True


# --- Heuristic classifier ---------------------------------------------------

def _email_domain(email: str) -> str:
    at = email.rfind("@")
    return "" if at < 0 else email[at + 1 :].lower()


def _heuristic_matches(email: str) -> list[tuple[str, float]]:
    domain = _email_domain(email)
    if not domain:
        return []
    out: list[tuple[str, float]] = []
    for p in PERSONAS:
        for hint in p["email_domain_hints"]:
            if domain == hint or domain.endswith("." + hint) or hint in domain:
                out.append((p["id"], 0.25))
                break
    out.sort(key=lambda t: -t[1])
    return out


def _classify_heuristic(email: str, first_message: str) -> dict[str, Any]:
    matches = _heuristic_matches(email)
    text_lower = first_message.lower()
    boosts: dict[str, float] = {}

    keyword_map: dict[str, list[str]] = {
        "lp_institutional": ["endowment", "pension", "fund-of-funds", "fund of funds", "institutional lp"],
        "lp_individual": ["limited partner", "lp ", "personal capital"],
        "gp_external": ["our fund", "general partner", "co-invest", "syndicate lead"],
        "angel_scout": ["angel", "scout"],
        "corporate_vc": ["corporate venture", "cvc", "strategic investor"],
        "sovereign_family_office": ["family office", "sovereign", "multi-family"],
        "academic": ["lab", "tech transfer", "research", "professor", "phd"],
        "founder_new": ["spin out", "spinout", "new venture", "30-day", "incorporate"],
        "founder_existing": ["existing company", "scaling", "series a", "series b"],
        "operator_advisor": ["operator", "advisor", "fractional", "sweat equity"],
        "service_provider": ["law firm", "counsel", "accounting", "legal services"],
        "press_analyst": ["journalist", "reporter", "analyst", "press"],
    }
    for pid, kws in keyword_map.items():
        for kw in kws:
            if kw in text_lower:
                boosts[pid] = boosts.get(pid, 0.0) + 0.4
                break

    for pid, score in matches:
        boosts[pid] = boosts.get(pid, 0.0) + score

    if not boosts:
        return {
            "persona_id": None,
            "confidence": 0.0,
            "alternatives": [],
            "follow_up_questions": [],
            "needs_disambiguation": True,
            "rationale": "No strong heuristic signal — please choose a persona.",
        }

    ranked = sorted(boosts.items(), key=lambda kv: -kv[1])
    top_id, top_score = ranked[0]
    persona = PERSONA_BY_ID[top_id]
    return {
        "persona_id": top_id,
        "confidence": min(0.95, top_score),
        "alternatives": [{"persona_id": pid, "confidence": min(0.95, s)} for pid, s in ranked[1:4]],
        "follow_up_questions": persona["follow_up_questions"],
        "needs_disambiguation": top_score < CONFIDENCE_THRESHOLD,
        "rationale": "Heuristic match on email domain + first-message keywords.",
    }


# --- Routes -----------------------------------------------------------------


@router.get("/taxonomy")
def taxonomy() -> dict[str, Any]:
    return {"personas": PERSONAS}


@router.get("/me")
def my_personas(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    _ensure_personas_schema(db)
    rows = db.execute(
        text(
            """
            SELECT id, user_id, persona_id, confidence, manual_override, source, is_primary, created_at, updated_at
            FROM user_personas WHERE user_id = :uid
            ORDER BY is_primary DESC, updated_at DESC
            """
        ),
        {"uid": user.id},
    ).mappings().all()
    extras = db.execute(
        text(
            "SELECT id, user_id, persona_id, key, value, source FROM user_profile_extras WHERE user_id = :uid"
        ),
        {"uid": user.id},
    ).mappings().all()
    return {"personas": [dict(r) for r in rows], "extras": [dict(r) for r in extras]}


@router.post("/classify")
async def classify(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    _ensure_personas_schema(db)
    body = await request.json()
    first_message = (body.get("first_message") or "").strip()
    if not first_message:
        raise HTTPException(status_code=400, detail="first_message required")
    return _classify_heuristic(user.email, first_message)


@router.post("/answer")
async def answer(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    _ensure_personas_schema(db)
    body = await request.json()
    persona_id = body.get("persona_id")
    if persona_id not in PERSONA_BY_ID:
        raise HTTPException(status_code=400, detail="invalid persona_id")
    key = (body.get("key") or "")[:80]
    if not key:
        raise HTTPException(status_code=400, detail="key required")
    raw_value = body.get("value")
    value = None if raw_value is None else str(raw_value)[:4000]

    db.execute(
        text(
            """
            INSERT INTO user_profile_extras (user_id, persona_id, key, value)
            VALUES (:uid, :pid, :key, :val)
            ON CONFLICT (user_id, persona_id, key) DO UPDATE SET
                value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
            """
        ),
        {"uid": user.id, "pid": persona_id, "key": key, "val": value},
    )
    db.commit()
    return {"ok": True}


@router.post("/finalize")
async def finalize(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    _ensure_personas_schema(db)
    body = await request.json()
    persona_id = body.get("persona_id")
    if persona_id not in PERSONA_BY_ID:
        raise HTTPException(status_code=400, detail="invalid persona_id")
    confidence = max(0.0, min(1.0, float(body.get("confidence") or 0)))
    source = "self_select" if body.get("source") == "self_select" else "router"

    secondary = body.get("secondary_persona_id")
    if secondary is not None:
        if secondary not in PERSONA_BY_ID:
            raise HTTPException(status_code=400, detail="invalid secondary_persona_id")
        if not _is_allowed_overlap(persona_id, secondary):
            raise HTTPException(status_code=400, detail="persona overlap not allowed")

    db.execute(text("UPDATE user_personas SET is_primary = 0 WHERE user_id = :uid"), {"uid": user.id})
    db.execute(
        text(
            """
            INSERT INTO user_personas (user_id, persona_id, confidence, source, is_primary)
            VALUES (:uid, :pid, :conf, :src, 1)
            ON CONFLICT (user_id, persona_id) DO UPDATE SET
                confidence = EXCLUDED.confidence,
                source = EXCLUDED.source,
                is_primary = 1,
                updated_at = CURRENT_TIMESTAMP
            """
        ),
        {"uid": user.id, "pid": persona_id, "conf": confidence, "src": source},
    )
    if secondary:
        db.execute(
            text(
                """
                INSERT INTO user_personas (user_id, persona_id, confidence, source, is_primary)
                VALUES (:uid, :pid, :conf, :src, 0)
                ON CONFLICT (user_id, persona_id) DO UPDATE SET
                    confidence = EXCLUDED.confidence,
                    source = EXCLUDED.source,
                    updated_at = CURRENT_TIMESTAMP
                """
            ),
            {"uid": user.id, "pid": secondary, "conf": confidence, "src": source},
        )
    db.commit()
    return {"ok": True, "primary": persona_id, "secondary": secondary}


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="admin required")


@router.get("/admin/list")
def admin_list(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    _require_admin(user)
    _ensure_personas_schema(db)
    rows = db.execute(
        text(
            """
            SELECT u.id AS user_id, u.email, u.name, u.role,
                   up.persona_id, up.confidence, up.manual_override, up.source, up.is_primary, up.updated_at
            FROM users u
            LEFT JOIN user_personas up ON up.user_id = u.id AND up.is_primary = 1
            ORDER BY u.created_at DESC
            LIMIT 500
            """
        )
    ).mappings().all()
    return {"users": [dict(r) for r in rows]}


@router.post("/admin/{user_id}/retag")
async def admin_retag(
    user_id: int,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    _require_admin(user)
    _ensure_personas_schema(db)
    body = await request.json()
    persona_id = body.get("persona_id")
    if persona_id not in PERSONA_BY_ID:
        raise HTTPException(status_code=400, detail="invalid persona_id")

    db.execute(text("UPDATE user_personas SET is_primary = 0 WHERE user_id = :uid"), {"uid": user_id})
    db.execute(
        text(
            """
            INSERT INTO user_personas (user_id, persona_id, confidence, manual_override, source, is_primary)
            VALUES (:uid, :pid, 1, 1, 'admin_retag', 1)
            ON CONFLICT (user_id, persona_id) DO UPDATE SET
                manual_override = 1,
                source = 'admin_retag',
                is_primary = 1,
                updated_at = CURRENT_TIMESTAMP
            """
        ),
        {"uid": user_id, "pid": persona_id},
    )
    try:
        db.execute(
            text(
                "INSERT INTO activity_logs (action, details, actor, user_id) "
                "VALUES ('persona_retagged', :details, :actor, :aid)"
            ),
            {
                "details": f"Admin {user.name} re-tagged user {user_id} as {persona_id}",
                "actor": user.email,
                "aid": user.id,
            },
        )
    except Exception:
        db.rollback()
    db.commit()
    return {"ok": True}

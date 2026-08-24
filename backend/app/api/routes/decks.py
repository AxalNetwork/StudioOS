"""Task #25 — Pitch deck builder (FastAPI dev mirror).

10-slide auto-generated decks pulling project + scoring data, with
per-slide rich-text (markdown) + image edits, version history, restore,
and one-time signed share URLs for investors.

Endpoints (under /api/decks)
    POST /generate                          AI/heuristic 10-slide draft
    GET  /by-project/{pid}                  Versions for a project
    GET  /{deck_id}                         Full slide payload
    PUT  /{deck_id}                         Update slides (creates new version)
    POST /{deck_id}/restore                 Restore an earlier version
    POST /{deck_id}/share                   Mint one-time signed share URL
    GET  /share/{token}                     Public read (consumes token)

Slide shape: { title, subtitle?, body? (markdown), bullets?, image_url? }
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import Session, select

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import Project, ScoreSnapshot, User
from backend.app.services.file_storage import mint_signed_token, verify_signed_token
from backend.app.services.use_of_funds import format_use_of_funds_text

router = APIRouter(prefix="/decks", tags=["Pitch Decks"])

_migrated = False


def _ensure_schema(session: Session) -> None:
    global _migrated
    if _migrated:
        return
    stmts = [
        """
        CREATE TABLE IF NOT EXISTS pitch_decks (
            id BIGSERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            slides TEXT NOT NULL,
            title TEXT,
            is_current BOOLEAN DEFAULT TRUE,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_decks_project ON pitch_decks(project_id, version)",
        "CREATE INDEX IF NOT EXISTS idx_decks_current ON pitch_decks(project_id, is_current)",
        # One-time share tokens. We store the SHA-256 of the token (not the
        # token itself) so a DB leak doesn't grant access. `used_at` marks
        # consumption; an atomic UPDATE … WHERE used_at IS NULL prevents
        # double-spend even under concurrent reads.
        """
        CREATE TABLE IF NOT EXISTS pitch_deck_share_tokens (
            id BIGSERIAL PRIMARY KEY,
            deck_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMP NOT NULL,
            used_at TIMESTAMP,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_deck_share_hash ON pitch_deck_share_tokens(token_hash)",
    ]
    for s in stmts:
        try:
            session.exec(text(s))
            session.commit()
        except Exception:
            session.rollback()
    # codeql[py/unused-global-variable] -- _migrated is read via the `global _migrated` guard at the top of this same function (`if
    # _migrated: return`); the write here is what a LATER, separate call's read observes. CodeQL's
    # dead-store analysis does not model a global's value persisting across separate invocations of
    # the function that sets it, so it sees this write as never consumed. It is: this flag exists
    # specifically to make the schema-migration idempotent-but-skippable after the first successful
    # request in this process.
    _migrated = True


def _project_owned(session: Session, project_id: int, user: User) -> Project:
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    role = (getattr(user.role, "value", user.role) or "").lower()
    if role in {"admin", "partner", "investor"}:
        return p
    if role == "founder":
        founder_id = getattr(user, "founder_id", None)
        if founder_id and p.founder_id == founder_id:
            return p
    raise HTTPException(status_code=403, detail="not your project")


# Slide titles are LOCKED — every generated deck has exactly these 10
# slides in this order. The editor lets the founder rename them later;
# the generator must guarantee the structure so investors get a deck.
SLIDE_TITLES = [
    "Problem", "Solution", "Market", "Traction", "Business model",
    "Go-to-market", "Competition", "Team", "Ask", "Financials",
]


def _latest_score(session: Session, project_id: int) -> Optional[ScoreSnapshot]:
    return session.exec(
        select(ScoreSnapshot)
        .where(ScoreSnapshot.project_id == project_id)
        .where(ScoreSnapshot.is_sandbox == False)  # noqa: E712
        .order_by(ScoreSnapshot.created_at.desc())
    ).first()


def _score_context(snap: Optional[ScoreSnapshot]) -> Dict[str, Any]:
    if not snap:
        return {}
    return {
        "total_score": snap.total_score, "tier": snap.tier,
        "market_total": snap.market_total, "team_total": snap.team_total,
        "product_total": snap.product_total, "capital_total": snap.capital_total,
        "fit_total": snap.fit_total, "distribution_total": snap.distribution_total,
        "ai_notes": snap.ai_notes,
    }


def _heuristic_slides(p: Project, snap: Optional[ScoreSnapshot]) -> List[Dict[str, Any]]:
    name = p.name or "Untitled"
    sector = p.sector or "your sector"
    problem = (p.problem_statement or "").strip() or f"Founders in {sector} lack a fast way to ship and scale."
    solution = (p.solution or "").strip() or (p.description or f"{name} delivers an integrated platform for {sector}.")
    why_now = (p.why_now or "").strip() or "Recent shifts in tooling and demand make this the right moment."
    tam = p.tam or 0
    sam = p.sam or 0
    users = p.users_count or 0
    revenue = p.revenue or 0
    funding = p.funding_needed or 0
    use_of = format_use_of_funds_text(p.use_of_funds) or "Product, GTM, key hires."

    # Lean on scoring data when available — gives investors a credible
    # quantitative anchor on the Traction and Market slides.
    score_line = ""
    market_line = ""
    if snap:
        score_line = f"Internal score: {round(snap.total_score, 1)}/100 ({snap.tier})."
        market_line = f"Market scoring: {round(snap.market_total, 1)} (urgency + trend signal)."

    def b(*items: str) -> List[str]:
        return [x for x in items if x]

    return [
        {"title": "Problem", "subtitle": name,
         "body": problem, "bullets": b(why_now), "image_url": None},
        {"title": "Solution", "subtitle": name,
         "body": solution, "bullets": [], "image_url": None},
        {"title": "Market", "subtitle": sector, "body": "", "bullets": b(
            f"TAM: ${tam:,.0f}" if tam else "TAM: large and growing",
            f"SAM: ${sam:,.0f}" if sam else "SAM: clearly addressable",
            why_now, market_line,
        ), "image_url": None},
        {"title": "Traction", "subtitle": "What's working", "body": "", "bullets": b(
            f"{users:,} users" if users else "Early design partners engaged",
            f"${revenue:,.0f} revenue" if revenue else "Pre-revenue, pilots in motion",
            (p.growth_signals or "Strong week-over-week engagement signals."),
            score_line,
        ), "image_url": None},
        {"title": "Business model", "subtitle": "How we make money", "body": "", "bullets": [
            "Subscription / usage tier (to be locked in this quarter).",
            "Gross margin trending toward 70%+ at scale.",
        ], "image_url": None},
        {"title": "Go-to-market", "subtitle": "Channels & motion", "body": "", "bullets": [
            "Founder-led sales into design partners → outbound + community.",
            "Distribution: integrations, referrals, content.",
        ], "image_url": None},
        {"title": "Competition", "subtitle": "Landscape", "body": "", "bullets": [
            "Incumbents are slow and unbundled.",
            "Our wedge: speed-to-value + integrated workflow.",
        ], "image_url": None},
        {"title": "Team", "subtitle": "Why us", "body": "", "bullets": [
            "Founders with domain + execution track record.",
            "Hiring plan: 2-3 senior ICs in the next 6 months.",
        ], "image_url": None},
        {"title": "Ask", "subtitle": "Round", "body": "", "bullets": b(
            (f"Raising ${funding:,.0f}" if funding else "Raising a focused pre-seed/seed round"),
            "18-24 months of runway to hit the next milestone.",
            use_of,
        ), "image_url": None},
        {"title": "Financials", "subtitle": "Plan", "body": "", "bullets": b(
            "Year 1: get to repeatable revenue motion.",
            "Year 2: scale GTM, expand product surface.",
            (f"Burn target reflecting ${funding:,.0f} raise." if funding else "Disciplined burn, default-alive plan."),
        ), "image_url": None},
    ]


def _ai_slides(p: Project, snap: Optional[ScoreSnapshot]) -> Optional[List[Dict[str, Any]]]:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    try:
        import openai
        client = openai.OpenAI(api_key=key)
        ctx = {
            "name": p.name, "sector": p.sector, "stage": p.stage,
            "description": p.description, "problem": p.problem_statement,
            "solution": p.solution, "why_now": p.why_now,
            "tam": p.tam, "sam": p.sam, "users": p.users_count,
            "revenue": p.revenue, "growth_signals": p.growth_signals,
            "cost_to_mvp": p.cost_to_mvp, "funding_needed": p.funding_needed,
            "use_of_funds": p.use_of_funds,
            "scoring": _score_context(snap),
        }
        prompt = (
            "Draft a 10-slide pitch deck for the following startup. Return ONLY valid JSON of the shape:\n"
            '{"slides":[{"title":"...","subtitle":"...","body":"...","bullets":["...","..."]}, ...]}\n'
            f"Use exactly these slide titles in order: {SLIDE_TITLES}.\n"
            "`body` is a 1-2 sentence narrative paragraph (markdown allowed). "
            "`bullets` is 2-4 punchy bullets (≤18 words each).\n"
            "Use the scoring numbers in the Traction and Market slides where helpful.\n"
            f"Startup data: {json.dumps(ctx, default=str)}"
        )
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a senior VC associate drafting concise pitch decks. Always return valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.5, max_tokens=1800,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(r.choices[0].message.content)
        slides = parsed.get("slides")
        if isinstance(slides, list) and len(slides) >= 1:
            return slides
    except Exception:
        return None
    return None


def _enforce_ten(slides: List[Dict[str, Any]], fallback: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Spec: deck "auto-creates 10 slides". Pad with fallback content from
    the heuristic when the AI returns fewer; trim when it returns more.
    Slides are aligned to the canonical SLIDE_TITLES order."""
    by_title: Dict[str, Dict[str, Any]] = {}
    for s in slides or []:
        if not isinstance(s, dict):
            continue
        t = str(s.get("title") or "").strip()
        if t:
            by_title.setdefault(t.lower(), s)
    out: List[Dict[str, Any]] = []
    for i, canonical_title in enumerate(SLIDE_TITLES):
        s = by_title.get(canonical_title.lower())
        if not s and i < len(slides):
            s = slides[i] if isinstance(slides[i], dict) else None
        if not s:
            s = fallback[i]
        # Ensure title matches the canonical slot.
        s = dict(s)
        s.setdefault("title", canonical_title)
        out.append(s)
    return out


def _sanitize_slides(slides: List[Any]) -> List[Dict[str, Any]]:
    safe = []
    for s in slides[:20]:
        if not isinstance(s, dict):
            continue
        title = str(s.get("title") or "").strip()[:120] or "Slide"
        subtitle = s.get("subtitle")
        subtitle = str(subtitle).strip()[:200] if subtitle else None
        body = s.get("body")
        body = str(body).strip()[:4000] if body else ""
        bullets_raw = s.get("bullets") or []
        bullets = [str(b).strip()[:400] for b in bullets_raw if str(b).strip()][:6]
        # image_url restricted to http(s) — protects the print/PDF render
        # path from javascript:/data: URL injection.
        image_url = s.get("image_url")
        if image_url and isinstance(image_url, str) and re.match(r"^https?://", image_url.strip(), re.I):
            image_url = image_url.strip()[:1000]
        else:
            image_url = None
        safe.append({"title": title, "subtitle": subtitle, "body": body,
                     "bullets": bullets, "image_url": image_url})
    return safe


def _row_to_deck(row, *, with_slides: bool = True) -> Dict[str, Any]:
    out = {
        "id": row["id"],
        "project_id": row["project_id"],
        "version": row["version"],
        "title": row["title"],
        "is_current": bool(row["is_current"]),
        "created_at": (row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"])),
    }
    if with_slides:
        try:
            out["slides"] = json.loads(row["slides"]) if row["slides"] else []
        except Exception:
            out["slides"] = []
    return out


def _next_version(session: Session, project_id: int) -> int:
    row = session.exec(text(
        "SELECT COALESCE(MAX(version), 0) AS v FROM pitch_decks WHERE project_id = :pid"
    ), params={"pid": project_id}).mappings().first()
    return int((row["v"] if row else 0) or 0) + 1


def _insert_version(session: Session, project_id: int, slides: List[Dict[str, Any]], title: Optional[str], user: User) -> int:
    session.exec(text(
        "UPDATE pitch_decks SET is_current = FALSE WHERE project_id = :pid AND is_current = TRUE"
    ), params={"pid": project_id})
    v = _next_version(session, project_id)
    session.exec(text(
        "INSERT INTO pitch_decks (project_id, version, slides, title, is_current, created_by) "
        "VALUES (:pid, :v, :slides, :title, TRUE, :uid)"
    ), params={
        "pid": project_id, "v": v,
        "slides": json.dumps(slides),
        "title": title or "Pitch deck",
        "uid": getattr(user, "id", None),
    })
    session.commit()
    row = session.exec(text(
        "SELECT id FROM pitch_decks WHERE project_id = :pid AND version = :v"
    ), params={"pid": project_id, "v": v}).mappings().first()
    return int(row["id"])


# --- payloads --------------------------------------------------------------


class GeneratePayload(BaseModel):
    project_id: int


class SlideModel(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    subtitle: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default="", max_length=4000)
    bullets: List[str] = Field(default_factory=list)
    image_url: Optional[str] = Field(default=None, max_length=1000)


class DeckUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    slides: List[SlideModel]


class SharePayload(BaseModel):
    ttl_hours: int = Field(default=72, ge=1, le=24 * 30)


# --- routes ----------------------------------------------------------------


def _deck_row(session: Session, deck_id: int):
    row = session.exec(text(
        "SELECT * FROM pitch_decks WHERE id = :id"
    ), params={"id": deck_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="deck not found")
    return row


@router.post("/generate")
def generate(payload: GeneratePayload, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    p = _project_owned(session, payload.project_id, user)
    _ensure_schema(session)
    snap = _latest_score(session, p.id)
    fallback = _heuristic_slides(p, snap)
    raw = _ai_slides(p, snap) or fallback
    aligned = _enforce_ten(raw, fallback)
    safe_slides = _sanitize_slides(aligned)
    # _enforce_ten guarantees 10; sanity guard anyway.
    while len(safe_slides) < 10:
        safe_slides.append(fallback[len(safe_slides)])
    title = f"{p.name} — Pitch deck"
    deck_id = _insert_version(session, p.id, safe_slides, title, user)
    row = _deck_row(session, deck_id)
    return _row_to_deck(row)


# ---------------------------------------------------------------------
# Dev mirror of the Worker's `/api/decks/methods` endpoint.
#
# The Cloudflare Worker (production) returns the 12 deck-method specs
# from `cloudflare-worker/src/services/decks/methods.ts`. The Pitch Deck
# Builder's "Pick a deck template" modal calls /api/decks/methods to
# populate the template grid. Without this route, the dev FastAPI backend
# previously matched the request against /{deck_id}, failed parsing, and
# the frontend received an error → empty `methods` array → blank grid.
#
# We mirror only the metadata fields the picker UI reads (id, key, label,
# category, slide_count, premium, prompt_hint, best_for, locked). Slide
# specs and auto-fill source lists are Worker-only — apply-method/generate
# in dev fall back to the legacy heuristic generator.
# ---------------------------------------------------------------------
_DECK_METHODS_DEV: List[Dict[str, Any]] = [
    {"id": "yc_seed", "key": "yc_seed", "label": "YC Seed (10)",
     "prompt_hint": "The Y Combinator demo-day classic. Tight, narrative.",
     "best_for": "Pre-seed / seed founders pitching accelerators.",
     "slide_count": 10, "premium": False, "category": "fundraising"},
    {"id": "sequoia_classic", "key": "sequoia_classic", "label": "Sequoia Classic (12)",
     "prompt_hint": "The Sequoia 12-slide template. Story arc + market deep dive.",
     "best_for": "Seed / Series A with a clear narrative + sizable market.",
     "slide_count": 12, "premium": False, "category": "narrative"},
    {"id": "kawasaki_10_20_30", "key": "kawasaki_10_20_30", "label": "Kawasaki 10/20/30 (10)",
     "prompt_hint": "10 slides, 20 minutes, 30-point font. Maximum clarity.",
     "best_for": "Investor meetings where you need to be ruthlessly concise.",
     "slide_count": 10, "premium": False, "category": "fundraising"},
    {"id": "minimal_seed", "key": "minimal_seed", "label": "Minimal Seed (6)",
     "prompt_hint": "Six slides. Cold-DM-friendly, easy to share async.",
     "best_for": "Sending to investors over email; first-touch pitches.",
     "slide_count": 6, "premium": False, "category": "fundraising"},
    {"id": "series_a_growth", "key": "series_a_growth", "label": "Series A Growth (15)",
     "prompt_hint": "Series A: depth on cohorts, retention, GTM motion.",
     "best_for": "Companies with $500k+ ARR raising a Series A.",
     "slide_count": 15, "premium": False, "category": "fundraising"},
    {"id": "series_b_diligence", "key": "series_b_diligence", "label": "Series B + Diligence (22 + appendix)",
     "prompt_hint": "Long-form Series B with diligence-grade appendix.",
     "best_for": "Series B+ rounds where investors expect a data room in slides.",
     "slide_count": 22, "premium": True, "category": "fundraising"},
    {"id": "demo_day", "key": "demo_day", "label": "Demo Day (12)",
     "prompt_hint": "Theatrical 12 slides. Designed for a live stage.",
     "best_for": "Accelerator demo days, pitch competitions.",
     "slide_count": 12, "premium": False, "category": "event"},
    {"id": "sales_commercial", "key": "sales_commercial", "label": "Sales / Commercial (18)",
     "prompt_hint": "Buyer-facing deck. ROI, security, references.",
     "best_for": "Enterprise sales meetings; commercial pitches.",
     "slide_count": 18, "premium": False, "category": "commercial"},
    {"id": "partnership_bd", "key": "partnership_bd", "label": "Partnership / BD (12)",
     "prompt_hint": "BD deck for channel + co-marketing partners.",
     "best_for": "Strategic partnerships, channel deals, co-marketing.",
     "slide_count": 12, "premium": False, "category": "commercial"},
    {"id": "one_pager_teaser", "key": "one_pager_teaser", "label": "One-pager teaser (1)",
     "prompt_hint": "Single-page summary for cold outreach.",
     "best_for": "First-touch teaser to send to investors or partners.",
     "slide_count": 1, "premium": False, "category": "commercial"},
    {"id": "investor_appendix", "key": "investor_appendix", "label": "Investor + 30pp Appendix",
     "prompt_hint": "Short investor deck plus a deep diligence appendix.",
     "best_for": "Sophisticated investors who want both a TL;DR and source data.",
     "slide_count": 12, "premium": True, "category": "fundraising"},
    {"id": "narrative_brand", "key": "narrative_brand", "label": "Narrative / Brand (15)",
     "prompt_hint": "Story-led brand deck. Heavy on imagery + tone.",
     "best_for": "Mission-driven companies; brand-first founders.",
     "slide_count": 15, "premium": True, "category": "narrative"},
    {"id": "axal_spinout_demoday", "key": "axal_spinout_demoday",
     "label": "Axal VC Spin-Out",
     "prompt_hint": "11 slides · editorial · binds to Lab data.",
     "best_for": "Axal Spin-Out Lab founders presenting on Demo Day.",
     "slide_count": 11, "premium": True, "category": "event"},
]
_PREMIUM_METHOD_IDS_DEV = [m["id"] for m in _DECK_METHODS_DEV if m["premium"]]


# IMPORTANT: must be registered BEFORE /{deck_id} so FastAPI doesn't
# match "methods" as a deck_id path param.
@router.get("/methods")
def list_methods(user: User = Depends(get_current_user)):
    # User.role is a UserRole(str, Enum) — str() on an Enum returns
    # "UserRole.ADMIN", not "admin", so we must read .value (or fall
    # back to the value itself when it's already a plain string).
    raw_role = getattr(user, "role", "") or ""
    role = str(getattr(raw_role, "value", raw_role)).lower()
    raw_tier = getattr(user, "subscription_tier", "free") or "free"
    tier = str(getattr(raw_tier, "value", raw_tier)).lower()
    bypass = role in {"admin", "partner", "investor", "advisor"}
    tier_ok = tier in {"growth", "studio", "enterprise"}
    methods = [
        {**m, "locked": bool(m["premium"]) and not bypass and not tier_ok}
        for m in _DECK_METHODS_DEV
    ]
    return {
        "methods": methods,
        "premium_method_ids": _PREMIUM_METHOD_IDS_DEV,
        "user_tier": tier,
        "can_remove_footer": tier_ok,
        "can_upload_watermark": tier in {"studio", "enterprise"},
        "watermark_url": "",
    }


@router.get("/by-project/{project_id}")
def list_versions(project_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _project_owned(session, project_id, user)
    _ensure_schema(session)
    rows = session.exec(text(
        "SELECT id, project_id, version, title, is_current, created_at, slides "
        "FROM pitch_decks WHERE project_id = :pid ORDER BY version DESC"
    ), params={"pid": project_id}).mappings().all()
    return {"versions": [_row_to_deck(r, with_slides=False) for r in rows]}


@router.get("/{deck_id}")
def get_deck(deck_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _ensure_schema(session)
    row = _deck_row(session, deck_id)
    _project_owned(session, row["project_id"], user)
    return _row_to_deck(row)


@router.put("/{deck_id}")
def update_deck(deck_id: int, payload: DeckUpdate, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Per the task: edits are versioned, not in-place. Saving creates a
    new `pitch_decks` row marked current; older versions stay restorable."""
    _ensure_schema(session)
    row = _deck_row(session, deck_id)
    _project_owned(session, row["project_id"], user)
    slides = _sanitize_slides([s.model_dump() for s in payload.slides])
    if not slides:
        raise HTTPException(status_code=422, detail="at least one slide required")
    title = payload.title or row["title"] or "Pitch deck"
    new_id = _insert_version(session, int(row["project_id"]), slides, title, user)
    new_row = _deck_row(session, new_id)
    return _row_to_deck(new_row)


@router.post("/{deck_id}/restore")
def restore(deck_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _ensure_schema(session)
    row = _deck_row(session, deck_id)
    _project_owned(session, row["project_id"], user)
    try:
        slides = _sanitize_slides(json.loads(row["slides"] or "[]"))
    except Exception:
        slides = []
    new_id = _insert_version(session, int(row["project_id"]), slides, row["title"], user)
    return _row_to_deck(_deck_row(session, new_id))


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/{deck_id}/share")
def share(deck_id: int, payload: SharePayload, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    """Mints a ONE-TIME share URL.

    The HMAC token gives transport-layer authenticity (tamper-resistant);
    the DB row enforces single use — the share_read endpoint atomically
    UPDATE … WHERE used_at IS NULL, so even concurrent reads can't
    consume the same token twice.
    """
    _ensure_schema(session)
    row = _deck_row(session, deck_id)
    _project_owned(session, row["project_id"], user)
    ttl = max(3600, int(payload.ttl_hours) * 3600)
    key = f"deck:{deck_id}:v{row['version']}"
    actor = getattr(user, "email", None)
    token = mint_signed_token(key, ttl_seconds=ttl, actor=actor)
    expires_at = datetime.utcnow() + timedelta(seconds=ttl)
    session.exec(text(
        "INSERT INTO pitch_deck_share_tokens (deck_id, token_hash, expires_at, created_by) "
        "VALUES (:did, :h, :exp, :uid)"
    ), params={
        "did": deck_id,
        "h": _token_hash(token),
        "exp": expires_at,
        "uid": getattr(user, "id", None),
    })
    session.commit()
    return {
        "token": token,
        "expires_in_seconds": ttl,
        "expires_at": expires_at.isoformat(),
        "share_path": f"/deck/share/{token}",
        "one_time": True,
    }


_SHARE_KEY_RE = re.compile(r"^deck:(\d+):v(\d+)$")


@router.get("/share/{token}")
def share_read(token: str, session: Session = Depends(get_session)):
    """Public read for an investor-share token. Single-use:
    1. HMAC verify the token (authenticity + expiry).
    2. Atomically claim the matching DB row (used_at WHERE NULL).
    3. Only then return the deck."""
    try:
        payload = verify_signed_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    m = _SHARE_KEY_RE.match(str(payload.get("k", "")))
    if not m:
        raise HTTPException(status_code=400, detail="bad token scope")
    deck_id = int(m.group(1))
    _ensure_schema(session)
    h = _token_hash(token)
    # Atomic claim. Postgres returns the row count via rowcount on the
    # underlying CursorResult; sqlmodel's exec wraps it.
    res = session.exec(text(
        "UPDATE pitch_deck_share_tokens SET used_at = CURRENT_TIMESTAMP "
        "WHERE token_hash = :h AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP"
    ), params={"h": h})
    session.commit()
    if getattr(res, "rowcount", 0) != 1:
        # Either: token never minted, already consumed, or expired.
        raise HTTPException(status_code=403, detail="share link is no longer valid")
    row = session.exec(text(
        "SELECT * FROM pitch_decks WHERE id = :id"
    ), params={"id": deck_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="deck not found")
    return _row_to_deck(row)

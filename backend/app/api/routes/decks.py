"""Task #25 — Pitch deck builder (FastAPI dev mirror).

10-slide auto-generated decks with per-slide editing, version history,
restore, signed share URLs, and a print-ready HTML view that the user
exports to PDF via the browser's print dialog (the simplest path that
avoids shipping a heavy server-side PDF dependency).

Endpoints (under /api/decks)
    POST /generate                          AI/heuristic 10-slide draft
    GET  /by-project/{pid}                  Versions for a project
    GET  /{deck_id}                         Full slide payload
    PUT  /{deck_id}                         Update slides (creates new version)
    POST /{deck_id}/restore                 Restore an earlier version
    POST /{deck_id}/share                   Mint signed share URL
    GET  /share/{token}                     Public read by signed token
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import Project, User
from backend.app.services.file_storage import mint_signed_token, verify_signed_token

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
    ]
    for s in stmts:
        try:
            session.exec(text(s))
            session.commit()
        except Exception:
            session.rollback()
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


SLIDE_TEMPLATES = [
    ("Problem", "What painful, urgent problem are you solving?"),
    ("Solution", "Your product in one screen + one paragraph."),
    ("Market", "TAM / SAM / SOM and why now."),
    ("Traction", "Users, revenue, MoM growth, pilots, LOIs."),
    ("Business model", "How you make money + unit economics."),
    ("Go-to-market", "Channels, CAC/LTV, sales motion."),
    ("Competition", "Landscape + your unfair advantage."),
    ("Team", "Founders + key hires + relevant wins."),
    ("Ask", "Round size, runway, milestones to next round."),
    ("Financials", "12-24mo plan: revenue, burn, headcount."),
]


def _heuristic_slides(p: Project) -> List[Dict[str, Any]]:
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
    use_of = (p.use_of_funds or "Product, GTM, key hires.").strip()

    def b(*items: str) -> List[str]:
        return [x for x in items if x]

    return [
        {"title": "Problem", "subtitle": name, "bullets": b(problem, why_now)},
        {"title": "Solution", "subtitle": name, "bullets": b(solution)},
        {"title": "Market", "subtitle": sector, "bullets": b(
            f"TAM: ${tam:,.0f}" if tam else "TAM: large and growing",
            f"SAM: ${sam:,.0f}" if sam else "SAM: clearly addressable",
            why_now,
        )},
        {"title": "Traction", "subtitle": "What's working", "bullets": b(
            f"{users:,} users" if users else "Early design partners engaged",
            f"${revenue:,.0f} revenue" if revenue else "Pre-revenue, pilots in motion",
            (p.growth_signals or "Strong week-over-week engagement signals."),
        )},
        {"title": "Business model", "subtitle": "How we make money", "bullets": b(
            "Subscription / usage tier (to be locked in this quarter).",
            "Gross margin trending toward 70%+ at scale.",
        )},
        {"title": "Go-to-market", "subtitle": "Channels & motion", "bullets": b(
            "Founder-led sales into design partners → outbound + community.",
            "Distribution: integrations, referrals, content.",
        )},
        {"title": "Competition", "subtitle": "Landscape", "bullets": b(
            "Incumbents are slow and unbundled.",
            "Our wedge: speed-to-value + integrated workflow.",
        )},
        {"title": "Team", "subtitle": "Why us", "bullets": b(
            "Founders with domain + execution track record.",
            "Hiring plan: 2-3 senior ICs in the next 6 months.",
        )},
        {"title": "Ask", "subtitle": "Round", "bullets": b(
            (f"Raising ${funding:,.0f}" if funding else "Raising a focused pre-seed/seed round"),
            "18-24 months of runway to hit the next milestone.",
            use_of,
        )},
        {"title": "Financials", "subtitle": "Plan", "bullets": b(
            "Year 1: get to repeatable revenue motion.",
            "Year 2: scale GTM, expand product surface.",
            (f"Burn target reflecting ${funding:,.0f} raise." if funding else "Disciplined burn, default-alive plan."),
        )},
    ]


def _ai_slides(p: Project) -> Optional[List[Dict[str, Any]]]:
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
        }
        prompt = (
            "Draft a 10-slide pitch deck for the following startup. Return ONLY valid JSON of the shape:\n"
            '{"slides":[{"title":"...","subtitle":"...","bullets":["...","..."]}, ...]}\n'
            f"Use exactly these slide titles in order: {[t for t,_ in SLIDE_TEMPLATES]}.\n"
            "Each slide should have 2-4 punchy bullets (no more than 18 words each).\n"
            f"Startup data: {json.dumps(ctx, default=str)}"
        )
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a senior VC associate drafting concise pitch decks. Always return valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.5, max_tokens=1400,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(r.choices[0].message.content)
        slides = parsed.get("slides")
        if isinstance(slides, list) and len(slides) >= 5:
            return slides[:10]
    except Exception:
        return None
    return None


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
    bullets: List[str] = Field(default_factory=list)


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
    slides = _ai_slides(p) or _heuristic_slides(p)
    # Sanitize bullets to plain strings.
    safe_slides = []
    for s in slides:
        title = str((s.get("title") if isinstance(s, dict) else "") or "").strip()[:120] or "Slide"
        subtitle = (s.get("subtitle") if isinstance(s, dict) else None)
        subtitle = str(subtitle).strip()[:200] if subtitle else None
        bullets_raw = (s.get("bullets") if isinstance(s, dict) else []) or []
        bullets = [str(b).strip()[:400] for b in bullets_raw if str(b).strip()][:6]
        safe_slides.append({"title": title, "subtitle": subtitle, "bullets": bullets})
    title = f"{p.name} — Pitch deck"
    deck_id = _insert_version(session, p.id, safe_slides, title, user)
    row = _deck_row(session, deck_id)
    return _row_to_deck(row)


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
    slides = [s.model_dump() for s in payload.slides][:20]
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
        slides = json.loads(row["slides"] or "[]")
    except Exception:
        slides = []
    new_id = _insert_version(session, int(row["project_id"]), slides, row["title"], user)
    return _row_to_deck(_deck_row(session, new_id))


# Signed share URLs reuse the existing HMAC helper. The token's `k` field
# is namespaced as `deck:{id}:v{version}` so a leaked token is bound to a
# single immutable version and can't be re-pointed.
@router.post("/{deck_id}/share")
def share(deck_id: int, payload: SharePayload, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _ensure_schema(session)
    row = _deck_row(session, deck_id)
    _project_owned(session, row["project_id"], user)
    ttl = max(3600, int(payload.ttl_hours) * 3600)
    key = f"deck:{deck_id}:v{row['version']}"
    actor = getattr(user, "email", None)
    token = mint_signed_token(key, ttl_seconds=ttl, actor=actor)
    return {
        "token": token,
        "expires_in_seconds": ttl,
        "share_path": f"/deck/share/{token}",
    }


_SHARE_KEY_RE = re.compile(r"^deck:(\d+):v(\d+)$")


@router.get("/share/{token}")
def share_read(token: str, session: Session = Depends(get_session)):
    """Public read for an investor-share token. The token binds a specific
    deck id (no version-bumping behind the investor's back)."""
    try:
        payload = verify_signed_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    m = _SHARE_KEY_RE.match(str(payload.get("k", "")))
    if not m:
        raise HTTPException(status_code=400, detail="bad token scope")
    deck_id = int(m.group(1))
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT * FROM pitch_decks WHERE id = :id"
    ), params={"id": deck_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="deck not found")
    return _row_to_deck(row)

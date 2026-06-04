"""Task #24 — Brand & landing page generator (FastAPI dev mirror).

Endpoints (all under /api/brand)
    POST /suggest                       AI brand suggestions (5 names)
    POST /logo                          AI/SVG logo generation
    GET  /landing/by-project/{pid}      Authenticated read for the project owner
    PUT  /landing/by-project/{pid}      Authenticated upsert
    POST /landing/by-project/{pid}/publish    Toggle published flag
    GET  /landing/{slug}                Public — server returns JSON for SSR mirror
    POST /landing/{slug}/waitlist       Public — appends signup
    POST /landing/{slug}/view           Public — increments analytics counter

The Cloudflare worker mirrors these and additionally serves an HTML
page at /landing/:slug for un-authenticated viewers.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlmodel import Session

from backend.app.api.routes.auth import get_current_user
from backend.app.database import get_session
from backend.app.models.entities import Project, User

router = APIRouter(prefix="/brand", tags=["Brand & Landing"])


_migrated = False


def _ensure_schema(session: Session) -> None:
    global _migrated
    if _migrated:
        return
    stmts = [
        """
        CREATE TABLE IF NOT EXISTS landing_pages (
            id BIGSERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL UNIQUE,
            slug TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            tagline TEXT,
            headline TEXT,
            subheadline TEXT,
            cta_text TEXT DEFAULT 'Join the waitlist',
            logo_url TEXT,
            logo_svg TEXT,
            theme_color TEXT DEFAULT '#7c3aed',
            published BOOLEAN DEFAULT FALSE,
            views_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS waitlist_signups (
            id BIGSERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL,
            landing_page_id INTEGER,
            email TEXT NOT NULL,
            name TEXT,
            source TEXT,
            ip_hash TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_waitlist_project ON waitlist_signups(project_id)",
        "CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist_signups(email)",
        "CREATE INDEX IF NOT EXISTS idx_landing_slug ON landing_pages(slug)",
    ]
    for s in stmts:
        try:
            session.exec(text(s))
            session.commit()
        except Exception:
            session.rollback()
    _migrated = True


# --- helpers ---------------------------------------------------------------

_SLUG_RE = re.compile(r"[^a-z0-9-]+")


def _slugify(name: str) -> str:
    base = _SLUG_RE.sub("-", (name or "").lower()).strip("-")[:48] or "page"
    return f"{base}-{secrets.token_hex(3)}"


def _project_owned(session: Session, project_id: int, user: User) -> Project:
    p = session.get(Project, project_id)
    if not p:
        raise HTTPException(status_code=404, detail="project not found")
    role = (getattr(user.role, "value", user.role) or "").lower()
    if role in {"admin", "partner", "investor"}:
        return p
    if role == "founder":
        # Founders can only touch their own projects.
        founder_id = getattr(user, "founder_id", None)
        if founder_id and p.founder_id == founder_id:
            return p
    raise HTTPException(status_code=403, detail="not your project")


def _heuristic_brand(description: str, sector: Optional[str]) -> List[Dict[str, Any]]:
    """Deterministic brand options for the dev backend (prod generates these
    via Workers AI on the Worker). Produces 5 plausible (name, tagline,
    logo_prompt) triplets so the wizard is always usable in dev."""
    seeds = ["Lumen", "Axon", "Forge", "Vela", "Quanta", "Helio", "Nimbus", "Stratus", "Orbit", "Beacon"]
    suffixes = ["AI", "Labs", "Works", "Cloud", "Stack", "OS", "Sense", "Engine"]
    h = int(hashlib.sha1((description or "x").encode()).hexdigest(), 16)
    out = []
    for i in range(5):
        a = seeds[(h + i * 7) % len(seeds)]
        b = suffixes[(h + i * 11) % len(suffixes)]
        name = f"{a}{b}"
        tag = f"{(sector or 'AI').strip().title()} that just works."
        if i == 1:
            tag = f"The fastest way to ship {sector or 'your idea'}."
        if i == 2:
            tag = f"{sector or 'Software'} for the next billion users."
        if i == 3:
            tag = "Built for founders who move fast."
        if i == 4:
            tag = "Less ops, more outcomes."
        out.append({
            "name": name,
            "tagline": tag,
            "logo_prompt": f"minimalist geometric logo, {a.lower()} mark, violet and white, vector, flat",
        })
    return out


# NOTE: The dev FastAPI backend is never deployed (prod is the Cloudflare
# Worker, which generates brand names/taglines and logos via Workers AI). Dev
# has no Workers AI binding, so it serves the deterministic heuristic + inline
# SVG directly — no external AI key is read here.


def _svg_logo(name: str, color: str = "#7c3aed") -> str:
    """Tiny inline SVG fallback — a circle with the brand initial."""
    initial = (name or "A").strip()[:1].upper()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">'
        f'<circle cx="50" cy="50" r="46" fill="{color}"/>'
        f'<text x="50" y="62" text-anchor="middle" font-family="Inter,system-ui,sans-serif" '
        f'font-size="44" font-weight="700" fill="#fff">{initial}</text></svg>'
    )


def _row_to_landing(row) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "slug": row["slug"],
        "name": row["name"],
        "tagline": row["tagline"],
        "headline": row["headline"],
        "subheadline": row["subheadline"],
        "cta_text": row["cta_text"] or "Join the waitlist",
        "logo_url": row["logo_url"],
        "logo_svg": row["logo_svg"],
        "theme_color": row["theme_color"] or "#7c3aed",
        "published": bool(row["published"]),
        "views_count": row["views_count"] or 0,
    }


# --- payloads --------------------------------------------------------------


class SuggestPayload(BaseModel):
    description: str = Field(..., min_length=4, max_length=2000)
    sector: Optional[str] = None


class LogoPayload(BaseModel):
    prompt: str = Field(..., min_length=4, max_length=600)
    name: Optional[str] = None
    color: Optional[str] = "#7c3aed"


class LandingUpsert(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    tagline: Optional[str] = None
    headline: Optional[str] = None
    subheadline: Optional[str] = None
    cta_text: Optional[str] = None
    logo_url: Optional[str] = None
    logo_svg: Optional[str] = None
    theme_color: Optional[str] = "#7c3aed"


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WaitlistPayload(BaseModel):
    # Email validity is enforced inside the route handler so we can return
    # a clean 422 without colliding with the project-wide validation
    # exception handler that mishandles pydantic ValueError contexts.
    email: str = Field(..., max_length=320)
    name: Optional[str] = Field(default=None, max_length=120)
    source: Optional[str] = Field(default=None, max_length=64)


# Stored-XSS guard for logo_svg: founders can save a custom SVG that we
# render with dangerouslySetInnerHTML on the public landing page, so we
# strip <script>/<foreignObject> blocks and on*= event handlers before
# accepting the payload. Anything that doesn't start with <svg is dropped.
_SVG_DANGER_TAG_BLOCK = re.compile(
    r"<\s*(script|foreignObject|iframe|object|embed|link|meta|style|use|image)\b[^>]*>.*?<\s*/\s*\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
_SVG_DANGER_TAG_VOID = re.compile(
    r"<\s*(script|foreignObject|iframe|object|embed|link|meta|style|use|image)\b[^>]*/?>",
    re.IGNORECASE,
)
_SVG_EVENT_ATTR = re.compile(r"\s+on[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE)
# Strict href stripper — kills href/xlink:href regardless of scheme, quoted
# OR unquoted. The fallback logo we ship has no href, so dropping all of
# them is safe and forecloses javascript:/data: bypasses the regex sanitizer
# would otherwise miss.
_SVG_ANY_HREF = re.compile(r"\s+(href|xlink:href)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.IGNORECASE)


def _sanitize_svg(svg: Optional[str]) -> Optional[str]:
    if not svg:
        return svg
    s = str(svg).strip()
    if not s.lower().startswith("<svg"):
        return None
    s = _SVG_DANGER_TAG_BLOCK.sub("", s)
    s = _SVG_DANGER_TAG_VOID.sub("", s)
    s = _SVG_EVENT_ATTR.sub("", s)
    s = _SVG_ANY_HREF.sub("", s)
    # Belt-and-suspenders: if anything dangerous still slipped through
    # (e.g. obfuscated entities), drop the SVG entirely so the renderer
    # falls back to the generated initial badge.
    lower = s.lower()
    if "javascript:" in lower or "<script" in lower or "onload" in lower or "onerror" in lower:
        return None
    return s[:8000]


# --- routes ----------------------------------------------------------------


@router.post("/suggest")
def suggest(payload: SuggestPayload, user: User = Depends(get_current_user)):
    # Dev backend has no Workers AI binding — serve the deterministic heuristic.
    # Prod (the Worker) routes this through Workers AI.
    return {"suggestions": _heuristic_brand(payload.description, payload.sector), "ai_generated": False}


@router.post("/logo")
def logo(payload: LogoPayload, user: User = Depends(get_current_user)):
    # Dev backend has no Workers AI binding — serve the inline SVG fallback.
    # Prod (the Worker) generates logos via Workers AI text-to-image.
    return {"url": None, "svg": _svg_logo(payload.name or "A", payload.color or "#7c3aed"), "source": "svg"}


@router.get("/landing/by-project/{project_id}")
def get_landing(project_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _project_owned(session, project_id, user)
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT * FROM landing_pages WHERE project_id = :pid"
    ), params={"pid": project_id}).mappings().first()
    if not row:
        return None
    return _row_to_landing(row)


@router.put("/landing/by-project/{project_id}")
def upsert_landing(
    project_id: int,
    payload: LandingUpsert,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _project_owned(session, project_id, user)
    _ensure_schema(session)
    existing = session.exec(text(
        "SELECT id, slug FROM landing_pages WHERE project_id = :pid"
    ), params={"pid": project_id}).mappings().first()
    params = {
        "pid": project_id,
        "name": payload.name,
        "tagline": payload.tagline,
        "headline": payload.headline,
        "subheadline": payload.subheadline,
        "cta": payload.cta_text or "Join the waitlist",
        "logo_url": payload.logo_url,
        "logo_svg": _sanitize_svg(payload.logo_svg),
        "color": payload.theme_color or "#7c3aed",
    }
    if existing:
        session.exec(text(
            "UPDATE landing_pages SET name=:name, tagline=:tagline, headline=:headline, "
            "subheadline=:subheadline, cta_text=:cta, logo_url=:logo_url, logo_svg=:logo_svg, "
            "theme_color=:color, updated_at=CURRENT_TIMESTAMP WHERE project_id=:pid"
        ), params=params)
        slug = existing["slug"]
    else:
        slug = _slugify(payload.name)
        params["slug"] = slug
        session.exec(text(
            "INSERT INTO landing_pages (project_id, slug, name, tagline, headline, subheadline, "
            "cta_text, logo_url, logo_svg, theme_color) VALUES (:pid, :slug, :name, :tagline, "
            ":headline, :subheadline, :cta, :logo_url, :logo_svg, :color)"
        ), params=params)
    session.commit()
    row = session.exec(text(
        "SELECT * FROM landing_pages WHERE project_id = :pid"
    ), params={"pid": project_id}).mappings().first()
    return _row_to_landing(row)


@router.post("/landing/by-project/{project_id}/publish")
def publish(
    project_id: int,
    body: Dict[str, Any] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _project_owned(session, project_id, user)
    _ensure_schema(session)
    flag = bool((body or {}).get("published", True))
    session.exec(text(
        "UPDATE landing_pages SET published=:p, updated_at=CURRENT_TIMESTAMP WHERE project_id=:pid"
    ), params={"pid": project_id, "p": flag})
    session.commit()
    return {"ok": True, "published": flag}


@router.get("/landing/{slug}")
def public_landing(slug: str, session: Session = Depends(get_session)):
    """Public read — returns landing JSON for an SSR-style mirror.
    Only published pages are visible; unpublished returns 404 so the
    URL doesn't leak draft pages."""
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT * FROM landing_pages WHERE slug = :slug AND published = TRUE"
    ), params={"slug": slug}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return _row_to_landing(row)


@router.post("/landing/{slug}/waitlist")
def waitlist(slug: str, payload: WaitlistPayload, request: Request, session: Session = Depends(get_session)):
    email = (payload.email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="invalid email")
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT id, project_id FROM landing_pages WHERE slug = :slug AND published = TRUE"
    ), params={"slug": slug}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="landing page not found")
    # Hash IP so we can de-dupe without storing PII.
    ip = (request.client.host if request.client else "") or ""
    ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:32] if ip else None
    session.exec(text(
        "INSERT INTO waitlist_signups (project_id, landing_page_id, email, name, source, ip_hash) "
        "VALUES (:pid, :lid, :email, :name, :source, :iph)"
    ), params={
        "pid": row["project_id"], "lid": row["id"],
        "email": email, "name": payload.name,
        "source": payload.source or "landing", "iph": ip_hash,
    })
    session.commit()
    return {"ok": True}


@router.post("/landing/{slug}/view")
def view_ping(slug: str, session: Session = Depends(get_session)):
    _ensure_schema(session)
    session.exec(text(
        "UPDATE landing_pages SET views_count = COALESCE(views_count,0)+1 WHERE slug=:slug AND published=TRUE"
    ), params={"slug": slug})
    session.commit()
    return {"ok": True}


@router.get("/landing/by-project/{project_id}/waitlist")
def list_waitlist(project_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _project_owned(session, project_id, user)
    _ensure_schema(session)
    rows = session.exec(text(
        "SELECT id, email, name, source, created_at FROM waitlist_signups "
        "WHERE project_id = :pid ORDER BY created_at DESC LIMIT 500"
    ), params={"pid": project_id}).mappings().all()
    return {
        "signups": [
            {"id": r["id"], "email": r["email"], "name": r["name"], "source": r["source"],
             "created_at": (r["created_at"].isoformat() if isinstance(r["created_at"], datetime) else str(r["created_at"]))}
            for r in rows
        ],
        "count": len(rows),
    }

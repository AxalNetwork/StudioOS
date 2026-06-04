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

import base64
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
            logo_asset_id TEXT,
            theme_color TEXT DEFAULT '#7c3aed',
            palette_bg TEXT,
            palette_ink TEXT,
            palette_secondary TEXT,
            palette_accent TEXT,
            font_pairing TEXT,
            published BOOLEAN DEFAULT FALSE,
            views_count INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """,
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS logo_asset_id TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS palette_bg TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS palette_ink TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS palette_secondary TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS palette_accent TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS font_pairing TEXT",
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


# --- heuristic helpers (Task #3 Brand Kit Expansion) ---

_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

_PALETTES = [
    {"primary": "#7c3aed", "background": "#faf7ff", "ink": "#1b1430", "secondary": "#c4b5fd", "accent": "#f59e0b"},
    {"primary": "#2563eb", "background": "#eff6ff", "ink": "#0f172a", "secondary": "#93c5fd", "accent": "#10b981"},
    {"primary": "#dc2626", "background": "#fef2f2", "ink": "#1a0a0a", "secondary": "#fca5a5", "accent": "#f59e0b"},
    {"primary": "#059669", "background": "#ecfdf5", "ink": "#0a1f15", "secondary": "#6ee7b7", "accent": "#3b82f6"},
    {"primary": "#0891b2", "background": "#ecfeff", "ink": "#0a1a1f", "secondary": "#67e8f9", "accent": "#f43f5e"},
    {"primary": "#4f46e5", "background": "#eef2ff", "ink": "#0f0a1a", "secondary": "#a5b4fc", "accent": "#f59e0b"},
    {"primary": "#7c3aed", "background": "#f5f3ff", "ink": "#1a1025", "secondary": "#d8b4fe", "accent": "#10b981"},
    {"primary": "#be185d", "background": "#fdf2f8", "ink": "#1a0a12", "secondary": "#fbcfe8", "accent": "#6366f1"},
    {"primary": "#ea580c", "background": "#fff7ed", "ink": "#1a0f05", "secondary": "#fdba74", "accent": "#10b981"},
    {"primary": "#4338ca", "background": "#e0e7ff", "ink": "#0a0a1f", "secondary": "#818cf8", "accent": "#f59e0b"},
    {"primary": "#065f46", "background": "#ecfdf5", "ink": "#0a1a14", "secondary": "#6ee7b7", "accent": "#f59e0b"},
    {"primary": "#b91c1c", "background": "#fef2f2", "ink": "#1a0a0a", "secondary": "#fca5a5", "accent": "#3b82f6"},
]


def _luminance(hex: str) -> float:
    v = hex.lstrip("#")
    rgb = [int(v[i:i+2], 16) for i in (0, 2, 4)] if len(v) == 6 else [int(v[i]+v[i], 16) for i in range(3)]
    a = []
    for c in rgb:
        c /= 255.0
        a.append(c / 12.92 if c <= 0.03928 else pow((c + 0.055) / 1.055, 2.4))
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]


def _contrast_ratio(a: str, b: str) -> float:
    l1 = _luminance(a) + 0.05
    l2 = _luminance(b) + 0.05
    return max(l1, l2) / min(l1, l2)


def _heuristic_palette(description: str, seed_color: Optional[str] = None) -> Dict[str, str]:
    h = 0
    for ch in (description or "x"):
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    base = _PALETTES[h % len(_PALETTES)].copy()
    if seed_color and _HEX_RE.match(seed_color):
        base["primary"] = seed_color.lower()
    return base


def _heuristic_taglines(
    name: str, description: str, audience: str, tone: str, market_angle: str
) -> List[str]:
    a = (audience or "founders").strip()
    t = (tone or "bold").strip().lower()
    m = (market_angle or "innovation").strip()
    templates: Dict[str, List[str]] = {
        "bold": [
            f"{name}: the {m} platform {a} have been waiting for.",
            f"Built for {a} who refuse to settle. {name} is here.",
            f"{name} — where {m} meets execution.",
            f"The fastest way for {a} to win. Period.",
            f"Stop guessing. Start scaling with {name}.",
            f"{name} turns {a} into {m} leaders.",
        ],
        "warm": [
            f"{name}: made with care for {a} who dream big.",
            f"A gentle {m} toolkit for {a} ready to grow.",
            f"{name} helps {a} build something meaningful.",
            f"For {a} who believe {m} should feel human.",
            f"{name} — your partner from first idea to launch.",
            f"Every {a} deserves a tool like {name}.",
        ],
        "technical": [
            f"{name}: {m} infrastructure for {a} at scale.",
            f"Engineered for {a} who demand {m} performance.",
            f"{name} — the {m} stack {a} actually want to use.",
            f"Composable {m} primitives for modern {a}.",
            f"API-first {m} tools for {a} who ship daily.",
            f"{name} reduces {a} operational complexity by design.",
        ],
        "playful": [
            f"{name}: {m} magic for {a} who like to play.",
            f"The {m} sidekick every {a} deserves.",
            f"{name} makes {m} feel like a game — and you win.",
            f"For {a} who think {m} should be fun.",
            f"{name}: serious {m}, zero boredom.",
            f"Unleash your {a} superpowers with {name}.",
        ],
        "authoritative": [
            f"{name}: the {m} standard for {a}.",
            f"Trusted by {a} who set the {m} agenda.",
            f"{name} — {m} proven at scale.",
            f"The {a} platform {m} teams rely on.",
            f"{name} delivers {m} outcomes, not promises.",
            f"The benchmark for {m} among {a}.",
        ],
    }
    bank = templates.get(t) or templates["bold"]
    return bank[:6]


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
        "logo_asset_id": row.get("logo_asset_id") or None,
        "theme_color": row["theme_color"] or "#7c3aed",
        "palette_bg": row.get("palette_bg") or None,
        "palette_ink": row.get("palette_ink") or None,
        "palette_secondary": row.get("palette_secondary") or None,
        "palette_accent": row.get("palette_accent") or None,
        "font_pairing": row.get("font_pairing") or None,
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
    palette_bg: Optional[str] = None
    palette_ink: Optional[str] = None
    palette_secondary: Optional[str] = None
    palette_accent: Optional[str] = None
    font_pairing: Optional[str] = None
    logo_asset_id: Optional[str] = None


class PalettePayload(BaseModel):
    description: str = Field(..., min_length=4, max_length=2000)
    sector: Optional[str] = None
    seed_color: Optional[str] = None


class TaglinePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = None
    audience: str = Field(..., min_length=1)
    tone: str = Field(..., min_length=1)
    market_angle: str = Field(..., min_length=1)


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
        "logo_asset_id": payload.logo_asset_id or None,
        "color": payload.theme_color or "#7c3aed",
        "palette_bg": payload.palette_bg or None,
        "palette_ink": payload.palette_ink or None,
        "palette_secondary": payload.palette_secondary or None,
        "palette_accent": payload.palette_accent or None,
        "font_pairing": payload.font_pairing or None,
    }
    if existing:
        session.exec(text(
            "UPDATE landing_pages SET name=:name, tagline=:tagline, headline=:headline, "
            "subheadline=:subheadline, cta_text=:cta, logo_url=:logo_url, logo_svg=:logo_svg, "
            "logo_asset_id=:logo_asset_id, theme_color=:color, palette_bg=:palette_bg, "
            "palette_ink=:palette_ink, palette_secondary=:palette_secondary, "
            "palette_accent=:palette_accent, font_pairing=:font_pairing, "
            "updated_at=CURRENT_TIMESTAMP WHERE project_id=:pid"
        ), params=params)
        slug = existing["slug"]
    else:
        slug = _slugify(payload.name)
        params["slug"] = slug
        session.exec(text(
            "INSERT INTO landing_pages (project_id, slug, name, tagline, headline, subheadline, "
            "cta_text, logo_url, logo_svg, logo_asset_id, theme_color, palette_bg, palette_ink, "
            "palette_secondary, palette_accent, font_pairing) "
            "VALUES (:pid, :slug, :name, :tagline, :headline, :subheadline, :cta, :logo_url, "
            ":logo_svg, :logo_asset_id, :color, :palette_bg, :palette_ink, "
            ":palette_secondary, :palette_accent, :font_pairing)"
        ), params=params)
    session.commit()
    row = session.exec(text(
        "SELECT * FROM landing_pages WHERE project_id = :pid"
    ), params={"pid": project_id}).mappings().first()
    return _row_to_landing(row)


from fastapi import UploadFile

@router.post("/logo/upload")
async def logo_upload(
    file: UploadFile = None,
    user: User = Depends(get_current_user),
):
    # Dev backend has no R2 binding — inline small images only.
    # Prod (Worker) routes this to R2 with the FILES binding.
    if not file:
        raise HTTPException(status_code=400, detail="file required (multipart field 'file')")
    mime = (file.content_type or "").strip()
    if mime not in {"image/png", "image/jpeg", "image/svg+xml"}:
        raise HTTPException(status_code=400, detail="invalid mime type")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty data")
    if len(raw) > 512 * 1024:
        raise HTTPException(status_code=400, detail="file too large")
    if mime == "image/svg+xml":
        svg = _sanitize_svg(raw.decode("utf-8", "replace"))
        if not svg:
            raise HTTPException(status_code=400, detail="svg failed sanitization")
        raw = svg.encode("utf-8")
    if len(raw) > 200 * 1024:
        raise HTTPException(status_code=400, detail="file too large for inline")
    b64 = base64.b64encode(raw).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    return {"asset_id": data_url, "url": data_url, "mime": mime, "size": len(raw), "source": "inline"}


@router.post("/palette/suggest")
def palette_suggest(payload: PalettePayload, user: User = Depends(get_current_user)):
    # Dev backend has no Workers AI binding — serve deterministic heuristic.
    palette = _heuristic_palette(payload.description, payload.seed_color)
    warnings = []
    if _contrast_ratio(palette["ink"], palette["background"]) < 4.5:
        warnings.append("text-on-background contrast below WCAG AA (4.5:1).")
    if _contrast_ratio(palette["ink"], palette["primary"]) < 3.0:
        warnings.append("text-on-primary contrast below WCAG AA for large text (3:1).")
    if _contrast_ratio(palette["primary"], palette["background"]) < 3.0:
        warnings.append("primary\u2194background contrast below WCAG AA for large text (3:1).")
    return {"palette": palette, "warnings": warnings, "ai_generated": False}


@router.post("/tagline/suggest")
def tagline_suggest(payload: TaglinePayload, user: User = Depends(get_current_user)):
    # Dev backend has no Workers AI binding — serve deterministic heuristic.
    taglines = _heuristic_taglines(
        payload.name,
        payload.description or "",
        payload.audience,
        payload.tone,
        payload.market_angle,
    )
    return {"taglines": taglines[:6], "ai_generated": False}


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

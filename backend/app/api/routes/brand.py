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
    # Task #4 — audience segmentation + preview token (additive, IF NOT EXISTS)
    for s in [
        "ALTER TABLE waitlist_signups ADD COLUMN IF NOT EXISTS audience TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS preview_token TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_customer_headline TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_customer_body TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_customer_cta TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_partner_headline TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_partner_body TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_partner_cta TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_investor_headline TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_investor_body TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS audience_investor_cta TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS template TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS hero_media_url TEXT",
        "ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS product_screenshot_url TEXT",
        "CREATE INDEX IF NOT EXISTS idx_landing_preview_token ON landing_pages(preview_token)",
        "CREATE INDEX IF NOT EXISTS idx_waitlist_audience ON waitlist_signups(project_id, audience)",
    ]:
        try:
            session.exec(text(s))
            session.commit()
        except Exception:
            session.rollback()
    _migrated = True


# --- helpers ---------------------------------------------------------------

_SLUG_RE = re.compile(r"[^a-z0-9-]+")


def _sanitize_url(url: Optional[str]) -> Optional[str]:
    """Allow only same-origin paths or https:// for externally-hosted images.
    Reject javascript:, data:text/html, and any other non-https scheme.
    """
    if not url:
        return None
    u = str(url).strip()
    if u.startswith("/"):
        return u
    try:
        parsed = urlparse(u)
        if parsed.scheme == "https":
            return u
    except Exception:
        pass
    return None


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
        "preview_token": row.get("preview_token") or None,
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
        "audience_customer_headline": row.get("audience_customer_headline") or None,
        "audience_customer_body": row.get("audience_customer_body") or None,
        "audience_customer_cta": row.get("audience_customer_cta") or None,
        "audience_partner_headline": row.get("audience_partner_headline") or None,
        "audience_partner_body": row.get("audience_partner_body") or None,
        "audience_partner_cta": row.get("audience_partner_cta") or None,
        "audience_investor_headline": row.get("audience_investor_headline") or None,
        "audience_investor_body": row.get("audience_investor_body") or None,
        "audience_investor_cta": row.get("audience_investor_cta") or None,
        "template": row.get("template") or "minimal",
        "hero_media_url": row.get("hero_media_url") or None,
        "product_screenshot_url": row.get("product_screenshot_url") or None,
        "logo_url": row.get("logo_url") or None,
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
    audience_customer_headline: Optional[str] = None
    audience_customer_body: Optional[str] = None
    audience_customer_cta: Optional[str] = None
    audience_partner_headline: Optional[str] = None
    audience_partner_body: Optional[str] = None
    audience_partner_cta: Optional[str] = None
    audience_investor_headline: Optional[str] = None
    audience_investor_body: Optional[str] = None
    audience_investor_cta: Optional[str] = None
    template: Optional[str] = None
    hero_media_url: Optional[str] = None
    product_screenshot_url: Optional[str] = None


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
    audience: Optional[str] = Field(default=None, max_length=20)


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
    # Loop to fixed point so a single pass can't leave a fresh forbidden
    # token (e.g. <scr<script>ipt> -> <script> after one pass).
    prev = None
    while prev != s:
        prev = s
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


def _render_landing_html(row, noindex: bool = False, csp_nonce: Optional[str] = None) -> str:
    """Render a public landing page HTML string (dev-backend parity).

    Mirrors the worker's buildLandingPageHtml with the same audience-tab
    layout, accessibility markup, and XSS-safe escaping.
    """
    import html

    def esc(s: Optional[str]) -> str:
        return html.escape(s or "")

    def _hex(v: Optional[str]) -> str:
        return v if v and re.match(r"^#[0-9a-fA-F]{6}$", v) else "#7c3aed"

    def _hex_bg(v: Optional[str]) -> str:
        return v if v and re.match(r"^#[0-9a-fA-F]{6}$", v) else "#fafafa"

    def _hex_ink(v: Optional[str]) -> str:
        return v if v and re.match(r"^#[0-9a-fA-F]{6}$", v) else "#0f172a"

    name = esc(row["name"])
    color = _hex(row["theme_color"])
    bg_color = _hex_bg(row["palette_bg"])
    ink_color = _hex_ink(row["palette_ink"])
    logo_markup = ""
    if row["logo_url"]:
        logo_markup = (
            f'<img src="{esc(row["logo_url"])}" alt="{name}" '
            f'style="width:96px;height:96px;border-radius:24px;object-fit:cover" />'
        )
    else:
        svg = _sanitize_svg(row.get("logo_svg"))
        if svg:
            logo_markup = svg
        else:
            initial = esc(row["name"][:1].upper() or "A")
            logo_markup = (
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">'
                f'<circle cx="50" cy="50" r="46" fill="{color}"/>'
                f'<text x="50" y="62" text-anchor="middle" font-family="Inter,system-ui,sans-serif" '
                f'font-size="44" font-weight="700" fill="#fff">{initial}</text></svg>'
            )

    aud = {
        "customer": {
            "h": esc(row["audience_customer_headline"] or row["headline"] or row["tagline"] or row["name"]),
            "b": esc(row["audience_customer_body"] or row["subheadline"] or row["tagline"] or ""),
            "c": esc(row["audience_customer_cta"] or row["cta_text"] or "Join the waitlist"),
        },
        "partner": {
            "h": esc(row["audience_partner_headline"] or row["headline"] or row["tagline"] or row["name"]),
            "b": esc(row["audience_partner_body"] or row["subheadline"] or row["tagline"] or ""),
            "c": esc(row["audience_partner_cta"] or row["cta_text"] or "Join the waitlist"),
        },
        "investor": {
            "h": esc(row["audience_investor_headline"] or row["headline"] or row["tagline"] or row["name"]),
            "b": esc(row["audience_investor_body"] or row["subheadline"] or row["tagline"] or ""),
            "c": esc(row["audience_investor_cta"] or row["cta_text"] or "Join the waitlist"),
        },
    }

    slug = esc(row["slug"])
    api_waitlist = f"/api/brand/landing/{slug}/waitlist"
    noindex_meta = '<meta name="robots" content="noindex, nofollow" />' if noindex else ""
    title_suffix = " (Preview)" if noindex else ""
    tab_badge = '<span class="badge badge-customer">Discovery</span>'

    html_str = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{name}{title_suffix}</title>
<meta name="description" content="{aud['customer']['b']}" />
{noindex_meta}
<style>
  :root {{ color-scheme: light; }}
  body {{ margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif; background: {bg_color}; color: {ink_color}; }}
  .wrap {{ max-width: 760px; margin: 0 auto; padding: 64px 24px 96px; text-align: center; }}
  .logo {{ display:flex; justify-content:center; margin-bottom: 28px; }}
  h1 {{ font-size: clamp(32px, 5vw, 52px); margin: 0 0 12px; line-height: 1.1; letter-spacing: -0.02em; }}
  p.sub {{ font-size: 18px; color: {ink_color}; opacity: .7; margin: 0 0 36px; }}
  .tabs {{ display:flex; gap: 6px; justify-content:center; margin-bottom: 28px; }}
  .tab {{ cursor:pointer; padding: 8px 16px; border-radius: 8px; border: 1px solid transparent; font-size: 14px; background: transparent; color: {ink_color}; opacity: .6; }}
  .tab.active {{ opacity: 1; background: {color}18; border-color: {color}44; }}
  .panel {{ display:none; }}
  .panel.active {{ display:block; }}
  form {{ display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }}
  input {{ flex:1 1 240px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 15px; outline:none; }}
  input:focus {{ border-color: {color}; box-shadow: 0 0 0 3px {color}22; }}
  button {{ padding: 12px 18px; background: {color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }}
  button[disabled] {{ opacity: .6; cursor: not-allowed; }}
  .ok, .err {{ margin-top: 16px; font-size: 14px; }}
  .ok {{ color: #059669; }}
  .err {{ color: #dc2626; }}
  .badge {{ display:inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-left: 8px; }}
  .badge-customer {{ background: {color}18; color: {color}; }}
  .badge-partner {{ background: #6366f118; color: #6366f1; }}
  .badge-investor {{ background: #10b98118; color: #10b981; }}
  footer {{ margin-top: 64px; font-size: 12px; color: #94a3b8; }}
  footer a {{ color: inherit; }}
  .sr {{ position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }}
  @media (max-width: 480px) {{ .tabs {{ flex-wrap: wrap; }} }}
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">{logo_markup}</div>
    <div class="tabs" role="tablist" aria-label="Audience">
      <button class="tab active" role="tab" aria-selected="true" aria-controls="p-customer" data-a="customer" onclick="switchTab('customer')">Customer{tab_badge}</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-partner" data-a="partner" onclick="switchTab('partner')">Partner</button>
      <button class="tab" role="tab" aria-selected="false" aria-controls="p-investor" data-a="investor" onclick="switchTab('investor')">Investor</button>
    </div>
    <div class="panel active" id="p-customer" role="tabpanel" data-a="customer">
      <h1>{aud['customer']['h']}</h1>
      {f'<p class="sub">{aud["customer"]["b"]}</p>' if aud['customer']['b'] else ''}
      <form id="wl-customer">
        <label for="email-customer" class="sr">Email</label>
        <input id="email-customer" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">{aud['customer']['c']}</button>
      </form>
      <div id="msg-customer" aria-live="polite"></div>
    </div>
    <div class="panel" id="p-partner" role="tabpanel" data-a="partner">
      <h1>{aud['partner']['h']}</h1>
      {f'<p class="sub">{aud["partner"]["b"]}</p>' if aud['partner']['b'] else ''}
      <form id="wl-partner">
        <label for="email-partner" class="sr">Email</label>
        <input id="email-partner" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">{aud['partner']['c']}</button>
      </form>
      <div id="msg-partner" aria-live="polite"></div>
    </div>
    <div class="panel" id="p-investor" role="tabpanel" data-a="investor">
      <h1>{aud['investor']['h']}</h1>
      {f'<p class="sub">{aud["investor"]["b"]}</p>' if aud['investor']['b'] else ''}
      <form id="wl-investor">
        <label for="email-investor" class="sr">Email</label>
        <input id="email-investor" type="email" name="email" placeholder="you@email.com" required />
        <button type="submit">{aud['investor']['c']}</button>
      </form>
      <div id="msg-investor" aria-live="polite"></div>
    </div>
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
<script{csp_nonce and f' nonce="{html.escape(csp_nonce)}"' or ''}>
function switchTab(aud){{
  document.querySelectorAll('.tab').forEach(function(t){{
    var on = t.dataset.a===aud;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  }});
  document.querySelectorAll('.panel').forEach(function(p){{ p.classList.toggle('active', p.dataset.a===aud); }});
}}
(function(){{
  var api="{api_waitlist}";
  if(!api) return;
  ['customer','partner','investor'].forEach(function(aud){{
    var f=document.getElementById('wl-'+aud), m=document.getElementById('msg-'+aud);
    f.addEventListener('submit',function(e){{
      e.preventDefault();
      var email=f.email.value.trim(); if(!email) return;
      var btn=f.querySelector('button'); btn.disabled=true;
      fetch(api,{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{email:email,source:'landing',audience:aud}})}})
        .then(function(r){{return r.json().then(function(j){{return {{ok:r.ok,j:j}}}})}})
        .then(function(x){{
          if(x.ok){{ m.className='ok'; m.textContent="You're on the list. We'll be in touch."; f.reset(); }}
          else {{ m.className='err'; m.textContent=(x.j&&x.j.error)||'Something went wrong.'; }}
        }})
        .catch(function(){{ m.className='err'; m.textContent='Network error. Please try again.'; }})
        .finally(function(){{ btn.disabled=false; }});
    }});
  }});
}})();
</script>
</body>
</html>"""
    return html_str


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
        "SELECT id, slug, preview_token FROM landing_pages WHERE project_id = :pid"
    ), params={"pid": project_id}).mappings().first()
    params = {
        "pid": project_id,
        "name": payload.name,
        "tagline": payload.tagline,
        "headline": payload.headline,
        "subheadline": payload.subheadline,
        "cta": payload.cta_text or "Join the waitlist",
        "logo_url": _sanitize_url(payload.logo_url),
        "logo_svg": _sanitize_svg(payload.logo_svg),
        "logo_asset_id": payload.logo_asset_id or None,
        "color": payload.theme_color or "#7c3aed",
        "palette_bg": payload.palette_bg or None,
        "palette_ink": payload.palette_ink or None,
        "palette_secondary": payload.palette_secondary or None,
        "palette_accent": payload.palette_accent or None,
        "font_pairing": payload.font_pairing or None,
        "ac_h": payload.audience_customer_headline or None,
        "ac_b": payload.audience_customer_body or None,
        "ac_c": payload.audience_customer_cta or None,
        "ap_h": payload.audience_partner_headline or None,
        "ap_b": payload.audience_partner_body or None,
        "ap_c": payload.audience_partner_cta or None,
        "ai_h": payload.audience_investor_headline or None,
        "ai_b": payload.audience_investor_body or None,
        "ai_c": payload.audience_investor_cta or None,
    }
    if existing:
        preview_token = existing.get("preview_token") or secrets.token_hex(16)
        params["preview_token"] = preview_token
        params["template"] = payload.template or "minimal"
        params["hero_media_url"] = _sanitize_url(payload.hero_media_url)
        params["product_screenshot_url"] = _sanitize_url(payload.product_screenshot_url)
        session.exec(text(
            "UPDATE landing_pages SET name=:name, tagline=:tagline, headline=:headline, "
            "subheadline=:subheadline, cta_text=:cta, logo_url=:logo_url, logo_svg=:logo_svg, "
            "logo_asset_id=:logo_asset_id, theme_color=:color, palette_bg=:palette_bg, "
            "palette_ink=:palette_ink, palette_secondary=:palette_secondary, "
            "palette_accent=:palette_accent, font_pairing=:font_pairing, "
            "audience_customer_headline=:ac_h, audience_customer_body=:ac_b, audience_customer_cta=:ac_c, "
            "audience_partner_headline=:ap_h, audience_partner_body=:ap_b, audience_partner_cta=:ap_c, "
            "audience_investor_headline=:ai_h, audience_investor_body=:ai_b, audience_investor_cta=:ai_c, "
            "template=:template, hero_media_url=:hero_media_url, product_screenshot_url=:product_screenshot_url, "
            "preview_token=:preview_token, updated_at=CURRENT_TIMESTAMP WHERE project_id=:pid"
        ), params=params)
        slug = existing["slug"]
    else:
        slug = _slugify(payload.name)
        preview_token = secrets.token_hex(16)
        params["slug"] = slug
        params["preview_token"] = preview_token
        params["template"] = payload.template or "minimal"
        params["hero_media_url"] = _sanitize_url(payload.hero_media_url)
        params["product_screenshot_url"] = _sanitize_url(payload.product_screenshot_url)
        session.exec(text(
            "INSERT INTO landing_pages (project_id, slug, preview_token, name, tagline, headline, subheadline, "
            "cta_text, logo_url, logo_svg, logo_asset_id, theme_color, palette_bg, palette_ink, "
            "palette_secondary, palette_accent, font_pairing, "
            "audience_customer_headline, audience_customer_body, audience_customer_cta, "
            "audience_partner_headline, audience_partner_body, audience_partner_cta, "
            "audience_investor_headline, audience_investor_body, audience_investor_cta, "
            "template, hero_media_url, product_screenshot_url) "
            "VALUES (:pid, :slug, :preview_token, :name, :tagline, :headline, :subheadline, :cta, :logo_url, "
            ":logo_svg, :logo_asset_id, :color, :palette_bg, :palette_ink, "
            ":palette_secondary, :palette_accent, :font_pairing, "
            ":ac_h, :ac_b, :ac_c, :ap_h, :ap_b, :ap_c, :ai_h, :ai_b, :ai_c, "
            ":template, :hero_media_url, :product_screenshot_url)"
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


def _template_list():
    return {
        "templates": [
            {"key": "minimal", "label": "Minimal", "description": "Clean, centered layout with the essentials.", "thumbnailPlaceholder": "minimal", "usesHero": False, "usesProduct": False},
            {"key": "bold-hero", "label": "Bold Hero", "description": "A striking, high-contrast headline with full-width background.", "thumbnailPlaceholder": "bold-hero", "usesHero": True, "usesProduct": False},
            {"key": "video-first", "label": "Video First", "description": "Hero media dominates above the fold.", "thumbnailPlaceholder": "video-first", "usesHero": True, "usesProduct": False},
            {"key": "editorial", "label": "Editorial", "description": "Long-form, narrative style with typographic hierarchy.", "thumbnailPlaceholder": "editorial", "usesHero": False, "usesProduct": False},
            {"key": "product-mock", "label": "Product Mock", "description": "Show your product front and centre with a screenshot.", "thumbnailPlaceholder": "product-mock", "usesHero": False, "usesProduct": True},
        ]
    }


@router.get("/templates")
def list_templates():
    return _template_list()


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


def _valid_audience(v: Optional[str]) -> Optional[str]:
    if v in {"customer", "partner", "investor"}:
        return v
    return None


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
    audience = _valid_audience(payload.audience)
    session.exec(text(
        "INSERT INTO waitlist_signups (project_id, landing_page_id, email, name, source, audience, ip_hash) "
        "VALUES (:pid, :lid, :email, :name, :source, :audience, :iph)"
    ), params={
        "pid": row["project_id"], "lid": row["id"],
        "email": email, "name": payload.name,
        "source": payload.source or "landing", "audience": audience, "iph": ip_hash,
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
def list_waitlist(
    project_id: int,
    audience: Optional[str] = None,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    _project_owned(session, project_id, user)
    _ensure_schema(session)
    aud = _valid_audience(audience)
    if aud:
        rows = session.exec(text(
            "SELECT id, email, name, source, audience, created_at FROM waitlist_signups "
            "WHERE project_id = :pid AND audience = :audience ORDER BY created_at DESC LIMIT 500"
        ), params={"pid": project_id, "audience": aud}).mappings().all()
    else:
        rows = session.exec(text(
            "SELECT id, email, name, source, audience, created_at FROM waitlist_signups "
            "WHERE project_id = :pid ORDER BY created_at DESC LIMIT 500"
        ), params={"pid": project_id}).mappings().all()
    return {
        "signups": [
            {"id": r["id"], "email": r["email"], "name": r["name"], "source": r["source"],
             "audience": r.get("audience") or None,
             "created_at": (r["created_at"].isoformat() if isinstance(r["created_at"], datetime) else str(r["created_at"]))}
            for r in rows
        ],
        "count": len(rows),
    }


@router.get("/landing/by-project/{project_id}/preview-url")
def preview_url(project_id: int, user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    _project_owned(session, project_id, user)
    _ensure_schema(session)
    row = session.exec(text(
        "SELECT preview_token FROM landing_pages WHERE project_id = :pid"
    ), params={"pid": project_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="no preview token")
    token = row.get("preview_token")
    if not token:
        token = secrets.token_hex(16)
        session.exec(text(
            "UPDATE landing_pages SET preview_token = :token WHERE project_id = :pid"
        ), params={"token": token, "pid": project_id})
        session.commit()
    return {"url": f"/landing/preview/{token}"}

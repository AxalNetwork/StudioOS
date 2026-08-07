/**
 * Task #24 — Brand & landing page generator (Worker).
 *
 * Mirrors backend/app/api/routes/brand.py and additionally serves the
 * public landing HTML at /landing/:slug. The HTML route is registered
 * separately at the index.ts root, not inside this Hono router, so it
 * lives outside /api/*.
 *
 *   POST /api/brand/landing/autofill                AI page content auto-fill
 *   POST /api/brand/logo                            Workers AI or SVG fallback
 *   GET  /api/brand/landing/by-project/:pid         owner read
 *   PUT  /api/brand/landing/by-project/:pid         owner upsert
 *   POST /api/brand/landing/by-project/:pid/publish toggle published
 *   GET  /api/brand/landing/by-project/:pid/waitlist  owner list
 *   GET  /api/brand/landing/:slug                   public JSON
 *   POST /api/brand/landing/:slug/waitlist          public signup
 *   POST /api/brand/landing/:slug/view              public analytics ping
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { ensureLandingPageBrandKitColumns } from '../services/landingPageSchema';
import { renderLandingTemplate, TEMPLATE_REGISTRY, TEMPLATE_KEYS, TEMPLATE_SIGNATURE_PALETTES, sanitizeLandingContent, LANDING_CONTENT_SCHEMA, HONEYPOT_FIELD } from '../services/landingTemplates';
import type { TemplateKey } from '../services/landingTemplates';
import { requireAuth } from '../auth';
import { run as aiRouterRun } from '../services/aiRouter';
import { ingestContact } from './contacts';

const brand = new Hono<{ Bindings: Env }>();

let _migrated = false;
async function ensureSchema(env: Env): Promise<void> {
  if (_migrated) return;
  const stmts = [
    // Multi-page sites: project_id is deliberately NOT unique (one project can
    // own many pages); (project_id, page_slug) uniqueness is enforced by
    // idx_landing_project_page below. Pre-existing prod tables are rebuilt by
    // migration 144 — this CREATE only covers fresh DBs.
    `CREATE TABLE IF NOT EXISTS landing_pages (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id INTEGER NOT NULL,
       slug TEXT NOT NULL UNIQUE,
       page_slug TEXT NOT NULL DEFAULT 'home',
       name TEXT NOT NULL,
       tagline TEXT,
       headline TEXT,
       subheadline TEXT,
       cta_text TEXT DEFAULT 'Join the waitlist',
       logo_url TEXT,
       logo_svg TEXT,
       theme_color TEXT DEFAULT '#7c3aed',
       palette_bg TEXT,
       palette_ink TEXT,
       font_pairing TEXT,
       published INTEGER DEFAULT 0,
       views_count INTEGER DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')),
       updated_at TEXT DEFAULT (datetime('now'))
     )`,
    // Editable, human-readable startup slug — one per project, globally unique.
    `CREATE TABLE IF NOT EXISTS brand_sites (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id INTEGER NOT NULL UNIQUE,
       slug TEXT NOT NULL UNIQUE,
       created_at TEXT DEFAULT (datetime('now')),
       updated_at TEXT DEFAULT (datetime('now'))
     )`,
    // Founder-saved reusable page designs (design fields + copy seeds).
    `CREATE TABLE IF NOT EXISTS brand_custom_templates (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL,
       name TEXT NOT NULL,
       snapshot_json TEXT NOT NULL,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_brand_custom_templates_user ON brand_custom_templates(user_id)`,
    `CREATE TABLE IF NOT EXISTS waitlist_signups (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id INTEGER NOT NULL,
       landing_page_id INTEGER,
       email TEXT NOT NULL,
       name TEXT,
       source TEXT,
       ip_hash TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_waitlist_project ON waitlist_signups(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist_signups(email)`,
    `CREATE INDEX IF NOT EXISTS idx_landing_slug ON landing_pages(slug)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_project_page ON landing_pages(project_id, page_slug)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch (e: any) { console.error('brand schema:', e?.message); }
  }
  // Brand-kit columns on pre-existing tables (CREATE above only covers fresh DBs).
  await ensureLandingPageBrandKitColumns(env);
  _migrated = true;
}

function slugify(name: string): string {
  const base = (name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'page';
  const tail = Math.random().toString(36).slice(2, 8);
  return `${base}-${tail}`;
}

// Stored-XSS guard for the user-supplied logo_svg. We render it with
// dangerouslySetInnerHTML on the public landing page, so strip script
// tags, on*= event handlers, and javascript: hrefs before saving.
// Exported so the sanitizer contract is locked by brand_svg_sanitize.test.ts.
export function sanitizeSvg(svg: string | null | undefined): string | null {
  if (!svg) return null;
  let s = String(svg).trim();
  if (!s.toLowerCase().startsWith('<svg')) return null;
  // CodeQL js/incomplete-multi-character-sanitization: a single replace pass
  // can leave a fresh forbidden token in the result (e.g. `<scr<script>ipt>`
  // → `<script>` after one pass). Loop to a fixed point.
  const STRIP_TAG_PAIR = /<\s*(script|foreignObject|iframe|object|embed|link|meta|style|use|image)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
  const STRIP_TAG_OPEN = /<\s*(script|foreignObject|iframe|object|embed|link|meta|style|use|image)\b[^>]*\/?>/gi;
  const STRIP_ON_ATTR  = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
  // Strip ALL href/xlink:href (quoted or unquoted, any scheme) — the
  // generated/uploaded logo SVGs have no need for hrefs and stripping
  // them blanket-blocks javascript:/data:text/html bypasses.
  const STRIP_HREF     = /\s+(href|xlink:href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(STRIP_TAG_PAIR, '')
         .replace(STRIP_TAG_OPEN, '')
         .replace(STRIP_ON_ATTR, '')
         .replace(STRIP_HREF, '');
  }
  // Belt-and-suspenders: drop the whole SVG if obfuscated payloads remain.
  const lower = s.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('<script') || lower.includes('onload') || lower.includes('onerror')) {
    return null;
  }
  return s.slice(0, 8000);
}

// Allow only same-origin paths (/...) or https:// for externally-hosted images.
// Reject javascript:, data:text/html, and any other non-https scheme.
function sanitizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).trim();
  if (u.startsWith('/')) return u;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'https:') return u;
  } catch { /* invalid URL */ }
  return null;
}

// Logos may also be data:image/svg+xml or data:image/png (AI-generated / SVG fallback).
// data:image/* is safe in <img> (rendered as image, never executed), so we allow it.
function sanitizeLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = String(url).trim();
  if (u.startsWith('/')) return u;
  if (u.startsWith('data:image/')) return u;
  return sanitizeUrl(url);
}

function svgLogo(name: string, color = '#7c3aed'): string {
  const initial = (name || 'A').trim().slice(0, 1).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">`
    + `<circle cx="50" cy="50" r="46" fill="${color}"/>`
    + `<text x="50" y="62" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="44" font-weight="700" fill="#fff">${initial}</text>`
    + `</svg>`;
}

// Derive shared hero copy (headline/subheadline/tagline) from the founder's
// own inputs (project name + sector + description). Deterministic; the AI path
// enriches this when a model is available.
function heuristicHeroCopy(name: string, sector: string | null, description: string): { headline: string; subheadline: string; tagline: string } {
  const desc = (description || '').trim();
  const firstSentence = (desc.split(/(?<=[.!?])\s+/)[0] || desc).trim();
  const headline = (firstSentence || name || 'Building something new').slice(0, 120);
  const subheadline = desc.slice(0, 200);
  const words = desc.split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  const tagline = (words || sector || name || '').slice(0, 120);
  return { headline, subheadline, tagline };
}

// Seed the chosen template's editable fields from the schema defaults. The
// editor layers these under anything the AI returns, so every field lands
// populated and on-brand even with no model available (dev backend path).
function heuristicTemplateContent(key: TemplateKey): Record<string, any> {
  const fields = LANDING_CONTENT_SCHEMA[key] || [];
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (f.kind === 'groupList') out[f.key] = Array.isArray(f.default) ? f.default : [];
    else out[f.key] = typeof f.default === 'string' ? f.default : '';
  }
  return out;
}

// Pull the first balanced {...} JSON object out of a model response. Small
// LLMs sometimes wrap JSON in prose or ```json fences; this is more robust
// than JSON.parse on the raw string.
function extractJsonObject(text: string): any | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

// AI page-content auto-fill via Workers AI (routed through aiRouter so per-user
// budget checks, model fallback, and usage logging all apply). Generates hero
// copy + the chosen template's editable fields from the founder's own inputs.
// Returns null on any failure/refusal so the caller falls back to the
// deterministic heuristic.
async function aiTemplateContent(
  env: Env,
  userId: number,
  key: TemplateKey,
  name: string,
  sector: string | null,
  description: string,
): Promise<{ name: string; cta_text: string; headline: string; subheadline: string; tagline: string; content: Record<string, any> } | null> {
  try {
    const fields = LANDING_CONTENT_SCHEMA[key] || [];
    const fieldSpec = fields.map((f) => {
      if (f.kind === 'groupList') {
        const items = (f.itemFields || []).map((itf) => `"${itf.key}"`).join(', ');
        return `"${f.key}": array (max ${f.max || 6}) of objects {${items}}`;
      }
      return `"${f.key}": string`;
    }).join('; ');
    const systemPrompt = 'You are a concise startup copywriter. Always return ONLY valid minified JSON, no prose, no markdown fences.';
    const userPrompt = `Write landing-page copy for a startup.\nBrand: ${name || 'unspecified'}. Sector: ${sector || 'unspecified'}.\nWhat it does: ${description.trim()}\n\nReturn JSON of the exact form: {"name":"","headline":"","subheadline":"","tagline":"","cta":""${fieldSpec ? `,"content":{${fieldSpec}}` : ''}}\nRules: name = the brand/product name (<=4 words); headline <=12 words; subheadline <=30 words; tagline <=8 words; cta = a 2-4 word call-to-action button label; keep copy specific to the idea; plain text only (no HTML).`;
    const res = await aiRouterRun(env, {
      task: 'brand_autofill',
      userId: userId || 0,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.7,
      maxTokens: 900,
    });
    if (!res.ok || !res.output) return null;
    const parsed = extractJsonObject(res.output);
    if (!parsed || typeof parsed !== 'object') return null;
    const aiName = String(parsed.name || '').trim().slice(0, 120);
    const headline = String(parsed.headline || '').trim().slice(0, 200);
    const subheadline = String(parsed.subheadline || '').trim().slice(0, 400);
    const tagline = String(parsed.tagline || '').trim().slice(0, 200);
    const cta = String(parsed.cta || '').trim().slice(0, 60);
    // Clamp the per-template content through the shared sanitizer so the model
    // can't inject unknown fields, oversized strings, or the wrong shape.
    const content = sanitizeLandingContent({ [key]: parsed.content })[key] || {};
    if (!aiName && !headline && !subheadline && !tagline && !cta && !Object.keys(content).length) return null;
    // Brand name + CTA fall back to the project name / sensible default so the
    // editor always lands every shared hero field populated (task #3).
    return {
      name: aiName || name,
      cta_text: cta || 'Join the waitlist',
      headline,
      subheadline,
      tagline,
      content,
    };
  } catch {
    return null;
  }
}

// Logo via Workers AI text-to-image (flux schnell). Returns a self-contained
// data URL (base64) so it slots into the existing logo_url handling with no
// storage plumbing. Returns null on any failure so the caller falls back to
// the inline SVG. Wrapped in a hard timeout so a slow image gen can't pin the
// isolate to its CPU cap.
async function aiLogo(env: Env, prompt: string): Promise<string | null> {
  const ai = (env as any).AI;
  if (!ai || typeof ai.run !== 'function') return null;
  const fullPrompt = `${prompt}. Flat minimalist vector logo, single centered mark, solid background, no text, no lettering, high contrast.`;
  try {
    const raw: any = await Promise.race([
      ai.run('@cf/black-forest-labs/flux-1-schnell', { prompt: fullPrompt.slice(0, 2048) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('logo_timeout')), 30_000)),
    ]);
    // flux schnell returns { image: "<base64 jpeg>" }.
    const b64 = typeof raw?.image === 'string' ? raw.image : null;
    if (!b64) return null;
    return `data:image/jpeg;base64,${b64}`;
  } catch {
    return null;
  }
}

async function projectOwned(env: Env, user: any, projectId: number): Promise<any> {
  const row = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first<any>();
  if (!row) throw new Error('NotFound');
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'partner' || role === 'investor') return row;
  if (role === 'founder' && user.founder_id && row.founder_id === user.founder_id) return row;
  throw new Error('Forbidden');
}

const AUDIENCE_SET = new Set(['customer', 'partner', 'investor']);
const VALID_AUDIENCE = (v: unknown): string | null => (typeof v === 'string' && AUDIENCE_SET.has(v.trim())) ? v.trim() : null;

// Audience-first flow — the landing page's PRIMARY audience carries the full
// 6-value taxonomy (mirrors AUDIENCES in frontend/src/lib/brand/templates.js).
// This is deliberately separate from AUDIENCE_SET above, which is the narrow
// waitlist segmentation (DB CHECK limited to customer/partner/investor).
const PAGE_AUDIENCE_SET = new Set(['customer', 'investor', 'partner', 'advisor', 'mentor', 'cofounder']);
const VALID_PAGE_AUDIENCE = (v: unknown): string | null =>
  (typeof v === 'string' && PAGE_AUDIENCE_SET.has(v.trim())) ? v.trim() : null;
// Normalized goal (mirrors GOALS in the frontend catalog).
const GOAL_SET = new Set(['join_waitlist', 'request_intro', 'start_pilot', 'book_call', 'apply', 'offer_guidance']);
const VALID_GOAL = (v: unknown): string | null =>
  (typeof v === 'string' && GOAL_SET.has(v.trim())) ? v.trim() : null;
// Catalog template id (kebab-case). Stored after a strict sanitise; NOT
// validated against the catalog itself — that lives frontend-side in
// lib/brand/templates.js, so duplicating it here would just invite drift.
const TEMPLATE_KIT_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const cleanTemplateKit = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return TEMPLATE_KIT_RE.test(s) ? s : null;
};

function rowToLanding(row: any) {
  return {
    id: row.id,
    project_id: row.project_id,
    slug: row.slug,
    page_slug: row.page_slug || 'home',
    preview_token: row.preview_token || null,
    name: row.name,
    tagline: row.tagline,
    headline: row.headline,
    subheadline: row.subheadline,
    cta_text: row.cta_text || 'Join the waitlist',
    logo_url: row.logo_url,
    logo_svg: row.logo_svg,
    logo_asset_id: row.logo_asset_id || null,
    theme_color: row.theme_color || '#7c3aed',
    palette_bg: row.palette_bg || null,
    palette_ink: row.palette_ink || null,
    palette_secondary: row.palette_secondary || null,
    palette_accent: row.palette_accent || null,
    font_pairing: row.font_pairing || null,
    published: !!row.published,
    views_count: row.views_count || 0,
    audience_customer_headline: row.audience_customer_headline || null,
    audience_customer_body: row.audience_customer_body || null,
    audience_customer_cta: row.audience_customer_cta || null,
    audience_partner_headline: row.audience_partner_headline || null,
    audience_partner_body: row.audience_partner_body || null,
    audience_partner_cta: row.audience_partner_cta || null,
    audience_investor_headline: row.audience_investor_headline || null,
    audience_investor_body: row.audience_investor_body || null,
    audience_investor_cta: row.audience_investor_cta || null,
    audience_advisor_headline: row.audience_advisor_headline || null,
    audience_advisor_body: row.audience_advisor_body || null,
    audience_advisor_cta: row.audience_advisor_cta || null,
    audience_mentor_headline: row.audience_mentor_headline || null,
    audience_mentor_body: row.audience_mentor_body || null,
    audience_mentor_cta: row.audience_mentor_cta || null,
    audience_cofounder_headline: row.audience_cofounder_headline || null,
    audience_cofounder_body: row.audience_cofounder_body || null,
    audience_cofounder_cta: row.audience_cofounder_cta || null,
    template: row.template || 'minimal',
    hero_media_url: row.hero_media_url || null,
    product_screenshot_url: row.product_screenshot_url || null,
    audience: row.audience || null,
    goal: row.goal || null,
    template_kit: row.template_kit || null,
    content_json: parseContentJson(row.content_json),
  };
}

// Parse the stored content_json string into an object for the editor to rehydrate.
function parseContentJson(raw: unknown): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, any>;
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_PAIRING_IDS = new Set(['editorial', 'modern', 'humanist', 'classic']);
const cleanHex = (v: unknown): string | null =>
  (typeof v === 'string' && HEX_RE.test(v.trim())) ? v.trim().toLowerCase() : null;
const cleanFontPairing = (v: unknown): string | null =>
  (typeof v === 'string' && FONT_PAIRING_IDS.has(v.trim())) ? v.trim() : null;

const ALLOWED_LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_INLINE_MAX_BYTES = 200 * 1024;

// WCAG relative luminance for a hex color (sRGB, 8-bit).
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const rgb = v.length === 3
    ? [parseInt(v[0] + v[0], 16), parseInt(v[1] + v[1], 16), parseInt(v[2] + v[2], 16)]
    : [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  const a = rgb.map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

// WCAG contrast ratio between two hex colors.
function contrastRatio(a: string, b: string): number {
  const l1 = luminance(a) + 0.05;
  const l2 = luminance(b) + 0.05;
  return Math.max(l1, l2) / Math.min(l1, l2);
}

// --- Multi-page sites (Task #2) --------------------------------------------

// Editable, human-readable slugs (site + page): lowercase alnum + hyphens,
// 1-48 chars, no leading/trailing hyphen. Stricter than the legacy random
// slug on purpose — these are user-facing URLs.
const CLEAN_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
function cleanSlug(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return CLEAN_SLUG_RE.test(s) ? s : null;
}
// /p/* is its own namespace so site slugs can't shadow app routes; this list
// only blocks names that would be confusing or useful for phishing.
const RESERVED_SITE_SLUGS = new Set(['api', 'app', 'admin', 'axal', 'assets', 'landing', 'login', 'preview', 'register', 'static', 'www']);

/**
 * Reserved PAGE slugs. Narrower than the site list on purpose.
 *
 * A page slug is the second segment (`/p/{site}/{page}`), so unlike a site
 * slug it can never shadow an app route — the /p/* namespace already isolates
 * it. What it CAN do is impersonate a trust surface on the founder's own
 * domain path: `/p/acme/login`, `/p/acme/verify` and friends are exactly the
 * shapes a phishing page wants, and these pages are attacker-authorable free
 * text. So this blocks credential/payment-adjacent names and the reserved
 * words that would collide with our own future per-site routes, and nothing
 * else — founders keep `/p/acme/pricing`, `/p/acme/about` and so on.
 */
const RESERVED_PAGE_SLUGS = new Set([
  'login', 'signin', 'sign-in', 'logout', 'register', 'signup', 'sign-up',
  'auth', 'oauth', 'sso', 'password', 'reset', 'verify', 'verification',
  'account', 'billing', 'payment', 'payments', 'checkout', 'card',
  'admin', 'api', 'assets', 'static', 'preview', 'settings', 'security',
]);

/** Max landing pages one project may own. Deliberately a named constant. */
const MAX_PAGES_PER_PROJECT = 5;

/** Trim + hard-clip attacker-controlled free text. Null when empty. */
function clipStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * Allowlisted UTM extraction. Mirrors the clip-and-allowlist approach the
 * marketing funnel already uses (frontend/src/lib/funnel.js → routes/track.ts)
 * so the two attribution paths agree on shape. Anything outside the five
 * standard keys is dropped rather than stored.
 */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
function pickUtm(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const s = clipStr(src[k], 120);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Page-count cap. Enforced HERE (server-side) rather than only in the UI,
 * because the endpoint is a plain authenticated POST that anything can call.
 * Each page is a ~40-column D1 row plus a globally-unique public URL, so an
 * unbounded creator is both a storage and a namespace problem.
 */
async function pageCountFor(env: Env, projectId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM landing_pages WHERE project_id = ?'
  ).bind(projectId).first<any>();
  return Number(row?.n ?? 0);
}

function deriveSlugBase(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 44)
    .replace(/-+$/, '');
}

const newPreviewToken = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');

const isUniqueError = (e: any, needle: string): boolean => {
  const msg = String(e?.message || '');
  return msg.includes('UNIQUE') && msg.includes(needle);
};

// Get-or-create the project's site slug. Derived slugs are auto-suffixed on
// collision (-2, -3, …); user-edited slugs go through the PUT below, which
// 409s instead — user input is never silently mutated.
async function ensureSite(env: Env, projectId: number, seedName: string): Promise<{ slug: string }> {
  const existing = await env.DB.prepare('SELECT slug FROM brand_sites WHERE project_id = ?').bind(projectId).first<any>();
  if (existing) return existing;
  let base = deriveSlugBase(seedName) || `venture-${projectId}`;
  if (RESERVED_SITE_SLUGS.has(base)) base = `${base}-site`;
  for (let i = 0; i < 30; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 43)}-${i + 1}`;
    try {
      await env.DB.prepare('INSERT INTO brand_sites (project_id, slug) VALUES (?, ?)').bind(projectId, candidate).run();
      return { slug: candidate };
    } catch (e: any) {
      if (isUniqueError(e, 'brand_sites.project_id')) {
        // Concurrent create won the race — use theirs.
        const row = await env.DB.prepare('SELECT slug FROM brand_sites WHERE project_id = ?').bind(projectId).first<any>();
        if (row) return row;
      }
      if (!isUniqueError(e, 'brand_sites.slug')) throw e;
    }
  }
  throw new Error('could not allocate a site slug');
}

// Derive a free page slug within a project (server-derived path only).
async function allocatePageSlug(env: Env, projectId: number, seedName: string): Promise<string> {
  const base = deriveSlugBase(seedName) || 'page';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 43)}-${i + 1}`;
    const hit = await env.DB.prepare(
      'SELECT 1 AS x FROM landing_pages WHERE project_id = ? AND page_slug = ?',
    ).bind(projectId, candidate).first<any>();
    if (!hit) return candidate;
  }
  throw new Error('could not allocate a page slug');
}

// Shared sanitised parse of a landing-page write body. The legacy single-page
// PUT and every multi-page write go through here, so all write paths get
// identical sanitisation — including pages seeded from saved custom templates
// (snapshots are re-sanitised at apply time; never trusted from storage).
function parseLandingFields(body: any) {
  const audienceBinds: (string | null)[] = [];
  for (const aud of ['customer', 'partner', 'investor', 'advisor', 'mentor', 'cofounder']) {
    for (const part of ['headline', 'body', 'cta']) {
      audienceBinds.push(String(body?.[`audience_${aud}_${part}`] || '').trim() || null);
    }
  }
  return {
    tagline: body?.tagline || null,
    headline: body?.headline || null,
    subheadline: body?.subheadline || null,
    cta: String(body?.cta_text || 'Join the waitlist'),
    color: String(body?.theme_color || '#7c3aed'),
    paletteBg: cleanHex(body?.palette_bg),
    paletteInk: cleanHex(body?.palette_ink),
    paletteSecondary: cleanHex(body?.palette_secondary),
    paletteAccent: cleanHex(body?.palette_accent),
    fontPairing: cleanFontPairing(body?.font_pairing),
    logoAssetId: String(body?.logo_asset_id || '').trim() || null,
    logoUrl: sanitizeLogoUrl(String(body?.logo_url || '').trim()),
    logoSvg: sanitizeSvg(body?.logo_svg) || null,
    audienceBinds,
    template: String(body?.template || '').trim() || 'minimal',
    heroMediaUrl: sanitizeUrl(String(body?.hero_media_url || '').trim()),
    productScreenshotUrl: sanitizeUrl(String(body?.product_screenshot_url || '').trim()),
    audience: VALID_PAGE_AUDIENCE(body?.audience),
    goal: VALID_GOAL(body?.goal),
    templateKit: cleanTemplateKit(body?.template_kit),
    contentJson: JSON.stringify(sanitizeLandingContent(body?.content_json)),
  };
}

// Update one page by id. pageSlug === null leaves page_slug unchanged.
async function updateLandingRow(env: Env, id: number, name: string, body: any, previewToken: string, pageSlug: string | null): Promise<void> {
  const f = parseLandingFields(body);
  await env.DB.prepare(
    `UPDATE landing_pages SET name=?, tagline=?, headline=?, subheadline=?, cta_text=?,
     logo_url=?, logo_svg=?, logo_asset_id=?, theme_color=?, palette_bg=?, palette_ink=?,
     palette_secondary=?, palette_accent=?, font_pairing=?,
     audience_customer_headline=?, audience_customer_body=?, audience_customer_cta=?,
     audience_partner_headline=?, audience_partner_body=?, audience_partner_cta=?,
     audience_investor_headline=?, audience_investor_body=?, audience_investor_cta=?,
     audience_advisor_headline=?, audience_advisor_body=?, audience_advisor_cta=?,
     audience_mentor_headline=?, audience_mentor_body=?, audience_mentor_cta=?,
     audience_cofounder_headline=?, audience_cofounder_body=?, audience_cofounder_cta=?,
     template=?, hero_media_url=?, product_screenshot_url=?,
     audience=?, goal=?, template_kit=?, content_json=?,
     preview_token=?, page_slug=COALESCE(?, page_slug), updated_at=datetime('now') WHERE id=?`
  ).bind(
    name, f.tagline, f.headline, f.subheadline, f.cta,
    f.logoUrl, f.logoSvg, f.logoAssetId, f.color, f.paletteBg, f.paletteInk,
    f.paletteSecondary, f.paletteAccent, f.fontPairing,
    ...f.audienceBinds,
    f.template, f.heroMediaUrl, f.productScreenshotUrl,
    f.audience, f.goal, f.templateKit, f.contentJson,
    previewToken, pageSlug, id,
  ).run();
}

// Insert a page. Every page still gets a legacy globally-unique random slug
// so the existing waitlist / view / share endpoints keep working unchanged.
async function insertLandingRow(env: Env, pid: number, pageSlug: string, name: string, body: any): Promise<number> {
  const f = parseLandingFields(body);
  const slug = slugify(name);
  const previewToken = newPreviewToken();
  const res = await env.DB.prepare(
    `INSERT INTO landing_pages (project_id, slug, page_slug, preview_token, name, tagline, headline, subheadline, cta_text,
     logo_url, logo_svg, logo_asset_id, theme_color, palette_bg, palette_ink, palette_secondary, palette_accent, font_pairing,
     audience_customer_headline, audience_customer_body, audience_customer_cta,
     audience_partner_headline, audience_partner_body, audience_partner_cta,
     audience_investor_headline, audience_investor_body, audience_investor_cta,
     audience_advisor_headline, audience_advisor_body, audience_advisor_cta,
     audience_mentor_headline, audience_mentor_body, audience_mentor_cta,
     audience_cofounder_headline, audience_cofounder_body, audience_cofounder_cta,
     template, hero_media_url, product_screenshot_url,
     audience, goal, template_kit, content_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?)`
  ).bind(
    pid, slug, pageSlug, previewToken, name, f.tagline, f.headline, f.subheadline, f.cta,
    f.logoUrl, f.logoSvg, f.logoAssetId, f.color, f.paletteBg, f.paletteInk, f.paletteSecondary, f.paletteAccent, f.fontPairing,
    ...f.audienceBinds,
    f.template, f.heroMediaUrl, f.productScreenshotUrl,
    f.audience, f.goal, f.templateKit, f.contentJson,
  ).run();
  return Number((res as any).meta?.last_row_id);
}

// Public JSON must not leak the draft preview token.
function publicLanding(row: any) {
  const out: any = rowToLanding(row);
  delete out.preview_token;
  return out;
}

// Design + copy-seed fields captured into a saved custom template. Snapshots
// are built server-side from a page the caller owns (never from a raw body).
const TEMPLATE_SNAPSHOT_FIELDS = [
  'template', 'template_kit', 'audience', 'goal', 'theme_color',
  'palette_bg', 'palette_ink', 'palette_secondary', 'palette_accent', 'font_pairing',
  'cta_text', 'headline', 'subheadline', 'tagline', 'hero_media_url', 'product_screenshot_url',
] as const;

function snapshotFromRow(row: any): Record<string, any> {
  const snap: Record<string, any> = {};
  for (const k of TEMPLATE_SNAPSHOT_FIELDS) snap[k] = row[k] ?? null;
  snap.content_json = parseContentJson(row.content_json);
  return snap;
}

// Returns a curated 5-color palette from a hash of the description.
function heuristicPalette(description: string, seedColor?: string | null): Record<string, string> {
  const palettes = [
    { primary: '#7c3aed', background: '#faf7ff', ink: '#1b1430', secondary: '#c4b5fd', accent: '#f59e0b' },
    { primary: '#2563eb', background: '#eff6ff', ink: '#0f172a', secondary: '#93c5fd', accent: '#10b981' },
    { primary: '#dc2626', background: '#fef2f2', ink: '#1a0a0a', secondary: '#fca5a5', accent: '#f59e0b' },
    { primary: '#059669', background: '#ecfdf5', ink: '#0a1f15', secondary: '#6ee7b7', accent: '#3b82f6' },
    { primary: '#0891b2', background: '#ecfeff', ink: '#0a1a1f', secondary: '#67e8f9', accent: '#f43f5e' },
    { primary: '#4f46e5', background: '#eef2ff', ink: '#0f0a1a', secondary: '#a5b4fc', accent: '#f59e0b' },
    { primary: '#7c3aed', background: '#f5f3ff', ink: '#1a1025', secondary: '#d8b4fe', accent: '#10b981' },
    { primary: '#be185d', background: '#fdf2f8', ink: '#1a0a12', secondary: '#fbcfe8', accent: '#6366f1' },
    { primary: '#ea580c', background: '#fff7ed', ink: '#1a0f05', secondary: '#fdba74', accent: '#10b981' },
    { primary: '#4338ca', background: '#e0e7ff', ink: '#0a0a1f', secondary: '#818cf8', accent: '#f59e0b' },
    { primary: '#065f46', background: '#ecfdf5', ink: '#0a1a14', secondary: '#6ee7b7', accent: '#f59e0b' },
    { primary: '#b91c1c', background: '#fef2f2', ink: '#1a0a0a', secondary: '#fca5a5', accent: '#3b82f6' },
  ];
  let h = 0;
  for (const ch of description || 'x') h = (h * 31 + ch.charCodeAt(0)) | 0;
  h = Math.abs(h);
  const base = palettes[h % palettes.length];
  if (seedColor && HEX_RE.test(seedColor)) {
    base.primary = seedColor.toLowerCase();
  }
  return base;
}

// Deterministic tagline templates based on audience + tone + market angle.
function heuristicTaglines(name: string, description: string, audience: string, tone: string, marketAngle: string): string[] {
  const a = (audience || 'founders').trim();
  const t = (tone || 'bold').trim().toLowerCase();
  const m = (marketAngle || 'innovation').trim();
  const d = (description || '').trim().slice(0, 80);
  const templates: Record<string, string[]> = {
    bold: [
      `${name}: the ${m} platform ${a} have been waiting for.`,
      `Built for ${a} who refuse to settle. ${name} is here.`,
      `${name} — where ${m} meets execution.`,
      `The fastest way for ${a} to win. Period.`,
      `Stop guessing. Start scaling with ${name}.`,
      `${name} turns ${a} into ${m} leaders.`,
    ],
    warm: [
      `${name}: made with care for ${a} who dream big.`,
      `A gentle ${m} toolkit for ${a} ready to grow.`,
      `${name} helps ${a} build something meaningful.`,
      `For ${a} who believe ${m} should feel human.`,
      `${name} — your partner from first idea to launch.`,
      `Every ${a} deserves a tool like ${name}.`,
    ],
    technical: [
      `${name}: ${m} infrastructure for ${a} at scale.`,
      `Engineered for ${a} who demand ${m} performance.`,
      `${name} — the ${m} stack ${a} actually want to use.`,
      `Composable ${m} primitives for modern ${a}.`,
      `API-first ${m} tools for ${a} who ship daily.`,
      `${name} reduces ${a} operational complexity by design.`,
    ],
    playful: [
      `${name}: ${m} magic for ${a} who like to play.`,
      `The ${m} sidekick every ${a} deserves.`,
      `${name} makes ${m} feel like a game — and you win.`,
      `For ${a} who think ${m} should be fun.`,
      `${name}: serious ${m}, zero boredom.`,
      `Unleash your ${a} superpowers with ${name}.`,
    ],
    authoritative: [
      `${name}: the ${m} standard for ${a}.`,
      `Trusted by ${a} who set the ${m} agenda.`,
      `${name} — ${m} proven at scale.`,
      `The ${a} platform ${m} teams rely on.`,
      `${name} delivers ${m} outcomes, not promises.`,
      `The benchmark for ${m} among ${a}.`,
    ],
  };
  const bank = templates[t] || templates.bold;
  return bank.map((s) => s.replace(/\$\{name\}/g, name).replace(/\$\{description\}/g, d));
}

async function aiPalette(env: Env, userId: number, description: string, sector: string | null, seedColor?: string | null): Promise<Record<string, string> | null> {
  try {
    const systemPrompt = 'You are a colour strategist. Always return ONLY valid minified JSON, no prose, no markdown fences.';
    const userPrompt = `Suggest a 5-colour palette for a startup.
Sector: ${sector || 'unspecified'}.
Idea: ${description.trim()}
${seedColor ? `Seed colour: ${seedColor}` : ''}

Return JSON of the exact form: {"primary":"#RRGGBB","background":"#RRGGBB","ink":"#RRGGBB","secondary":"#RRGGBB","accent":"#RRGGBB"}
Rules: all values must be hex; background must be light enough for dark text; ink must be dark enough for light backgrounds; secondary should complement primary; accent should be a contrasting warm or cool colour.`;
    const res = await aiRouterRun(env, {
      task: 'brand_palette',
      userId: userId || 0,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.8,
      maxTokens: 300,
    });
    if (!res.ok || !res.output) return null;
    const parsed = extractJsonObject(res.output);
    const p = parsed || {};
    const out: Record<string, string> = {};
    for (const key of ['primary', 'background', 'ink', 'secondary', 'accent']) {
      const v = String(p[key] || '').trim();
      if (HEX_RE.test(v)) out[key] = v.toLowerCase();
    }
    return Object.keys(out).length === 5 ? out : null;
  } catch {
    return null;
  }
}

async function aiTaglines(env: Env, userId: number, name: string, description: string, audience: string, tone: string, marketAngle: string): Promise<string[] | null> {
  try {
    const systemPrompt = 'You are a startup copywriter. Always return ONLY valid minified JSON, no prose, no markdown fences.';
    const userPrompt = `Write 6 tagline candidates for a startup.
Name: ${name}
Description: ${description.trim()}
Audience: ${audience}
Tone: ${tone}
Market angle: ${marketAngle}

Return JSON of the exact form: {"taglines":["","","","","",""]}
Rules: each tagline <= 12 words; varied angles; no emojis.`;
    const res = await aiRouterRun(env, {
      task: 'brand_taglines',
      userId: userId || 0,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.9,
      maxTokens: 400,
    });
    if (!res.ok || !res.output) return null;
    const parsed = extractJsonObject(res.output);
    const arr = Array.isArray(parsed?.taglines) ? parsed.taglines : null;
    if (!arr) return null;
    const clean = arr
      .map((s: any) => String(s || '').trim().slice(0, 160))
      .filter((s: string) => s.length > 0);
    return clean.length ? clean.slice(0, 6) : null;
  } catch {
    return null;
  }
}

brand.post('/landing/autofill', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const description = String(body?.description || '').trim();
  if (description.length < 4) return c.json({ error: 'description too short' }, 400);
  const name = String(body?.name || '').trim();
  const sector = body?.sector ? String(body.sector) : null;
  const requested = String(body?.template || '').trim();
  const key = (TEMPLATE_KEYS as readonly string[]).includes(requested) ? (requested as TemplateKey) : 'minimal';
  const ai = await aiTemplateContent(c.env, user.id, key, name, sector, description);
  if (ai) return c.json({ ...ai, ai_generated: true });
  const hero = heuristicHeroCopy(name, sector, description);
  return c.json({
    ...hero,
    name,
    cta_text: 'Join the waitlist',
    content: heuristicTemplateContent(key),
    ai_generated: false,
  });
});

brand.post('/logo', async (c) => {
  await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const prompt = String(body?.prompt || '').trim();
  if (prompt.length < 4) return c.json({ error: 'prompt too short' }, 400);
  const url = await aiLogo(c.env, prompt);
  if (url) return c.json({ url, svg: null, source: 'workers-ai' });
  return c.json({ url: null, svg: svgLogo(body?.name || 'A', body?.color || '#7c3aed'), source: 'svg' });
});

brand.post('/logo/upload', async (c) => {
  const user = await requireAuth(c);
  const ctype = (c.req.header('content-type') || '').toLowerCase();
  if (!ctype.includes('multipart/form-data')) {
    return c.json({ error: 'expected_multipart' }, 400);
  }
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof (file as unknown as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
    return c.json({ error: 'no_file' }, 400);
  }
  const f = file as unknown as { name?: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> };
  const mime = String(f.type || '').trim();
  if (!ALLOWED_LOGO_MIME.has(mime)) return c.json({ error: 'invalid mime type' }, 400);

  const raw = new Uint8Array(await f.arrayBuffer());
  if (raw.length === 0) return c.json({ error: 'empty data' }, 400);
  if (raw.length > LOGO_MAX_BYTES) return c.json({ error: 'file too large' }, 400);

  // Sanitise SVG before any storage path. For non-SVG uploads the raw bytes
  // are kept as-is; for SVG we overwrite with the sanitised text so that
  // stored bytes never carry a script payload.
  let logoBytes: Uint8Array = raw;
  if (mime === 'image/svg+xml') {
    const text = new TextDecoder().decode(raw);
    const svgSanitized = sanitizeSvg(text);
    if (!svgSanitized) return c.json({ error: 'svg failed sanitization' }, 400);
    logoBytes = new TextEncoder().encode(svgSanitized);
  }

  // Safe base64 without spreading potentially large Uint8Arrays (avoids
  // "Maximum call stack size exceeded" on engines with small argument limits).
  function bytesToBase64(bytes: Uint8Array): string {
    const chunk = 65536;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  const files = c.env.FILES;
  if (files) {
    const key = `brand-logos/${user.id}/${crypto.randomUUID()}.${mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'svg'}`;
    try {
      await files.put(key, logoBytes, {
        httpMetadata: { contentType: mime },
        customMetadata: { userId: String(user.id), uploadedAt: new Date().toISOString() },
      });
    } catch {
      return c.json({ error: 'upload failed' }, 500);
    }
    // asset_id is the R2 key; the frontend can resolve it via a future
    // signed-URL route. For now, inline the logo for immediate preview.
    let previewUrl: string | null = null;
    try {
      const b64 = bytesToBase64(logoBytes);
      previewUrl = `data:${mime};base64,${b64}`;
    } catch {
      // preview encoding failure is non-fatal; asset is still stored.
    }
    return c.json({ asset_id: key, url: previewUrl, mime, size: logoBytes.length, source: 'r2' });
  }

  // No FILES binding — inline small images only.
  if (logoBytes.length > LOGO_INLINE_MAX_BYTES) return c.json({ error: 'file too large for inline' }, 400);
  const b64 = bytesToBase64(logoBytes);
  const dataUrl = `data:${mime};base64,${b64}`;
  return c.json({ asset_id: dataUrl, url: dataUrl, mime, size: logoBytes.length, source: 'inline' });
});

brand.post('/palette/suggest', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const description = String(body?.description || '').trim();
  if (description.length < 4) return c.json({ error: 'description too short' }, 400);
  const sector = body?.sector ? String(body.sector) : null;
  const seed = cleanHex(body?.seed_color);
  const ai = await aiPalette(c.env, user.id, description, sector, seed);
  const palette = ai || heuristicPalette(description, seed);
  const warnings: string[] = [];
  if (contrastRatio(palette.ink, palette.background) < 4.5) {
    warnings.push('text-on-background contrast below WCAG AA (4.5:1).');
  }
  if (contrastRatio(palette.ink, palette.primary) < 3.0) {
    warnings.push('text-on-primary contrast below WCAG AA for large text (3:1).');
  }
  if (contrastRatio(palette.primary, palette.background) < 3.0) {
    warnings.push('primary↔background contrast below WCAG AA for large text (3:1).');
  }
  return c.json({
    palette: {
      primary: palette.primary,
      background: palette.background,
      ink: palette.ink,
      secondary: palette.secondary,
      accent: palette.accent,
    },
    warnings,
    ai_generated: !!ai,
  });
});

brand.post('/tagline/suggest', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const name = String(body?.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const description = String(body?.description || '').trim();
  const audience = String(body?.audience || '').trim();
  const tone = String(body?.tone || '').trim();
  const marketAngle = String(body?.market_angle || '').trim();
  if (!audience || !tone || !marketAngle) return c.json({ error: 'audience, tone, and market_angle required' }, 400);
  const ai = await aiTaglines(c.env, user.id, name, description, audience, tone, marketAngle);
  const taglines = ai || heuristicTaglines(name, description, audience, tone, marketAngle);
  return c.json({ taglines: taglines.slice(0, 6), ai_generated: !!ai });
});

brand.get('/landing/by-project/:pid', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  // Primary page = oldest page (multi-page sites; legacy single-page callers
  // keep working against it).
  const row = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE project_id = ? ORDER BY id LIMIT 1').bind(pid).first<any>();
  if (!row) return c.json(null);
  return c.json(rowToLanding(row));
});

brand.put('/landing/by-project/:pid', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  const body = await c.req.json().catch(() => ({} as any));
  const name = String(body?.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  await ensureSchema(c.env);
  // Legacy single-page endpoint — operates on the project's PRIMARY page
  // (oldest by id). Additional pages are managed by the /pages endpoints.
  const existing = await c.env.DB.prepare('SELECT id, slug, preview_token FROM landing_pages WHERE project_id = ? ORDER BY id LIMIT 1').bind(pid).first<any>();
  let rowId: number;
  if (existing) {
    const previewToken = existing.preview_token || newPreviewToken();
    await updateLandingRow(c.env, existing.id, name, body, previewToken, null);
    rowId = existing.id;
  } else {
    rowId = await insertLandingRow(c.env, pid, 'home', name, body);
  }
  // Make sure the project has a branded site slug once a page exists.
  try { await ensureSite(c.env, pid, name); }
  catch (e: any) { console.error('brand ensureSite:', e?.message); }
  const row = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE id = ?').bind(rowId).first<any>();
  return c.json(rowToLanding(row));
});

brand.post('/landing/by-project/:pid/publish', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => ({} as any));
  const flag = body?.published === false ? 0 : 1;
  await ensureSchema(c.env);
  // Primary page only — per-page publish lives at /landing/pages/:id/publish.
  await c.env.DB.prepare(
    `UPDATE landing_pages SET published=?, updated_at=datetime('now')
     WHERE id = (SELECT id FROM landing_pages WHERE project_id = ? ORDER BY id LIMIT 1)`
  ).bind(flag, pid).run();
  return c.json({ ok: true, published: !!flag });
});

brand.get('/landing/by-project/:pid/waitlist', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) { return c.json({ error: 'forbidden' }, 403); }
  await ensureSchema(c.env);
  const audienceFilter = VALID_AUDIENCE(c.req.query('audience'));
  // landing_page_id is selected so the founder UI can attribute a signup to
  // the page that captured it. It was previously omitted, which left the UI
  // trying to match on `source` — a column the capture route always writes as
  // the constant 'landing', so every per-page count rendered 0.
  const sql = audienceFilter
    ? `SELECT id, landing_page_id, email, name, source, audience, created_at FROM waitlist_signups WHERE project_id = ? AND audience = ? ORDER BY created_at DESC LIMIT 500`
    : `SELECT id, landing_page_id, email, name, source, audience, created_at FROM waitlist_signups WHERE project_id = ? ORDER BY created_at DESC LIMIT 500`;
  const stmt = c.env.DB.prepare(sql);
  const rows = audienceFilter
    ? stmt.bind(pid, audienceFilter).all<any>()
    : stmt.bind(pid).all<any>();
  const list = ((await rows).results ?? []) as any[];
  return c.json({ signups: list, count: list.length });
});

brand.get('/landing/by-project/:pid/preview-url', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) { return c.json({ error: 'forbidden' }, 403); }
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare('SELECT id, preview_token FROM landing_pages WHERE project_id = ? ORDER BY id LIMIT 1').bind(pid).first<any>();
  if (!row) return c.json({ error: 'no preview token' }, 404);
  let token = row.preview_token;
  if (!token) {
    token = newPreviewToken();
    await c.env.DB.prepare('UPDATE landing_pages SET preview_token = ? WHERE id = ?').bind(token, row.id).run();
  }
  return c.json({ url: `/landing/preview/${token}` });
});

// --- Multi-page site endpoints (Task #2) ------------------------------------

// Branded startup URL for a project (get-or-create).
brand.get('/site/by-project/:pid', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  const proj = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(pid).first<any>();
  try {
    const site = await ensureSite(c.env, pid, String(proj?.name || ''));
    return c.json({ slug: site.slug, path: `/p/${site.slug}` });
  } catch (e: any) {
    console.error('brand site get:', e?.message);
    return c.json({ error: 'could not allocate a site slug' }, 500);
  }
});

// Edit the startup slug. User-chosen slugs are never auto-suffixed — a
// collision is an explicit 409 so the founder picks something else.
brand.put('/site/by-project/:pid', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const slug = cleanSlug(body?.slug);
  if (!slug) {
    return c.json({ error: 'Slug must be 1-48 characters: lowercase letters, numbers, and hyphens (no leading/trailing hyphen).' }, 400);
  }
  if (RESERVED_SITE_SLUGS.has(slug)) return c.json({ error: 'That slug is reserved.' }, 400);
  const proj = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(pid).first<any>();
  try {
    await ensureSite(c.env, pid, String(proj?.name || ''));
    await c.env.DB.prepare(
      `UPDATE brand_sites SET slug = ?, updated_at = datetime('now') WHERE project_id = ?`
    ).bind(slug, pid).run();
  } catch (e: any) {
    if (isUniqueError(e, 'brand_sites.slug')) {
      return c.json({ error: 'That startup URL is already taken.' }, 409);
    }
    console.error('brand site put:', e?.message);
    return c.json({ error: 'could not update site slug' }, 500);
  }
  return c.json({ slug, path: `/p/${slug}` });
});

// List all pages of a project's site.
brand.get('/landing/by-project/:pid/pages', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT id, page_slug, slug, name, headline, template, template_kit, audience, goal,
            published, views_count, updated_at
     FROM landing_pages WHERE project_id = ? ORDER BY id`
  ).bind(pid).all<any>();
  const pages = ((rows.results ?? []) as any[]).map((r) => ({
    ...r,
    page_slug: r.page_slug || 'home',
    published: !!r.published,
    views_count: r.views_count ?? 0,
  }));
  return c.json({ pages });
});

// Create a new page, optionally seeded from a saved custom template.
brand.post('/landing/by-project/:pid/pages', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const name = String(body?.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);

  // Hard cap, server-side. 409 (not 400) — the request is well-formed, it
  // conflicts with the account's current state, and deleting a page resolves it.
  const existingCount = await pageCountFor(c.env, pid);
  if (existingCount >= MAX_PAGES_PER_PROJECT) {
    return c.json({
      error: `You've reached the limit of ${MAX_PAGES_PER_PROJECT} landing pages for this project. Delete a page to make room for a new one.`,
      code: 'page_limit_reached',
      limit: MAX_PAGES_PER_PROJECT,
      count: existingCount,
    }, 409);
  }

  // Seed from a saved template the caller owns; the merged body is re-parsed
  // through the shared sanitiser, so stored snapshots are never trusted as-is.
  let seed: Record<string, any> = body || {};
  const tplId = parseInt(String(body?.from_custom_template_id ?? '')) || 0;
  if (tplId) {
    const tpl = await c.env.DB.prepare(
      'SELECT snapshot_json FROM brand_custom_templates WHERE id = ? AND user_id = ?'
    ).bind(tplId, user.id).first<any>();
    if (!tpl) return c.json({ error: 'template not found' }, 404);
    let snap: Record<string, any> = {};
    try { snap = JSON.parse(tpl.snapshot_json) || {}; }
    catch { return c.json({ error: 'template snapshot is corrupted' }, 500); }
    seed = { ...snap };
    for (const [k, v] of Object.entries(body || {})) {
      if (v !== undefined && v !== null && v !== '') seed[k] = v;
    }
  }

  // Page slug: explicit value must be valid (400) and free (409); otherwise
  // derive from the name with auto-suffixing.
  const rawPageSlug = body?.page_slug;
  let pageSlug: string;
  const userChoseSlug = rawPageSlug !== undefined && rawPageSlug !== null && String(rawPageSlug).trim() !== '';
  if (userChoseSlug) {
    const cleaned = cleanSlug(rawPageSlug);
    if (!cleaned) {
      return c.json({ error: 'Page slug must be 1-48 characters: lowercase letters, numbers, and hyphens (no leading/trailing hyphen).' }, 400);
    }
    if (RESERVED_PAGE_SLUGS.has(cleaned)) {
      return c.json({ error: `"${cleaned}" is reserved and can't be used as a page URL.`, code: 'slug_reserved' }, 400);
    }
    pageSlug = cleaned;
  } else {
    pageSlug = await allocatePageSlug(c.env, pid, name);
  }

  let rowId: number;
  try {
    rowId = await insertLandingRow(c.env, pid, pageSlug, name, seed);
  } catch (e: any) {
    if (isUniqueError(e, 'page_slug') || isUniqueError(e, 'idx_landing_project_page')) {
      return c.json({ error: 'A page with that slug already exists on this site.' }, 409);
    }
    if (isUniqueError(e, 'landing_pages.project_id')) {
      // Pre-migration DB still enforcing one page per project — explicit, not silent.
      return c.json({ error: 'multi-page not available until migration 144 is applied' }, 500);
    }
    throw e;
  }
  try { await ensureSite(c.env, pid, name); }
  catch (e: any) { console.error('brand ensureSite:', e?.message); }
  const row = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE id = ?').bind(rowId).first<any>();
  return c.json(rowToLanding(row), 201);
});

// Load one owned page (any page, not just the primary).
brand.get('/landing/pages/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c.env, user, row.project_id); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  return c.json(rowToLanding(row));
});

// Update one page (content + optional page_slug rename).
brand.put('/landing/pages/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  const existing = await c.env.DB.prepare('SELECT id, project_id, preview_token FROM landing_pages WHERE id = ?').bind(id).first<any>();
  if (!existing) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c.env, user, existing.project_id); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => ({} as any));
  const name = String(body?.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  let pageSlug: string | null = null;
  const rawPageSlug = body?.page_slug;
  if (rawPageSlug !== undefined && rawPageSlug !== null && String(rawPageSlug).trim() !== '') {
    pageSlug = cleanSlug(rawPageSlug);
    if (!pageSlug) {
      return c.json({ error: 'Page slug must be 1-48 characters: lowercase letters, numbers, and hyphens (no leading/trailing hyphen).' }, 400);
    }
    if (RESERVED_PAGE_SLUGS.has(pageSlug)) {
      return c.json({ error: `"${pageSlug}" is reserved and can't be used as a page URL.`, code: 'slug_reserved' }, 400);
    }
  }
  const previewToken = existing.preview_token || newPreviewToken();
  try {
    await updateLandingRow(c.env, id, name, body, previewToken, pageSlug);
  } catch (e: any) {
    if (isUniqueError(e, 'page_slug') || isUniqueError(e, 'idx_landing_project_page')) {
      return c.json({ error: 'A page with that slug already exists on this site.' }, 409);
    }
    throw e;
  }
  const row = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE id = ?').bind(id).first<any>();
  return c.json(rowToLanding(row));
});

// Delete a page — but never the last one (unpublish instead).
brand.delete('/landing/pages/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare('SELECT id, project_id FROM landing_pages WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c.env, user, row.project_id); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM landing_pages WHERE project_id = ?').bind(row.project_id).first<any>();
  if (Number(count?.n || 0) <= 1) {
    return c.json({ error: 'Cannot delete the last page of a site — unpublish it instead.' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM landing_pages WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

// Per-page publish toggle.
brand.post('/landing/pages/:id/publish', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare('SELECT id, project_id FROM landing_pages WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c.env, user, row.project_id); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => ({} as any));
  const flag = body?.published === false ? 0 : 1;
  await c.env.DB.prepare(
    `UPDATE landing_pages SET published=?, updated_at=datetime('now') WHERE id=?`
  ).bind(flag, id).run();
  return c.json({ ok: true, published: !!flag });
});

// Per-page draft preview URL.
brand.get('/landing/pages/:id/preview-url', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare('SELECT id, project_id, preview_token FROM landing_pages WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c.env, user, row.project_id); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  let token = row.preview_token;
  if (!token) {
    token = newPreviewToken();
    await c.env.DB.prepare('UPDATE landing_pages SET preview_token = ? WHERE id = ?').bind(token, id).run();
  }
  return c.json({ url: `/landing/preview/${token}` });
});

/**
 * The page's PUBLIC url — the one to share, not the private preview token.
 *
 * This exists because there was no way to get it. The founder-facing UI only
 * ever had `preview-url`, so "View Live" opened a `noindex, no-store` draft
 * link and the real public address was never shown anywhere in the product.
 *
 * `published` is returned alongside so the caller can be honest about what the
 * link is: an unpublished page HAS a public URL, it just 404s until it goes
 * live, and telling the founder that beats handing over a link that looks
 * broken.
 */
brand.get('/landing/pages/:id/public-url', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  try { await projectOwned(c.env, user, row.project_id); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const origin = new URL(c.req.url).origin;
  const url = await canonicalPublicUrl(c.env, row, origin);
  return c.json({ url, published: !!row.published, page_slug: row.page_slug || 'home' });
});

/**
 * Is this page slug free for this project?
 *
 * Pre-flight for the slug editor, mirroring the company-name check the
 * Incorporate wizard already uses (routes/legal.ts). Without it the only
 * feedback is a 409 AFTER a failed save, which means a founder discovers the
 * clash having already lost their edit.
 *
 * Returns the same three verdicts the write path enforces — malformed,
 * reserved, taken — so the two can't disagree. Advisory only: the write still
 * re-validates, because anything can change between this call and the save.
 */
brand.get('/landing/by-project/:pid/page-slug-available', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  const raw = c.req.query('slug');
  const cleaned = cleanSlug(raw);
  if (!cleaned) {
    return c.json({
      available: false,
      reason: 'invalid',
      message: 'Use 1-48 characters: lowercase letters, numbers and hyphens (no leading or trailing hyphen).',
    });
  }
  if (RESERVED_PAGE_SLUGS.has(cleaned)) {
    return c.json({ available: false, reason: 'reserved', message: `"${cleaned}" is reserved and can't be used as a page URL.` });
  }
  // Exclude the page being renamed, so re-saving its own slug isn't a clash.
  const excludeId = parseInt(String(c.req.query('exclude_page_id') ?? '')) || 0;
  const clash = await c.env.DB.prepare(
    `SELECT id FROM landing_pages WHERE project_id = ? AND page_slug = ? AND id <> ? LIMIT 1`
  ).bind(pid, cleaned, excludeId).first<any>();
  if (clash) {
    return c.json({ available: false, reason: 'taken', message: 'You already have a page at that URL.', slug: cleaned });
  }
  return c.json({ available: true, slug: cleaned });
});

// --- Saved custom templates (Task #2) ---------------------------------------

const MAX_CUSTOM_TEMPLATES = 50;

brand.get('/custom-templates', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const rows = await c.env.DB.prepare(
    'SELECT id, name, snapshot_json, created_at FROM brand_custom_templates WHERE user_id = ? ORDER BY created_at DESC, id DESC'
  ).bind(user.id).all<any>();
  const templates = ((rows.results ?? []) as any[]).map((r) => {
    let snap: Record<string, any> = {};
    try { snap = JSON.parse(r.snapshot_json) || {}; } catch { /* summary fields stay null */ }
    return {
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      template: snap.template ?? null,
      template_kit: snap.template_kit ?? null,
      theme_color: snap.theme_color ?? null,
      palette_bg: snap.palette_bg ?? null,
      palette_ink: snap.palette_ink ?? null,
      font_pairing: snap.font_pairing ?? null,
    };
  });
  return c.json({ templates });
});

// Snapshot an owned page into a reusable template (server-side capture).
brand.post('/custom-templates', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const body = await c.req.json().catch(() => ({} as any));
  const name = String(body?.name || '').trim().slice(0, 80);
  if (!name) return c.json({ error: 'name required' }, 400);
  const fromPageId = parseInt(String(body?.from_page_id ?? '')) || 0;
  if (!fromPageId) return c.json({ error: 'from_page_id required' }, 400);
  const page = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE id = ?').bind(fromPageId).first<any>();
  if (!page) return c.json({ error: 'page not found' }, 404);
  try { await projectOwned(c.env, user, page.project_id); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM brand_custom_templates WHERE user_id = ?').bind(user.id).first<any>();
  if (Number(count?.n || 0) >= MAX_CUSTOM_TEMPLATES) {
    return c.json({ error: `Template limit reached (${MAX_CUSTOM_TEMPLATES}) — delete one first.` }, 400);
  }
  const snapshot = snapshotFromRow(page);
  const res = await c.env.DB.prepare(
    'INSERT INTO brand_custom_templates (user_id, name, snapshot_json) VALUES (?, ?, ?)'
  ).bind(user.id, name, JSON.stringify(snapshot)).run();
  return c.json({ id: Number((res as any).meta?.last_row_id), name, ...{
    template: snapshot.template ?? null,
    template_kit: snapshot.template_kit ?? null,
    theme_color: snapshot.theme_color ?? null,
    palette_bg: snapshot.palette_bg ?? null,
    palette_ink: snapshot.palette_ink ?? null,
    font_pairing: snapshot.font_pairing ?? null,
  } }, 201);
});

brand.delete('/custom-templates/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureSchema(c.env);
  const id = parseInt(c.req.param('id'));
  const res = await c.env.DB.prepare(
    'DELETE FROM brand_custom_templates WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run();
  if (!Number((res as any).meta?.changes || 0)) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// Public JSON for a branded site page (no auth; published pages only).
brand.get('/p/:site/:page', async (c) => {
  await ensureSchema(c.env);
  const site = await c.env.DB.prepare('SELECT project_id FROM brand_sites WHERE slug = ?').bind(c.req.param('site')).first<any>();
  if (!site) return c.json({ error: 'not found' }, 404);
  const row = await c.env.DB.prepare(
    'SELECT * FROM landing_pages WHERE project_id = ? AND page_slug = ? AND published = 1'
  ).bind(site.project_id, c.req.param('page')).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(publicLanding(row));
});

brand.get('/landing/:slug', async (c) => {
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare(
    `SELECT * FROM landing_pages WHERE slug = ? AND published = 1`
  ).bind(c.req.param('slug')).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  // Public payload — the draft preview token stays private.
  return c.json(publicLanding(row));
});

brand.get('/templates', async (c) => {
  await ensureSchema(c.env);
  return c.json({ templates: TEMPLATE_REGISTRY });
});

brand.post('/landing/:slug/waitlist', async (c) => {
  await ensureSchema(c.env);
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({} as any));

  // Honeypot. The rendered form carries an off-screen, aria-hidden,
  // autocomplete-off text input that no human ever sees or fills. Naive bots
  // that blindly populate every input give themselves away here.
  //
  // We answer 200 {ok:true} rather than an error ON PURPOSE: a bot that gets a
  // 400 learns the trap exists and adapts, while an indistinguishable success
  // wastes its time. Nothing is written.
  const trap = body?.[HONEYPOT_FIELD];
  if (typeof trap === 'string' && trap.trim() !== '') {
    console.warn('brand waitlist: honeypot tripped on', slug);
    return c.json({ ok: true });
  }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'invalid email' }, 400);
  const lp = await c.env.DB.prepare(
    `SELECT id, project_id FROM landing_pages WHERE slug = ? AND published = 1`
  ).bind(slug).first<any>();
  if (!lp) return c.json({ error: 'landing page not found' }, 404);
  const audience = VALID_AUDIENCE(body?.audience);
  // The Contacts hub accepts the full 6-value audience taxonomy; the legacy
  // waitlist_signups insert stays CHECK-safe (customer/partner/investor only).
  const contactAudience = VALID_PAGE_AUDIENCE(body?.audience) || 'customer';
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || '';
  let ipHash: string | null = null;
  if (ip) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    ipHash = Array.from(new Uint8Array(buf)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Idempotent re-submit. The same person hitting the button twice, or
  // re-visiting a page they already joined, previously produced a duplicate
  // row in BOTH tables — the founder's inbox showed the same lead repeatedly
  // with no indication it was one person. Treat a repeat of the same email on
  // the same page as a no-op and report success, which is what the visitor
  // sees anyway. Different page = genuinely a different lead, so it's scoped
  // to (landing_page_id, email), not email alone.
  const already = await c.env.DB.prepare(
    `SELECT id FROM waitlist_signups WHERE landing_page_id = ? AND email = ? LIMIT 1`
  ).bind(lp.id, email).first<any>();
  if (already) return c.json({ ok: true, duplicate: true });

  // Attribution. Captured from the page's own querystring (forwarded by the
  // form script) and the document referrer, so a founder can tell an
  // organic visit from one they paid for. Clipped + allowlisted — this is
  // attacker-controlled text on a public endpoint.
  const utm = pickUtm(body?.utm);
  const referrer = clipStr(body?.referrer, 300);

  await c.env.DB.prepare(
    `INSERT INTO waitlist_signups (project_id, landing_page_id, email, name, source, audience, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(lp.project_id, lp.id, email, clipStr(body?.name, 200), body?.source || 'landing', audience, ipHash).run();
  // Route the lead into the Contacts hub (best-effort — never fail the capture).
  try {
    await ingestContact(c.env, {
      projectId: lp.project_id, landingPageId: lp.id, email,
      name: clipStr(body?.name, 200), audience: contactAudience,
      cta: clipStr(body?.cta, 200), message: clipStr(body?.message, 2000),
      source: body?.source || 'landing',
      utm, referrer,
    });
  } catch (e: any) {
    // Capture must still succeed even if the Contacts write fails — but log it
    // (explicit error handling over silent fallbacks).
    console.error('contacts ingest:', e?.message);
  }
  return c.json({ ok: true });
});

brand.post('/landing/:slug/view', async (c) => {
  await ensureSchema(c.env);
  await c.env.DB.prepare(
    `UPDATE landing_pages SET views_count = COALESCE(views_count, 0) + 1 WHERE slug = ? AND published = 1`
  ).bind(c.req.param('slug')).run();
  return c.json({ ok: true });
});

// --- Public HTML renderer (mounted from index.ts at /landing/:slug) ------

/**
 * The ONE public URL a published page should be indexed and shared under.
 *
 * A published page is reachable at BOTH the legacy random `/landing/:slug`
 * and — once its project has a brand_sites row — the branded
 * `/p/:site/:page`. Identical HTML on two URLs is duplicate content, and the
 * two would compete with each other in search and in link previews. The
 * branded URL wins: it is the one the founder chose, it is stable across
 * re-publishes, and it reads as theirs. Both renderers call this, so whichever
 * URL a visitor arrives on, the page points at the same canonical.
 *
 * Falls back to the legacy URL when the project has no site row yet.
 */
export async function canonicalPublicUrl(env: Env, row: any, origin: string): Promise<string | null> {
  if (!origin) return null;
  try {
    const site = await env.DB.prepare(
      'SELECT slug FROM brand_sites WHERE project_id = ?'
    ).bind(row.project_id).first<any>();
    if (site?.slug) {
      const page = String(row.page_slug || 'home');
      // The site root serves the 'home' page, so 'home' canonicalises to the
      // bare /p/:site rather than the equivalent /p/:site/home.
      return page === 'home'
        ? `${origin}/p/${encodeURIComponent(site.slug)}`
        : `${origin}/p/${encodeURIComponent(site.slug)}/${encodeURIComponent(page)}`;
    }
  } catch (e: any) {
    // A missing brand_sites table (fresh/unmigrated DB) must not break the
    // render — fall through to the legacy URL.
    console.warn('brand canonical lookup:', e?.message);
  }
  return row.slug ? `${origin}/landing/${encodeURIComponent(row.slug)}` : null;
}

function buildLandingPageHtml(
  row: any,
  opts: { slug?: string; token?: string; noindex?: boolean; nonce?: string; canonical?: string | null } = {},
): Response {
  const html = renderLandingTemplate(row, opts);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': opts.noindex ? 'private, no-store' : 'public, max-age=60',
      'X-Robots-Tag': opts.noindex ? 'noindex, nofollow' : 'index, follow',
    },
  });
}

export async function renderLandingHtml(env: Env, slug: string, nonce?: string, origin = ''): Promise<Response> {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT * FROM landing_pages WHERE slug = ? AND published = 1`
  ).bind(slug).first<any>();
  if (!row) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
  // Increment view count fire-and-forget — never block the render.
  env.DB.prepare(
    `UPDATE landing_pages SET views_count = COALESCE(views_count, 0) + 1 WHERE slug = ?`
  ).bind(slug).run().catch(() => {});
  const canonical = await canonicalPublicUrl(env, row, origin);
  return buildLandingPageHtml(row, { slug, noindex: false, nonce, canonical });
}

// Branded site SSR — /p/{site}/{page} (and /p/{site} → the home page).
// The row's legacy slug is passed through so the rendered waitlist form and
// view ping keep POSTing to the existing /api/brand/landing/:slug endpoints.
export async function renderSitePage(env: Env, siteSlug: string, pageSlug: string | null, nonce?: string, origin = ''): Promise<Response> {
  await ensureSchema(env);
  const site = await env.DB.prepare('SELECT project_id FROM brand_sites WHERE slug = ?').bind(siteSlug).first<any>();
  if (!site) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
  let row: any = null;
  if (pageSlug) {
    row = await env.DB.prepare(
      'SELECT * FROM landing_pages WHERE project_id = ? AND page_slug = ? AND published = 1'
    ).bind(site.project_id, pageSlug).first<any>();
  } else {
    // Site root: prefer the "home" page, else the oldest published page.
    row = await env.DB.prepare(
      `SELECT * FROM landing_pages WHERE project_id = ? AND published = 1
       ORDER BY CASE WHEN page_slug = 'home' THEN 0 ELSE 1 END, id LIMIT 1`
    ).bind(site.project_id).first<any>();
  }
  if (!row) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
  // Increment view count fire-and-forget — never block the render.
  env.DB.prepare(
    'UPDATE landing_pages SET views_count = COALESCE(views_count, 0) + 1 WHERE id = ?'
  ).bind(row.id).run().catch(() => {});
  const canonical = await canonicalPublicUrl(env, row, origin);
  return buildLandingPageHtml(row, { slug: row.slug, noindex: false, nonce, canonical });
}

export async function renderLandingPreview(env: Env, token: string, nonce?: string): Promise<Response> {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    `SELECT * FROM landing_pages WHERE preview_token = ?`
  ).bind(token).first<any>();
  if (!row) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
  return buildLandingPageHtml(row, { token, noindex: true, nonce });
}

// Task #20 — public (no-auth) visual preview of a landing template. Renders one
// of the visual styles with generic placeholder copy + Axal brand colours so the
// template picker can show a true-to-life preview before selection. No DB read,
// no slug/token — pure render. Always noindex.
// Task #24 — the ported designs ship a signature palette; merge it so their
// previews are on-brand (the generic violet would otherwise flatten them).
export function renderTemplatePreview(env: Env, style: string, nonce?: string): Response {
  const key = (TEMPLATE_KEYS as readonly string[]).includes(style) ? style : 'minimal';
  const row: Record<string, any> = {
    name: 'Northwind Labs',
    tagline: 'The operating system for ambitious founders.',
    headline: 'Build, launch, and grow — all in one place.',
    subheadline: 'Northwind Labs gives early-stage teams everything they need to go from idea to traction without the busywork.',
    cta_text: 'Join the waitlist',
    theme_color: '#7c3aed',
    palette_bg: '#faf7ff',
    palette_ink: '#1b1430',
    palette_secondary: '#c4b5fd',
    palette_accent: '#f59e0b',
    font_pairing: 'editorial',
    template: key,
  };
  const sig = TEMPLATE_SIGNATURE_PALETTES[key];
  if (sig) Object.assign(row, sig);
  const html = renderLandingTemplate(row, { noindex: true, nonce });
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export default brand;

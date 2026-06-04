/**
 * Task #25 — Pitch deck builder (Worker mirror).
 *
 * 10-slide deck pulling project + scoring data, per-slide rich-text
 * (markdown body) + image fields, version history, restore, and
 * ONE-TIME signed share URLs (HMAC + DB-tracked single-use).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { ensureTier, tierCovers } from '../middleware/requireTier';
import {
  DECK_METHODS, PREMIUM_METHOD_IDS, getMethod,
} from '../services/decks/methods';
import { autofillDeck, toEditorSlides } from '../services/decks/autofill';
// Task #15 — Axal 30-day Spin-Out Lab demo day deck. Custom autofill
// path that bypasses the generic field-source vocabulary in autofill.ts
// because the deck binds to Lab tables (interviews, milestones, OKRs)
// that don't fit the project/financials/captable source shape.
import { fillAxalSpinoutDemoDay, buildAxalSpinoutDemoDaySlides, buildAxalSpinoutCoverage } from '../services/decks/axalSpinoutDemoDay';
import { recommendMethod, listOverrides, setOverride, deleteOverride } from '../services/decks/recommend';
import { getDeckBrand, setStudioWatermark, ensureMethodAllowed, fetchLandingPageForProject, applyBrandKitToSlides } from '../services/decks/branding';
import { renderDeckHTML, type RenderableDeck } from '../services/decks/render';
import { renderDeckPPTX, renderDeckPPTXWithImages } from '../services/decks/pptx';
import { stripTrailingSlashes } from '../util/url';

const decks = new Hono<{ Bindings: Env }>();

let _migrated = false;
async function ensureSchema(env: Env): Promise<void> {
  if (_migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS pitch_decks (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       project_id INTEGER NOT NULL,
       version INTEGER NOT NULL DEFAULT 1,
       slides TEXT NOT NULL,
       title TEXT,
       is_current INTEGER DEFAULT 1,
       created_by INTEGER,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_decks_project ON pitch_decks(project_id, version)`,
    `CREATE INDEX IF NOT EXISTS idx_decks_current ON pitch_decks(project_id, is_current)`,
    // One-time share tokens: stores SHA-256(token), atomic-claim on read.
    `CREATE TABLE IF NOT EXISTS pitch_deck_share_tokens (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       deck_id INTEGER NOT NULL,
       token_hash TEXT NOT NULL UNIQUE,
       expires_at TEXT NOT NULL,
       used_at TEXT,
       view_limit INTEGER NOT NULL DEFAULT 1,
       view_count INTEGER NOT NULL DEFAULT 0,
       last_viewed_at TEXT,
       created_by INTEGER,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_hash ON pitch_deck_share_tokens(token_hash)`,
    // Task #53 — per-impression telemetry surfaced in the Engagement panel.
    `CREATE TABLE IF NOT EXISTS deck_share_views (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       share_token_id INTEGER NOT NULL,
       deck_id INTEGER NOT NULL,
       ip_hash TEXT,
       ua_fingerprint TEXT,
       read_seconds INTEGER NOT NULL DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')),
       updated_at TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_views_deck ON deck_share_views(deck_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_views_tok ON deck_share_views(share_token_id)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch (e: any) { console.error('decks schema:', e?.message); }
  }
  // Lazy column bootstrap for older deployments where the share token
  // table predates Task #53. D1 has no ADD COLUMN IF NOT EXISTS; we
  // probe with PRAGMA and ALTER on demand.
  try {
    const cols = await env.DB.prepare(`PRAGMA table_info(pitch_deck_share_tokens)`).all<any>();
    const have = new Set(((cols.results || []) as any[]).map((r) => String(r.name)));
    if (!have.has('view_limit')) {
      try { await env.DB.prepare(`ALTER TABLE pitch_deck_share_tokens ADD COLUMN view_limit INTEGER NOT NULL DEFAULT 1`).run(); } catch {}
    }
    if (!have.has('view_count')) {
      try { await env.DB.prepare(`ALTER TABLE pitch_deck_share_tokens ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`).run(); } catch {}
    }
    if (!have.has('last_viewed_at')) {
      try { await env.DB.prepare(`ALTER TABLE pitch_deck_share_tokens ADD COLUMN last_viewed_at TEXT`).run(); } catch {}
    }
  } catch {}
  _migrated = true;
}

// Task #14 — lazy bootstrap of the projects columns added by migration
// 069. D1 has no `ADD COLUMN IF NOT EXISTS`; we probe PRAGMA and ALTER
// on demand so autofill works in any environment regardless of whether
// `wrangler d1 execute … 069_deck_autofill_fields.sql` has run.
// Mirrors `ensureAdvisorWeekColumn` / `ensureCalendarOAuthSchema`.
let _projectAutofillCols = false;
async function ensureProjectAutofillColumns(env: Env): Promise<void> {
  if (_projectAutofillCols) return;
  try {
    const cols = await env.DB.prepare(`PRAGMA table_info(projects)`).all<any>();
    const have = new Set(((cols.results || []) as any[]).map((r) => String(r.name)));
    const adds: Array<[string, string]> = [
      ['tagline', 'TEXT'],
      ['logo_url', 'TEXT'],
      ['som', 'REAL'],
      ['cac', 'REAL'],
      ['gross_margin_pct', 'REAL'],
      ['contact_email', 'TEXT'],
      ['vision', 'TEXT'],
      ['traction_summary', 'TEXT'],
    ];
    for (const [name, type] of adds) {
      if (have.has(name)) continue;
      try { await env.DB.prepare(`ALTER TABLE projects ADD COLUMN ${name} ${type}`).run(); }
      catch (e: any) {
        // `too many columns on sqlite_altertab` would block here; surface
        // it once so we know to move to a side table (see users-table
        // pattern in user_google_links from migration 065).
        console.error('[decks] ensureProjectAutofillColumns:', name, e?.message);
      }
    }
  } catch {}
  _projectAutofillCols = true;
}

// Task #53 — best-effort hashing of viewer identifiers. Stored
// per-impression so the founder can see "5 views, 12 min read" without
// learning the visitor's IP or UA verbatim. SHA-256(secret || value)
// keyed by JWT_SECRET so the hashes aren't a precomputed-rainbow target.
// ---------------------------------------------------------------------
// Task #2 — short-lived HMAC token for headless export. Browser
// Rendering can't carry the user's cookies/JWT, so we sign a
// scoped {deck_id, exp} payload and expose a public, token-gated
// /api/decks/print-export/:token endpoint that returns the deck JSON.
// The SPA route /deck/print-export/:token consumes the same token to
// drive an unauthenticated render of the live React templates.
// ---------------------------------------------------------------------
// b64url + b64urlDecode are defined later in this file (function-hoisted);
// reused here so we don't duplicate the implementation.
async function deckPrintHmacKey(env: Env): Promise<CryptoKey> {
  const secret = (env as any).JWT_SECRET || 'dev-secret-do-not-use';
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}
export async function signDeckPrintToken(env: Env, deckId: number, ttlSec = 180): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `deck-print|${deckId}|${exp}`;
  const key = await deckPrintHmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${b64url(new TextEncoder().encode(payload))}.${b64url(sig)}`;
}
export async function verifyDeckPrintToken(env: Env, token: string): Promise<{ deckId: number } | null> {
  try {
    const [pB64, sB64] = (token || '').split('.');
    if (!pB64 || !sB64) return null;
    const payloadBytes = b64urlDecode(pB64);
    const sigBytes = b64urlDecode(sB64);
    const key = await deckPrintHmacKey(env);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    if (!ok) return null;
    const payload = new TextDecoder().decode(payloadBytes);
    const [tag, idStr, expStr] = payload.split('|');
    if (tag !== 'deck-print' || !idStr || !expStr) return null;
    if (Math.floor(Date.now() / 1000) > Number(expStr)) return null;
    const deckId = parseInt(idStr, 10);
    if (!Number.isFinite(deckId) || deckId <= 0) return null;
    return { deckId };
  } catch { return null; }
}

async function hashViewerField(env: Env, value: string | null): Promise<string | null> {
  if (!value) return null;
  const secret = (env as any).JWT_SECRET || 'fallback-dev-only';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|${value}`));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < 8; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

const SLIDE_TITLES = [
  'Problem', 'Solution', 'Market', 'Traction', 'Business model',
  'Go-to-market', 'Competition', 'Team', 'Ask', 'Financials',
];

function fmtMoney(n: any): string | null {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return null;
  return `$${Math.round(v).toLocaleString()}`;
}

async function latestScore(env: Env, projectId: number): Promise<any | null> {
  try {
    return await env.DB.prepare(
      `SELECT * FROM score_snapshots WHERE project_id = ? AND is_sandbox = 0
       ORDER BY created_at DESC LIMIT 1`
    ).bind(projectId).first<any>();
  } catch { return null; }
}

function heuristicSlides(p: any, snap: any | null): any[] {
  // Task #14 — extended to read every project column the 12 deck templates
  // reference, preserving the literal '—' placeholder when the column is
  // empty so the editor renders a visible "needs filling" cue instead of
  // an opinionated default. The dash mirrors `autofill.ts::PLACEHOLDER`.
  const DASH = '—';
  const orDash = (v: any): string => {
    const s = (v == null ? '' : String(v)).trim();
    return s ? s : DASH;
  };
  const name = orDash(p.name);
  const sector = orDash(p.sector);
  const tagline = orDash(p.tagline);
  const vision = orDash(p.vision);
  const tractionSummary = orDash(p.traction_summary);
  const contactEmail = orDash(p.contact_email);
  const logoUrl = (p.logo_url && String(p.logo_url).trim()) ? String(p.logo_url).trim() : null;
  const problem = orDash(p.problem_statement);
  const solution = (p.solution || p.description || '').toString().trim() || DASH;
  const whyNow = orDash(p.why_now);
  const tam = fmtMoney(p.tam);
  const sam = fmtMoney(p.sam);
  const som = fmtMoney(p.som);
  const users = Number(p.users_count || 0);
  const revenue = fmtMoney(p.revenue);
  const funding = fmtMoney(p.funding_needed);
  const useOf = orDash(p.use_of_funds);
  const cac = fmtMoney(p.cac);
  const grossMarginPct = p.gross_margin_pct != null && p.gross_margin_pct !== ''
    ? `${Math.round(Number(p.gross_margin_pct) * 100) / 100}%` : null;
  const scoreLine = snap ? `Internal score: ${Math.round(Number(snap.total_score) * 10) / 10}/100 (${snap.tier}).` : '';
  const marketLine = snap ? `Market scoring: ${Math.round(Number(snap.market_total) * 10) / 10} (urgency + trend signal).` : '';
  const arr = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x);

  return [
    { title: 'Title', subtitle: name, body: tagline, bullets: arr([vision !== DASH ? `Vision: ${vision}` : null]), image_url: logoUrl },
    { title: 'Problem', subtitle: name, body: problem, bullets: arr([whyNow !== DASH ? whyNow : null]), image_url: null },
    { title: 'Solution', subtitle: name, body: solution, bullets: [], image_url: null },
    { title: 'Market', subtitle: sector, body: '', bullets: arr([
      tam ? `TAM: ${tam}` : `TAM: ${DASH}`,
      sam ? `SAM: ${sam}` : `SAM: ${DASH}`,
      som ? `SOM: ${som}` : `SOM: ${DASH}`,
      whyNow !== DASH ? whyNow : null, marketLine,
    ]), image_url: null },
    { title: 'Traction', subtitle: "What's working", body: tractionSummary, bullets: arr([
      users > 0 ? `${users.toLocaleString()} users` : `Users: ${DASH}`,
      revenue ? `${revenue} revenue` : `Revenue: ${DASH}`,
      p.growth_signals || DASH,
      scoreLine,
    ]), image_url: null },
    { title: 'Business model', subtitle: 'How we make money', body: '', bullets: arr([
      cac ? `Blended CAC: ${cac}` : `CAC: ${DASH}`,
      grossMarginPct ? `Gross margin: ${grossMarginPct}` : `Gross margin: ${DASH}`,
    ]), image_url: null },
    { title: 'Go-to-market', subtitle: 'Channels & motion', body: '', bullets: [DASH], image_url: null },
    { title: 'Competition', subtitle: 'Landscape', body: '', bullets: [DASH], image_url: null },
    { title: 'Team', subtitle: 'Why us', body: '', bullets: [DASH], image_url: null },
    { title: 'Ask', subtitle: 'Round', body: '', bullets: arr([
      funding ? `Raising ${funding}` : `Raise: ${DASH}`,
      '18-24 months of runway to hit the next milestone.',
      useOf,
    ]), image_url: null },
    { title: 'Financials', subtitle: 'Plan', body: '', bullets: arr([
      funding ? `Burn target reflecting ${funding} raise.` : `Burn target: ${DASH}`,
    ]), image_url: null },
    { title: 'Contact', subtitle: name, body: contactEmail, bullets: [], image_url: null },
  ];
}

async function aiSlides(env: Env, p: any, snap: any | null): Promise<any[] | null> {
  const key = (env as any).OPENAI_API_KEY;
  if (!key) return null;
  try {
    const ctx = {
      name: p.name, sector: p.sector, stage: p.stage,
      description: p.description, problem: p.problem_statement,
      solution: p.solution, why_now: p.why_now,
      tam: p.tam, sam: p.sam, users: p.users_count, revenue: p.revenue,
      growth_signals: p.growth_signals, cost_to_mvp: p.cost_to_mvp,
      funding_needed: p.funding_needed, use_of_funds: p.use_of_funds,
      scoring: snap ? {
        total_score: snap.total_score, tier: snap.tier,
        market_total: snap.market_total, team_total: snap.team_total,
        product_total: snap.product_total, capital_total: snap.capital_total,
        fit_total: snap.fit_total, distribution_total: snap.distribution_total,
        ai_notes: snap.ai_notes,
      } : null,
    };
    const prompt = `Draft a 10-slide pitch deck for the following startup. Return ONLY valid JSON of the shape:
{"slides":[{"title":"...","subtitle":"...","body":"...","bullets":["...","..."]}, ...]}
Use exactly these slide titles in order: ${JSON.stringify(SLIDE_TITLES)}.
\`body\` is a 1-2 sentence narrative paragraph (markdown allowed). \`bullets\` is 2-4 punchy bullets (≤18 words each).
Use the scoring numbers in the Traction and Market slides where helpful.
Startup data: ${JSON.stringify(ctx)}`;
    // T7 — 45s timeout (longer than brand.ts because pitch decks are bigger
    // outputs; still well under the 60s subrequest cap).
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a senior VC associate drafting concise pitch decks. Always return valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5, max_tokens: 1800,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const parsed = JSON.parse(j?.choices?.[0]?.message?.content || '{}');
    const slides = Array.isArray(parsed?.slides) ? parsed.slides : null;
    return slides && slides.length >= 1 ? slides : null;
  } catch { return null; }
}

// Spec: deck "auto-creates 10 slides". Pad with fallback content from the
// heuristic when the AI returns fewer; trim when more. Aligned by canonical
// slide title where possible.
function enforceTen(slides: any[], fallback: any[]): any[] {
  const byTitle = new Map<string, any>();
  for (const s of slides || []) {
    if (!s || typeof s !== 'object') continue;
    const t = String(s.title || '').trim().toLowerCase();
    if (t && !byTitle.has(t)) byTitle.set(t, s);
  }
  const out: any[] = [];
  for (let i = 0; i < SLIDE_TITLES.length; i++) {
    const canonical = SLIDE_TITLES[i];
    let s = byTitle.get(canonical.toLowerCase());
    if (!s && i < slides.length && slides[i] && typeof slides[i] === 'object') s = slides[i];
    if (!s) s = fallback[i];
    s = { ...s };
    if (!s.title) s.title = canonical;
    out.push(s);
  }
  return out;
}

// Task #16 — must accept *both* the legacy {title,body,bullets,image_url}
// shape AND the new fielded shape { title, subtitle, spec_id, appendix,
// method_id, fields:[{key,label,kind,value,source,edited?}] }. Anything
// else is dropped. Caps prevent runaway sizes.
function sanitizeSlides(input: any[]): any[] {
  return (input || []).slice(0, 60).map((s: any) => {
    const title = String((s?.title || '') as string).trim().slice(0, 120) || 'Slide';
    const sub = s?.subtitle ? String(s.subtitle).trim().slice(0, 200) : null;
    const body = s?.body ? String(s.body).trim().slice(0, 4000) : '';
    const bullets = Array.isArray(s?.bullets)
      ? s.bullets.map((b: any) => String(b).trim().slice(0, 400)).filter((b: string) => !!b).slice(0, 6)
      : [];
    let image_url: string | null = null;
    if (s?.image_url && typeof s.image_url === 'string') {
      const u = sanitizeImageUrl(s.image_url);
      if (u) image_url = u;
    }
    const out: any = { title, subtitle: sub, body, bullets, image_url };
    if (s?.spec_id) out.spec_id = String(s.spec_id).slice(0, 80);
    if (s?.method_id) out.method_id = String(s.method_id).slice(0, 80);
    if (s?.appendix) out.appendix = !!s.appendix;
    if (Array.isArray(s?.fields)) out.fields = sanitizeFields(s.fields);
    return out;
  });
}

// `auto` = computed, non-editable field (e.g. the Cover Lab-activity strip);
// the editor renders it read-only. Must round-trip through persistence or a
// saved deck would silently revert it to an editable paragraph.
const ALLOWED_FIELD_KINDS = new Set(['title', 'subtitle', 'paragraph', 'bullets', 'image', 'metric_grid', 'quote', 'auto']);
function sanitizeFields(input: any[]): any[] {
  // Cap raised from 16 → 32 so per-slide flat-field templates (e.g. the
  // Axal axal_signal slide carries 19 fields after the JSON-blob removal)
  // round-trip cleanly. 32 is still small enough to bound storage.
  return input.slice(0, 32).map((f: any) => {
    const kind = ALLOWED_FIELD_KINDS.has(f?.kind) ? f.kind : 'paragraph';
    const key = String(f?.key || '').slice(0, 64) || 'field';
    const label = String(f?.label || '').slice(0, 80);
    const source = ['data', 'ai', 'placeholder', 'auto'].includes(f?.source) ? f.source : 'data';
    let value: any;
    if (kind === 'bullets') {
      value = Array.isArray(f?.value)
        ? f.value.map((b: any) => String(b).slice(0, 400)).filter(Boolean).slice(0, 16)
        : [];
    } else if (kind === 'metric_grid') {
      // `sub` preserved — Axal cap-table holders encode security+kind in it.
      value = Array.isArray(f?.value)
        ? f.value.slice(0, 16).map((c: any) => {
            const out: any = {
              label: String(c?.label || '').slice(0, 60),
              value: String(c?.value || '').slice(0, 80),
            };
            if (c?.sub != null) out.sub = String(c.sub).slice(0, 120);
            return out;
          })
        : [];
    } else if (kind === 'image') {
      value = f?.value ? sanitizeImageUrl(String(f.value)) : null;
    } else {
      value = String(f?.value || '').slice(0, 4000);
    }
    const out: any = { key, label, kind, value, source };
    if (f?.edited) out.edited = true;
    // Preserve the read-only flag so auto-computed fields stay non-editable
    // after a save/reload round-trip.
    if (f?.readonly) out.readonly = true;
    return out;
  });
}

// Task #16 — SSRF guard. Slide images & watermarks are eventually fed
// into Cloudflare Browser Rendering as <img src=…>. Reject anything but
// https:// and refuse RFC1918 / loopback hostnames so a malicious user
// can't make the headless browser request internal services.
function extractDeckMethodId(row: any): string | null {
  try {
    const arr = JSON.parse(row?.slides || '[]');
    for (const s of arr) {
      if (s && typeof s.method_id === 'string' && s.method_id) return s.method_id;
    }
  } catch {}
  return null;
}

export function sanitizeImageUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (raw.length > 1000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) return null;
  return u.toString();
}

async function projectOwned(env: Env, user: any, projectId: number): Promise<any> {
  const row = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first<any>();
  if (!row) throw new Error('NotFound');
  const role = String(user?.role || '').toLowerCase();
  if (role === 'admin' || role === 'partner' || role === 'investor') return row;
  if (role === 'founder' && user.founder_id && row.founder_id === user.founder_id) return row;
  throw new Error('Forbidden');
}

function rowToDeck(row: any, withSlides = true): any {
  const out: any = {
    id: row.id, project_id: row.project_id, version: row.version,
    title: row.title, is_current: !!row.is_current, created_at: row.created_at,
  };
  if (withSlides) {
    try { out.slides = JSON.parse(row.slides || '[]'); } catch { out.slides = []; }
  }
  return out;
}

async function nextVersion(env: Env, projectId: number): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(MAX(version), 0) AS v FROM pitch_decks WHERE project_id = ?'
  ).bind(projectId).first<any>();
  return (Number(row?.v) || 0) + 1;
}

async function insertVersion(env: Env, projectId: number, slides: any[], title: string, userId: number | null): Promise<number> {
  await env.DB.prepare(
    'UPDATE pitch_decks SET is_current = 0 WHERE project_id = ? AND is_current = 1'
  ).bind(projectId).run();
  const v = await nextVersion(env, projectId);
  const res = await env.DB.prepare(
    `INSERT INTO pitch_decks (project_id, version, slides, title, is_current, created_by)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).bind(projectId, v, JSON.stringify(slides), title, userId).run();
  return Number((res as any)?.meta?.last_row_id || 0);
}

decks.post('/generate', async (c) => {
  // Task #6 — deck generation/save is Growth-tier.
  ensureTier(await requireAuth(c), 'growth');
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const pid = parseInt(body?.project_id);
  if (!pid) return c.json({ error: 'project_id required' }, 400);
  let p: any;
  try {
    await projectOwned(c.env, user, pid);
    p = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(pid).first<any>();
  } catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  const snap = await latestScore(c.env, pid);
  const fallback = heuristicSlides(p, snap);
  const raw = (await aiSlides(c.env, p, snap)) || fallback;
  const aligned = enforceTen(raw, fallback);
  const slides = sanitizeSlides(aligned);
  while (slides.length < 10) slides.push(fallback[slides.length]);
  // Task #6 — inject brand kit from landing page (generic generate = 'off' theme)
  const landingPage = await fetchLandingPageForProject(c.env, pid);
  const brandedSlides = applyBrandKitToSlides(slides, landingPage, 'off', p.name);
  const title = `${p.name} — Pitch deck`;
  const id = await insertVersion(c.env, pid, brandedSlides, title, Number(user.id) || null);
  const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  return c.json(rowToDeck(row));
});

decks.get('/by-project/:pid', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); } catch { return c.json({ error: 'forbidden' }, 403); }
  await ensureSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT id, project_id, version, title, is_current, created_at FROM pitch_decks
     WHERE project_id = ? ORDER BY version DESC`
  ).bind(pid).all<any>();
  return c.json({ versions: ((rows.results ?? []) as any[]).map((r) => rowToDeck(r, false)) });
});

async function getDeckRow(env: Env, id: number): Promise<any> {
  const row = await env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  if (!row) throw new Error('NotFound');
  return row;
}

// ---------------------------------------------------------------------
// Task #2 — public, HMAC-token-gated deck payload for headless export.
// Drives the SPA route /deck/print-export/:token from inside a
// Cloudflare Browser Rendering session (which carries no auth cookies).
// Returns the same JSON shape as deckGet() so the print page's existing
// template-loading code path works unchanged.
// ---------------------------------------------------------------------
decks.get('/print-export/:token', async (c) => {
  const token = c.req.param('token');
  const v = await verifyDeckPrintToken(c.env, token);
  if (!v) return c.json({ error: 'invalid_or_expired_token' }, 403);
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(v.deckId).first<any>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const methodId = extractDeckMethodId(row);
  let projectName: string | null = null;
  try {
    const pr = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(Number(row.project_id)).first<any>();
    if (pr?.name) projectName = String(pr.name).slice(0, 200);
  } catch {}
  return c.json({
    ...rowToDeck(row),
    method_id: methodId,
    project_id: Number(row.project_id) || null,
    project_name: projectName,
  });
});

decks.get('/share/:token', async (c) => {
  const token = c.req.param('token');
  let payload: any;
  try { payload = await verifySignedToken(c.env, token); }
  catch (e: any) {
    // Expired signed tokens are functionally "gone" — return 410 so
    // viewer pages can show a "share link expired" state distinct from
    // an outright invalid signature (which stays 403).
    if (/expired/i.test(String(e?.message || ''))) {
      return c.json({ error: 'share link has expired' }, 410);
    }
    return c.json({ error: e?.message || 'forbidden' }, 403);
  }
  const m = /^deck:(\d+):v(\d+)$/.exec(String(payload?.k || ''));
  if (!m) return c.json({ error: 'bad token scope' }, 400);
  await ensureSchema(c.env);
  // Task #53 — atomic claim against view_limit. Increment view_count
  // only when there is capacity left and the token hasn't expired.
  // D1's meta.changes tells us if THIS request consumed a view slot.
  const h = await sha256Hex(token);
  const claim = await c.env.DB.prepare(
    `UPDATE pitch_deck_share_tokens
        SET view_count = view_count + 1,
            last_viewed_at = datetime('now'),
            used_at = CASE WHEN view_count + 1 >= view_limit THEN datetime('now') ELSE used_at END
      WHERE token_hash = ?
        AND view_count < view_limit
        AND expires_at > datetime('now')`
  ).bind(h).run();
  const changes = Number((claim as any)?.meta?.changes || 0);
  if (changes !== 1) {
    // Distinguish expired/exhausted (410 Gone) from never-existed (403).
    const tokRow = await c.env.DB.prepare(
      `SELECT id, view_count, view_limit, expires_at FROM pitch_deck_share_tokens WHERE token_hash = ?`
    ).bind(h).first<any>();
    if (!tokRow) return c.json({ error: 'share link is invalid' }, 403);
    return c.json({ error: 'share link is no longer valid' }, 410);
  }
  const id = parseInt(m[1]);
  const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'deck not found' }, 404);

  // Log the impression. ip_hash & ua_fingerprint are SHA-256(secret||v)
  // truncated to 16 hex chars — enough to distinguish unique viewers in
  // the Engagement panel without storing raw PII.
  const tokRow = await c.env.DB.prepare(
    `SELECT id FROM pitch_deck_share_tokens WHERE token_hash = ?`
  ).bind(h).first<any>();
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '';
  const ua = c.req.header('user-agent') || '';
  const ipHash = await hashViewerField(c.env, ip || null);
  const uaHash = await hashViewerField(c.env, ua || null);
  let viewId: number | null = null;
  try {
    const ins = await c.env.DB.prepare(
      `INSERT INTO deck_share_views (share_token_id, deck_id, ip_hash, ua_fingerprint, read_seconds)
       VALUES (?, ?, ?, ?, 0)`
    ).bind(Number(tokRow?.id) || 0, id, ipHash, uaHash).run();
    viewId = Number((ins as any)?.meta?.last_row_id || 0) || null;
  } catch {}

  // view_id is returned so the viewer can heartbeat read-time updates.
  // Task #6 — surface method_id + project_id + project_name at the top
  // level so the viewer can route to the right template renderer AND
  // render category-aware CTA copy without a second authed roundtrip.
  // method_id is extracted from the stamped slide blob via the same
  // helper /apply-method writes (and which the frontend already falls
  // back through), so a legacy deck saved before /apply-method (no
  // slide-level method_id) still surfaces null and the viewer renders
  // the generic fallback.
  const methodId = extractDeckMethodId(row);
  let projectName: string | null = null;
  try {
    const pr = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(Number(row.project_id)).first<any>();
    if (pr?.name) projectName = String(pr.name).slice(0, 200);
  } catch {}
  return c.json({
    ...rowToDeck(row),
    view_id: viewId,
    method_id: methodId,
    project_id: Number(row.project_id) || null,
    project_name: projectName,
  });
});

/**
 * POST /api/decks/share/:token/heartbeat — viewer pings read-time so
 * the Engagement panel can show "12 min read". Capped at 2h per view
 * row to prevent runaway counters from a tab left open overnight.
 */
decks.post('/share/:token/heartbeat', async (c) => {
  const token = c.req.param('token');
  let payload: any;
  try { payload = await verifySignedToken(c.env, token); } catch { return c.json({ ok: false }, 200); }
  const m = /^deck:(\d+):v(\d+)$/.exec(String(payload?.k || ''));
  if (!m) return c.json({ ok: false }, 200);
  const body = await c.req.json().catch(() => ({} as any));
  const viewId = parseInt(body?.view_id);
  const seconds = Math.min(7200, Math.max(0, Number(body?.seconds) || 0));
  if (!viewId || !seconds) return c.json({ ok: true });
  await ensureSchema(c.env);
  try {
    await c.env.DB.prepare(
      `UPDATE deck_share_views
          SET read_seconds = MIN(7200, ?),
              updated_at = datetime('now')
        WHERE id = ? AND deck_id = ? AND read_seconds < ?`
    ).bind(seconds, viewId, parseInt(m[1]), seconds).run();
  } catch {}
  return c.json({ ok: true });
});

/**
 * GET /api/decks/:id/engagement — founder-facing roll-up of share-link
 * activity for the Engagement panel. Returns active tokens + per-view
 * impressions (hashed identifiers only) so the founder can answer
 * "did anyone read it?" without leaking IPs.
 */
decks.get('/:id/engagement', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const tokens = await c.env.DB.prepare(
    `SELECT id, expires_at, used_at, view_limit, view_count, last_viewed_at, created_at
       FROM pitch_deck_share_tokens
      WHERE deck_id = ?
      ORDER BY created_at DESC
      LIMIT 50`
  ).bind(id).all<any>();
  const views = await c.env.DB.prepare(
    `SELECT id, share_token_id, ip_hash, ua_fingerprint, read_seconds, created_at, updated_at
       FROM deck_share_views
      WHERE deck_id = ?
      ORDER BY created_at DESC
      LIMIT 200`
  ).bind(id).all<any>();
  const tokRows = (tokens.results || []) as any[];
  const viewRows = (views.results || []) as any[];
  const totalRead = viewRows.reduce((acc, v) => acc + (Number(v.read_seconds) || 0), 0);

  // Task #6 — surface conversion funnel alongside the existing view
  // metrics. We aggregate by type and join the latest conversion per
  // view so the engagement panel can render a per-view badge.
  let convAgg: Record<string, number> = {};
  const convByView = new Map<number, string>();
  try {
    const { ensureDeckShareConversionSchema } = await import('./deck_share_actions');
    await ensureDeckShareConversionSchema(c.env);
    const convRows = await c.env.DB.prepare(
      `SELECT view_id, type, created_at
         FROM deck_share_conversions
        WHERE deck_id = ?
        ORDER BY created_at ASC`
    ).bind(id).all<any>();
    for (const r of (convRows.results || []) as any[]) {
      convAgg[r.type] = (convAgg[r.type] || 0) + 1;
      if (r.view_id) convByView.set(Number(r.view_id), String(r.type));
    }
  } catch (e) {
    console.error('[decks engagement] conversion aggregation failed', (e as Error).message);
  }

  return c.json({
    deck_id: id,
    total_views: viewRows.length,
    total_read_seconds: totalRead,
    last_viewed_at: viewRows[0]?.created_at || null,
    conversions: {
      signups:           convAgg.signup           || 0,
      nda_signed:        convAgg.nda_signed       || 0,
      feedbacks:         convAgg.feedback         || 0,
      deal_pack_opened:  convAgg.deal_pack_opened || 0,
      deals_signed:      convAgg.deal_signed      || 0,
    },
    shares: tokRows.map((t) => ({
      id: t.id,
      created_at: t.created_at,
      expires_at: t.expires_at,
      view_limit: Number(t.view_limit) || 1,
      view_count: Number(t.view_count) || 0,
      last_viewed_at: t.last_viewed_at,
      exhausted: !!t.used_at || (Number(t.view_count) || 0) >= (Number(t.view_limit) || 1),
    })),
    views: viewRows.map((v) => ({
      id: v.id, share_token_id: v.share_token_id,
      ip_hash: v.ip_hash, ua_fingerprint: v.ua_fingerprint,
      read_seconds: Number(v.read_seconds) || 0,
      created_at: v.created_at, updated_at: v.updated_at,
      conversion: convByView.get(Number(v.id)) || null,
    })),
  });
});

decks.get('/:id', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  return c.json(rowToDeck(row));
});

decks.put('/:id', async (c) => {
  // Task #16 — free-tier founders may edit non-premium decks. Premium
  // gating is enforced from TRUSTED state: we look up method_id from the
  // currently-stored deck, not the request body, so a malicious client
  // can't omit/replace the method_id to bypass the paywall.
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const persistedMethod = extractDeckMethodId(row);
  if (persistedMethod && PREMIUM_METHOD_IDS.includes(persistedMethod as any)) {
    try { ensureMethodAllowed(user, persistedMethod, PREMIUM_METHOD_IDS); }
    catch { return c.json({ error: 'paywall', code: 'PAYWALL_PREMIUM_METHOD', method_id: persistedMethod, required_tier: 'growth' }, 402); }
  }
  const body = await c.req.json().catch(() => ({} as any));
  const slides = sanitizeSlides(body?.slides || []);
  // Refuse client-side attempts to escalate a non-premium deck into a
  // premium one via PUT — apply-method is the only way to switch templates.
  for (const s of slides) {
    if (s?.method_id && persistedMethod && s.method_id !== persistedMethod) {
      return c.json({ error: 'method_id may not be changed via PUT — use /apply-method', code: 'METHOD_LOCKED' }, 400);
    }
  }
  if (!slides.length) return c.json({ error: 'slides required' }, 400);
  const title = String(body?.title || row.title || 'Pitch deck').slice(0, 200);

  // Task #2 — Spin-Out Demo Day deck: when the founder edits the
  // Review-the-deal data-room URL or NDA flag inline on the slide,
  // write back to the project columns so the project remains the
  // single source of truth and the next deck version pre-fills. We
  // only touch the project when the slide actually carries a new value
  // (no clobber to null when the field is absent from the payload).
  if (persistedMethod === 'axal_spinout_demoday') {
    try {
      // Slides carry `fields` as an array of {key,value,...} descriptors
      // (see sanitizeFields). Build a key→value lookup across every slide
      // so we don't depend on slide id/spec_id staying stable.
      const fieldByKey: Record<string, any> = {};
      for (const s of slides) {
        if (!Array.isArray((s as any)?.fields)) continue;
        for (const f of (s as any).fields) {
          if (f && typeof f.key === 'string' && !(f.key in fieldByKey)) {
            fieldByKey[f.key] = f.value;
          }
        }
      }
      let nextUrl: string | undefined;
      let nextNda: boolean | undefined;
      const urlVal = fieldByKey['contact_deal_access_url'];
      if (typeof urlVal === 'string') nextUrl = urlVal.trim();
      const ndaVal = fieldByKey['contact_deal_access_nda_required'];
      if (typeof ndaVal === 'boolean') nextNda = ndaVal;
      else if (ndaVal === 0 || ndaVal === 1) nextNda = !!ndaVal;
      else if (ndaVal === 'true' || ndaVal === 'false') nextNda = ndaVal === 'true';
      const daRaw = fieldByKey['contact_deal_access_json'];
      let da: any = daRaw;
      if (typeof daRaw === 'string' && daRaw.trim()) {
        try { da = JSON.parse(daRaw); } catch { da = null; }
      }
      if (da && typeof da === 'object') {
        if (typeof da.deal_room_url === 'string' && nextUrl === undefined) nextUrl = da.deal_room_url.trim();
        if (typeof da.nda_required === 'boolean' && nextNda === undefined) nextNda = da.nda_required;
      }
      if (nextUrl !== undefined || nextNda !== undefined) {
        const { ensureProjectDataRoomColumns } = await import('./projects');
        await ensureProjectDataRoomColumns(c.env);
        const sets: string[] = [];
        const vals: any[] = [];
        if (nextUrl !== undefined) { sets.push('data_room_url = ?'); vals.push(nextUrl || null); }
        if (nextNda !== undefined) { sets.push('data_room_nda_required = ?'); vals.push(nextNda ? 1 : 0); }
        vals.push(Number(row.project_id));
        await c.env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
      }
    } catch (e) {
      // Best-effort: a writeback failure must not block the deck save.
      console.error('[decks PUT] data_room writeback failed', (e as Error).message);
    }
  }

  const newId = await insertVersion(c.env, Number(row.project_id), slides, title, Number(user.id) || null);
  return c.json(rowToDeck(await getDeckRow(c.env, newId)));
});

decks.post('/:id/restore', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  let slides: any[] = [];
  try { slides = sanitizeSlides(JSON.parse(row.slides || '[]')); } catch {}
  const newId = await insertVersion(c.env, Number(row.project_id), slides, row.title, Number(user.id) || null);
  return c.json(rowToDeck(await getDeckRow(c.env, newId)));
});

decks.post('/:id/share', async (c) => {
  ensureTier(await requireAuth(c), 'growth');
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => ({} as any));
  const ttlHours = Math.min(
    24 * 30,
    Math.max(1, Number(body?.expires_in_hours ?? body?.ttl_hours) || 72),
  );
  const ttlSeconds = ttlHours * 3600;
  // Task #53 — accept an optional view_limit (1..100). The spec says
  // links work "exactly once OR up to view_limit"; default stays 1 so
  // pre-Task-53 callers keep their one-time semantics.
  const viewLimit = Math.min(100, Math.max(1, Number(body?.view_limit) || 1));
  const token = await mintSignedToken(c.env, `deck:${id}:v${row.version}`, ttlSeconds, user.email || null);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await c.env.DB.prepare(
    `INSERT INTO pitch_deck_share_tokens (deck_id, token_hash, expires_at, view_limit, view_count, created_by)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).bind(id, await sha256Hex(token), expiresAt, viewLimit, Number(user.id) || null).run();
  return c.json({
    token, expires_in_seconds: ttlSeconds, expires_at: expiresAt,
    view_limit: viewLimit,
    // Canonical share URL per Task #53 spec is /share/deck/<token>; the
    // legacy /deck/share/<token> path is kept as an alias so existing
    // links continue to resolve.
    share_path: `/share/deck/${token}`,
    legacy_share_path: `/deck/share/${token}`,
    one_time: viewLimit === 1,
  });
});

// --- HMAC token + sha helpers (mirror of backend) -----------------------

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function signingKey(env: Env): Promise<CryptoKey> {
  const secret = (env as any).FILE_TOKEN_SECRET || env.JWT_SECRET || '';
  if (!secret) throw new Error('FILE_TOKEN_SECRET (or JWT_SECRET) must be set');
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}
async function mintSignedToken(env: Env, fileKey: string, ttlSeconds: number, actor: string | null): Promise<string> {
  const payload: any = { k: fileKey, exp: Math.floor(Date.now() / 1000) + Math.max(1, ttlSeconds) };
  if (actor) payload.a = actor;
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await signingKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}
export async function verifySignedToken(env: Env, token: string): Promise<any> {
  const idx = token.indexOf('.');
  if (idx <= 0) throw new Error('Malformed token');
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const key = await signingKey(env);
  const expected = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  if (!timingEqual(expected, sig)) throw new Error('Bad signature');
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  if (Number(payload?.exp || 0) < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  if (!payload?.k) throw new Error('Token missing key');
  return payload;
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

// =====================================================================
// Task #16 (DE) — Pitch Deck Builder rewrite endpoints.
// =====================================================================

/** GET /api/decks/methods — list all 12 templates with lock status. */
decks.get('/methods', async (c) => {
  const user = await requireAuth(c);
  const tier = String((user as any).subscription_tier || 'free').toLowerCase();
  const isBypass = ['admin', 'partner', 'investor', 'mentor'].includes(String(user.role));
  const items = DECK_METHODS.map((m) => ({
    id: m.id, key: m.key, label: m.label, prompt_hint: m.prompt_hint,
    best_for: m.best_for, slide_count: m.slide_count, premium: !!m.premium,
    category: m.category, ai_fill_hint: m.ai_fill_hint,
    locked: !!m.premium && !isBypass && !tierCovers(tier, 'growth'),
    fields_from_project: m.fields_from_project,
    fields_from_financials: m.fields_from_financials,
    fields_from_captable: m.fields_from_captable,
    slides: m.slides.map((s) => ({
      id: s.id, title: s.title, appendix: !!s.appendix,
      fields: s.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, optional: !!f.optional })),
    })),
  }));
  const brand = await getDeckBrand(c.env, user as any);
  return c.json({
    methods: items,
    premium_method_ids: PREMIUM_METHOD_IDS,
    user_tier: tier,
    can_remove_footer: brand.can_remove_footer,
    // Capability mirrors server-side enforcement in setStudioWatermark
    // (studio tier required; bypass roles do NOT bypass tier here).
    can_upload_watermark: tierCovers(tier, 'studio'),
    watermark_url: brand.watermark_url,
  });
});

/** GET /api/decks/recommend?project_id=... — suggested method for project. */
decks.get('/recommend', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.query('project_id') || '');
  if (!pid) return c.json({ error: 'project_id required' }, 400);
  let proj: any;
  try {
    await projectOwned(c.env, user, pid);
    proj = await c.env.DB.prepare('SELECT id, name, sector, stage FROM projects WHERE id = ?')
      .bind(pid).first<any>();
  } catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  const rec = await recommendMethod(c.env, proj || {});
  return c.json(rec);
});

/** POST /api/decks/apply-method — autofill the picked template into a new version. */
decks.post('/apply-method', async (c) => {
  const user = await requireAuth(c);
  // Free-tier founders may apply any non-premium template. Premium
  // templates are gated below via ensureMethodAllowed → 402.
  const body = await c.req.json().catch(() => ({} as any));
  const pid = parseInt(body?.project_id);
  const methodId = String(body?.method_id || '').trim();
  if (!pid || !methodId) return c.json({ error: 'project_id and method_id required' }, 400);
  const method = getMethod(methodId);
  if (!method) return c.json({ error: 'unknown method_id' }, 400);
  try {
    ensureMethodAllowed(user, methodId, PREMIUM_METHOD_IDS);
  } catch (e: any) {
    return c.json({
      error: 'paywall', code: 'PAYWALL_PREMIUM_METHOD',
      method_id: methodId, required_tier: 'growth',
      message: 'This template is part of the Growth plan. Upgrade to unlock.',
    }, 402);
  }
  let proj: any;
  try {
    await projectOwned(c.env, user, pid);
    proj = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(pid).first<any>();
  } catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  await ensureProjectAutofillColumns(c.env);

  // Task #15 — Axal Spin-Out Lab demo day uses a custom autofill path.
  // The deck binds 1:1 to Lab tables (spinout_lab_milestones,
  // discovery_interviews, roadmap_okrs, score_snapshots), which don't
  // fit the generic field-source vocabulary in autofill.ts. We build a
  // SpinoutDemoDayData record and persist it as 14 slides, each
  // carrying one JSON-encoded paragraph field per top-level section.
  // The frontend adapter (axal_spinout_demoday_app.tsx) reads those
  // back via buildTemplateData and merges onto its canonical SAMPLE_DATA
  // via mergeShape().
  if (methodId === 'axal_spinout_demoday') {
    const data = await fillAxalSpinoutDemoDay(c.env, Number(user.id), pid);
    const wrapped = buildAxalSpinoutDemoDaySlides(data);
    const safeWrapped = sanitizeSlides(wrapped);
    // Task #6 — inject brand kit for spin-out (accent_only)
    const landingPage = await fetchLandingPageForProject(c.env, pid);
    const branded = applyBrandKitToSlides(safeWrapped, landingPage, method.brandTheme, proj.name);
    const title = `${proj.name} — ${method.label}`;
    const id = await insertVersion(c.env, pid, branded, title, Number(user.id) || null);
    const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
    // No generic coverage metric for the custom path — report 1 when
    // the project has a name + sector, else 0. Keeps the picker's
    // "filled" badge meaningful without lying.
    const coverage = data.meta.project_name !== '—' && data.meta.sector !== '—' ? 1 : 0.5;
    return c.json({
      deck: rowToDeck(row),
      method_id: methodId,
      coverage_pct: coverage,
      // Task #8 — 14-cell per-slide coverage map for the Fill-from-project grid.
      coverage: buildAxalSpinoutCoverage(data),
    });
  }

  // Run autofill, then convert to the editor slide JSON shape stored in
  // pitch_decks.slides. We also stash the method_id + spec_id on each
  // slide so the editor can re-render the right field controls.
  const filled = await autofillDeck(c.env, method, pid);
  const editorSlides = toEditorSlides(method, filled);
  const wrapped = editorSlides.map((s) => ({
    title: s.title,
    subtitle: s.subtitle || null,
    spec_id: s.spec_id,
    appendix: s.appendix,
    method_id: methodId,
    fields: s.fields,
    // Legacy keys kept for backward-compat with the old renderer (share/link
    // pages still using the v1 editor will see something sensible).
    body: s.fields.find((f) => f.kind === 'paragraph')?.value || '',
    bullets: (s.fields.find((f) => f.kind === 'bullets')?.value as any) || [],
    image_url: (s.fields.find((f) => f.kind === 'image')?.value as any) || null,
  }));
  // Task #16 — run sanitizeSlides on the autofilled output too so
  // project-supplied image URLs (logo_url, cover_url, …) get the SSRF
  // guard before they're persisted and later rendered into the
  // headless browser during /export.
  const safeWrapped = sanitizeSlides(wrapped);
  // Task #6 — inject brand kit per the template's theme tier
  const landingPage = await fetchLandingPageForProject(c.env, pid);
  const branded = applyBrandKitToSlides(safeWrapped, landingPage, method.brandTheme, proj.name);
  const title = `${proj.name} — ${method.label}`;
  const id = await insertVersion(c.env, pid, branded, title, Number(user.id) || null);
  const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  return c.json({
    deck: rowToDeck(row),
    method_id: methodId,
    coverage_pct: filled.total_coverage_pct,
  });
});

/**
 * Task #14 — POST /api/decks/:id/autofill
 * Re-runs the auto-fill pipeline against the deck's existing method_id
 * and overwrites the current version's `slides` in place (no new
 * version). Used by the editor's "Fill from project" button.
 *
 * The method_id is read from the first slide's `method_id` stamp that
 * `/apply-method` writes on creation. If the deck was created before
 * the new fielded editor (legacy 10-slide shape), or the stamp is
 * missing, returns 409 with `code:'no_method_id'` so the client can
 * direct the user to pick a template first via `/apply-method`.
 */
decks.post('/:id/autofill', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  if (!id) return c.json({ error: 'id required' }, 400);
  await ensureSchema(c.env);
  await ensureProjectAutofillColumns(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); }
  catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }

  // Extract method_id from the persisted slides. /apply-method stamps
  // it on every slide; we accept any non-empty match.
  let slides: any[] = [];
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = []; }
  const methodId = String(
    slides.find((s) => s && typeof s.method_id === 'string')?.method_id || '',
  ).trim();
  if (!methodId) {
    return c.json({
      error: 'no_method_id',
      code: 'no_method_id',
      message: 'Deck has no template. Pick one via "Apply template" first.',
    }, 409);
  }
  const method = getMethod(methodId);
  if (!method) return c.json({ error: 'unknown_method_id', method_id: methodId }, 400);
  try {
    ensureMethodAllowed(user, methodId, PREMIUM_METHOD_IDS);
  } catch {
    return c.json({
      error: 'paywall', code: 'PAYWALL_PREMIUM_METHOD',
      method_id: methodId, required_tier: 'growth',
    }, 402);
  }

  // Task #15 — custom re-fill path for the Spin-Out Lab demo day deck
  // (mirrors the apply-method branch above so /:id/autofill stays in
  // sync when the founder pushes "Fill from project" after logging more
  // interviews / completing more milestones).
  if (methodId === 'axal_spinout_demoday') {
    const data = await fillAxalSpinoutDemoDay(c.env, Number(user.id), Number(row.project_id));
    const wrapped = buildAxalSpinoutDemoDaySlides(data);
    const safeWrapped = sanitizeSlides(wrapped);
    await c.env.DB.prepare(`UPDATE pitch_decks SET slides = ? WHERE id = ?`)
      .bind(JSON.stringify(safeWrapped), id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
    const coverage = data.meta.project_name !== '—' && data.meta.sector !== '—' ? 1 : 0.5;
    return c.json({
      deck: rowToDeck(fresh),
      method_id: methodId,
      coverage_pct: coverage,
      slide_confidence: safeWrapped.map((s: any, i: number) => ({
        index: i, spec_id: s.spec_id, title: s.title, coverage_pct: coverage,
      })),
      // Task #8 — 14-cell per-slide coverage map for the Fill-from-project grid.
      coverage: buildAxalSpinoutCoverage(data),
    });
  }

  const filled = await autofillDeck(c.env, method, Number(row.project_id));
  const editorSlides = toEditorSlides(method, filled);
  const wrapped = editorSlides.map((s) => ({
    title: s.title,
    subtitle: s.subtitle || null,
    spec_id: s.spec_id,
    appendix: s.appendix,
    method_id: methodId,
    fields: s.fields,
    body: s.fields.find((f) => f.kind === 'paragraph')?.value || '',
    bullets: (s.fields.find((f) => f.kind === 'bullets')?.value as any) || [],
    image_url: (s.fields.find((f) => f.kind === 'image')?.value as any) || null,
  }));
  const safeWrapped = sanitizeSlides(wrapped);
  // Task #6 — re-inject brand kit on re-fill (preserve original method.brandTheme)
  const projectName = String(
    (await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(Number(row.project_id)).first<any>())?.name || ''
  );
  const landingPage = await fetchLandingPageForProject(c.env, Number(row.project_id));
  const branded = applyBrandKitToSlides(safeWrapped, landingPage, method.brandTheme, projectName);
  await c.env.DB.prepare(`UPDATE pitch_decks SET slides = ? WHERE id = ?`)
    .bind(JSON.stringify(branded), id).run();
  const fresh = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  // Per-slide confidence — surfaced in the editor rail. `filled.slides`
  // and `editorSlides` share the same order/length.
  const slide_confidence = filled.slides.map((s, i) => ({
    index: i,
    spec_id: s.spec_id,
    title: s.title,
    coverage_pct: s.coverage_pct,
  }));
  return c.json({
    deck: rowToDeck(fresh),
    method_id: methodId,
    coverage_pct: filled.total_coverage_pct,
    slide_confidence,
  });
});

/**
 * POST /api/decks/:id/export — { format: 'pdf' | 'pptx' } → file bytes.
 *
 * Task #2 rewrite:
 *  - PDF: Browser Rendering navigates to the live React SPA print
 *    template at /deck/print-export/:hmacToken with print_mode=pdf so
 *    every slide renders at native 1920×1080. Matches the in-app
 *    preview investors see.
 *  - PPTX: For each slide, screenshot the same SPA URL with slide=N
 *    (single-slide mode), then embed each PNG full-bleed in the .pptx
 *    via renderDeckPPTXWithImages(). Falls back to the text-only
 *    renderer when BROWSER is unavailable so dev still gets a download.
 *  - PNG cover removed end-to-end (UI + handler + validator).
 */
decks.post('/:id/export', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => ({} as any));
  const format = String(body?.format || 'pdf').toLowerCase();
  if (!['pdf', 'pptx'].includes(format)) {
    return c.json({ error: 'format must be pdf | pptx' }, 400);
  }
  let slides: any[] = [];
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = []; }
  // Re-sanitize persisted slides (defence-in-depth against legacy rows
  // pre-dating sanitizeImageUrl) before they reach Browser Rendering.
  slides = sanitizeSlides(slides);
  const renderable: RenderableDeck = {
    title: row.title || 'Pitch deck',
    project_name: row.title || '',
    slides: slides.map((s: any) => {
      if (Array.isArray(s.fields)) {
        return { title: s.title, subtitle: s.subtitle, appendix: !!s.appendix, fields: s.fields };
      }
      const fields: any[] = [];
      if (s.title) fields.push({ key: 'title', label: 'Title', kind: 'title', value: s.title });
      if (s.subtitle) fields.push({ key: 'sub', label: 'Subtitle', kind: 'subtitle', value: s.subtitle });
      if (s.body) fields.push({ key: 'body', label: 'Body', kind: 'paragraph', value: s.body });
      if (Array.isArray(s.bullets) && s.bullets.length) {
        fields.push({ key: 'bullets', label: 'Bullets', kind: 'bullets', value: s.bullets });
      }
      if (s.image_url) fields.push({ key: 'img', label: 'Image', kind: 'image', value: s.image_url });
      return { title: s.title || 'Slide', subtitle: s.subtitle, appendix: false, fields };
    }),
  };
  const brand = await getDeckBrand(c.env, user as any);
  const fname = (row.title || 'pitch-deck').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 80);

  const browser = (c.env as any).BROWSER;
  const browserAvailable = !!browser?.fetch;

  // Public base URL the headless browser will hit. The worker serves
  // the SPA assets at /deck/print-export/:token on both axal.vc and
  // app.axal.vc — pick the configured canonical host.
  const publicBase = stripTrailingSlashes(
    (c.env as any).PUBLIC_BASE_URL || (c.env as any).APP_URL || 'https://axal.vc'
  );

  if (format === 'pdf') {
    if (!browserAvailable) {
      // Dev / unprovisioned env — let the client fall back to its
      // existing html2canvas + jsPDF pipeline.
      return c.json({
        error: 'browser_binding_unavailable',
        message: 'Server-side PDF export requires Cloudflare Browser Rendering. Use the client print fallback.',
        fallback: 'client_render',
      }, 503);
    }
    const token = await signDeckPrintToken(c.env, id, 180);
    const url = `${publicBase}/deck/print-export/${token}?print_mode=pdf`;
    let r: Response;
    try {
      r = await browser.fetch('https://browser/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
          gotoOptions: { waitUntil: 'networkidle0', timeout: 45000 },
          addStyleTag: [{
            content: '@page { size: 1920px 1080px; margin: 0; } html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }',
          }],
          printOptions: {
            printBackground: true,
            preferCSSPageSize: true,
            width: '1920px',
            height: '1080px',
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
          },
        }),
      });
    } catch (e) {
      console.error('[decks/export] pdf browser fetch threw:', (e as Error).message);
      return c.json({ error: 'pdf_render_failed', message: (e as Error).message }, 502);
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('[decks/export] pdf render failed:', r.status, text.slice(0, 200));
      return c.json({ error: 'pdf_render_failed', status: r.status, detail: text.slice(0, 240) }, 502);
    }
    const bytes = await r.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fname}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // -------------------- PPTX --------------------
  if (!browserAvailable) {
    // No headless browser — fall back to the legacy text-only writer
    // so a download still works in dev. Production always has the
    // BROWSER binding.
    const bytes = renderDeckPPTX(renderable, brand);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${fname}.pptx"`,
        'Cache-Control': 'no-store',
        'X-Deck-Export-Mode': 'text-only-fallback',
      },
    });
  }

  // Browser Rendering available — capture one full-bleed PNG per slide
  // by navigating the SPA print template with slide=N. 5-minute TTL
  // comfortably covers the longest deck (60-slide cap).
  const token = await signDeckPrintToken(c.env, id, 300);
  const slideCount = renderable.slides.length;
  const images: Uint8Array[] = [];
  for (let i = 0; i < slideCount; i++) {
    const slideUrl = `${publicBase}/deck/print-export/${token}?print_mode=single&slide=${i}`;
    let r: Response;
    try {
      r = await browser.fetch('https://browser/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: slideUrl,
          viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
          gotoOptions: { waitUntil: 'networkidle0', timeout: 45000 },
          screenshotOptions: { type: 'png', omitBackground: false, fullPage: false },
        }),
      });
    } catch (e) {
      console.error('[decks/export] pptx screenshot threw slide', i, (e as Error).message);
      return c.json({ error: 'pptx_render_failed', slide: i, message: (e as Error).message }, 502);
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('[decks/export] pptx screenshot failed slide', i, r.status, text.slice(0, 200));
      return c.json({ error: 'pptx_render_failed', slide: i, status: r.status, detail: text.slice(0, 240) }, 502);
    }
    images.push(new Uint8Array(await r.arrayBuffer()));
  }
  const bytes = renderDeckPPTXWithImages(renderable, brand, images);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fname}.pptx"`,
      'Cache-Control': 'no-store',
    },
  });
});

// --- Branding endpoints (Studio tier custom watermark) ---------------

decks.get('/brand', async (c) => {
  const user = await requireAuth(c);
  const brand = await getDeckBrand(c.env, user as any);
  return c.json({ brand });
});

decks.put('/brand/watermark', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  try {
    await setStudioWatermark(c.env, user as any, body?.watermark_url ?? null);
  } catch (e: any) {
    if (e?.message === 'STUDIO_TIER_REQUIRED') {
      return c.json({ error: 'studio_tier_required', required_tier: 'studio' }, 402);
    }
    if (e?.message === 'INVALID_WATERMARK_URL') {
      return c.json({ error: 'watermark_url must be https URL ≤1000 chars' }, 400);
    }
    return c.json({ error: 'failed' }, 500);
  }
  const brand = await getDeckBrand(c.env, user as any);
  return c.json({ brand });
});

// --- Admin overrides for the recommendation engine -------------------

decks.get('/admin/recommend-overrides', async (c) => {
  const user = await requireAuth(c);
  if (String(user.role) !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const overrides = await listOverrides(c.env);
  return c.json({ overrides });
});

decks.put('/admin/recommend-overrides', async (c) => {
  const user = await requireAuth(c);
  if (String(user.role) !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json().catch(() => ({} as any));
  const sector = String(body?.sector || '').trim();
  const stage = String(body?.stage || '').trim();
  const methodId = String(body?.method_id || '').trim();
  if (!sector || !stage || !methodId) return c.json({ error: 'sector, stage, method_id required' }, 400);
  if (!getMethod(methodId)) return c.json({ error: 'unknown method_id' }, 400);
  await setOverride(c.env, sector, stage, methodId, Number(user.id) || null);
  const overrides = await listOverrides(c.env);
  return c.json({ overrides });
});

decks.delete('/admin/recommend-overrides', async (c) => {
  const user = await requireAuth(c);
  if (String(user.role) !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const sector = c.req.query('sector') || '';
  const stage = c.req.query('stage') || '';
  if (!sector || !stage) return c.json({ error: 'sector + stage query required' }, 400);
  await deleteOverride(c.env, sector, stage);
  const overrides = await listOverrides(c.env);
  return c.json({ overrides });
});

export default decks;

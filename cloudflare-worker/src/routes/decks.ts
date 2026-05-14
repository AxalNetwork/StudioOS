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
  DECK_METHODS, DECK_METHODS_BY_ID, PREMIUM_METHOD_IDS, getMethod,
} from '../services/decks/methods';
import { autofillDeck, toEditorSlides } from '../services/decks/autofill';
import { recommendMethod, listOverrides, setOverride, deleteOverride } from '../services/decks/recommend';
import { getDeckBrand, setStudioWatermark, ensureMethodAllowed } from '../services/decks/branding';
import { renderDeckHTML, type RenderableDeck } from '../services/decks/render';
import { renderDeckPPTX } from '../services/decks/pptx';

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
       created_by INTEGER,
       created_at TEXT DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_deck_share_hash ON pitch_deck_share_tokens(token_hash)`,
  ];
  for (const s of stmts) {
    try { await env.DB.prepare(s).run(); } catch (e: any) { console.error('decks schema:', e?.message); }
  }
  _migrated = true;
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
  const name = p.name || 'Untitled';
  const sector = p.sector || 'your sector';
  const problem = (p.problem_statement || '').trim() || `Founders in ${sector} lack a fast way to ship and scale.`;
  const solution = (p.solution || '').trim() || (p.description || `${name} delivers an integrated platform for ${sector}.`);
  const whyNow = (p.why_now || '').trim() || 'Recent shifts in tooling and demand make this the right moment.';
  const tam = fmtMoney(p.tam);
  const sam = fmtMoney(p.sam);
  const users = Number(p.users_count || 0);
  const revenue = fmtMoney(p.revenue);
  const funding = fmtMoney(p.funding_needed);
  const useOf = (p.use_of_funds || 'Product, GTM, key hires.').trim();
  const scoreLine = snap ? `Internal score: ${Math.round(Number(snap.total_score) * 10) / 10}/100 (${snap.tier}).` : '';
  const marketLine = snap ? `Market scoring: ${Math.round(Number(snap.market_total) * 10) / 10} (urgency + trend signal).` : '';
  const arr = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x);

  return [
    { title: 'Problem', subtitle: name, body: problem, bullets: arr([whyNow]), image_url: null },
    { title: 'Solution', subtitle: name, body: solution, bullets: [], image_url: null },
    { title: 'Market', subtitle: sector, body: '', bullets: arr([
      tam ? `TAM: ${tam}` : 'TAM: large and growing',
      sam ? `SAM: ${sam}` : 'SAM: clearly addressable',
      whyNow, marketLine,
    ]), image_url: null },
    { title: 'Traction', subtitle: "What's working", body: '', bullets: arr([
      users > 0 ? `${users.toLocaleString()} users` : 'Early design partners engaged',
      revenue ? `${revenue} revenue` : 'Pre-revenue, pilots in motion',
      p.growth_signals || 'Strong week-over-week engagement signals.',
      scoreLine,
    ]), image_url: null },
    { title: 'Business model', subtitle: 'How we make money', body: '', bullets: [
      'Subscription / usage tier (to be locked in this quarter).',
      'Gross margin trending toward 70%+ at scale.',
    ], image_url: null },
    { title: 'Go-to-market', subtitle: 'Channels & motion', body: '', bullets: [
      'Founder-led sales into design partners → outbound + community.',
      'Distribution: integrations, referrals, content.',
    ], image_url: null },
    { title: 'Competition', subtitle: 'Landscape', body: '', bullets: [
      'Incumbents are slow and unbundled.',
      'Our wedge: speed-to-value + integrated workflow.',
    ], image_url: null },
    { title: 'Team', subtitle: 'Why us', body: '', bullets: [
      'Founders with domain + execution track record.',
      'Hiring plan: 2-3 senior ICs in the next 6 months.',
    ], image_url: null },
    { title: 'Ask', subtitle: 'Round', body: '', bullets: arr([
      funding ? `Raising ${funding}` : 'Raising a focused pre-seed/seed round',
      '18-24 months of runway to hit the next milestone.',
      useOf,
    ]), image_url: null },
    { title: 'Financials', subtitle: 'Plan', body: '', bullets: arr([
      'Year 1: get to repeatable revenue motion.',
      'Year 2: scale GTM, expand product surface.',
      funding ? `Burn target reflecting ${funding} raise.` : 'Disciplined burn, default-alive plan.',
    ]), image_url: null },
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

function sanitizeSlides(input: any[]): any[] {
  return (input || []).slice(0, 20).map((s: any) => {
    const title = String((s?.title || '') as string).trim().slice(0, 120) || 'Slide';
    const sub = s?.subtitle ? String(s.subtitle).trim().slice(0, 200) : null;
    const body = s?.body ? String(s.body).trim().slice(0, 4000) : '';
    const bullets = Array.isArray(s?.bullets)
      ? s.bullets.map((b: any) => String(b).trim().slice(0, 400)).filter((b: string) => !!b).slice(0, 6)
      : [];
    let image_url: string | null = null;
    if (s?.image_url && typeof s.image_url === 'string') {
      const u = s.image_url.trim();
      if (/^https?:\/\//i.test(u)) image_url = u.slice(0, 1000);
    }
    return { title, subtitle: sub, body, bullets, image_url };
  });
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
  const title = `${p.name} — Pitch deck`;
  const id = await insertVersion(c.env, pid, slides, title, Number(user.id) || null);
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

decks.get('/share/:token', async (c) => {
  const token = c.req.param('token');
  let payload: any;
  try { payload = await verifySignedToken(c.env, token); }
  catch (e: any) { return c.json({ error: e?.message || 'forbidden' }, 403); }
  const m = /^deck:(\d+):v(\d+)$/.exec(String(payload?.k || ''));
  if (!m) return c.json({ error: 'bad token scope' }, 400);
  await ensureSchema(c.env);
  // Atomic single-use claim. D1 returns meta.changes for the affected
  // row count, so we know whether THIS request consumed the token.
  const h = await sha256Hex(token);
  const claim = await c.env.DB.prepare(
    `UPDATE pitch_deck_share_tokens SET used_at = datetime('now')
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`
  ).bind(h).run();
  const changes = Number((claim as any)?.meta?.changes || 0);
  if (changes !== 1) return c.json({ error: 'share link is no longer valid' }, 403);
  const id = parseInt(m[1]);
  const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  if (!row) return c.json({ error: 'deck not found' }, 404);
  return c.json(rowToDeck(row));
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
  ensureTier(await requireAuth(c), 'growth');
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => ({} as any));
  const slides = sanitizeSlides(body?.slides || []);
  if (!slides.length) return c.json({ error: 'slides required' }, 400);
  const title = String(body?.title || row.title || 'Pitch deck').slice(0, 200);
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
  const ttlHours = Math.min(24 * 30, Math.max(1, Number(body?.ttl_hours) || 72));
  const ttlSeconds = ttlHours * 3600;
  const token = await mintSignedToken(c.env, `deck:${id}:v${row.version}`, ttlSeconds, user.email || null);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await c.env.DB.prepare(
    `INSERT INTO pitch_deck_share_tokens (deck_id, token_hash, expires_at, created_by)
     VALUES (?, ?, ?, ?)`
  ).bind(id, await sha256Hex(token), expiresAt, Number(user.id) || null).run();
  return c.json({
    token, expires_in_seconds: ttlSeconds, expires_at: expiresAt,
    share_path: `/deck/share/${token}`, one_time: true,
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
async function verifySignedToken(env: Env, token: string): Promise<any> {
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
    can_upload_watermark: tierCovers(tier, 'studio') || isBypass,
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
  ensureTier(user, 'growth');
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
  const title = `${proj.name} — ${method.label}`;
  const id = await insertVersion(c.env, pid, wrapped, title, Number(user.id) || null);
  const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  return c.json({
    deck: rowToDeck(row),
    method_id: methodId,
    coverage_pct: filled.total_coverage_pct,
  });
});

/** POST /api/decks/:id/export — { format: 'pdf' | 'pptx' | 'png' } → file bytes. */
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
  if (!['pdf', 'pptx', 'png'].includes(format)) {
    return c.json({ error: 'format must be pdf | pptx | png' }, 400);
  }
  let slides: any[] = [];
  try { slides = JSON.parse(row.slides || '[]'); } catch { slides = []; }
  // Adapt either the new fielded shape or the legacy {title, body, bullets,
  // image_url} shape to RenderableSlide.
  const renderable: RenderableDeck = {
    title: row.title || 'Pitch deck',
    project_name: row.title || '',
    slides: slides.map((s: any) => {
      if (Array.isArray(s.fields)) {
        return { title: s.title, subtitle: s.subtitle, appendix: !!s.appendix, fields: s.fields };
      }
      // Legacy shape → synthesise fields.
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

  if (format === 'pptx') {
    const bytes = renderDeckPPTX(renderable, brand);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${fname}.pptx"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // pdf + png both go via Cloudflare Browser Rendering.
  const html = renderDeckHTML(renderable, brand);
  const browser = (c.env as any).BROWSER;
  if (!browser?.fetch) {
    // Browser binding missing (dev) — return HTML so the client can do
    // its existing client-side PDF flow as a fallback.
    return c.json({
      error: 'browser_binding_unavailable',
      fallback: 'client_render',
      html,
    }, 503);
  }
  if (format === 'pdf') {
    const r = await browser.fetch('https://browser.rendering/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html, viewport: { width: 1280, height: 720 },
        pdfOptions: { printBackground: true, format: 'Letter', landscape: true },
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('[decks/export] pdf render failed:', r.status, text.slice(0, 200));
      return c.json({ error: 'pdf_render_failed', status: r.status }, 502);
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
  // png — first slide thumbnail.
  const firstHtml = renderDeckHTML({ ...renderable, slides: renderable.slides.slice(0, 1) }, brand);
  const r = await browser.fetch('https://browser.rendering/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html: firstHtml,
      viewport: { width: 1280, height: 720 },
      screenshotOptions: { type: 'png', omitBackground: false },
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.error('[decks/export] png render failed:', r.status, text.slice(0, 200));
    return c.json({ error: 'png_render_failed', status: r.status }, 502);
  }
  const bytes = await r.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${fname}-thumb.png"`,
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

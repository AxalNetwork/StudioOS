/**
 * Task #25 — Pitch deck builder (Worker).
 *
 * Mirrors backend/app/api/routes/decks.py. Decks are versioned: every PUT
 * inserts a new row marked is_current=1 and demotes the previous version,
 * so older versions remain restorable.
 *
 * Public share URLs use HMAC-signed tokens scoped to `deck:<id>:v<version>`
 * so a leaked token can only read the specific version it was issued for.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';

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

function heuristicSlides(p: any): any[] {
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

  const arr = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => !!x);
  return [
    { title: 'Problem', subtitle: name, bullets: arr([problem, whyNow]) },
    { title: 'Solution', subtitle: name, bullets: arr([solution]) },
    { title: 'Market', subtitle: sector, bullets: arr([
      tam ? `TAM: ${tam}` : 'TAM: large and growing',
      sam ? `SAM: ${sam}` : 'SAM: clearly addressable',
      whyNow,
    ]) },
    { title: 'Traction', subtitle: "What's working", bullets: arr([
      users > 0 ? `${users.toLocaleString()} users` : 'Early design partners engaged',
      revenue ? `${revenue} revenue` : 'Pre-revenue, pilots in motion',
      p.growth_signals || 'Strong week-over-week engagement signals.',
    ]) },
    { title: 'Business model', subtitle: 'How we make money', bullets: [
      'Subscription / usage tier (to be locked in this quarter).',
      'Gross margin trending toward 70%+ at scale.',
    ] },
    { title: 'Go-to-market', subtitle: 'Channels & motion', bullets: [
      'Founder-led sales into design partners → outbound + community.',
      'Distribution: integrations, referrals, content.',
    ] },
    { title: 'Competition', subtitle: 'Landscape', bullets: [
      'Incumbents are slow and unbundled.',
      'Our wedge: speed-to-value + integrated workflow.',
    ] },
    { title: 'Team', subtitle: 'Why us', bullets: [
      'Founders with domain + execution track record.',
      'Hiring plan: 2-3 senior ICs in the next 6 months.',
    ] },
    { title: 'Ask', subtitle: 'Round', bullets: arr([
      funding ? `Raising ${funding}` : 'Raising a focused pre-seed/seed round',
      '18-24 months of runway to hit the next milestone.',
      useOf,
    ]) },
    { title: 'Financials', subtitle: 'Plan', bullets: arr([
      'Year 1: get to repeatable revenue motion.',
      'Year 2: scale GTM, expand product surface.',
      funding ? `Burn target reflecting ${funding} raise.` : 'Disciplined burn, default-alive plan.',
    ]) },
  ];
}

async function aiSlides(env: Env, p: any): Promise<any[] | null> {
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
    };
    const prompt = `Draft a 10-slide pitch deck for the following startup. Return ONLY valid JSON of the shape:
{"slides":[{"title":"...","subtitle":"...","bullets":["...","..."]}, ...]}
Use exactly these slide titles in order: ${JSON.stringify(SLIDE_TITLES)}.
Each slide should have 2-4 punchy bullets (no more than 18 words each).
Startup data: ${JSON.stringify(ctx)}`;
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a senior VC associate drafting concise pitch decks. Always return valid JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5, max_tokens: 1400,
        response_format: { type: 'json_object' },
      }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    const parsed = JSON.parse(j?.choices?.[0]?.message?.content || '{}');
    const slides = Array.isArray(parsed?.slides) ? parsed.slides : null;
    return slides && slides.length >= 5 ? slides.slice(0, 10) : null;
  } catch { return null; }
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

function sanitizeSlides(input: any[]): any[] {
  return (input || []).slice(0, 20).map((s: any) => {
    const title = String((s?.title || '') as string).trim().slice(0, 120) || 'Slide';
    const sub = s?.subtitle ? String(s.subtitle).trim().slice(0, 200) : null;
    const bullets = Array.isArray(s?.bullets)
      ? s.bullets.map((b: any) => String(b).trim().slice(0, 400)).filter((b: string) => !!b).slice(0, 6)
      : [];
    return { title, subtitle: sub, bullets };
  });
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
  // D1 returns last_row_id in meta.
  return Number((res as any)?.meta?.last_row_id || 0);
}

decks.post('/generate', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const pid = parseInt(body?.project_id);
  if (!pid) return c.json({ error: 'project_id required' }, 400);
  let p: any;
  try {
    p = await projectOwned(c.env, user, pid);
    p = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(pid).first<any>();
  } catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  const slides = sanitizeSlides((await aiSlides(c.env, p)) || heuristicSlides(p));
  const title = `${p.name} — Pitch deck`;
  const id = await insertVersion(c.env, pid, slides, title, Number(user.id) || null);
  const row = await c.env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  return c.json(rowToDeck(row));
});

decks.get('/by-project/:pid', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) { return c.json({ error: 'forbidden' }, 403); }
  await ensureSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT id, project_id, version, title, is_current, created_at FROM pitch_decks
     WHERE project_id = ? ORDER BY version DESC`
  ).bind(pid).all<any>();
  const list = ((rows.results ?? []) as any[]).map((r) => rowToDeck(r, false));
  return c.json({ versions: list });
});

async function getDeckRow(env: Env, id: number): Promise<any> {
  const row = await env.DB.prepare('SELECT * FROM pitch_decks WHERE id = ?').bind(id).first<any>();
  if (!row) throw new Error('NotFound');
  return row;
}

decks.get('/share/:token', async (c) => {
  // Public — verify HMAC token, then return the bound deck.
  const token = c.req.param('token');
  let payload: any;
  try { payload = await verifySignedToken(c.env, token); }
  catch (e: any) { return c.json({ error: e?.message || 'forbidden' }, 403); }
  const m = /^deck:(\d+):v(\d+)$/.exec(String(payload?.k || ''));
  if (!m) return c.json({ error: 'bad token scope' }, 400);
  await ensureSchema(c.env);
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
  const newRow = await getDeckRow(c.env, newId);
  return c.json(rowToDeck(newRow));
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
  try { slides = JSON.parse(row.slides || '[]'); } catch {}
  const newId = await insertVersion(c.env, Number(row.project_id), slides, row.title, Number(user.id) || null);
  return c.json(rowToDeck(await getDeckRow(c.env, newId)));
});

decks.post('/:id/share', async (c) => {
  const user = await requireAuth(c);
  const id = parseInt(c.req.param('id'));
  await ensureSchema(c.env);
  let row: any;
  try { row = await getDeckRow(c.env, id); } catch { return c.json({ error: 'not found' }, 404); }
  try { await projectOwned(c.env, user, Number(row.project_id)); }
  catch { return c.json({ error: 'forbidden' }, 403); }
  const body = await c.req.json().catch(() => ({} as any));
  const ttlHours = Math.min(24 * 30, Math.max(1, Number(body?.ttl_hours) || 72));
  const token = await mintSignedToken(c.env, `deck:${id}:v${row.version}`, ttlHours * 3600, user.email || null);
  return c.json({ token, expires_in_seconds: ttlHours * 3600, share_path: `/deck/share/${token}` });
});

// --- HMAC token helpers (mirror of backend file_storage helpers) ---------
// Kept local to this module to avoid widening the worker auth surface.

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

export default decks;

/**
 * Task #24 — Brand & landing page generator (Worker).
 *
 * Mirrors backend/app/api/routes/brand.py and additionally serves the
 * public landing HTML at /landing/:slug. The HTML route is registered
 * separately at the index.ts root, not inside this Hono router, so it
 * lives outside /api/*.
 *
 *   POST /api/brand/suggest                         AI brand suggestions
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
import { requireAuth } from '../auth';
import { run as aiRouterRun } from '../services/aiRouter';

const brand = new Hono<{ Bindings: Env }>();

let _migrated = false;
async function ensureSchema(env: Env): Promise<void> {
  if (_migrated) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS landing_pages (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
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
       palette_bg TEXT,
       palette_ink TEXT,
       font_pairing TEXT,
       published INTEGER DEFAULT 0,
       views_count INTEGER DEFAULT 0,
       created_at TEXT DEFAULT (datetime('now')),
       updated_at TEXT DEFAULT (datetime('now'))
     )`,
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
function sanitizeSvg(svg: string | null | undefined): string | null {
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

function svgLogo(name: string, color = '#7c3aed'): string {
  const initial = (name || 'A').trim().slice(0, 1).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">`
    + `<circle cx="50" cy="50" r="46" fill="${color}"/>`
    + `<text x="50" y="62" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="44" font-weight="700" fill="#fff">${initial}</text>`
    + `</svg>`;
}

function heuristicBrand(description: string, sector: string | null): any[] {
  const seeds = ['Lumen', 'Axon', 'Forge', 'Vela', 'Quanta', 'Helio', 'Nimbus', 'Stratus', 'Orbit', 'Beacon'];
  const suffixes = ['AI', 'Labs', 'Works', 'Cloud', 'Stack', 'OS', 'Sense', 'Engine'];
  // Tiny rolling hash — deterministic per description so re-runs return
  // the same suggestions when the AI path is unavailable.
  let h = 0;
  for (const ch of description || 'x') h = (h * 31 + ch.charCodeAt(0)) | 0;
  h = Math.abs(h);
  const tags = [
    `${(sector || 'AI').trim()} that just works.`,
    `The fastest way to ship ${sector || 'your idea'}.`,
    `${sector || 'Software'} for the next billion users.`,
    `Built for founders who move fast.`,
    `Less ops, more outcomes.`,
  ];
  return Array.from({ length: 5 }, (_, i) => {
    const a = seeds[(h + i * 7) % seeds.length];
    const b = suffixes[(h + i * 11) % suffixes.length];
    return {
      name: `${a}${b}`,
      tagline: tags[i],
      logo_prompt: `minimalist geometric logo, ${a.toLowerCase()} mark, violet and white, vector, flat`,
    };
  });
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

// Brand name/tagline suggestions via Workers AI (routed through aiRouter so
// per-user budget checks, model fallback, and usage logging all apply).
// Returns null on any failure/refusal so the caller falls back to the
// deterministic heuristic.
async function aiBrand(env: Env, userId: number, description: string, sector: string | null): Promise<any[] | null> {
  try {
    const systemPrompt = 'You are a concise brand strategist. Always return ONLY valid minified JSON, no prose, no markdown fences.';
    const userPrompt = `Help a startup founder pick a brand. Sector: ${sector || 'unspecified'}.\nIdea: ${description.trim()}\n\nReturn JSON of the exact form: {"suggestions":[{"name":"","tagline":"","logo_prompt":""}]}\nRules: exactly 5 suggestions; name 1-3 words; tagline <=8 words; logo_prompt is a short text-to-image prompt for a minimalist vector logo.`;
    const res = await aiRouterRun(env, {
      task: 'brand_suggest',
      userId: userId || 0,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.8,
      maxTokens: 500,
    });
    if (!res.ok || !res.output) return null;
    const parsed = extractJsonObject(res.output);
    const sug = Array.isArray(parsed?.suggestions) ? parsed.suggestions : null;
    if (!sug) return null;
    // Normalise + guard each entry so a partial model response can't break
    // the UI; drop anything missing a name.
    const clean = sug
      .map((s: any) => ({
        name: String(s?.name || '').trim().slice(0, 60),
        tagline: String(s?.tagline || '').trim().slice(0, 120),
        logo_prompt: String(s?.logo_prompt || '').trim().slice(0, 200)
          || `minimalist geometric logo, ${String(s?.name || 'brand').toLowerCase()} mark, violet and white, vector, flat`,
      }))
      .filter((s: any) => s.name.length > 0);
    return clean.length ? clean.slice(0, 5) : null;
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

function rowToLanding(row: any) {
  return {
    id: row.id,
    project_id: row.project_id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    headline: row.headline,
    subheadline: row.subheadline,
    cta_text: row.cta_text || 'Join the waitlist',
    logo_url: row.logo_url,
    logo_svg: row.logo_svg,
    theme_color: row.theme_color || '#7c3aed',
    palette_bg: row.palette_bg || null,
    palette_ink: row.palette_ink || null,
    font_pairing: row.font_pairing || null,
    published: !!row.published,
    views_count: row.views_count || 0,
  };
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT_PAIRING_IDS = new Set(['editorial', 'modern', 'humanist', 'classic']);
const cleanHex = (v: unknown): string | null =>
  (typeof v === 'string' && HEX_RE.test(v.trim())) ? v.trim().toLowerCase() : null;
const cleanFontPairing = (v: unknown): string | null =>
  (typeof v === 'string' && FONT_PAIRING_IDS.has(v.trim())) ? v.trim() : null;

brand.post('/suggest', async (c) => {
  const user = await requireAuth(c);
  const body = await c.req.json().catch(() => ({} as any));
  const description = String(body?.description || '').trim();
  if (description.length < 4) return c.json({ error: 'description too short' }, 400);
  const sector = body?.sector ? String(body.sector) : null;
  const ai = await aiBrand(c.env, user.id, description, sector);
  if (ai) return c.json({ suggestions: ai, ai_generated: true });
  return c.json({ suggestions: heuristicBrand(description, sector), ai_generated: false });
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

brand.get('/landing/by-project/:pid', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) {
    if (e?.message === 'NotFound') return c.json({ error: 'not found' }, 404);
    return c.json({ error: 'forbidden' }, 403);
  }
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE project_id = ?').bind(pid).first<any>();
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
  const existing = await c.env.DB.prepare('SELECT id, slug FROM landing_pages WHERE project_id = ?').bind(pid).first<any>();
  const cta = String(body?.cta_text || 'Join the waitlist');
  const color = String(body?.theme_color || '#7c3aed');
  const paletteBg = cleanHex(body?.palette_bg);
  const paletteInk = cleanHex(body?.palette_ink);
  const fontPairing = cleanFontPairing(body?.font_pairing);
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE landing_pages SET name=?, tagline=?, headline=?, subheadline=?, cta_text=?,
       logo_url=?, logo_svg=?, theme_color=?, palette_bg=?, palette_ink=?, font_pairing=?,
       updated_at=datetime('now') WHERE project_id=?`
    ).bind(
      name, body?.tagline || null, body?.headline || null, body?.subheadline || null, cta,
      body?.logo_url || null, sanitizeSvg(body?.logo_svg) || null, color,
      paletteBg, paletteInk, fontPairing, pid,
    ).run();
  } else {
    const slug = slugify(name);
    await c.env.DB.prepare(
      `INSERT INTO landing_pages (project_id, slug, name, tagline, headline, subheadline, cta_text,
       logo_url, logo_svg, theme_color, palette_bg, palette_ink, font_pairing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      pid, slug, name, body?.tagline || null, body?.headline || null, body?.subheadline || null, cta,
      body?.logo_url || null, sanitizeSvg(body?.logo_svg) || null, color,
      paletteBg, paletteInk, fontPairing,
    ).run();
  }
  const row = await c.env.DB.prepare('SELECT * FROM landing_pages WHERE project_id = ?').bind(pid).first<any>();
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
  await c.env.DB.prepare(
    `UPDATE landing_pages SET published=?, updated_at=datetime('now') WHERE project_id=?`
  ).bind(flag, pid).run();
  return c.json({ ok: true, published: !!flag });
});

brand.get('/landing/by-project/:pid/waitlist', async (c) => {
  const user = await requireAuth(c);
  const pid = parseInt(c.req.param('pid'));
  try { await projectOwned(c.env, user, pid); }
  catch (e: any) { return c.json({ error: 'forbidden' }, 403); }
  await ensureSchema(c.env);
  const rows = await c.env.DB.prepare(
    `SELECT id, email, name, source, created_at FROM waitlist_signups WHERE project_id = ? ORDER BY created_at DESC LIMIT 500`
  ).bind(pid).all<any>();
  const list = (rows.results ?? []) as any[];
  return c.json({ signups: list, count: list.length });
});

brand.get('/landing/:slug', async (c) => {
  await ensureSchema(c.env);
  const row = await c.env.DB.prepare(
    `SELECT * FROM landing_pages WHERE slug = ? AND published = 1`
  ).bind(c.req.param('slug')).first<any>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(rowToLanding(row));
});

brand.post('/landing/:slug/waitlist', async (c) => {
  await ensureSchema(c.env);
  const slug = c.req.param('slug');
  const body = await c.req.json().catch(() => ({} as any));
  const email = String(body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'invalid email' }, 400);
  const lp = await c.env.DB.prepare(
    `SELECT id, project_id FROM landing_pages WHERE slug = ? AND published = 1`
  ).bind(slug).first<any>();
  if (!lp) return c.json({ error: 'landing page not found' }, 404);
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('x-forwarded-for') || '';
  let ipHash: string | null = null;
  if (ip) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    ipHash = Array.from(new Uint8Array(buf)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  await c.env.DB.prepare(
    `INSERT INTO waitlist_signups (project_id, landing_page_id, email, name, source, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(lp.project_id, lp.id, email, body?.name || null, body?.source || 'landing', ipHash).run();
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

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export async function renderLandingHtml(env: Env, slug: string): Promise<Response> {
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

  const name = escapeHtml(row.name);
  const headline = escapeHtml(row.headline || row.tagline || row.name);
  const sub = escapeHtml(row.subheadline || row.tagline || '');
  const cta = escapeHtml(row.cta_text || 'Join the waitlist');
  const color = /^#[0-9a-fA-F]{6}$/.test(row.theme_color || '') ? row.theme_color : '#7c3aed';
  const logoMarkup = row.logo_url
    ? `<img src="${escapeHtml(row.logo_url)}" alt="${name}" style="width:96px;height:96px;border-radius:24px;object-fit:cover" />`
    : (row.logo_svg || svgLogo(row.name, color));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}</title>
<meta name="description" content="${sub}" />
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif; background: #fafafa; color: #0f172a; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 64px 24px 96px; text-align: center; }
  .logo { display:flex; justify-content:center; margin-bottom: 28px; }
  h1 { font-size: clamp(32px, 5vw, 52px); margin: 0 0 12px; line-height: 1.1; letter-spacing: -0.02em; }
  p.sub { font-size: 18px; color: #475569; margin: 0 0 36px; }
  form { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; max-width: 480px; margin: 0 auto; }
  input { flex:1 1 240px; padding: 12px 14px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 15px; outline:none; }
  input:focus { border-color: ${color}; box-shadow: 0 0 0 3px ${color}22; }
  button { padding: 12px 18px; background: ${color}; color: #fff; border: 0; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: not-allowed; }
  .ok, .err { margin-top: 16px; font-size: 14px; }
  .ok { color: #059669; }
  .err { color: #dc2626; }
  footer { margin-top: 64px; font-size: 12px; color: #94a3b8; }
  footer a { color: inherit; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">${logoMarkup}</div>
    <h1>${headline}</h1>
    ${sub ? `<p class="sub">${sub}</p>` : ''}
    <form id="wl">
      <input type="email" name="email" placeholder="you@email.com" required />
      <button type="submit">${cta}</button>
    </form>
    <div id="msg"></div>
    <footer>Built with <a href="https://axal.vc" rel="noopener">Axal VC</a></footer>
  </div>
<script>
(function(){
  var f=document.getElementById('wl'),m=document.getElementById('msg');
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var email=f.email.value.trim(); if(!email) return;
    var btn=f.querySelector('button'); btn.disabled=true;
    fetch('/api/brand/landing/${encodeURIComponent(slug)}/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,source:'landing'})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})})
      .then(function(x){
        if(x.ok){ m.className='ok'; m.textContent="You're on the list. We'll be in touch."; f.reset(); }
        else { m.className='err'; m.textContent=(x.j&&x.j.error)||'Something went wrong.'; }
      })
      .catch(function(){ m.className='err'; m.textContent='Network error. Please try again.'; })
      .finally(function(){ btn.disabled=false; });
  });
})();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Robots-Tag': 'index, follow',
    },
  });
}

export default brand;

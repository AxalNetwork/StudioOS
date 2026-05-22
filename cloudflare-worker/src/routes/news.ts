/**
 * Task #2 — Public + author-facing news endpoints.
 *
 * Mounted at /api/news. Trust gate (>=70) enforced server-side on every
 * write — never trust client claim.
 *
 *   Public (no auth, CORS for axal.vc, 60-day edge cache):
 *     GET    /                — published list (?limit&offset&sector&tag)
 *     GET    /:slug           — published article body+html
 *     GET    /cover/:id       — published cover image (R2)
 *
 *   Author (auth + trust>=70):
 *     GET    /mine            — caller's drafts/articles
 *     POST   /draft           — create draft
 *     GET    /draft/:id       — load own draft
 *     PUT    /:id             — update own draft (forbidden once published)
 *     POST   /:id/submit      — submit for review (rate-limited 3/week)
 *     POST   /:id/retract     — pull back to draft (only when submitted/changes_requested)
 *     POST   /:id/cover       — upload cover (data URI, 5MB)
 *     GET    /:id/comments    — review comments on own article
 *     GET    /trust/me        — current trust score breakdown
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';
import {
  ensureNewsSchema,
  NEWS_STATUSES,
  SUBMISSIONS_PER_WEEK,
  TRUST_AUTHOR_MIN,
} from '../services/newsSchema';
import { canAuthor, computeAuthorTrust } from '../services/newsTrust';
import { lintForSend } from '../services/telegramRedactCheck';
import { notifyNews } from '../services/newsNotify';
import { renderMarkdown, slugify, snapshotRevision, wordsAndMinutes } from '../services/newsRender';

const news = new Hono<{ Bindings: Env }>();

// Public endpoints accept CORS from the Jekyll marketing site on axal.vc.
news.use('/', cors({ origin: ['https://axal.vc', 'https://www.axal.vc'], credentials: false }));
news.use('/:slug', cors({ origin: ['https://axal.vc', 'https://www.axal.vc'], credentials: false }));
news.use('/cover/:id', cors({ origin: ['https://axal.vc', 'https://www.axal.vc'], credentials: false }));

const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const CACHE_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function publicArticleShape(row: any) {
  let tags: string[] = [];
  if (row.tags) {
    try { tags = JSON.parse(row.tags) || []; } catch { tags = []; }
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    sector: row.sector,
    tags,
    cover_url: row.cover_r2_key ? `/api/news/cover/${row.id}` : null,
    published_at: row.published_at,
    word_count: row.word_count,
    read_minutes: row.read_minutes,
    author: row.author_name || null,
  };
}

function authorArticleShape(row: any) {
  let tags: string[] = [];
  if (row.tags) {
    try { tags = JSON.parse(row.tags) || []; } catch { tags = []; }
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    body_markdown: row.body_markdown,
    sector: row.sector,
    tags,
    status: row.status,
    cover_url: row.cover_r2_key ? `/api/news/cover/${row.id}` : null,
    submitted_at: row.submitted_at,
    reviewed_at: row.reviewed_at,
    approved_at: row.approved_at,
    published_at: row.published_at,
    rejected_at: row.rejected_at,
    rejection_reason: row.rejection_reason,
    word_count: row.word_count,
    read_minutes: row.read_minutes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// PUBLIC
// ---------------------------------------------------------------------------

async function cacheLookup(c: any): Promise<Response | null> {
  try {
    const cache = (caches as any).default;
    if (!cache) return null;
    const hit = await cache.match(c.req.raw);
    return hit || null;
  } catch { return null; }
}

async function cachePut(c: any, body: any): Promise<Response> {
  const res = new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
    },
  });
  try {
    const cache = (caches as any).default;
    if (cache) await cache.put(c.req.raw, res.clone());
  } catch { /* swallow */ }
  return res;
}

news.get('/', async (c) => {
  await ensureNewsSchema(c.env);
  const cached = await cacheLookup(c);
  if (cached) return cached;
  const url = new URL(c.req.url);
  const limit = clampLimit(url.searchParams.get('limit'), 20, 100);
  const offset = parseOffset(url.searchParams.get('offset'));
  const sector = url.searchParams.get('sector');
  const tag = url.searchParams.get('tag');
  const where: string[] = ["a.status = 'published'"];
  const bind: any[] = [];
  if (sector) { where.push('a.sector = ?'); bind.push(sector); }
  if (tag) { where.push('a.tags LIKE ?'); bind.push(`%"${tag}"%`); }
  const sql = `SELECT a.id, a.slug, a.title, a.subtitle, a.sector, a.tags,
                      a.cover_r2_key, a.published_at, a.word_count, a.read_minutes,
                      u.name AS author_name
                 FROM articles a
                 LEFT JOIN users u ON u.id = a.author_user_id
                WHERE ${where.join(' AND ')}
             ORDER BY a.published_at DESC
                LIMIT ? OFFSET ?`;
  bind.push(limit, offset);
  const res = await c.env.DB.prepare(sql).bind(...bind).all<any>();
  const items = (res.results || []).map(publicArticleShape);
  // Count for paging (best-effort).
  const cnt: any = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM articles WHERE status='published'`,
  ).first();
  return cachePut(c, { items, total: cnt?.c ?? items.length, limit, offset });
});

news.get('/cover/:id', async (c) => {
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid' }, 400);
  const row: any = await c.env.DB.prepare(
    `SELECT cover_r2_key, cover_mime, status FROM articles WHERE id = ? LIMIT 1`,
  ).bind(id).first();
  if (!row || row.status !== 'published' || !row.cover_r2_key) return c.json({ error: 'not_found' }, 404);
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const obj = await c.env.FILES.get(row.cover_r2_key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': row.cover_mime || 'application/octet-stream',
      'cache-control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
    },
  });
});

news.get('/:slug', async (c) => {
  // Must NOT clash with /mine, /draft, /trust, etc. — those handlers are
  // registered AFTER this one would be in route definition order, so we
  // explicitly bail when slug looks like a known reserved path.
  const slug = c.req.param('slug');
  if (['mine', 'draft', 'trust', 'cover'].includes(slug)) return c.json({ error: 'not_found' }, 404);
  await ensureNewsSchema(c.env);
  const cached = await cacheLookup(c);
  if (cached) return cached;
  const row: any = await c.env.DB.prepare(
    `SELECT a.*, u.name AS author_name
       FROM articles a LEFT JOIN users u ON u.id = a.author_user_id
      WHERE a.slug = ? AND a.status = 'published' LIMIT 1`,
  ).bind(slug).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const html = row.body_html || renderMarkdown(row.body_markdown || '');
  const body = {
    ...publicArticleShape(row),
    body_html: html,
    body_markdown: row.body_markdown,
  };
  return cachePut(c, body);
});

// ---------------------------------------------------------------------------
// AUTHOR (auth required)
// ---------------------------------------------------------------------------

news.get('/trust/me', async (c) => {
  const user = await requireAuth(c);
  const { score, signals } = await computeAuthorTrust(c.env, user.id);
  return c.json({ score, signals, min_required: TRUST_AUTHOR_MIN });
});

news.get('/mine', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const url = new URL(c.req.url);
  const limit = clampLimit(url.searchParams.get('limit'), 50, 100);
  const offset = parseOffset(url.searchParams.get('offset'));
  const res = await c.env.DB.prepare(
    `SELECT * FROM articles WHERE author_user_id = ?
     ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).bind(user.id, limit, offset).all<any>();
  return c.json({ items: (res.results || []).map(authorArticleShape) });
});

news.get('/draft/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid' }, 400);
  const row: any = await c.env.DB.prepare(
    `SELECT * FROM articles WHERE id = ? LIMIT 1`,
  ).bind(id).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.author_user_id !== user.id && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  // Comments visible once admin starts review.
  const cmts = await c.env.DB.prepare(
    `SELECT c.id, c.author_id, c.body, c.anchor, c.resolved_at, c.created_at,
            u.name AS author_name, u.role AS author_role
       FROM article_review_comments c
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.article_id = ? ORDER BY c.created_at`,
  ).bind(id).all<any>();
  return c.json({ article: authorArticleShape(row), comments: cmts.results || [] });
});

news.post('/draft', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  if (!(await canAuthor(c.env, user.id))) {
    return c.json({ error: 'trust_too_low', min_required: TRUST_AUTHOR_MIN }, 403);
  }
  const body: any = await c.req.json().catch(() => ({}));
  const title = String(body.title || 'Untitled draft').slice(0, 280).trim() || 'Untitled draft';
  const subtitle = body.subtitle ? String(body.subtitle).slice(0, 500) : null;
  const md = String(body.body_markdown || '').slice(0, 200_000);
  const sector = body.sector ? String(body.sector).slice(0, 64) : null;
  const tags = Array.isArray(body.tags) ? body.tags.slice(0, 8).map((t: any) => String(t).slice(0, 40)) : [];
  const wm = wordsAndMinutes(md);
  // Slug uniqueness: append -2/-3 on collision.
  const baseSlug = slugify(title);
  let slug = baseSlug;
  for (let i = 1; i < 10; i++) {
    const exists: any = await c.env.DB.prepare(`SELECT id FROM articles WHERE slug = ?`).bind(slug).first();
    if (!exists) break;
    slug = `${baseSlug}-${i + 1}`;
  }
  const ins: any = await c.env.DB.prepare(
    `INSERT INTO articles (slug, title, subtitle, body_markdown, sector, tags, status,
                           author_user_id, word_count, read_minutes)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).bind(slug, title, subtitle, md, sector, JSON.stringify(tags), user.id, wm.words, wm.minutes).run();
  const id = Number(ins?.meta?.last_row_id);
  await snapshotRevision(c.env, id, user.id, 'manual');
  const row: any = await c.env.DB.prepare(`SELECT * FROM articles WHERE id = ?`).bind(id).first();
  return c.json({ article: authorArticleShape(row) }, 201);
});

async function loadOwned(env: Env, id: number, userId: number, role: string): Promise<any | null> {
  const row: any = await env.DB.prepare(`SELECT * FROM articles WHERE id = ? LIMIT 1`).bind(id).first();
  if (!row) return null;
  if (row.author_user_id !== userId && role !== 'admin') return null;
  return row;
}

news.put('/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const row = await loadOwned(c.env, id, user.id, user.role);
  if (!row) return c.json({ error: 'not_found_or_forbidden' }, 404);
  if (row.status === 'published') return c.json({ error: 'already_published' }, 409);
  if (row.status === 'in_review') return c.json({ error: 'locked_for_review' }, 409);
  const body: any = await c.req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  if (typeof body.title === 'string') patch.title = body.title.slice(0, 280).trim();
  if (typeof body.subtitle === 'string') patch.subtitle = body.subtitle.slice(0, 500);
  if (typeof body.body_markdown === 'string') patch.body_markdown = body.body_markdown.slice(0, 200_000);
  if (typeof body.sector === 'string') patch.sector = body.sector.slice(0, 64);
  if (Array.isArray(body.tags)) patch.tags = JSON.stringify(body.tags.slice(0, 8).map((t: any) => String(t).slice(0, 40)));
  if (Object.keys(patch).length === 0) return c.json({ error: 'no_changes' }, 400);
  // Recompute word/read counts when body changed.
  if (patch.body_markdown !== undefined) {
    const wm = wordsAndMinutes(patch.body_markdown);
    patch.word_count = wm.words;
    patch.read_minutes = wm.minutes;
  }
  // If we're moving from changes_requested → draft on first edit, flip status.
  if (row.status === 'changes_requested') patch.status = 'draft';
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  const binds = [...Object.values(patch), new Date().toISOString(), id];
  await c.env.DB.prepare(`UPDATE articles SET ${sets}, updated_at = ? WHERE id = ?`).bind(...binds).run();
  const updated: any = await c.env.DB.prepare(`SELECT * FROM articles WHERE id = ?`).bind(id).first();
  return c.json({ article: authorArticleShape(updated) });
});

news.post('/:id/submit', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const row = await loadOwned(c.env, id, user.id, user.role);
  if (!row) return c.json({ error: 'not_found_or_forbidden' }, 404);
  if (!(await canAuthor(c.env, user.id))) {
    return c.json({ error: 'trust_too_low', min_required: TRUST_AUTHOR_MIN }, 403);
  }
  if (!['draft', 'changes_requested', 'rejected'].includes(row.status)) {
    return c.json({ error: 'invalid_status', status: row.status }, 409);
  }
  if (!row.title || !String(row.title).trim()) return c.json({ error: 'title_required' }, 400);
  if (!row.body_markdown || String(row.body_markdown).trim().length < 200) {
    return c.json({ error: 'body_too_short', min_chars: 200 }, 400);
  }
  // Weekly rate limit: 3/week/author.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cnt: any = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM article_submission_log WHERE author_id = ? AND submitted_at >= ?`,
  ).bind(user.id, weekAgo).first();
  if ((cnt?.c ?? 0) >= SUBMISSIONS_PER_WEEK) {
    return c.json({ error: 'rate_limited', per_week: SUBMISSIONS_PER_WEEK }, 429);
  }
  // PII linter: block on high-severity findings.
  const lint = await lintForSend(c.env, String(row.body_markdown), 'public');
  if (!lint.ok) {
    const blocking = lint.findings.filter((f) => f.severity === 'high');
    if (blocking.length > 0) {
      return c.json({ error: 'pii_blocked', findings: blocking }, 422);
    }
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE articles SET status='submitted', submitted_at=?, updated_at=? WHERE id = ?`,
  ).bind(now, now, id).run();
  await c.env.DB.prepare(
    `INSERT INTO article_submission_log (author_id, article_id) VALUES (?, ?)`,
  ).bind(user.id, id).run();
  await snapshotRevision(c.env, id, user.id, 'submit');
  await notifyNews(c.env, 'author_submitted', { articleId: id, slug: row.slug, title: row.title, authorUserId: user.id });
  await notifyNews(c.env, 'admin_submitted', { articleId: id, slug: row.slug, title: row.title, authorUserId: user.id });
  const updated: any = await c.env.DB.prepare(`SELECT * FROM articles WHERE id = ?`).bind(id).first();
  return c.json({ article: authorArticleShape(updated) });
});

news.post('/:id/retract', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const row = await loadOwned(c.env, id, user.id, user.role);
  if (!row) return c.json({ error: 'not_found_or_forbidden' }, 404);
  if (!['submitted', 'changes_requested'].includes(row.status)) {
    return c.json({ error: 'invalid_status', status: row.status }, 409);
  }
  await c.env.DB.prepare(
    `UPDATE articles SET status='draft', updated_at = ? WHERE id = ?`,
  ).bind(new Date().toISOString(), id).run();
  return c.json({ ok: true });
});

news.post('/:id/cover', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const row = await loadOwned(c.env, id, user.id, user.role);
  if (!row) return c.json({ error: 'not_found_or_forbidden' }, 404);
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const body: any = await c.req.json().catch(() => ({}));
  const dataUri = String(body.data_uri || '');
  const m = dataUri.match(/^data:([\w/+\-.]+);base64,(.+)$/);
  if (!m) return c.json({ error: 'invalid_data_uri' }, 400);
  const mime = m[1].toLowerCase();
  const ext = COVER_MIME[mime];
  if (!ext) return c.json({ error: 'unsupported_mime' }, 400);
  const bytes = bytesFromBase64(m[2]);
  if (bytes.byteLength > MAX_COVER_BYTES) return c.json({ error: 'too_large', max: MAX_COVER_BYTES }, 413);
  const uuid = crypto.randomUUID();
  const key = `news/${id}/cover-${uuid}.${ext}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
  // Replace old cover if any.
  if (row.cover_r2_key && row.cover_r2_key.startsWith('news/')) {
    try { await c.env.FILES.delete(row.cover_r2_key); } catch (e) { console.warn('[news] old cover delete failed', e); }
  }
  await c.env.DB.prepare(
    `UPDATE articles SET cover_r2_key = ?, cover_mime = ?, updated_at = ? WHERE id = ?`,
  ).bind(key, mime, new Date().toISOString(), id).run();
  return c.json({ ok: true, cover_url: `/api/news/cover/${id}` });
});

export default news;

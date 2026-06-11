/**
 * Task #1 — Public + author-facing /api/articles.
 *
 * Shares the `articles` / `article_revisions` / `article_review_comments`
 * tables with the (legacy) /api/news surface — same lazy schema bootstrap
 * via `ensureNewsSchema`. The differences vs /api/news:
 *
 *   - Role-aware listing: `?role=founder|investor|mentor|partner|admin`
 *   - Per-author endpoint for profile tabs: `GET /by-author/:user_id`
 *   - Sector taxonomy endpoint: `GET /sectors` (single source of truth)
 *   - Cover served at `/api/articles/cover/:id` (alongside legacy
 *     /api/news/cover/:id which still works for back-compat).
 *   - Public list shape includes `author_user_id` + `author_handle` so the
 *     FE can deep-link from cards into public profiles.
 *
 * Public reads are CORS-open for the Jekyll marketing site and edge-cached
 * for 60 days; author writes are open to any authenticated user (Task #9)
 * but still pass the same PII linter + weekly rate cap as /api/news.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../types';
import { requireAuth, getCurrentUser } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';
import {
  ensureNewsSchema,
  SUBMISSIONS_PER_WEEK,
  TRUST_AUTHOR_MIN,
} from '../services/newsSchema';
import { ensureAuthorWebsites } from '../services/authorWebsites';
import { ensureArticleCovers } from '../services/articleCovers';
import { computeAuthorTrust } from '../services/newsTrust';
import { lintForSend } from '../services/telegramRedactCheck';
import { notifyArticle } from '../services/articleNotify';
import { renderMarkdown, slugify, snapshotRevision, wordsAndMinutes } from '../services/newsRender';
import { SECTORS, isValidSector } from '../data/sectors';

const articles = new Hono<{ Bindings: Env }>();

// Public endpoints accept CORS from the Jekyll marketing site on axal.vc.
articles.use('/', cors({ origin: ['https://axal.vc', 'https://www.axal.vc'], credentials: false }));
articles.use('/sectors', cors({ origin: ['https://axal.vc', 'https://www.axal.vc'], credentials: false }));
articles.use('/by-author/:user_id', cors({ origin: ['https://axal.vc', 'https://www.axal.vc'], credentials: false }));
articles.use('/cover/:id', cors({ origin: ['https://axal.vc', 'https://www.axal.vc'], credentials: false }));
articles.use('/:slug', cors({ origin: ['https://axal.vc', 'https://www.axal.vc'], credentials: false }));

const MAX_COVER_BYTES = 5 * 1024 * 1024;
const COVER_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
// Short TTL on the public list — variants are unbounded (sector × role ×
// search × pagination × featured) and we can't enumerate every key for
// purge. 5 minutes is the longest a freshly-published or unpublished
// article should ever be stale. Slug + cover endpoints can stay long
// because we purge those exactly by key in bustArticleEdgeCache.
const CACHE_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days (slug + cover only)
const LIST_CACHE_TTL_SECONDS = 5 * 60;       // 5 minutes
const VALID_AUTHOR_ROLES = new Set(['admin', 'founder', 'investor', 'partner', 'mentor', 'coach']);

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
    cover_url: row.cover_r2_key ? `/api/articles/cover/${row.id}` : null,
    published_at: row.published_at,
    word_count: row.word_count,
    read_minutes: row.read_minutes,
    author: row.author_name || null,
    author_user_id: row.author_user_id ?? null,
    author_handle: row.author_handle ?? null,
    author_role: row.author_role ?? null,
    author_website: row.author_website ?? null,
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
    cover_url: row.cover_r2_key ? `/api/articles/cover/${row.id}` : null,
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

async function cacheLookup(c: any): Promise<Response | null> {
  try {
    const cache = (caches as any).default;
    if (!cache) return null;
    const hit = await cache.match(c.req.raw);
    return hit || null;
  } catch { return null; }
}

async function cachePut(c: any, body: any, ttl: number = CACHE_TTL_SECONDS): Promise<Response> {
  const res = new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=${ttl}, s-maxage=${ttl}`,
    },
  });
  try {
    const cache = (caches as any).default;
    if (cache) await cache.put(c.req.raw, res.clone());
  } catch { /* swallow */ }
  return res;
}

// ---------------------------------------------------------------------------
// PUBLIC
// ---------------------------------------------------------------------------

articles.get('/sectors', async (c) => {
  return c.json({ sectors: SECTORS });
});

articles.get('/', async (c) => {
  await ensureNewsSchema(c.env);
  await ensureAuthorWebsites(c.env);
  const seededCover = await ensureArticleCovers(c.env);
  const cached = seededCover ? null : await cacheLookup(c);
  if (cached) return cached;
  const url = new URL(c.req.url);
  const limit = clampLimit(url.searchParams.get('limit'), 20, 100);
  const offset = parseOffset(url.searchParams.get('offset'));
  const sector = url.searchParams.get('sector');
  const tag = url.searchParams.get('tag');
  const role = url.searchParams.get('role');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
  const featured = url.searchParams.get('featured') === '1';

  const where: string[] = ["a.status = 'published'"];
  const bind: any[] = [];
  if (sector) { where.push('a.sector = ?'); bind.push(sector); }
  if (tag) { where.push('a.tags LIKE ?'); bind.push(`%"${tag}"%`); }
  if (role && VALID_AUTHOR_ROLES.has(role)) { where.push('u.role = ?'); bind.push(role); }
  if (q) {
    // Lightweight LIKE-based search on title/subtitle. D1 has no FTS by
    // default; this is good enough for the volume we expect on the
    // public feed. Escapes %/_ to avoid wildcard injection.
    const safe = q.replace(/[\\%_]/g, (m) => `\\${m}`);
    where.push('(a.title LIKE ? ESCAPE \'\\\' OR a.subtitle LIKE ? ESCAPE \'\\\')');
    bind.push(`%${safe}%`, `%${safe}%`);
  }

  // Featured strip: editorial picks bubble up via a `featured` tag — any
  // article tagged "featured" by an admin reviewer wins the slot. Falls
  // back to most-recent if none exist so the strip never goes empty.
  const order = featured ? 'CASE WHEN a.tags LIKE \'%"featured"%\' THEN 0 ELSE 1 END, a.published_at DESC'
                          : 'a.published_at DESC';
  const sql = `SELECT a.id, a.slug, a.title, a.subtitle, a.sector, a.tags,
                      a.cover_r2_key, a.published_at, a.word_count, a.read_minutes,
                      a.author_user_id,
                      u.name AS author_name, NULL AS author_handle, u.role AS author_role,
                      aw.website_url AS author_website
                 FROM articles a
                 LEFT JOIN users u ON u.id = a.author_user_id
                 LEFT JOIN author_websites aw ON aw.user_id = a.author_user_id
                WHERE ${where.join(' AND ')}
             ORDER BY ${order}
                LIMIT ? OFFSET ?`;
  bind.push(limit, offset);
  const res = await c.env.DB.prepare(sql).bind(...bind).all<any>();
  const items = (res.results || []).map(publicArticleShape);
  // Total count must honour the same WHERE clause so pagination math
  // matches what the user actually sees on the page.
  const countSql = `SELECT COUNT(*) AS c FROM articles a LEFT JOIN users u ON u.id = a.author_user_id WHERE ${where.join(' AND ')}`;
  const cnt: any = await c.env.DB.prepare(countSql).bind(...bind.slice(0, -2)).first();
  return cachePut(c, { items, total: cnt?.c ?? items.length, limit, offset }, LIST_CACHE_TTL_SECONDS);
});

articles.get('/by-author/:user_id', async (c) => {
  await ensureNewsSchema(c.env);
  await ensureAuthorWebsites(c.env);
  await ensureArticleCovers(c.env);
  const userId = Number(c.req.param('user_id'));
  if (!Number.isInteger(userId) || userId <= 0) return c.json({ error: 'invalid' }, 400);
  const url = new URL(c.req.url);
  const limit = clampLimit(url.searchParams.get('limit'), 20, 100);
  const offset = parseOffset(url.searchParams.get('offset'));
  const res = await c.env.DB.prepare(
    `SELECT a.id, a.slug, a.title, a.subtitle, a.sector, a.tags,
            a.cover_r2_key, a.published_at, a.word_count, a.read_minutes,
            a.author_user_id,
            u.name AS author_name, NULL AS author_handle, u.role AS author_role,
            aw.website_url AS author_website
       FROM articles a
       LEFT JOIN users u ON u.id = a.author_user_id
       LEFT JOIN author_websites aw ON aw.user_id = a.author_user_id
      WHERE a.author_user_id = ? AND a.status = 'published'
      ORDER BY a.published_at DESC
      LIMIT ? OFFSET ?`,
  ).bind(userId, limit, offset).all<any>();
  const items = (res.results || []).map(publicArticleShape);
  return c.json({ items, limit, offset });
});

articles.get('/cover/:id', async (c) => {
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid' }, 400);
  const row: any = await c.env.DB.prepare(
    `SELECT cover_r2_key, cover_mime, status, author_user_id FROM articles WHERE id = ? LIMIT 1`,
  ).bind(id).first();
  if (!row || !row.cover_r2_key) return c.json({ error: 'not_found' }, 404);
  // Published covers are public and long-cached. Unpublished covers (draft /
  // submitted / in_review / changes_requested / rejected) are private: only the
  // author or an admin may view them, so the editor preview survives a hard
  // refresh without leaking unpublished art to the public. A same-origin <img>
  // can't send a Bearer header, so this authenticates via the studioos_auth
  // cookie; these responses are never cached.
  let cacheControl = `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`;
  if (row.status !== 'published') {
    const user = await getCurrentUser(c).catch(() => null);
    if (!user || (row.author_user_id !== user.id && user.role !== 'admin')) {
      return c.json({ error: 'not_found' }, 404);
    }
    cacheControl = 'private, no-store';
  }
  if (!c.env.FILES) return c.json({ error: 'r2_unavailable' }, 503);
  const obj = await c.env.FILES.get(row.cover_r2_key);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': row.cover_mime || 'application/octet-stream',
      'cache-control': cacheControl,
    },
  });
});

articles.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  // Reserved sub-paths handled by their own routes above must not be
  // shadowed by the slug catch-all.
  if (['mine', 'draft', 'trust', 'cover', 'sectors', 'by-author'].includes(slug)) {
    return c.json({ error: 'not_found' }, 404);
  }
  await ensureNewsSchema(c.env);
  await ensureAuthorWebsites(c.env);
  const seededCover = await ensureArticleCovers(c.env);
  const cached = seededCover ? null : await cacheLookup(c);
  if (cached) return cached;
  const row: any = await c.env.DB.prepare(
    `SELECT a.*, u.name AS author_name, NULL AS author_handle, u.role AS author_role,
            aw.website_url AS author_website
       FROM articles a
       LEFT JOIN users u ON u.id = a.author_user_id
       LEFT JOIN author_websites aw ON aw.user_id = a.author_user_id
      WHERE a.slug = ? AND a.status = 'published' LIMIT 1`,
  ).bind(slug).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  // Re-render from the markdown source on read rather than trusting a stored
  // `body_html`: older rows were rendered before the renderer learned about
  // headings/lists, so their cached HTML leaks raw `##` markup. Markdown is
  // the source of truth; fall back to stored HTML only when markdown is empty.
  const html = row.body_markdown ? renderMarkdown(row.body_markdown) : (row.body_html || '');
  // Best-effort refresh of the stored HTML so non-reader consumers and the
  // fallback path also get the corrected markup. Fire-and-forget — never
  // blocks or fails the read.
  if (html && html !== row.body_html) {
    c.executionCtx?.waitUntil?.(
      c.env.DB.prepare(`UPDATE articles SET body_html = ? WHERE id = ?`)
        .bind(html, row.id).run().catch(() => {}),
    );
  }
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

articles.get('/trust/me', async (c) => {
  const user = await requireAuth(c);
  const { score, signals } = await computeAuthorTrust(c.env, user.id);
  return c.json({ score, signals, min_required: TRUST_AUTHOR_MIN });
});

articles.get('/mine', async (c) => {
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

articles.get('/draft/:id', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid' }, 400);
  const row: any = await c.env.DB.prepare(
    `SELECT * FROM articles WHERE id = ? LIMIT 1`,
  ).bind(id).first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.author_user_id !== user.id && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  const cmts = await c.env.DB.prepare(
    `SELECT c.id, c.author_id, c.body, c.anchor, c.resolved_at, c.created_at,
            u.name AS author_name, u.role AS author_role
       FROM article_review_comments c
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.article_id = ? ORDER BY c.created_at`,
  ).bind(id).all<any>();
  return c.json({ article: authorArticleShape(row), comments: cmts.results || [] });
});

articles.post('/draft', async (c) => {
  // Task #9 — authoring is open to any authenticated user. The trust-score
  // gate was removed; the PII linter + weekly submission cap on /submit stay.
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const title = String(body.title || 'Untitled draft').slice(0, 280).trim() || 'Untitled draft';
  const subtitle = body.subtitle ? String(body.subtitle).slice(0, 500) : null;
  const md = String(body.body_markdown || '').slice(0, 200_000);
  let sector: string | null = body.sector ? String(body.sector).slice(0, 64) : null;
  if (sector && !isValidSector(sector)) sector = null;
  const tags = Array.isArray(body.tags)
    ? body.tags.slice(0, 8).map((t: any) => String(t).slice(0, 40))
    : [];
  const wm = wordsAndMinutes(md);
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

articles.put('/:id', async (c) => {
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
  if (typeof body.sector === 'string') {
    const s = body.sector.slice(0, 64);
    patch.sector = isValidSector(s) ? s : null;
  }
  if (Array.isArray(body.tags)) patch.tags = JSON.stringify(body.tags.slice(0, 8).map((t: any) => String(t).slice(0, 40)));
  if (Object.keys(patch).length === 0) return c.json({ error: 'no_changes' }, 400);
  if (patch.body_markdown !== undefined) {
    const wm = wordsAndMinutes(patch.body_markdown);
    patch.word_count = wm.words;
    patch.read_minutes = wm.minutes;
  }
  if (row.status === 'changes_requested') patch.status = 'draft';
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  const binds = [...Object.values(patch), new Date().toISOString(), id];
  await c.env.DB.prepare(`UPDATE articles SET ${sets}, updated_at = ? WHERE id = ?`).bind(...binds).run();
  const updated: any = await c.env.DB.prepare(`SELECT * FROM articles WHERE id = ?`).bind(id).first();
  return c.json({ article: authorArticleShape(updated) });
});

articles.post('/:id/submit', async (c) => {
  const user = await requireAuth(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const row = await loadOwned(c.env, id, user.id, user.role);
  if (!row) return c.json({ error: 'not_found_or_forbidden' }, 404);
  if (!['draft', 'changes_requested', 'rejected'].includes(row.status)) {
    return c.json({ error: 'invalid_status', status: row.status }, 409);
  }
  if (!row.title || !String(row.title).trim()) return c.json({ error: 'title_required' }, 400);
  if (!row.body_markdown || String(row.body_markdown).trim().length < 200) {
    return c.json({ error: 'body_too_short', min_chars: 200 }, 400);
  }
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cnt: any = await c.env.DB.prepare(
    `SELECT COUNT(*) AS c FROM article_submission_log WHERE author_id = ? AND submitted_at >= ?`,
  ).bind(user.id, weekAgo).first();
  if ((cnt?.c ?? 0) >= SUBMISSIONS_PER_WEEK) {
    return c.json({ error: 'rate_limited', per_week: SUBMISSIONS_PER_WEEK }, 429);
  }
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
  await notifyArticle(c.env, 'author_submitted', { articleId: id, slug: row.slug, title: row.title, authorUserId: user.id });
  await notifyArticle(c.env, 'admin_submitted', { articleId: id, slug: row.slug, title: row.title, authorUserId: user.id });
  const updated: any = await c.env.DB.prepare(`SELECT * FROM articles WHERE id = ?`).bind(id).first();
  return c.json({ article: authorArticleShape(updated) });
});

articles.post('/:id/retract', async (c) => {
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
  // Notify admins that the in-queue article was pulled so the review
  // queue stays honest. We piggy-back on `admin_submitted` with a
  // retracted-prefix title via the reason field for context.
  await notifyArticle(c.env, 'admin_submitted', {
    articleId: id,
    slug: row.slug,
    title: `[retracted] ${row.title}`,
    authorUserId: user.id,
    reason: 'Author pulled this article back to draft. No further review action needed.',
  });
  return c.json({ ok: true });
});

articles.post('/:id/cover', async (c) => {
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
  const key = `articles/${id}/cover-${uuid}.${ext}`;
  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
  if (row.cover_r2_key && (row.cover_r2_key.startsWith('articles/') || row.cover_r2_key.startsWith('news/'))) {
    try { await c.env.FILES.delete(row.cover_r2_key); } catch (e) { console.warn('[articles] old cover delete failed', e); }
  }
  await c.env.DB.prepare(
    `UPDATE articles SET cover_r2_key = ?, cover_mime = ?, updated_at = ? WHERE id = ?`,
  ).bind(key, mime, new Date().toISOString(), id).run();
  return c.json({ ok: true, cover_url: `/api/articles/cover/${id}` });
});

export default articles;

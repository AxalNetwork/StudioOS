/**
 * Task #2 — Admin news review queue.
 *
 * Mounted at /api/admin/news (BEFORE the catch-all /api/admin in
 * index.ts, mirroring admin_telegram). Sits inside the existing
 * `/api/admin/*` Cf-Access perimeter; per-route admin gating via
 * requireAdmin.
 *
 *   GET    /queue                — list submitted/in_review/changes_requested
 *   GET    /:id                  — full article + revisions + comments
 *   POST   /:id/start-review     — submitted → in_review (claims as reviewer)
 *   POST   /:id/request-changes  — { reason } → changes_requested
 *   POST   /:id/reject           — { reason } → rejected
 *   POST   /:id/approve          → approved
 *   POST   /:id/publish          → published (renders + stamps body_html)
 *   POST   /:id/unpublish        → approved (busts edge cache)
 *   POST   /:id/comments         — { body, anchor? }
 *   PUT    /comments/:cid        — { resolved?: true|false, body? }
 *   DELETE /comments/:cid
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';
import { ensureNewsSchema } from '../services/newsSchema';
import { bustEdgeCache, renderMarkdown, snapshotRevision } from '../services/newsRender';
import { notifyNews } from '../services/newsNotify';

const adminNews = new Hono<{ Bindings: Env }>();

async function loadArticle(env: Env, id: number) {
  return env.DB.prepare(
    `SELECT a.*, u.name AS author_name, u.email AS author_email
       FROM articles a LEFT JOIN users u ON u.id = a.author_user_id
      WHERE a.id = ? LIMIT 1`,
  ).bind(id).first<any>();
}

adminNews.get('/queue', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const url = new URL(c.req.url);
  const status = url.searchParams.get('status');
  const limit = clampLimit(url.searchParams.get('limit'), 50, 100);
  const offset = parseOffset(url.searchParams.get('offset'));
  const where: string[] = [];
  const bind: any[] = [];
  if (status) {
    where.push('a.status = ?');
    bind.push(status);
  } else {
    where.push("a.status IN ('submitted','in_review','changes_requested','approved')");
  }
  const sql = `SELECT a.id, a.slug, a.title, a.status, a.author_user_id, a.submitted_at,
                      a.reviewed_at, a.approved_at, a.updated_at, a.word_count,
                      u.name AS author_name, u.email AS author_email,
                      r.name AS reviewer_name
                 FROM articles a
                 LEFT JOIN users u ON u.id = a.author_user_id
                 LEFT JOIN users r ON r.id = a.reviewer_user_id
                WHERE ${where.join(' AND ')}
             ORDER BY COALESCE(a.submitted_at, a.updated_at) ASC
                LIMIT ? OFFSET ?`;
  bind.push(limit, offset);
  const res = await c.env.DB.prepare(sql).bind(...bind).all<any>();
  return c.json({ items: res.results || [], limit, offset });
});

adminNews.get('/:id', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid' }, 400);
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const revs = await c.env.DB.prepare(
    `SELECT id, rev, title, status_at_save, saved_by, reason, created_at
       FROM article_revisions WHERE article_id = ? ORDER BY rev DESC`,
  ).bind(id).all<any>();
  const cmts = await c.env.DB.prepare(
    `SELECT c.id, c.author_id, c.body, c.anchor, c.resolved_at, c.created_at,
            u.name AS author_name, u.role AS author_role
       FROM article_review_comments c
       LEFT JOIN users u ON u.id = c.author_id
      WHERE c.article_id = ? ORDER BY c.created_at`,
  ).bind(id).all<any>();
  let tags: string[] = [];
  try { tags = row.tags ? JSON.parse(row.tags) : []; } catch { tags = []; }
  return c.json({
    article: { ...row, tags },
    revisions: revs.results || [],
    comments: cmts.results || [],
  });
});

async function transition(
  c: any,
  id: number,
  expect: string[],
  patch: Record<string, any>,
  reason: 'submit' | 'request_changes' | 'reject' | 'publish' | 'manual' | null,
  notifyKind: Parameters<typeof notifyNews>[1] | null,
  reasonText?: string | null,
) {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!expect.includes(row.status)) return c.json({ error: 'invalid_status', status: row.status }, 409);
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  const binds = [...Object.values(patch), new Date().toISOString(), id];
  await c.env.DB.prepare(`UPDATE articles SET ${sets}, updated_at = ? WHERE id = ?`).bind(...binds).run();
  if (reason) await snapshotRevision(c.env, id, admin.id, reason);
  if (notifyKind) {
    await notifyNews(c.env, notifyKind, {
      articleId: id,
      slug: row.slug,
      title: row.title,
      authorUserId: row.author_user_id,
      reason: reasonText ?? null,
    });
  }
  const updated = await loadArticle(c.env, id);
  return c.json({ article: updated });
}

adminNews.post('/:id/start-review', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  return transition(
    c, id, ['submitted'],
    { status: 'in_review', reviewer_user_id: admin.id, reviewed_at: new Date().toISOString() },
    null, 'author_in_review',
  );
});

adminNews.post('/:id/request-changes', async (c) => {
  const id = Number(c.req.param('id'));
  const body: any = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || '').slice(0, 2000).trim();
  if (reason.length < 8) return c.json({ error: 'reason_too_short' }, 400);
  return transition(
    c, id, ['in_review', 'submitted'],
    { status: 'changes_requested', rejection_reason: reason },
    'request_changes', 'author_changes_requested', reason,
  );
});

adminNews.post('/:id/reject', async (c) => {
  const id = Number(c.req.param('id'));
  const body: any = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || '').slice(0, 2000).trim();
  if (reason.length < 8) return c.json({ error: 'reason_too_short' }, 400);
  return transition(
    c, id, ['in_review', 'submitted', 'changes_requested'],
    { status: 'rejected', rejection_reason: reason, rejected_at: new Date().toISOString() },
    'reject', 'author_rejected', reason,
  );
});

adminNews.post('/:id/approve', async (c) => {
  const id = Number(c.req.param('id'));
  return transition(
    c, id, ['in_review', 'submitted'],
    { status: 'approved', approved_at: new Date().toISOString() },
    null, 'author_approved',
  );
});

adminNews.post('/:id/publish', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!['approved', 'in_review'].includes(row.status)) {
    return c.json({ error: 'invalid_status', status: row.status }, 409);
  }
  const html = renderMarkdown(row.body_markdown || '');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE articles
        SET status='published', body_html=?, published_at = COALESCE(published_at, ?), updated_at=?
      WHERE id = ?`,
  ).bind(html, now, now, id).run();
  await snapshotRevision(c.env, id, admin.id, 'publish');
  await bustEdgeCache(c.env, row.slug, id);
  await notifyNews(c.env, 'author_published', {
    articleId: id, slug: row.slug, title: row.title, authorUserId: row.author_user_id,
  });
  const updated = await loadArticle(c.env, id);
  return c.json({ article: updated });
});

adminNews.post('/:id/unpublish', async (c) => {
  const id = Number(c.req.param('id'));
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'published') return c.json({ error: 'invalid_status', status: row.status }, 409);
  await c.env.DB.prepare(
    `UPDATE articles SET status='approved', updated_at = ? WHERE id = ?`,
  ).bind(new Date().toISOString(), id).run();
  await bustEdgeCache(c.env, row.slug, id);
  void admin;
  return c.json({ ok: true });
});

adminNews.post('/:id/comments', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const body: any = await c.req.json().catch(() => ({}));
  const text = String(body.body || '').slice(0, 5000).trim();
  if (!text) return c.json({ error: 'empty' }, 400);
  const anchor = body.anchor ? String(body.anchor).slice(0, 120) : null;
  const ins: any = await c.env.DB.prepare(
    `INSERT INTO article_review_comments (article_id, author_id, body, anchor)
     VALUES (?, ?, ?, ?)`,
  ).bind(id, admin.id, text, anchor).run();
  return c.json({ id: Number(ins?.meta?.last_row_id), ok: true }, 201);
});

adminNews.put('/comments/:cid', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const cid = Number(c.req.param('cid'));
  const body: any = await c.req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  if (body.resolved === true) patch.resolved_at = new Date().toISOString();
  if (body.resolved === false) patch.resolved_at = null;
  if (typeof body.body === 'string') patch.body = body.body.slice(0, 5000);
  if (Object.keys(patch).length === 0) return c.json({ error: 'no_changes' }, 400);
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE article_review_comments SET ${sets} WHERE id = ?`).bind(...Object.values(patch), cid).run();
  void admin;
  return c.json({ ok: true });
});

adminNews.delete('/comments/:cid', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const cid = Number(c.req.param('cid'));
  await c.env.DB.prepare(`DELETE FROM article_review_comments WHERE id = ?`).bind(cid).run();
  return c.json({ ok: true });
});

export default adminNews;

/**
 * Task #1 — Admin /api/admin/articles review queue.
 *
 * Mirrors `admin_news.ts` but routed under /api/admin/articles. MUST be
 * mounted BEFORE the catch-all /api/admin in index.ts. Sits inside the
 * existing `/api/admin/*` Cf-Access perimeter; per-route admin gating
 * via requireAdmin.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';
import { ensureNewsSchema } from '../services/newsSchema';
import { bustArticleEdgeCache, renderMarkdown, snapshotRevision } from '../services/newsRender';
import { notifyArticle } from '../services/articleNotify';
import { notify } from '../services/notify';
import { ensureFollowsSchema } from './follows';

const adminArticles = new Hono<{ Bindings: Env }>();

// Task #66 — when an article is published, notify everyone following its
// author (entity_type='user'). Best-effort: never blocks or fails publish.
// Excludes the author so they aren't pinged about their own piece. Mirrors
// notifyProjectFollowers in routes/portfolio_updates.ts.
async function notifyAuthorFollowers(
  env: Env,
  authorUserId: number | null | undefined,
  article: { id: number; slug: string; title: string },
): Promise<void> {
  if (!authorUserId) return;
  try {
    await ensureFollowsSchema(env);
    const author = await env.DB.prepare(
      'SELECT uid, name FROM users WHERE id = ?',
    ).bind(authorUserId).first<{ uid: string; name: string }>();
    if (!author) return;
    const followers = await env.DB.prepare(
      "SELECT follower_user_id AS uid FROM follows WHERE entity_type = 'user' AND entity_id = ?",
    ).bind(authorUserId).all<{ uid: number }>();
    for (const f of followers.results || []) {
      if (f.uid === authorUserId) continue;
      await notify(env, {
        userId: f.uid,
        type: 'followed_entity_news',
        title: `${author.name || 'Someone you follow'} published an article`,
        body: article.title || null,
        link: `/articles/${article.slug}`,
        payload: { entity_type: 'user', handle: author.uid, article_id: article.id },
        category: 'proactive_nudges',
      });
    }
  } catch (e) {
    console.warn('[admin_articles] author follower fan-out failed', e);
  }
}

async function loadArticle(env: Env, id: number) {
  return env.DB.prepare(
    `SELECT a.*, u.name AS author_name, u.email AS author_email, NULL AS author_handle, u.role AS author_role
       FROM articles a LEFT JOIN users u ON u.id = a.author_user_id
      WHERE a.id = ? LIMIT 1`,
  ).bind(id).first<any>();
}

adminArticles.get('/queue', async (c) => {
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

adminArticles.get('/:id', async (c) => {
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
  notifyKind: Parameters<typeof notifyArticle>[1] | null,
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
    await notifyArticle(c.env, notifyKind, {
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

adminArticles.post('/:id/start-review', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  return transition(
    c, id, ['submitted'],
    { status: 'in_review', reviewer_user_id: admin.id, reviewed_at: new Date().toISOString() },
    null, 'author_in_review',
  );
});

adminArticles.post('/:id/request-changes', async (c) => {
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

adminArticles.post('/:id/reject', async (c) => {
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

adminArticles.post('/:id/approve', async (c) => {
  const id = Number(c.req.param('id'));
  return transition(
    c, id, ['in_review', 'submitted'],
    { status: 'approved', approved_at: new Date().toISOString() },
    null, 'author_approved',
  );
});

adminArticles.post('/:id/publish', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  // Approval gate: publish requires explicit /approve first. No skipping
  // straight from in_review → published, even by an admin. Mirrors the
  // task spec ("admin approval queue with explicit approve, then publish").
  if (row.status !== 'approved') {
    return c.json({ error: 'invalid_status', status: row.status, expected: 'approved' }, 409);
  }
  const html = renderMarkdown(row.body_markdown || '');
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE articles
        SET status='published', body_html=?, published_at = COALESCE(published_at, ?), updated_at=?
      WHERE id = ?`,
  ).bind(html, now, now, id).run();
  await snapshotRevision(c.env, id, admin.id, 'publish');
  await bustArticleEdgeCache(c.env, row.slug, id, row.author_user_id);
  await notifyArticle(c.env, 'author_published', {
    articleId: id, slug: row.slug, title: row.title, authorUserId: row.author_user_id,
  });
  // Task #66 — fan out to followers of the author (best-effort, non-blocking).
  await notifyAuthorFollowers(c.env, row.author_user_id, {
    id, slug: row.slug, title: row.title,
  });
  const updated = await loadArticle(c.env, id);
  return c.json({ article: updated });
});

adminArticles.post('/:id/unpublish', async (c) => {
  const id = Number(c.req.param('id'));
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'published') return c.json({ error: 'invalid_status', status: row.status }, 409);
  await c.env.DB.prepare(
    `UPDATE articles SET status='approved', updated_at = ? WHERE id = ?`,
  ).bind(new Date().toISOString(), id).run();
  await snapshotRevision(c.env, id, admin.id, 'manual');
  await bustArticleEdgeCache(c.env, row.slug, id, row.author_user_id);
  await notifyArticle(c.env, 'author_changes_requested', {
    articleId: id,
    slug: row.slug,
    title: row.title,
    authorUserId: row.author_user_id,
    reason: 'Article was unpublished by an admin and returned to approved status.',
  });
  return c.json({ ok: true });
});

adminArticles.post('/:id/comments', async (c) => {
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

adminArticles.put('/comments/:cid', async (c) => {
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

adminArticles.delete('/comments/:cid', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const cid = Number(c.req.param('cid'));
  await c.env.DB.prepare(`DELETE FROM article_review_comments WHERE id = ?`).bind(cid).run();
  return c.json({ ok: true });
});

export default adminArticles;

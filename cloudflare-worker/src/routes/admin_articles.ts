/**
 * Task #1 — Admin /api/admin/articles review queue.
 *
 * THE ONLY admin review queue over `articles`. MUST be mounted BEFORE the
 * catch-all /api/admin in index.ts.
 *
 * It used to say it mirrored `admin_news.ts`, and two things about that were
 * wrong by the time D166 read them:
 *
 *   1. That router was not a mirror, it was a LOOSER one. Its publish handler
 *      accepted `in_review` as well as `approved`, so the approval gate two
 *      screens down — "No skipping straight from in_review → published, even
 *      by an admin" — could be walked around by calling the other path. D166
 *      retired it; `/api/admin/news` now 404s.
 *   2. There is NO Cf-Access perimeter in front of /api/admin. Task #33
 *      removed it (see index.ts, above the /api/admin mounts): the Access app
 *      is configured on the apex while the SPA uses a relative API base, so
 *      app.axal.vc/api/admin/* could not carry the Cf-Access-Jwt-Assertion
 *      header and every legitimate admin got a fail-closed 403.
 *
 * So `requireAdmin` per route is not the inner half of a perimeter — it is
 * the whole gate, which is exactly why (1) mattered.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin, isSuperAdmin } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';
import { ensureNewsSchema } from '../services/newsSchema';
import { bustArticleEdgeCache, renderMarkdown, snapshotRevision } from '../services/newsRender';
import { notifyArticle } from '../services/articleNotify';
import { notify } from '../services/notify';
import { ensureFollowsSchema } from './follows';
import { logAdminAction } from '../services/adminAudit';

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

/**
 * Publish one APPROVED article: render, flip the status, record the revision,
 * clear the edge cache, tell the author and their followers. The one path both
 * the manual publish and the scheduled publish (D484) take.
 *
 * The status flip is conditional (`AND status = 'approved'`), so two callers
 * racing — an admin's click and the cron, or two cron ticks — publish once:
 * the loser changes no row and sends no notification. Returns whether this
 * call was the one that published.
 */
export async function publishApprovedArticle(env: Env, row: any, actorUserId: number): Promise<boolean> {
  const html = renderMarkdown(row.body_markdown || '');
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE articles
        SET status='published', body_html=?, published_at = COALESCE(published_at, ?), updated_at=?
      WHERE id = ? AND status = 'approved'`,
  ).bind(html, now, now, row.id).run();
  if (!res?.meta?.changes) return false;
  await snapshotRevision(env, row.id, actorUserId, 'publish');
  await bustArticleEdgeCache(env, row.slug, row.id, row.author_user_id);
  await notifyArticle(env, 'author_published', {
    articleId: row.id, slug: row.slug, title: row.title, authorUserId: row.author_user_id,
  });
  // Task #66 — fan out to followers of the author (best-effort, non-blocking).
  await notifyAuthorFollowers(env, row.author_user_id, {
    id: row.id, slug: row.slug, title: row.title,
  });
  return true;
}

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
  if (!(await publishApprovedArticle(c.env, row, admin.id))) {
    // Published by someone else (or the schedule) between the read and the write.
    const now = await loadArticle(c.env, id);
    return c.json({ error: 'invalid_status', status: now?.status ?? null, expected: 'approved' }, 409);
  }
  const updated = await loadArticle(c.env, id);
  return c.json({ article: updated });
});

/** The furthest ahead a publish time may be set: a year. */
export const PUBLISH_AT_MAX_DAYS = 365;

// POST /api/admin/articles/:id/schedule  { publish_at: ISO-8601 | null }
//
// D484 — set, move or clear the time an APPROVED article goes out. The
// per-minute cron publishes it once the time has passed, through
// `publishApprovedArticle`. `null` clears the time, and the article waits for
// a manual publish as before. A time must name its zone (an ISO string with
// `Z` or an offset), be in the future, and be at most a year ahead; it is
// stored as UTC.
adminArticles.post('/:id/schedule', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const body: any = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('publish_at' in body)) {
    return c.json({ error: 'publish_at_required', message: 'Send publish_at: an ISO time with its zone, or null to clear it.' }, 400);
  }
  let publishAt: string | null = null;
  if (body.publish_at !== null) {
    const raw = typeof body.publish_at === 'string' ? body.publish_at.trim() : '';
    // A zone is required: "2026-10-07T09:00" means a different instant in
    // every reader's browser, and the cron would have to guess which.
    const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw);
    const ms = zoned ? Date.parse(raw) : Number.NaN;
    if (!Number.isFinite(ms)) {
      return c.json({ error: 'bad_publish_at', message: 'publish_at must be an ISO time with its zone, such as 2026-10-07T09:00:00Z.' }, 400);
    }
    const nowMs = Date.now();
    if (ms <= nowMs) {
      return c.json({ error: 'publish_at_past', message: 'That time has passed. Publish now instead, or choose a later time.' }, 400);
    }
    if (ms > nowMs + PUBLISH_AT_MAX_DAYS * 86_400_000) {
      return c.json({ error: 'publish_at_too_far', message: `A publish time can be at most ${PUBLISH_AT_MAX_DAYS} days ahead.` }, 400);
    }
    publishAt = new Date(ms).toISOString();
  }
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'approved') {
    return c.json({ error: 'invalid_status', status: row.status, expected: 'approved' }, 409);
  }
  const res = await c.env.DB.prepare(
    `UPDATE articles SET publish_at = ?, publish_at_set_by = ?, updated_at = ? WHERE id = ? AND status = 'approved'`,
  ).bind(publishAt, publishAt ? admin.id : null, new Date().toISOString(), id).run();
  if (!res?.meta?.changes) {
    const now = await loadArticle(c.env, id);
    return c.json({ error: 'invalid_status', status: now?.status ?? null, expected: 'approved' }, 409);
  }
  await logAdminAction(c.env, admin.id, admin.email || '', publishAt ? 'article.schedule' : 'article.unschedule', {
    article_id: id, publish_at: publishAt, previous: row.publish_at ?? null,
  });
  const updated = await loadArticle(c.env, id);
  return c.json({ article: updated });
});

/** How many due articles one cron tick publishes; the rest go on the next tick. */
export const PUBLISH_DUE_BATCH = 20;

/**
 * D484 — the per-minute cron's half: publish every approved article whose
 * time has passed, oldest time first, as the admin who set the time.
 *
 * A database without migration 346 has no `publish_at` to read; that is not
 * an error worth a cron failure, so it answers `{ readable: false }` and
 * publishes nothing.
 */
export async function publishDueArticles(env: Env, now: Date = new Date()): Promise<{ readable: boolean; due: number; published: number }> {
  let due: any[];
  try {
    const q = await env.DB.prepare(
      `SELECT a.* FROM articles a
        WHERE a.status = 'approved' AND a.publish_at IS NOT NULL AND a.publish_at <= ?
        ORDER BY a.publish_at ASC, a.id ASC LIMIT ?`,
    ).bind(now.toISOString(), PUBLISH_DUE_BATCH).all<any>();
    due = q.results || [];
  } catch {
    return { readable: false, due: 0, published: 0 };
  }
  let published = 0;
  for (const row of due) {
    // The revision's author is whoever set the time. A row with none (set
    // before the column existed is impossible, but a hand edit is not) falls
    // back to the article's author rather than inventing an admin.
    const actor = Number(row.publish_at_set_by) || Number(row.author_user_id);
    try {
      if (await publishApprovedArticle(env, row, actor)) published += 1;
    } catch (e) {
      console.warn('[publishDueArticles] publish failed', row.id, (e as Error)?.message);
    }
  }
  return { readable: true, due: due.length, published };
}

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
  // D484 — back to approved, so a publish time that already passed must go,
  // or the next cron tick would publish it again. Its own statement: a
  // database without migration 346 still unpublishes.
  await c.env.DB.prepare(
    'UPDATE articles SET publish_at = NULL, publish_at_set_by = NULL WHERE id = ?',
  ).bind(id).run().catch(() => {});
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
  if (!Number.isFinite(cid) || cid <= 0) return c.json({ error: 'comment_not_found' }, 404);
  const body: any = await c.req.json().catch(() => ({}));
  const comment = await c.env.DB.prepare(
    'SELECT id, article_id, author_id, body, resolved_at FROM article_review_comments WHERE id = ?',
  ).bind(cid).first<{ id: number; article_id: number; author_id: number; body: string; resolved_at: string | null }>();
  if (!comment) return c.json({ error: 'comment_not_found' }, 404);

  // Column names are literals. A request field never becomes SQL.
  let nextBody: string | undefined;
  let nextResolved: string | null | undefined;
  if (typeof body.body === 'string') {
    const text = body.body.slice(0, 5000).trim();
    if (text !== comment.body) {
      if (!text) return c.json({ error: 'empty' }, 400);
      if (Number(comment.author_id) !== Number(admin.id) && !isSuperAdmin(admin)) {
        return c.json({ error: 'not_your_comment' }, 403);
      }
      nextBody = text;
    }
  }
  if (body.resolved === true) nextResolved = new Date().toISOString();
  if (body.resolved === false) nextResolved = null;
  if (nextBody === undefined && nextResolved === undefined) return c.json({ error: 'no_changes' }, 400);

  if (nextBody !== undefined && nextResolved !== undefined) {
    await c.env.DB.prepare(
      'UPDATE article_review_comments SET body = ?, resolved_at = ? WHERE id = ?',
    ).bind(nextBody, nextResolved, cid).run();
  } else if (nextBody !== undefined) {
    await c.env.DB.prepare(
      'UPDATE article_review_comments SET body = ? WHERE id = ?',
    ).bind(nextBody, cid).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE article_review_comments SET resolved_at = ? WHERE id = ?',
    ).bind(nextResolved, cid).run();
  }

  // Only a Super Admin rewriting someone else's text is an audit event.
  // The text itself stays out of the row.
  if (nextBody !== undefined && Number(comment.author_id) !== Number(admin.id)) {
    await logAdminAction(c.env, admin.id, admin.email || '', 'article_comment_edited', {
      article_id: comment.article_id,
      comment_id: comment.id,
    });
  }
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

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
 *
 * D1292 (#3388) — who decided, recorded, and no one approves their own work:
 *
 *   · Every transition — start review, approve, request changes, reject,
 *     publish (manual or scheduled) and unpublish — writes one audit row
 *     (`logAdminAction`, `article.<transition>`), as schedule already did, and
 *     only when the conditional update changed the row. Article text and
 *     reasons stay out of the row; it holds the ids and the two statuses.
 *   · Approve stores `approved_by` (migration 635) beside `approved_at`.
 *   · Approve, publish and schedule by the article's own author are refused
 *     (`self_approval`). A Super Admin may override with `override_reason`,
 *     which the audit row carries; an Admin is told to ask another admin.
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
import { MetricsRefusal, authorsRead, performanceRead, recordFollowerReach } from '../services/articleMetrics';
import { parseQueueQuery, publicationChips, queueRows, stageCounts } from '../services/articleQueue';

const adminArticles = new Hono<{ Bindings: Env }>();

// Task #66 — when an article is published, notify everyone following its
// author (entity_type='user'). Best-effort: never blocks or fails publish.
// Excludes the author so they aren't pinged about their own piece. Mirrors
// notifyProjectFollowers in routes/portfolio_updates.ts.
//
// D1294 (#3390): the publish's reach is stored with it — how many followers
// the fan-out tried and how many notices were written — as counts only, no
// follower id (`article_follower_reach`, migration 637).
async function notifyAuthorFollowers(
  env: Env,
  authorUserId: number | null | undefined,
  article: { id: number; slug: string; title: string },
  publishedAt: string = new Date().toISOString(),
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
    let tried = 0;
    let notified = 0;
    for (const f of followers.results || []) {
      if (f.uid === authorUserId) continue;
      tried += 1;
      const sent = await notify(env, {
        userId: f.uid,
        type: 'followed_entity_news',
        title: `${author.name || 'Someone you follow'} published an article`,
        body: article.title || null,
        link: `/articles/${article.slug}`,
        payload: { entity_type: 'user', handle: author.uid, article_id: article.id },
        category: 'proactive_nudges',
      });
      if (sent !== null) notified += 1;
    }
    await recordFollowerReach(env, article.id, publishedAt, tried, notified);
  } catch (e) {
    console.warn('[admin_articles] author follower fan-out failed', e);
  }
}

/** The shortest override reason a Super Admin may give for deciding their own article. */
export const OVERRIDE_REASON_MIN = 8;

/**
 * D1292 — the self-approval rule for approve, publish and schedule. Returns a
 * refusal, or `{ override }` with the Super Admin's reason (null when the
 * decider is not the author). The article's text never enters the answer.
 */
export function selfApprovalCheck(
  admin: { id: number; role?: string; is_super_admin?: unknown },
  row: { author_user_id?: unknown },
  body: any,
): { refused: { status: 403; body: Record<string, string> } } | { override: string | null } {
  if (Number(row?.author_user_id) !== Number(admin.id)) return { override: null };
  if (!isSuperAdmin(admin as any)) {
    return { refused: { status: 403, body: {
      error: 'self_approval',
      detail: 'You wrote this article, so another admin must approve and publish it. Ask another admin. Nothing was changed.',
    } } };
  }
  const reason = typeof body?.override_reason === 'string' ? body.override_reason.slice(0, 2000).trim() : '';
  if (reason.length < OVERRIDE_REASON_MIN) {
    return { refused: { status: 403, body: {
      error: 'self_approval_reason_required',
      detail: `You wrote this article. To decide it yourself, give a reason of at least ${OVERRIDE_REASON_MIN} characters; it is recorded. Nothing was changed.`,
    } } };
  }
  return { override: reason };
}

/** D1292 — one audit row per transition; ids and statuses only, never the text. */
async function auditTransition(
  env: Env,
  actor: { id: number; email?: string | null },
  action: string,
  row: { id: number; author_user_id?: unknown; status?: string },
  to: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const author = Number(row.author_user_id);
  await logAdminAction(env, actor.id, actor.email || '', action, {
    article_id: row.id,
    from: row.status ?? null,
    to,
    ...(Number.isFinite(author) && author > 0 ? { target_user_id: author } : {}),
    ...extra,
  });
}

async function loadArticle(env: Env, id: number) {
  return env.DB.prepare(
    `SELECT a.*, u.name AS author_name, u.email AS author_email, NULL AS author_handle, u.role AS author_role
       FROM articles a LEFT JOIN users u ON u.id = a.author_user_id
      WHERE a.id = ? LIMIT 1`,
  ).bind(id).first<any>();
}

// D1291 (#3387): the queue read the Pipeline board, list and Calendar draw
// (services/articleQueue.ts). `status` keeps its old meaning, one raw status,
// so today's page reads what it always did; `stage` adds ready and scheduled.
adminArticles.get('/queue', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const url = new URL(c.req.url);
  const limit = clampLimit(url.searchParams.get('limit'), 50, 100);
  const offset = parseOffset(url.searchParams.get('offset'));
  const parsed = parseQueueQuery(url.searchParams, limit, offset);
  if (!parsed.ok) return c.json({ error: parsed.error, code: parsed.code }, 400);
  const q = parsed.query;
  let rows;
  try {
    rows = await queueRows(c.env, q);
  } catch {
    console.warn('[admin_articles] queue read failed');
    return c.json({ error: 'The queue could not be read. Try again.', code: 'queue_unreadable' }, 503);
  }
  // Each block reads alone: one that fails says so and leaves the rows standing.
  const counts = await stageCounts(c.env).catch(() => ({ available: false as const, reason: 'unreadable' as const }));
  const publications = q.from && q.to
    ? await publicationChips(c.env, q.from, q.to).catch(() => ({ available: false as const, reason: 'unreadable' as const }))
    : undefined;
  return c.json({
    items: rows.items, total: rows.total, limit, offset, counts,
    ...(publications ? { publications } : {}),
    query: { stage: q.stage, sort: q.sort, from: q.from, to: q.to },
  });
});

// D1294 (#3390) — what Authors and Performance read. Registered before
// `/:id`, which would otherwise take `authors` and `performance` as an id.
adminArticles.get('/authors', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  c.header('Cache-Control', 'no-store');
  return c.json(await authorsRead(c.env));
});

adminArticles.get('/performance', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  c.header('Cache-Control', 'no-store');
  try {
    return c.json(await performanceRead(c.env, c.req.query('from'), c.req.query('to')));
  } catch (e) {
    if (e instanceof MetricsRefusal) return c.json({ error: e.code, message: e.sentence }, e.status as 400);
    throw e;
  }
});

adminArticles.get('/:id', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid' }, 400);
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  // D1293 — each revision names who saved it; `saved_by_name` is null when
  // that account is gone, and the drawer says so rather than guessing.
  const revs = await c.env.DB.prepare(
    `SELECT r.id, r.rev, r.title, r.status_at_save, r.saved_by, r.reason, r.created_at,
            s.name AS saved_by_name
       FROM article_revisions r
       LEFT JOIN users s ON s.id = r.saved_by
      WHERE r.article_id = ? ORDER BY r.rev DESC`,
  ).bind(id).all<any>();
  const cmts = await c.env.DB.prepare(
    `SELECT c.id, c.author_id, c.body, c.anchor, c.resolved_at, c.created_at,
            c.parent_id, c.resolved_by, c.edited_at,
            u.name AS author_name, u.role AS author_role,
            rb.name AS resolved_by_name
       FROM article_review_comments c
       LEFT JOIN users u ON u.id = c.author_id
       LEFT JOIN users rb ON rb.id = c.resolved_by
      WHERE c.article_id = ? ORDER BY c.created_at, c.id`,
  ).bind(id).all<any>();
  let tags: string[] = [];
  try { tags = row.tags ? JSON.parse(row.tags) : []; } catch { tags = []; }
  // D1294: each publish's follower reach, newest first; none before migration 637.
  const reach = await c.env.DB.prepare(
    'SELECT published_at, followers, notified FROM article_follower_reach WHERE article_id = ? ORDER BY id DESC LIMIT 20',
  ).bind(id).all<any>().catch(() => null);
  return c.json({
    // D1293 — `rendered_html` is the body as readers would see it now, from
    // the current markdown. `body_html` stays what was rendered at publish.
    article: { ...row, tags, rendered_html: renderMarkdown(row.body_markdown || '') },
    revisions: revs.results || [],
    comments: cmts.results || [],
    follower_reach: reach ? reach.results || [] : null,
  });
});

// GET /api/admin/articles/:id/revisions/:rev — D1293: one revision's stored
// text, for the drawer's compare. Admins only; an author reads their own
// article through /api/articles/draft/:id, never another revision.
adminArticles.get('/:id/revisions/:rev', async (c) => {
  await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const rev = Number(c.req.param('rev'));
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(rev) || rev <= 0) return c.json({ error: 'invalid' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT r.rev, r.title, r.subtitle, r.body_markdown, r.status_at_save, r.saved_by, r.reason, r.created_at,
            s.name AS saved_by_name
       FROM article_revisions r
       LEFT JOIN users s ON s.id = r.saved_by
      WHERE r.article_id = ? AND r.rev = ? LIMIT 1`,
  ).bind(id, rev).first<any>();
  if (!row) return c.json({ error: 'revision_not_found', detail: 'That revision is not stored for this article.' }, 404);
  return c.json({ revision: row });
});

async function transition(
  c: any,
  id: number,
  expect: string[],
  patch: Record<string, any>,
  reason: 'submit' | 'request_changes' | 'reject' | 'publish' | 'manual' | null,
  notifyKind: Parameters<typeof notifyArticle>[1] | null,
  reasonText: string | null | undefined,
  audit: { action: string; selfApproval?: boolean },
) {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!expect.includes(row.status)) return c.json({ error: 'invalid_status', status: row.status }, 409);
  let override: string | null = null;
  if (audit.selfApproval) {
    const body: any = await c.req.json().catch(() => ({}));
    const check = selfApprovalCheck(admin, row, body);
    if ('refused' in check) return c.json(check.refused.body, check.refused.status);
    override = check.override;
  }
  // `patch`'s keys are the literals each route below passes; a request field
  // never becomes a column name. The status guard makes a race lose cleanly:
  // two admins deciding at once change the row once and audit it once.
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  const binds = [...Object.values(patch), new Date().toISOString(), id, JSON.stringify(expect)];
  const res = await c.env.DB.prepare(
    `UPDATE articles SET ${sets}, updated_at = ? WHERE id = ? AND status IN (SELECT value FROM json_each(?))`,
  ).bind(...binds).run();
  if (!res?.meta?.changes) {
    const now = await loadArticle(c.env, id);
    return c.json({ error: 'invalid_status', status: now?.status ?? null }, 409);
  }
  await auditTransition(c.env, admin, audit.action, row, String(patch.status),
    override ? { self_approval_override: true, override_reason: override } : {});
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
    null, 'author_in_review', null, { action: 'article.start_review' },
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
    'request_changes', 'author_changes_requested', reason, { action: 'article.request_changes' },
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
    'reject', 'author_rejected', reason, { action: 'article.reject' },
  );
});

adminArticles.post('/:id/approve', async (c) => {
  const admin = await requireAdmin(c);
  const id = Number(c.req.param('id'));
  return transition(
    c, id, ['in_review', 'submitted'],
    { status: 'approved', approved_at: new Date().toISOString(), approved_by: admin.id },
    null, 'author_approved', null, { action: 'article.approve', selfApproval: true },
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
export async function publishApprovedArticle(
  env: Env,
  row: any,
  actorUserId: number,
  audit: { email?: string | null; via?: 'manual' | 'schedule'; override?: string | null } = {},
): Promise<boolean> {
  const html = renderMarkdown(row.body_markdown || '');
  const now = new Date().toISOString();
  const res = await env.DB.prepare(
    `UPDATE articles
        SET status='published', body_html=?, published_at = COALESCE(published_at, ?), updated_at=?
      WHERE id = ? AND status = 'approved'`,
  ).bind(html, now, now, row.id).run();
  if (!res?.meta?.changes) return false;
  // D1292 — the publish is recorded as the actor's: the admin who clicked, or
  // the admin who set the time when the schedule carries it out.
  await auditTransition(env, { id: actorUserId, email: audit.email ?? '' }, 'article.publish', row, 'published', {
    via: audit.via ?? 'manual',
    ...(audit.override ? { self_approval_override: true, override_reason: audit.override } : {}),
  });
  await snapshotRevision(env, row.id, actorUserId, 'publish');
  await bustArticleEdgeCache(env, row.slug, row.id, row.author_user_id);
  await notifyArticle(env, 'author_published', {
    articleId: row.id, slug: row.slug, title: row.title, authorUserId: row.author_user_id,
  });
  // Task #66 — fan out to followers of the author (best-effort, non-blocking).
  await notifyAuthorFollowers(env, row.author_user_id, {
    id: row.id, slug: row.slug, title: row.title,
  }, now);
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
  const check = selfApprovalCheck(admin, row, await c.req.json().catch(() => ({})));
  if ('refused' in check) return c.json(check.refused.body, check.refused.status);
  if (!(await publishApprovedArticle(c.env, row, admin.id, { email: admin.email, via: 'manual', override: check.override }))) {
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
  // D1292 — a time is a publish carried out later, so the author may not set
  // one on their own article either; clearing a time publishes nothing.
  let override: string | null = null;
  if (publishAt) {
    const check = selfApprovalCheck(admin, row, body);
    if ('refused' in check) return c.json(check.refused.body, check.refused.status);
    override = check.override;
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
    ...(override ? { self_approval_override: true, override_reason: override } : {}),
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
      if (await publishApprovedArticle(env, row, actor, { via: 'schedule' })) published += 1;
    } catch (e) {
      console.warn('[publishDueArticles] publish failed', row.id, (e as Error)?.message);
    }
  }
  return { readable: true, due: due.length, published };
}

// POST /api/admin/articles/:id/unpublish  { reason }
//
// D1293 — the author is told why, in their own notice ("Your article was
// unpublished"), not as "Changes requested". A reason under eight characters
// is refused, as request-changes and reject refuse one. Unpublishing also
// takes the article off the featured strip.
adminArticles.post('/:id/unpublish', async (c) => {
  const id = Number(c.req.param('id'));
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const body: any = await c.req.json().catch(() => ({}));
  const reason = String(body?.reason || '').slice(0, 2000).trim();
  if (reason.length < 8) {
    return c.json({ error: 'reason_too_short', detail: 'Say why, in at least eight characters. The author reads it. Nothing was unpublished.' }, 400);
  }
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.status !== 'published') return c.json({ error: 'invalid_status', status: row.status }, 409);
  const res = await c.env.DB.prepare(
    `UPDATE articles SET status='approved', featured_at = NULL, featured_by = NULL, updated_at = ?
      WHERE id = ? AND status = 'published'`,
  ).bind(new Date().toISOString(), id).run();
  if (!res?.meta?.changes) {
    const now = await loadArticle(c.env, id);
    return c.json({ error: 'invalid_status', status: now?.status ?? null }, 409);
  }
  await auditTransition(c.env, admin, 'article.unpublish', row, 'approved', {
    was_featured: !!row.featured_at,
  });
  // D484 — back to approved, so a publish time that already passed must go,
  // or the next cron tick would publish it again. Its own statement: a
  // database without migration 346 still unpublishes.
  await c.env.DB.prepare(
    'UPDATE articles SET publish_at = NULL, publish_at_set_by = NULL WHERE id = ?',
  ).bind(id).run().catch(() => {});
  await snapshotRevision(c.env, id, admin.id, 'manual');
  await bustArticleEdgeCache(c.env, row.slug, id, row.author_user_id);
  await notifyArticle(c.env, 'author_unpublished', {
    articleId: id,
    slug: row.slug,
    title: row.title,
    authorUserId: row.author_user_id,
    reason,
  });
  return c.json({ ok: true });
});

/** The most articles featured on Articles at once (D1290 §4, question 4). */
export const FEATURED_MAX = 3;

// POST /api/admin/articles/:id/feature  { featured: true | false }
//
// D1293 — a Super Admin features a published article on Articles, or takes
// it off. At most FEATURED_MAX at a time: the count is part of the UPDATE's
// own WHERE, so two Super Admins racing for the last place feature one
// article, not two. Featuring an article already featured, or unfeaturing
// one that is not, changes nothing and says so.
adminArticles.post('/:id/feature', async (c) => {
  const admin = await requireAdmin(c);
  if (!isSuperAdmin(admin)) {
    return c.json({ error: 'super_admin_only', detail: 'Only a Super Admin features an article. Nothing was changed.' }, 403);
  }
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid' }, 400);
  const body: any = await c.req.json().catch(() => null);
  if (!body || typeof body.featured !== 'boolean') {
    return c.json({ error: 'featured_required', detail: 'Send featured: true or false.' }, 400);
  }
  const row = await loadArticle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const now = new Date().toISOString();
  if (body.featured) {
    const res = await c.env.DB.prepare(
      `UPDATE articles SET featured_at = ?, featured_by = ?
        WHERE id = ? AND status = 'published' AND featured_at IS NULL
          AND (SELECT COUNT(*) FROM articles WHERE featured_at IS NOT NULL) < ?`,
    ).bind(now, admin.id, id, FEATURED_MAX).run();
    if (!res?.meta?.changes) {
      const again = await loadArticle(c.env, id);
      if (again?.featured_at) return c.json({ article: again, changed: false });
      if (again?.status !== 'published') {
        return c.json({ error: 'invalid_status', status: again?.status ?? null, expected: 'published', detail: 'Only a published article can be featured. Nothing was changed.' }, 409);
      }
      return c.json({ error: 'featured_full', max: FEATURED_MAX, detail: `${FEATURED_MAX} articles are featured already. Unfeature one first. Nothing was changed.` }, 409);
    }
  } else {
    if (!row.featured_at) return c.json({ article: row, changed: false });
    await c.env.DB.prepare(
      'UPDATE articles SET featured_at = NULL, featured_by = NULL WHERE id = ?',
    ).bind(id).run();
  }
  await logAdminAction(c.env, admin.id, admin.email || '', body.featured ? 'article.feature' : 'article.unfeature', {
    article_id: id,
  });
  await bustArticleEdgeCache(c.env, row.slug, id, row.author_user_id);
  return c.json({ article: await loadArticle(c.env, id), changed: true });
});

adminArticles.post('/:id/comments', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const id = Number(c.req.param('id'));
  const body: any = await c.req.json().catch(() => ({}));
  const text = String(body.body || '').slice(0, 5000).trim();
  if (!text) return c.json({ error: 'empty' }, 400);
  const anchor = body.anchor ? String(body.anchor).slice(0, 120) : null;
  // D1293 — `parent_id` answers a thread: it must be a first comment on this
  // same article. A reply takes no anchor of its own; the thread has one.
  let parentId: number | null = null;
  if (body.parent_id !== undefined && body.parent_id !== null) {
    parentId = Number(body.parent_id);
    const parent = Number.isInteger(parentId) && parentId > 0
      ? await c.env.DB.prepare(
        'SELECT id FROM article_review_comments WHERE id = ? AND article_id = ? AND parent_id IS NULL',
      ).bind(parentId, id).first<{ id: number }>()
      : null;
    if (!parent) return c.json({ error: 'comment_not_found', detail: 'That thread is not on this article. Nothing was posted.' }, 404);
  }
  const ins: any = await c.env.DB.prepare(
    `INSERT INTO article_review_comments (article_id, author_id, body, anchor, parent_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(id, admin.id, text, parentId ? null : anchor, parentId).run();
  return c.json({ id: Number(ins?.meta?.last_row_id), ok: true }, 201);
});

adminArticles.put('/comments/:cid', async (c) => {
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const cid = Number(c.req.param('cid'));
  if (!Number.isFinite(cid) || cid <= 0) return c.json({ error: 'comment_not_found' }, 404);
  const body: any = await c.req.json().catch(() => ({}));
  const comment = await c.env.DB.prepare(
    'SELECT id, article_id, author_id, body, resolved_at, parent_id FROM article_review_comments WHERE id = ?',
  ).bind(cid).first<{ id: number; article_id: number; author_id: number; body: string; resolved_at: string | null; parent_id: number | null }>();
  if (!comment) return c.json({ error: 'comment_not_found' }, 404);
  // D1293 — a thread is resolved at its first comment; a reply is not.
  if (typeof body.resolved === 'boolean' && comment.parent_id) {
    return c.json({ error: 'reply_not_resolvable', detail: 'Resolve the thread, not a reply. Nothing was changed.' }, 400);
  }

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

  // D1293 — a text change stamps `edited_at`; resolving records who
  // (`resolved_by`), and reopening clears it with the time.
  const now = new Date().toISOString();
  const resolvedBy = nextResolved ? admin.id : null;
  if (nextBody !== undefined && nextResolved !== undefined) {
    await c.env.DB.prepare(
      'UPDATE article_review_comments SET body = ?, edited_at = ?, resolved_at = ?, resolved_by = ? WHERE id = ?',
    ).bind(nextBody, now, nextResolved, resolvedBy, cid).run();
  } else if (nextBody !== undefined) {
    await c.env.DB.prepare(
      'UPDATE article_review_comments SET body = ?, edited_at = ? WHERE id = ?',
    ).bind(nextBody, now, cid).run();
  } else {
    await c.env.DB.prepare(
      'UPDATE article_review_comments SET resolved_at = ?, resolved_by = ? WHERE id = ?',
    ).bind(nextResolved, resolvedBy, cid).run();
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
  const admin = await requireAdmin(c);
  await ensureNewsSchema(c.env);
  const cid = Number(c.req.param('cid'));
  // D634 — each refusal carries the sentence the review page prints.
  const NOT_FOUND = { error: 'comment_not_found', detail: 'This comment no longer exists. Nothing was deleted.' };
  if (!Number.isFinite(cid) || cid <= 0) return c.json(NOT_FOUND, 404);
  const comment = await c.env.DB.prepare(
    'SELECT id, article_id, author_id, body FROM article_review_comments WHERE id = ?',
  ).bind(cid).first<{ id: number; article_id: number; author_id: number; body: string }>();
  if (!comment) return c.json(NOT_FOUND, 404);
  if (Number(comment.author_id) !== Number(admin.id) && !isSuperAdmin(admin)) {
    return c.json({ error: 'not_your_comment', detail: 'Only the comment’s author or a Super Admin can delete it. Nothing was deleted.' }, 403);
  }
  // D1293 — a thread's replies go with it. Said here as well as by the
  // foreign key, so a database without enforced keys keeps no orphan.
  await c.env.DB.prepare('DELETE FROM article_review_comments WHERE id = ? OR parent_id = ?').bind(cid, cid).run();
  await logAdminAction(c.env, admin.id, admin.email || '', 'article_comment_deleted', {
    article_id: comment.article_id,
    comment_id: comment.id,
  });
  return c.json({ ok: true });
});

export default adminArticles;

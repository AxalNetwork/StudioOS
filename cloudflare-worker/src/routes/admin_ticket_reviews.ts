/**
 * D544 — the Super Admin's review queue for feature requests and suggested
 * tasks. Mounted at /api/admin/ticket-reviews.
 *
 *   GET  /features                       feature requests not yet decided
 *                                        { items, count, total }
 *   POST /features/:ticketId/approve     { reason }
 *   POST /features/:ticketId/decline     { reason }   the user is sent it
 *   GET  /tasks                          suggested tasks still pending
 *                                        { items, count, total, audiences }
 *   POST /tasks/:id/approve              { audience, reason }
 *   POST /tasks/:id/decline              { reason }   the user is sent it
 *
 * Every route is the Super Admin's (`requireSuperAdmin`). Every decision takes
 * a typed reason of at least ten characters, is recorded once (a second
 * decision on the same request is a 409, never a second effect), and is logged
 * through `logAdminAction`.
 *
 * WHAT A DECISION DOES.
 *   - Approving a feature labels its mirrored issue `feature:approved`
 *     (`addLabels`, which keeps the issue's other labels); Session 1 then files
 *     the build task. Declining labels it `feature:declined` and sends the user
 *     the reason. The decision is stored in `feature_request_reviews`
 *     (migration 383) whatever GitHub answers, and `label_status` says what
 *     became of the label: never silent.
 *   - Approving a suggested task publishes it to the community task list
 *     (#1108) for one persona or `all`, and pays the suggester `task_approved`
 *     through D540's `grantCredits`, keyed `task:<id>` so it is paid once.
 *     Declining sends the reason.
 *
 * D606 — the page is `/hq/review` (`pages/hq/ReviewQueuePage.jsx`), built to
 * the owner's Eadwyn Tickets canvas. A list reads the oldest 200 waiting;
 * `count` is how many came back and `total` how many are waiting, so a page
 * past the 200th says how many it cannot show rather than a short number.
 * A task carries its GitHub issue's number beside its link, as a feature does.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireSuperAdmin } from '../auth';
import { logAdminAction } from '../services/adminAudit';
import { notify } from '../services/notify';
import { grantCredits } from '../services/creditGrants';
import { addLabels, githubConfigured } from '../services/githubSync';
import { mapError } from './_t13t14t15_helpers';
import { refuse } from '../util/refusal';

type C = Context<{ Bindings: Env }>;
const r = new Hono<{ Bindings: Env }>();

export const REVIEW_REASON_MIN = 10;
/** Who an approved task is for: one persona (advisor's `Persona`, less admin and unknown) or everyone. */
export const AUDIENCES = ['all', 'founder', 'investor', 'advisor', 'partner', 'explorer'] as const;
export const FEATURE_APPROVED_LABEL = 'feature:approved';
export const FEATURE_DECLINED_LABEL = 'feature:declined';

type Ticket = {
  id: number; title: string; description: string | null; priority: string; type: string;
  user_id: number | null; submitted_by: string | null; created_at: string;
  github_issue_number: number | null; github_issue_url: string | null;
};

async function readReason(c: C): Promise<{ body: any; reason: string } | Response> {
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body?.reason ?? '').trim().slice(0, 1000);
  if (reason.length < REVIEW_REASON_MIN) {
    return refuse(c, 400, {
      code: 'reason_too_short',
      message: `Say why — at least ${REVIEW_REASON_MIN} characters. It is recorded with the decision.`,
    });
  }
  return { body, reason };
}

const idParam = (raw: string): number | null => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && String(n) === raw ? n : null;
};

async function tellUser(env: Env, userId: number | null, title: string, body: string, payload: Record<string, unknown>): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await notify(env, { userId, type: 'ticket_review', title, body, link: '/studio', payload, channels: ['in_app'], category: 'tickets' })) !== null;
  } catch (e) {
    console.warn('[ticket-reviews] notice failed', (e as Error).message);
    return false;
  }
}

/** Add one label to the mirrored issue and say what happened. */
async function labelIssue(env: Env, t: Ticket, label: string): Promise<'added' | 'no_issue' | 'not_configured' | 'failed'> {
  if (!t.github_issue_number) return 'no_issue';
  if (!githubConfigured(env)) return 'not_configured';
  const res = await addLabels(env, Number(t.github_issue_number), [label]);
  if (!res.ok) console.warn('[ticket-reviews] label failed', label, res.error);
  return res.ok ? 'added' : 'failed';
}

const asker = (row: any) => ({
  user_id: row.user_id ?? null,
  name: row.user_name ?? row.submitted_by ?? null,
  email: row.user_email ?? null,
});

// ---- feature requests ---------------------------------------------------------

r.get('/features', async (c) => {
  try {
    await requireSuperAdmin(c);
    const rows = await c.env.DB.prepare(
      `SELECT t.id, t.title, t.description, t.priority, t.created_at, t.user_id, t.submitted_by,
              t.github_issue_number, t.github_issue_url, u.name AS user_name, u.email AS user_email
         FROM tickets t
         LEFT JOIN users u ON u.id = t.user_id
        WHERE t.type = 'feature'
          AND NOT EXISTS (SELECT 1 FROM feature_request_reviews f WHERE f.ticket_id = t.id)
        ORDER BY t.created_at ASC, t.id ASC LIMIT 200`,
    ).all<any>();
    const items = (rows.results || []).map((x: any) => ({
      ticket_id: x.id, title: x.title, body: x.description, priority: x.priority, created_at: x.created_at,
      asked_by: asker(x), github_issue_number: x.github_issue_number ?? null, github_issue_url: x.github_issue_url ?? null,
    }));
    const waiting = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM tickets t
        WHERE t.type = 'feature'
          AND NOT EXISTS (SELECT 1 FROM feature_request_reviews f WHERE f.ticket_id = t.id)`,
    ).first<{ n: number }>();
    return c.json({ items, count: items.length, total: Math.max(Number(waiting?.n ?? 0), items.length) });
  } catch (e) { return mapError(c, e); }
});

async function decideFeature(c: C, decision: 'approved' | 'declined') {
  const admin = await requireSuperAdmin(c);
  const ticketId = idParam(c.req.param('ticketId') ?? '');
  if (ticketId === null) return refuse(c, 400, { code: 'invalid_id', message: 'That is not a ticket id.' });
  const read = await readReason(c);
  if (read instanceof Response) return read;
  const t = await c.env.DB.prepare(
    `SELECT id, title, description, priority, type, user_id, submitted_by, created_at, github_issue_number, github_issue_url
       FROM tickets WHERE id = ? AND type = 'feature'`,
  ).bind(ticketId).first<Ticket>();
  if (!t) return refuse(c, 404, { code: 'not_found', message: 'No feature request has that id.' });
  const ins = await c.env.DB.prepare(
    `INSERT INTO feature_request_reviews (ticket_id, status, decided_by, decided_at, decline_reason)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(ticket_id) DO NOTHING`,
  ).bind(ticketId, decision, admin.id, new Date().toISOString(), decision === 'declined' ? read.reason : null).run();
  if (Number(ins?.meta?.changes ?? 0) !== 1) {
    const prior = await c.env.DB.prepare('SELECT status FROM feature_request_reviews WHERE ticket_id = ?')
      .bind(ticketId).first<{ status: string }>();
    return refuse(c, 409, {
      code: 'already_decided', message: `This request was already ${prior?.status ?? 'decided'}; nothing was changed.`,
      extra: { status: prior?.status ?? null },
    });
  }
  const labelStatus = await labelIssue(c.env, t, decision === 'approved' ? FEATURE_APPROVED_LABEL : FEATURE_DECLINED_LABEL);
  await c.env.DB.prepare('UPDATE feature_request_reviews SET label_status = ? WHERE ticket_id = ?').bind(labelStatus, ticketId).run();
  await logAdminAction(c.env, admin.id, admin.email, decision === 'approved' ? 'feature_request_approved' : 'feature_request_declined', {
    ticket_id: ticketId, target_user_id: t.user_id, reason: read.reason, label_status: labelStatus,
  });
  const notified = decision === 'approved'
    ? await tellUser(c.env, t.user_id, 'Your feature request was approved',
      `"${t.title}" is going to the build queue. Approval is not a promise of a date.`, { ticket_id: ticketId })
    : await tellUser(c.env, t.user_id, 'Your feature request was declined',
      `"${t.title}" will not be built. The reason: "${read.reason}".`, { ticket_id: ticketId });
  return c.json({ ok: true, ticket_id: ticketId, status: decision, label_status: labelStatus, notified });
}

r.post('/features/:ticketId/approve', async (c) => { try { return await decideFeature(c, 'approved'); } catch (e) { return mapError(c, e); } });
r.post('/features/:ticketId/decline', async (c) => { try { return await decideFeature(c, 'declined'); } catch (e) { return mapError(c, e); } });

// ---- suggested tasks ------------------------------------------------------------

r.get('/tasks', async (c) => {
  try {
    await requireSuperAdmin(c);
    const rows = await c.env.DB.prepare(
      `SELECT ct.id, ct.ticket_id, ct.title, ct.body, ct.created_at, t.priority, t.user_id, t.submitted_by,
              t.github_issue_number, t.github_issue_url, u.name AS user_name, u.email AS user_email
         FROM community_tasks ct
         JOIN tickets t ON t.id = ct.ticket_id
         LEFT JOIN users u ON u.id = t.user_id
        WHERE ct.status = 'pending' AND t.type = 'task'
        ORDER BY ct.created_at ASC, ct.id ASC LIMIT 200`,
    ).all<any>();
    const items = (rows.results || []).map((x: any) => ({
      id: x.id, ticket_id: x.ticket_id, title: x.title, body: x.body, priority: x.priority, created_at: x.created_at,
      asked_by: asker(x), github_issue_number: x.github_issue_number ?? null, github_issue_url: x.github_issue_url ?? null,
    }));
    const waiting = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM community_tasks ct JOIN tickets t ON t.id = ct.ticket_id
        WHERE ct.status = 'pending' AND t.type = 'task'`,
    ).first<{ n: number }>();
    return c.json({ items, count: items.length, total: Math.max(Number(waiting?.n ?? 0), items.length), audiences: AUDIENCES });
  } catch (e) { return mapError(c, e); }
});

async function pendingTask(c: C, id: number) {
  return c.env.DB.prepare(
    `SELECT ct.id, ct.ticket_id, ct.title, ct.status, t.user_id
       FROM community_tasks ct JOIN tickets t ON t.id = ct.ticket_id WHERE ct.id = ?`,
  ).bind(id).first<{ id: number; ticket_id: number; title: string; status: string; user_id: number | null }>();
}

r.post('/tasks/:id/approve', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return refuse(c, 400, { code: 'invalid_id', message: 'That is not a task id.' });
    const read = await readReason(c);
    if (read instanceof Response) return read;
    const audience = String(read.body?.audience ?? '').trim().toLowerCase();
    if (!(AUDIENCES as readonly string[]).includes(audience)) {
      return refuse(c, 400, { code: 'invalid_audience', message: `Choose who the task is for: ${AUDIENCES.join(', ')}.` });
    }
    const task = await pendingTask(c, id);
    if (!task) return refuse(c, 404, { code: 'not_found', message: 'No suggested task has that id.' });
    // The status guard is the once: a second approval changes no row.
    const upd = await c.env.DB.prepare(
      `UPDATE community_tasks SET status = 'approved', audience = ?, decided_by = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'`,
    ).bind(audience, admin.id, new Date().toISOString(), id).run();
    if (Number(upd?.meta?.changes ?? 0) !== 1) {
      return refuse(c, 409, { code: 'already_decided', message: `This task was already ${task.status}; nothing was changed.`, extra: { status: task.status } });
    }
    const reward = task.user_id
      ? await grantCredits(c.env, {
        userId: task.user_id, ruleKey: 'task_approved', sourceRef: `task:${id}`,
        actor: { kind: 'admin', id: admin.id, email: admin.email },
      })
      : { status: 'refused' as const, code: 'user_not_found' as const, message: 'The ticket has no account to reward.' };
    await logAdminAction(c.env, admin.id, admin.email, 'community_task_approved', {
      community_task_id: id, ticket_id: task.ticket_id, target_user_id: task.user_id, audience, reason: read.reason,
      reward: reward.status === 'refused' ? reward.code : reward.status,
    });
    return c.json({ ok: true, id, status: 'approved', audience, reward });
  } catch (e) { return mapError(c, e); }
});

r.post('/tasks/:id/decline', async (c) => {
  try {
    const admin = await requireSuperAdmin(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return refuse(c, 400, { code: 'invalid_id', message: 'That is not a task id.' });
    const read = await readReason(c);
    if (read instanceof Response) return read;
    const task = await pendingTask(c, id);
    if (!task) return refuse(c, 404, { code: 'not_found', message: 'No suggested task has that id.' });
    const upd = await c.env.DB.prepare(
      `UPDATE community_tasks SET status = 'declined', decline_reason = ?, decided_by = ?, decided_at = ?
        WHERE id = ? AND status = 'pending'`,
    ).bind(read.reason, admin.id, new Date().toISOString(), id).run();
    if (Number(upd?.meta?.changes ?? 0) !== 1) {
      return refuse(c, 409, { code: 'already_decided', message: `This task was already ${task.status}; nothing was changed.`, extra: { status: task.status } });
    }
    await logAdminAction(c.env, admin.id, admin.email, 'community_task_declined', {
      community_task_id: id, ticket_id: task.ticket_id, target_user_id: task.user_id, reason: read.reason,
    });
    const notified = await tellUser(c.env, task.user_id, 'Your suggested task was declined',
      `"${task.title}" will not be published to the task list. The reason: "${read.reason}".`, { community_task_id: id });
    return c.json({ ok: true, id, status: 'declined', notified });
  } catch (e) { return mapError(c, e); }
});

export default r;

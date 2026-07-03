/**
 * Task #68 — Public Job Board: admin routes.
 *
 * Mounted at /api/admin/jobs, BEFORE the catch-all /api/admin router (same
 * mount-before-catch-all precedence as admin_events). Every handler is
 * requireAdmin; mutating actions append to admin_audit_log with
 * report_type='jobs' (audit writer mirrors admin_events.ts, tolerating the
 * optional `actor` column).
 *
 * The public-feed publish gate is enforced here: only an admin `approve` flips
 * a pending_review posting to status='published' + admin_published=1, which is
 * what the public feed predicate requires.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { notify } from '../services/notify';
import { ensureJobBoardSchema } from '../services/jobBoardSchema';
import { shapeJobPosting } from '../services/jobBoardCommon';

const adminJobs = new Hono<{ Bindings: Env }>();

adminJobs.use('*', async (c, next) => {
  await ensureJobBoardSchema(c.env);
  await next();
});

async function admin(c: any) {
  try {
    return await requireAdmin(c);
  } catch (e) {
    const msg = (e as Error)?.message;
    return c.json({ error: msg || 'Admin required' }, msg === 'Unauthorized' ? 401 : 403);
  }
}

let _auditHasActor: boolean | null = null;
async function auditHasActor(env: Env): Promise<boolean> {
  if (_auditHasActor !== null) return _auditHasActor;
  try {
    const r: any = await env.DB.prepare("PRAGMA table_info('admin_audit_log')").all();
    _auditHasActor = (r.results || []).some((col: any) => String(col.name) === 'actor');
  } catch {
    _auditHasActor = false;
  }
  return _auditHasActor === true;
}

async function hashEmail(email: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(email.toLowerCase());
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

async function writeAudit(
  env: Env,
  opts: { adminId: number; adminEmail: string; action: string; postingId?: number; extra?: Record<string, unknown> },
) {
  try {
    const filters = JSON.stringify({ posting_id: opts.postingId, ...(opts.extra || {}) });
    if (await auditHasActor(env)) {
      const actor = await hashEmail(opts.adminEmail);
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, actor) VALUES (?, ?, 'jobs', ?, ?)`,
      ).bind(opts.adminId, opts.action, filters, actor).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json) VALUES (?, ?, 'jobs', ?)`,
      ).bind(opts.adminId, opts.action, filters).run();
    }
  } catch (e) {
    console.warn('[admin_jobs] audit write failed:', (e as Error).message);
  }
}

async function loadPosting(env: Env, id: number): Promise<any | null> {
  return env.DB.prepare(
    `SELECT j.*, p.name AS project_name,
            (SELECT COUNT(*) FROM job_applications a WHERE a.posting_id = j.id) AS application_count
       FROM job_postings j
       LEFT JOIN projects p ON p.id = j.project_id
      WHERE j.id = ?`,
  ).bind(id).first();
}

function intParam(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── GET / — admin posting queue / list ─────────────────────────────────────
adminJobs.get('/', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') || 50) || 50, 200);
  const offset = Math.max(Number(c.req.query('offset') || 0) || 0, 0);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status) { where.push('j.status = ?'); binds.push(status); }
  const rows = await c.env.DB.prepare(
    `SELECT j.*, p.name AS project_name,
            (SELECT COUNT(*) FROM job_applications a WHERE a.posting_id = j.id) AS application_count
       FROM job_postings j
       LEFT JOIN projects p ON p.id = j.project_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all();
  return c.json({ jobs: (rows.results || []).map((r) => shapeJobPosting(r, { includePrivate: true })) });
});

// ── GET /:id — admin posting detail ────────────────────────────────────────
adminJobs.get('/:id', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  return c.json({ job: shapeJobPosting(posting, { includePrivate: true }) });
});

// ── POST /:id/approve — publish to the public feed ─────────────────────────
adminJobs.post('/:id/approve', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(
    `UPDATE job_postings SET status = 'published', admin_published = 1, review_notes = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'job_approved', postingId: id });
  if (posting.host_user_id) {
    await notify(c.env, {
      userId: Number(posting.host_user_id), type: 'job_approved', category: 'jobs',
      title: `Your role is live: ${posting.title}`, link: `/jobs/${posting.slug}`, payload: { posting_id: id },
    }).catch(() => {});
  }
  return c.json({ job: shapeJobPosting(await loadPosting(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/reject — bounce back from the review queue ────────────────────
adminJobs.post('/:id/reject', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({} as any));
  const reason = body.reason ? String(body.reason).slice(0, 1000) : null;
  await c.env.DB.prepare(
    `UPDATE job_postings SET status = 'rejected', admin_published = 0, review_notes = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(reason, id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'job_rejected', postingId: id, extra: { reason } });
  if (posting.host_user_id) {
    await notify(c.env, {
      userId: Number(posting.host_user_id), type: 'job_rejected', category: 'jobs',
      title: `Role needs changes: ${posting.title}`, body: reason || undefined,
      link: `/jobs/${id}/manage`, payload: { posting_id: id },
    }).catch(() => {});
  }
  return c.json({ job: shapeJobPosting(await loadPosting(c.env, id), { includePrivate: true }) });
});

// ── POST /:id/unpublish — pull from the public feed ────────────────────────
adminJobs.post('/:id/unpublish', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const posting = await loadPosting(c.env, id);
  if (!posting) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(
    `UPDATE job_postings SET admin_published = 0, status = 'draft', updated_at = datetime('now') WHERE id = ?`,
  ).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'job_unpublished', postingId: id });
  return c.json({ job: shapeJobPosting(await loadPosting(c.env, id), { includePrivate: true }) });
});

export default adminJobs;

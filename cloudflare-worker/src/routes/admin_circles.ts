/**
 * Task #9 — Communities & Circles: admin CRUD routes.
 *
 * Mounted at /api/admin/circles, BEFORE the catch-all /api/admin router (same
 * mount-before-catch-all precedence as admin_events / admin_jobs). Every handler
 * is requireAdmin; mutating actions append to admin_audit_log with
 * report_type='circles' (audit writer mirrors admin_jobs.ts, tolerating the
 * optional `actor` column).
 *
 * Circles are fully admin-authored here (no founder-submission queue) — the
 * public /circles page shows only rows an admin has published (published=1).
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAdmin } from '../auth';
import { ensureCirclesSchema } from '../services/circlesSchema';
import { parseCircleBody, shapeCircle, slugify, uniqueCircleSlug } from '../services/circlesCommon';

const adminCircles = new Hono<{ Bindings: Env }>();

adminCircles.use('*', async (c, next) => {
  await ensureCirclesSchema(c.env);
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
  opts: { adminId: number; adminEmail: string; action: string; circleId?: number; extra?: Record<string, unknown> },
) {
  try {
    const filters = JSON.stringify({ circle_id: opts.circleId, ...(opts.extra || {}) });
    if (await auditHasActor(env)) {
      const actor = await hashEmail(opts.adminEmail);
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json, actor) VALUES (?, ?, 'circles', ?, ?)`,
      ).bind(opts.adminId, opts.action, filters, actor).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO admin_audit_log (admin_user_id, action, report_type, filters_json) VALUES (?, ?, 'circles', ?)`,
      ).bind(opts.adminId, opts.action, filters).run();
    }
  } catch (e) {
    console.warn('[admin_circles] audit write failed:', (e as Error).message);
  }
}

async function loadCircle(env: Env, id: number): Promise<any | null> {
  return env.DB.prepare(`SELECT * FROM circles WHERE id = ?`).bind(id).first();
}

function intParam(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── GET / — full admin list (published + draft) ────────────────────────────
adminCircles.get('/', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const status = c.req.query('status'); // 'published' | 'draft' | undefined
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status === 'published') where.push('published = 1');
  else if (status === 'draft') where.push('published = 0');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM circles
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY sort_order ASC, created_at DESC`,
  ).bind(...binds).all();
  return c.json({ circles: (rows.results || []).map(shapeCircle) });
});

// ── GET /:id — admin detail ────────────────────────────────────────────────
adminCircles.get('/:id', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const row = await loadCircle(c.env, id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ circle: shapeCircle(row) });
});

// ── POST / — create a circle ───────────────────────────────────────────────
adminCircles.post('/', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const body = await c.req.json().catch(() => ({} as any));
  const parsed = parseCircleBody(body || {});
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const v = parsed.value;
  const slug = await uniqueCircleSlug(c.env.DB, slugify(v.name));
  const res = await c.env.DB.prepare(
    `INSERT INTO circles
       (slug, name, type, access, tagline, region, theme, members, activity,
        upcoming_events, discussions, tags, hosted_by, featured, published, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    slug, v.name, v.type, v.access, v.tagline, v.region, v.theme, v.members, v.activity,
    v.upcomingEvents, v.discussions, JSON.stringify(v.tags), v.hostedBy, v.featured, v.published, v.sortOrder,
  ).run();
  const id = Number(res.meta?.last_row_id);
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'circle_created', circleId: id, extra: { published: v.published } });
  const row = await loadCircle(c.env, id);
  return c.json({ circle: shapeCircle(row) }, 201);
});

// ── PATCH /:id — update a circle ───────────────────────────────────────────
// NOTE: full-replace, not merge — parseCircleBody requires `name` and defaults
// every omitted field (counters → 0). The admin UI always sends the complete
// form, so a partial body would reset unspecified fields by design.
adminCircles.patch('/:id', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  const existing = await loadCircle(c.env, id);
  if (!existing) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({} as any));
  const parsed = parseCircleBody(body || {});
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const v = parsed.value;
  // Re-slug only when the name changed, keeping uniqueness (excluding self).
  const slug = v.name === existing.name
    ? existing.slug
    : await uniqueCircleSlug(c.env.DB, slugify(v.name), id);
  await c.env.DB.prepare(
    `UPDATE circles SET
       slug = ?, name = ?, type = ?, access = ?, tagline = ?, region = ?, theme = ?,
       members = ?, activity = ?, upcoming_events = ?, discussions = ?, tags = ?,
       hosted_by = ?, featured = ?, published = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(
    slug, v.name, v.type, v.access, v.tagline, v.region, v.theme,
    v.members, v.activity, v.upcomingEvents, v.discussions, JSON.stringify(v.tags),
    v.hostedBy, v.featured, v.published, v.sortOrder, id,
  ).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'circle_updated', circleId: id });
  return c.json({ circle: shapeCircle(await loadCircle(c.env, id)) });
});

// ── POST /:id/publish — show on the public feed ────────────────────────────
adminCircles.post('/:id/publish', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  if (!(await loadCircle(c.env, id))) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE circles SET published = 1, updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'circle_published', circleId: id });
  return c.json({ circle: shapeCircle(await loadCircle(c.env, id)) });
});

// ── POST /:id/unpublish — pull from the public feed ────────────────────────
adminCircles.post('/:id/unpublish', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  if (!(await loadCircle(c.env, id))) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`UPDATE circles SET published = 0, updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'circle_unpublished', circleId: id });
  return c.json({ circle: shapeCircle(await loadCircle(c.env, id)) });
});

// ── POST /:id/feature — toggle the featured flag ───────────────────────────
adminCircles.post('/:id/feature', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  if (!(await loadCircle(c.env, id))) return c.json({ error: 'not_found' }, 404);
  const body = await c.req.json().catch(() => ({} as any));
  const featured = body.featured ? 1 : 0;
  await c.env.DB.prepare(`UPDATE circles SET featured = ?, updated_at = datetime('now') WHERE id = ?`).bind(featured, id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'circle_featured', circleId: id, extra: { featured } });
  return c.json({ circle: shapeCircle(await loadCircle(c.env, id)) });
});

// ── DELETE /:id — remove a circle ──────────────────────────────────────────
adminCircles.delete('/:id', async (c) => {
  const a = await admin(c);
  if (a instanceof Response) return a;
  const id = intParam(c.req.param('id'));
  if (!id) return c.json({ error: 'not_found' }, 404);
  if (!(await loadCircle(c.env, id))) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(`DELETE FROM circles WHERE id = ?`).bind(id).run();
  await writeAudit(c.env, { adminId: a.id, adminEmail: a.email, action: 'circle_deleted', circleId: id });
  return c.json({ ok: true });
});

export default adminCircles;

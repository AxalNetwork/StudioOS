/**
 * Contacts — unified inbound relationship hub (founder side).
 *
 * Generalizes landing-page `waitlist_signups` into a managed CRM: every landing
 * CTA (or founder-initiated invite) becomes a `contacts` row tagged by audience,
 * with a status pipeline, reply log, and follow-up tasks. Routing on ingest
 * sends customers toward Customer Discovery, investors toward the raise pipeline,
 * and everyone else (partner/advisor/mentor/cofounder) into the network pipeline.
 *
 * Mounted at /api/contacts. Founder-owned (admin bypasses). The table is created
 * lazily (mirroring brand.ts) so it exists at runtime before the 120 migration
 * is applied; the migration is the canonical record.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireRole } from '../auth';
import { isAdmin, isFounder, mapError, nowIso, newUid } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();

export const CONTACT_AUDIENCES = ['customer', 'investor', 'partner', 'advisor', 'mentor', 'cofounder'];
const CONTACT_STATUSES = ['new', 'invited', 'contacted', 'replied', 'qualified', 'active', 'passed'];

/** Audience → founder workflow the contact should feed. */
export function routeFor(audience: string): string {
  if (audience === 'customer') return 'discovery';
  if (audience === 'investor') return 'raise';
  return 'network';
}

type ContactRow = {
  id: number; uid: string; project_id: number; audience: string; routed_to: string;
  name: string | null; email: string; cta: string | null; message: string | null;
  source: string | null; landing_page_id: number | null; status: string;
  promoted_to: string | null; last_activity_at: string | null;
  created_at: string; updated_at: string;
};

let _ensured = false;
async function ensureSchema(env: Env): Promise<void> {
  if (_ensured) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS contacts (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       project_id INTEGER NOT NULL,
       audience TEXT NOT NULL,
       routed_to TEXT NOT NULL DEFAULT 'network',
       name TEXT, email TEXT NOT NULL,
       cta TEXT, message TEXT, source TEXT,
       landing_page_id INTEGER,
       status TEXT NOT NULL DEFAULT 'new',
       promoted_to TEXT,
       last_activity_at TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts(project_id, audience)`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status)`,
    `CREATE TABLE IF NOT EXISTS contact_replies (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       contact_id INTEGER NOT NULL,
       direction TEXT NOT NULL DEFAULT 'inbound',
       body TEXT,
       created_by INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_contact_replies_contact ON contact_replies(contact_id)`,
    `CREATE TABLE IF NOT EXISTS contact_tasks (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       contact_id INTEGER NOT NULL,
       title TEXT NOT NULL,
       due_date TEXT,
       done INTEGER NOT NULL DEFAULT 0,
       created_by INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_contact_tasks_contact ON contact_tasks(contact_id)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
  _ensured = true;
}

/**
 * Ingest a captured lead into the Contacts hub. Called from the public landing
 * subscribe handler (brand.ts) and from founder-initiated invites. Best-effort:
 * callers should not let a Contacts failure break the capture response.
 */
export async function ingestContact(
  env: Env,
  opts: { projectId: number; landingPageId?: number | null; email: string; name?: string | null; audience?: string | null; cta?: string | null; message?: string | null; source?: string | null; status?: string },
): Promise<void> {
  await ensureSchema(env);
  const audience = opts.audience && CONTACT_AUDIENCES.includes(opts.audience) ? opts.audience : 'customer';
  const uid = newUid();
  await env.DB.prepare(
    `INSERT INTO contacts (uid, project_id, audience, routed_to, name, email, cta, message, source, landing_page_id, status, last_activity_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uid, opts.projectId, audience, routeFor(audience),
    opts.name || null, String(opts.email).toLowerCase(),
    opts.cta || null, opts.message || null, opts.source || 'landing',
    opts.landingPageId ?? null,
    opts.status && CONTACT_STATUSES.includes(opts.status) ? opts.status : 'new',
    nowIso(), nowIso(), nowIso(),
  ).run();
}

/** Project ids owned by the founder (or 'all' for admin). */
async function ownedProjectScope(env: Env, user: User): Promise<'all' | number[]> {
  if (isAdmin(user)) return 'all';
  if (!user.founder_id) return [];
  const rows = await env.DB.prepare('SELECT id FROM projects WHERE founder_id = ? AND deleted_at IS NULL').bind(user.founder_id).all<{ id: number }>();
  return (rows.results || []).map((x) => Number(x.id));
}

async function loadOwned(env: Env, uid: string, user: User): Promise<ContactRow | 'notfound' | 'forbidden'> {
  const row = await env.DB.prepare('SELECT * FROM contacts WHERE uid = ?').bind(uid).first<ContactRow>();
  if (!row) return 'notfound';
  if (isAdmin(user)) return row;
  const scope = await ownedProjectScope(env, user);
  if (scope === 'all' || (Array.isArray(scope) && scope.includes(row.project_id))) return row;
  return 'forbidden';
}

// GET /api/contacts — founder inbox (filter by audience / status / routed_to)
r.get('/', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const scope = await ownedProjectScope(c.env, user);
    let where = '1=1';
    const params: any[] = [];
    if (scope !== 'all') {
      if (scope.length === 0) return c.json({ items: [], counts: {} });
      where += ` AND project_id IN (${scope.map(() => '?').join(',')})`;
      params.push(...scope);
    }
    const audience = c.req.query('audience');
    const status = c.req.query('status');
    const routed = c.req.query('routed_to');
    if (audience) { where += ' AND audience = ?'; params.push(audience); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (routed) { where += ' AND routed_to = ?'; params.push(routed); }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM contacts WHERE ${where} ORDER BY COALESCE(last_activity_at, created_at) DESC LIMIT 500`
    ).bind(...params).all<ContactRow>();
    const items = (rows.results || []) as ContactRow[];
    const counts: Record<string, number> = {};
    for (const it of items) counts[it.audience] = (counts[it.audience] || 0) + 1;
    return c.json({ items, counts });
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts — founder manually adds a contact (own project)
r.post('/', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    const email = String(body.email || '').trim().toLowerCase();
    if (!Number.isFinite(projectId) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return c.json({ detail: 'project_id and a valid email are required' }, 400);
    }
    const scope = await ownedProjectScope(c.env, user);
    if (scope !== 'all' && !scope.includes(projectId)) return c.json({ detail: 'Forbidden' }, 403);
    await ingestContact(c.env, {
      projectId, email, name: body.name, audience: body.audience,
      cta: body.cta, message: body.message, source: body.source || 'manual',
    });
    const row = await c.env.DB.prepare('SELECT * FROM contacts WHERE project_id = ? AND email = ? ORDER BY id DESC LIMIT 1').bind(projectId, email).first<ContactRow>();
    return c.json(row, 201);
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/invite — founder sends an invitation (creates an 'invited' contact)
r.post('/invite', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    const email = String(body.email || '').trim().toLowerCase();
    if (!Number.isFinite(projectId) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return c.json({ detail: 'project_id and a valid email are required' }, 400);
    }
    const scope = await ownedProjectScope(c.env, user);
    if (scope !== 'all' && !scope.includes(projectId)) return c.json({ detail: 'Forbidden' }, 403);
    await ingestContact(c.env, {
      projectId, email, name: body.name, audience: body.audience,
      cta: 'invite', message: body.message, source: 'invite', status: 'invited',
    });
    // Note: transactional email delivery reuses routes/email.ts (follow-up wiring).
    const row = await c.env.DB.prepare('SELECT * FROM contacts WHERE project_id = ? AND email = ? ORDER BY id DESC LIMIT 1').bind(projectId, email).first<ContactRow>();
    return c.json(row, 201);
  } catch (e) { return mapError(c, e); }
});

// GET /api/contacts/:uid — detail with replies + tasks
r.get('/:uid', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c.env, c.req.param('uid'), user);
    if (row === 'notfound') return c.json({ detail: 'Not found' }, 404);
    if (row === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    const replies = await c.env.DB.prepare('SELECT id, direction, body, created_by, created_at FROM contact_replies WHERE contact_id = ? ORDER BY created_at ASC').bind(row.id).all<any>();
    const tasks = await c.env.DB.prepare('SELECT id, title, due_date, done, created_at FROM contact_tasks WHERE contact_id = ? ORDER BY done ASC, created_at ASC').bind(row.id).all<any>();
    return c.json({ ...row, replies: replies.results || [], tasks: tasks.results || [] });
  } catch (e) { return mapError(c, e); }
});

// PUT /api/contacts/:uid — update status / name / audience
r.put('/:uid', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c.env, c.req.param('uid'), user);
    if (row === 'notfound') return c.json({ detail: 'Not found' }, 404);
    if (row === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    let status = row.status;
    if (body.status && CONTACT_STATUSES.includes(body.status)) status = body.status;
    let audience = row.audience;
    let routed = row.routed_to;
    if (body.audience && CONTACT_AUDIENCES.includes(body.audience)) { audience = body.audience; routed = routeFor(audience); }
    const name = body.name !== undefined ? (body.name ? String(body.name).slice(0, 200) : null) : row.name;
    await c.env.DB.prepare(
      `UPDATE contacts SET status=?, audience=?, routed_to=?, name=?, last_activity_at=?, updated_at=? WHERE id=?`
    ).bind(status, audience, routed, name, nowIso(), nowIso(), row.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
    return c.json(fresh);
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/:uid/reply — log an inbound/outbound reply
r.post('/:uid/reply', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c.env, c.req.param('uid'), user);
    if (row === 'notfound') return c.json({ detail: 'Not found' }, 404);
    if (row === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const direction = body.direction === 'outbound' ? 'outbound' : 'inbound';
    await c.env.DB.prepare('INSERT INTO contact_replies (contact_id, direction, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, direction, body.body ? String(body.body).slice(0, 8000) : null, user.id, nowIso()).run();
    // Inbound replies advance a fresh contact to 'replied'.
    const newStatus = direction === 'inbound' && ['new', 'invited', 'contacted'].includes(row.status) ? 'replied' : row.status;
    await c.env.DB.prepare('UPDATE contacts SET status=?, last_activity_at=?, updated_at=? WHERE id=?').bind(newStatus, nowIso(), nowIso(), row.id).run();
    return c.json({ ok: true });
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/:uid/tasks — add a follow-up task
r.post('/:uid/tasks', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c.env, c.req.param('uid'), user);
    if (row === 'notfound') return c.json({ detail: 'Not found' }, 404);
    if (row === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    const title = body.title ? String(body.title).slice(0, 300) : null;
    if (!title) return c.json({ detail: 'title required' }, 400);
    await c.env.DB.prepare('INSERT INTO contact_tasks (contact_id, title, due_date, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, title, body.due_date ? String(body.due_date).slice(0, 32) : null, user.id, nowIso()).run();
    return c.json({ ok: true }, 201);
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/:uid/tasks/:taskId/toggle — flip a task done/undone
r.post('/:uid/tasks/:taskId/toggle', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c.env, c.req.param('uid'), user);
    if (row === 'notfound') return c.json({ detail: 'Not found' }, 404);
    if (row === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    const taskId = Number(c.req.param('taskId'));
    const t = await c.env.DB.prepare('SELECT id, done FROM contact_tasks WHERE id = ? AND contact_id = ?').bind(taskId, row.id).first<{ id: number; done: number }>();
    if (!t) return c.json({ detail: 'Not found' }, 404);
    await c.env.DB.prepare('UPDATE contact_tasks SET done = ? WHERE id = ?').bind(t.done ? 0 : 1, taskId).run();
    return c.json({ ok: true, done: t.done ? 0 : 1 });
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/:uid/promote — route a contact into its downstream workflow
r.post('/:uid/promote', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c.env, c.req.param('uid'), user);
    if (row === 'notfound') return c.json({ detail: 'Not found' }, 404);
    if (row === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    // Customers → Customer Discovery; investors → raise pipeline. Others have no
    // separate destination (they live in Contacts). Deep record creation in the
    // target module is a follow-up; here we stamp the promotion + qualify.
    const target = row.audience === 'customer' ? 'discovery' : row.audience === 'investor' ? 'raise' : null;
    if (!target) return c.json({ detail: 'This audience has no promotion target; manage it here.' }, 400);
    await c.env.DB.prepare('UPDATE contacts SET promoted_to=?, status=?, last_activity_at=?, updated_at=? WHERE id=?')
      .bind(target, 'qualified', nowIso(), nowIso(), row.id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
    return c.json({ ...fresh, promoted_to: target });
  } catch (e) { return mapError(c, e); }
});

export default r;

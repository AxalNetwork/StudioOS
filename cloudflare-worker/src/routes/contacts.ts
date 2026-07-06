/**
 * Contacts — unified inbound relationship hub (founder side).
 *
 * Generalizes landing-page `waitlist_signups` into a managed CRM: every landing
 * CTA (or founder-initiated invite) becomes a `contacts` row tagged by audience,
 * with a status pipeline, reply log, and follow-up tasks. Routing on ingest
 * sends customers toward Customer Discovery, investors toward the raise pipeline,
 * and everyone else (partner/advisor/cofounder) into the network pipeline.
 *
 * Mounted at /api/contacts. Founder-owned (admin bypasses). The table is created
 * lazily (mirroring brand.ts) so it exists at runtime before the 120 migration
 * is applied; the migration is the canonical record.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireRole } from '../auth';
import { isAdmin, mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { sendContactInviteEmail } from '../services/email';
import { FREE_TIER_LIMITS, userMeetsTier } from '../middleware/requireTier';
import {
  ensureDiscoveryInterviewFeaturedColumn,
  ensureDiscoveryValidationRatingColumns,
} from '../services/discoveryInterviewSchema';
import { hashEmail } from '../util/hashEmail';

const r = new Hono<{ Bindings: Env }>();

export const CONTACT_AUDIENCES = ['customer', 'investor', 'partner', 'advisor', 'advisor', 'cofounder'];
const CONTACT_STATUSES = ['new', 'invited', 'contacted', 'replied', 'qualified', 'active', 'passed'];

/** Investor raise-pipeline stages a promoted investor prospect moves through. */
export const RAISE_STAGES = ['to_contact', 'contacted', 'meeting', 'diligence', 'committed', 'passed'];

/** Audience → founder workflow the contact should feed. */
export function routeFor(audience: string): string {
  if (audience === 'customer') return 'discovery';
  if (audience === 'investor') return 'raise';
  return 'network';
}

/** D1 autoincrement id from an INSERT result (meta shape varies across libs). */
function lastInsertId(res: { meta?: { last_row_id?: number } }): number {
  const id = res.meta?.last_row_id;
  return typeof id === 'number' ? id : 0;
}

/** Rows changed by an UPDATE — used for the flip-from-NULL concurrency guard. */
function changedRows(res: { meta?: { changes?: number } }): number {
  return Number(res.meta?.changes ?? 0);
}

/** Best-effort activity log — never blocks the promote write. */
async function logPromotion(env: Env, user: User, projectId: number, detail: string): Promise<void> {
  try {
    const project = await env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first<{ name: string }>();
    const actor = await hashEmail(user.email);
    await env.DB.prepare(
      `INSERT INTO activity_logs (action, details, actor, user_id, project_id) VALUES (?, ?, ?, ?, ?)`,
    ).bind('contact_promoted', `Project ${project?.name ?? projectId}: ${detail}`, actor, user.id, projectId).run();
  } catch { /* activity logging must never block the write */ }
}

type ContactRow = {
  id: number; uid: string; project_id: number; audience: string; routed_to: string;
  name: string | null; email: string; cta: string | null; message: string | null;
  source: string | null; landing_page_id: number | null; status: string;
  promoted_to: string | null; promoted_ref_id: number | null; last_activity_at: string | null;
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
       promoted_ref_id INTEGER,
       last_activity_at TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_project ON contacts(project_id, audience)`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status)`,
    `CREATE TABLE IF NOT EXISTS contact_replies (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       contact_id INTEGER NOT NULL REFERENCES contacts(id),
       direction TEXT NOT NULL DEFAULT 'inbound',
       body TEXT,
       created_by INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_contact_replies_contact ON contact_replies(contact_id)`,
    `CREATE TABLE IF NOT EXISTS contact_tasks (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       contact_id INTEGER NOT NULL REFERENCES contacts(id),
       title TEXT NOT NULL,
       due_date TEXT,
       done INTEGER NOT NULL DEFAULT 0,
       created_by INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_contact_tasks_contact ON contact_tasks(contact_id)`,
    // Task #32 — investor raise pipeline. One row per promoted investor
    // prospect; the promoted contact links here via promoted_ref_id.
    `CREATE TABLE IF NOT EXISTS raise_prospects (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       project_id INTEGER NOT NULL,
       contact_id INTEGER,
       name TEXT, email TEXT, firm TEXT,
       stage TEXT NOT NULL DEFAULT 'to_contact',
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_raise_prospects_project ON raise_prospects(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_raise_prospects_contact ON raise_prospects(contact_id)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
  // Task #32 — self-heal promoted_ref_id on an EXISTING prod contacts table
  // (CREATE TABLE IF NOT EXISTS never adds columns to a table that already
  // exists). Canonical add is migration 128; this is the runtime safety net.
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(contacts)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((x) => x.name));
    if (!have.has('promoted_ref_id')) {
      try { await env.DB.prepare(`ALTER TABLE contacts ADD COLUMN promoted_ref_id INTEGER`).run(); }
      catch (e) { console.warn('[contacts] ALTER promoted_ref_id failed (likely already applied)', e); }
    }
  } catch (e) { console.warn('[contacts] promoted_ref_id bootstrap failed', e); }
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

// POST /api/contacts/invite — founder sends an invitation (creates an 'invited'
// contact AND delivers a real invitation email). Delivery failures are surfaced
// explicitly via `email_sent`/`email_error` on the response — never swallowed —
// while the contact row is still created so the founder can retry from the hub.
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
    const message = body.message ? String(body.message).slice(0, 2000) : '';
    await ingestContact(c.env, {
      projectId, email, name: body.name, audience: body.audience,
      cta: 'invite', message: message || null, source: 'invite', status: 'invited',
    });
    const row = await c.env.DB.prepare('SELECT * FROM contacts WHERE project_id = ? AND email = ? ORDER BY id DESC LIMIT 1').bind(projectId, email).first<ContactRow>();

    // Deliver the invitation email. The founder is the sender (Reply-To) so the
    // recipient's reply reaches them directly; From stays on noreply@axal.vc.
    const project = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first<{ name: string }>();
    const link = c.env.APP_URL || c.env.PUBLIC_BASE_URL || 'https://axal.vc';
    let emailSent = false;
    let emailError: string | null = null;
    try {
      emailSent = await sendContactInviteEmail(
        c.env, email, row?.name || body.name || '', user.name || 'Axal StudioOS',
        user.email || '', project?.name || '', link, message,
      );
      if (!emailSent) emailError = 'Email provider is not configured or rejected the message';
    } catch (e: any) {
      emailError = e?.message || 'Unknown error sending invite email';
    }
    // Only stamp the activity log once the invite has actually gone out, so the
    // contact history never claims a delivery that failed.
    if (emailSent && row) {
      await c.env.DB.prepare('INSERT INTO contact_replies (contact_id, direction, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(row.id, 'outbound', message ? `Invitation email sent:\n${message}` : 'Invitation email sent.', user.id, nowIso()).run();
      await c.env.DB.prepare('UPDATE contacts SET last_activity_at=?, updated_at=? WHERE id=?').bind(nowIso(), nowIso(), row.id).run();
    }
    return c.json({ ...row, email_sent: emailSent, ...(emailError ? { email_error: emailError } : {}) }, 201);
  } catch (e) { return mapError(c, e); }
});

// GET /api/contacts/raise-prospects — investor raise pipeline (own projects).
// Registered BEFORE /:uid so the static segment wins the Hono route match.
r.get('/raise-prospects', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const scope = await ownedProjectScope(c.env, user);
    let where = '1=1';
    const params: any[] = [];
    if (scope !== 'all') {
      if (scope.length === 0) return c.json({ items: [], stages: RAISE_STAGES });
      where += ` AND project_id IN (${scope.map(() => '?').join(',')})`;
      params.push(...scope);
    }
    const pid = c.req.query('project_id');
    if (pid) { where += ' AND project_id = ?'; params.push(Number(pid)); }
    const rows = await c.env.DB.prepare(
      `SELECT * FROM raise_prospects WHERE ${where} ORDER BY updated_at DESC LIMIT 500`,
    ).bind(...params).all<any>();
    return c.json({ items: rows.results || [], stages: RAISE_STAGES });
  } catch (e) { return mapError(c, e); }
});

// PUT /api/contacts/raise-prospects/:id — update stage / notes / firm / name.
r.put('/raise-prospects/:id', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    const scope = await ownedProjectScope(c.env, user);
    if (scope !== 'all' && !scope.includes(Number(row.project_id))) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    let stage = row.stage;
    if (body.stage && RAISE_STAGES.includes(body.stage)) stage = body.stage;
    const notes = body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 4000) : null) : row.notes;
    const firm = body.firm !== undefined ? (body.firm ? String(body.firm).slice(0, 200) : null) : row.firm;
    const name = body.name !== undefined ? (body.name ? String(body.name).slice(0, 200) : null) : row.name;
    await c.env.DB.prepare(
      `UPDATE raise_prospects SET stage=?, notes=?, firm=?, name=?, updated_at=? WHERE id=?`,
    ).bind(stage, notes, firm, name, nowIso(), id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ?').bind(id).first<any>();
    return c.json(fresh);
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

// POST /api/contacts/:uid/promote — create/link a REAL downstream record.
//
// Customers → a Customer Discovery interview (discovery_interviews); investors
// → a raise-pipeline prospect (raise_prospects). Idempotent: a re-promote (or
// double-click / retry) returns the existing linked record instead of creating
// a duplicate. The contact links back via promoted_ref_id (interpreted through
// promoted_to). Concurrency is guarded by only letting the request that flips
// promoted_ref_id from NULL win; the loser deletes its just-created row and
// returns the winner's — mirroring the waitlist→interview promote in
// routes/progress.ts. Others (partner/advisor/cofounder) have no
// downstream module and stay in Contacts.
r.post('/:uid/promote', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c.env, c.req.param('uid'), user);
    if (row === 'notfound') return c.json({ detail: 'Not found' }, 404);
    if (row === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    const db = c.env.DB;

    // ---- Customer → Customer Discovery interview ----
    if (row.audience === 'customer') {
      await ensureDiscoveryInterviewFeaturedColumn(c.env);
      await ensureDiscoveryValidationRatingColumns(c.env);

      // Idempotent — return the existing interview unless the link dangles
      // (interview since deleted → fall through and re-create).
      if (row.promoted_to === 'discovery' && row.promoted_ref_id) {
        const existing = await db.prepare('SELECT * FROM discovery_interviews WHERE id = ?')
          .bind(row.promoted_ref_id).first<any>();
        if (existing) {
          const fresh = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
          return c.json({ ...fresh, record: existing, already_promoted: true });
        }
      }

      // Free-tier cap mirrors create-interview / waitlist-promote so the button
      // is not a tier-cap bypass. Explicit 402 — never a silent fallback.
      if (user.role === 'founder' && !userMeetsTier(user, 'growth')) {
        const cnt = await db.prepare('SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?')
          .bind(row.project_id).first<{ n: number }>();
        if (Number(cnt?.n ?? 0) >= FREE_TIER_LIMITS.discoveryInterviews) {
          return c.json({ detail: `Free tier is capped at ${FREE_TIER_LIMITS.discoveryInterviews} customer interviews. Upgrade to Growth to promote more.` }, 402);
        }
      }

      const intervieweeName = (row.name && row.name.trim()) ? row.name.trim() : row.email;
      const notes = `Promoted from Contacts (${row.source || 'landing'}). Contact: ${row.email}`;
      const res = await db.prepare(
        `INSERT INTO discovery_interviews
           (project_id, interviewee_name, interviewee_role, interview_date,
            notes, hypotheses_json, pains_json, featured,
            validation_rating, validation_comment, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.project_id, intervieweeName, null, nowIso().slice(0, 10),
        notes, '[]', '[]', 0, null, null, nowIso(), nowIso(),
      ).run();
      const newId = lastInsertId(res);

      const upd = await db.prepare(
        `UPDATE contacts SET promoted_to='discovery', promoted_ref_id=?, status='qualified', last_activity_at=?, updated_at=?
          WHERE id=? AND (promoted_ref_id IS NULL OR promoted_ref_id = ?)`,
      ).bind(newId, nowIso(), nowIso(), row.id, row.promoted_ref_id).run();
      if (changedRows(upd) === 0) {
        // Lost the race — drop our interview and return the winner's link.
        await db.prepare('DELETE FROM discovery_interviews WHERE id = ?').bind(newId).run();
        const winner = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
        const winnerRec = winner?.promoted_ref_id
          ? await db.prepare('SELECT * FROM discovery_interviews WHERE id = ?').bind(winner.promoted_ref_id).first<any>()
          : null;
        return c.json({ ...winner, record: winnerRec, already_promoted: true });
      }

      await logPromotion(c.env, user, row.project_id, `promoted ${row.email} to a customer interview`);
      const fresh = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
      const record = await db.prepare('SELECT * FROM discovery_interviews WHERE id = ?').bind(newId).first<any>();
      return c.json({ ...fresh, record });
    }

    // ---- Investor → raise-pipeline prospect ----
    if (row.audience === 'investor') {
      if (row.promoted_to === 'raise' && row.promoted_ref_id) {
        const existing = await db.prepare('SELECT * FROM raise_prospects WHERE id = ?')
          .bind(row.promoted_ref_id).first<any>();
        if (existing) {
          const fresh = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
          return c.json({ ...fresh, record: existing, already_promoted: true });
        }
      }

      const res = await db.prepare(
        `INSERT INTO raise_prospects (uid, project_id, contact_id, name, email, firm, stage, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newUid(), row.project_id, row.id, row.name || null, row.email, null,
        'to_contact', row.message ? String(row.message).slice(0, 4000) : null,
        nowIso(), nowIso(),
      ).run();
      const newId = lastInsertId(res);

      const upd = await db.prepare(
        `UPDATE contacts SET promoted_to='raise', promoted_ref_id=?, status='qualified', last_activity_at=?, updated_at=?
          WHERE id=? AND (promoted_ref_id IS NULL OR promoted_ref_id = ?)`,
      ).bind(newId, nowIso(), nowIso(), row.id, row.promoted_ref_id).run();
      if (changedRows(upd) === 0) {
        await db.prepare('DELETE FROM raise_prospects WHERE id = ?').bind(newId).run();
        const winner = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
        const winnerRec = winner?.promoted_ref_id
          ? await db.prepare('SELECT * FROM raise_prospects WHERE id = ?').bind(winner.promoted_ref_id).first<any>()
          : null;
        return c.json({ ...winner, record: winnerRec, already_promoted: true });
      }

      await logPromotion(c.env, user, row.project_id, `promoted ${row.email} to the raise pipeline`);
      const fresh = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
      const record = await db.prepare('SELECT * FROM raise_prospects WHERE id = ?').bind(newId).first<any>();
      return c.json({ ...fresh, record });
    }

    return c.json({ detail: 'This audience has no promotion target; manage it here.' }, 400);
  } catch (e) { return mapError(c, e); }
});

export default r;

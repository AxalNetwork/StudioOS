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
import { projectInActiveCompany } from '../services/tenancyScope';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, requireRole } from '../auth';
import { isAdmin, mapError, nowIso, newUid } from './_t13t14t15_helpers';
import { sendContactInviteEmail } from '../services/email';
import { ensureAdvisorProfilesSchema } from '../services/advisorProfilesSchema';
import { FREE_TIER_LIMITS, userMeetsTier } from '../middleware/requireTier';
import {
  ensureDiscoveryInterviewFeaturedColumn,
  ensureDiscoveryValidationRatingColumns,
} from '../services/discoveryInterviewSchema';
import { hashEmail } from '../util/hashEmail';
import {
  computeRoundProgress, rollUpTranches, computeProRata, postRoundStake,
} from '../services/roundMath';

const r = new Hono<{ Bindings: Env }>();

// mentor is a first-class landing-page audience (see PAGE_AUDIENCE_SET in
// brand.ts) but was missing here, so mentor leads were coerced to 'customer' at
// ingest. Adding it lets mentor leads flow through and route to Advisory.
export const CONTACT_AUDIENCES = ['customer', 'investor', 'partner', 'advisor', 'mentor', 'cofounder'];
const CONTACT_STATUSES = ['new', 'invited', 'contacted', 'replied', 'qualified', 'active', 'passed'];

/** Investor raise-pipeline stages a promoted investor prospect moves through. */
export const RAISE_STAGES = ['to_contact', 'contacted', 'meeting', 'diligence', 'committed', 'passed'];

/**
 * Audience → founder destination the contact should feed. The map is complete
 * so no captured lead silently defaults to the generic Network inbox:
 *   customer → discovery   investor → raise       advisor/mentor → advisory
 *   cofounder → team       partner  → marketplace
 * Unknown audiences still fall back to 'network'. The Contacts inbox renders
 * these keys via ROUTED_LABEL; destination pages surface them with
 * IncomingLeadsStrip (filtered by audience, robust to legacy routed_to rows).
 */
export function routeFor(audience: string): string {
  switch (audience) {
    case 'customer': return 'discovery';
    case 'investor': return 'raise';
    case 'advisor':
    case 'mentor': return 'advisory';
    case 'cofounder': return 'team';
    case 'partner': return 'marketplace';
    default: return 'network';
  }
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
       -- Lead attribution (migration 166). utm_json is an allowlisted,
       -- length-clipped {utm_source,utm_medium,utm_campaign,utm_term,
       -- utm_content} blob; referrer is the capturing page's document.referrer.
       utm_json TEXT,
       referrer TEXT,
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
    // Raise Pipeline v1 — active round per project + investor updates. Canonical
    // record is migration 145; this bootstrap self-heals a DB baselined earlier.
    `CREATE TABLE IF NOT EXISTS raise_rounds (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       project_id INTEGER NOT NULL,
       name TEXT,
       target_amount REAL,
       close_date TEXT,
       status TEXT NOT NULL DEFAULT 'active',
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_raise_rounds_project ON raise_rounds(project_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_raise_rounds_active ON raise_rounds(project_id) WHERE status = 'active'`,
    `CREATE TABLE IF NOT EXISTS raise_investor_updates (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       project_id INTEGER NOT NULL,
       round_id INTEGER,
       subject TEXT NOT NULL,
       body TEXT,
       recipients_count INTEGER NOT NULL DEFAULT 0,
       created_by INTEGER,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_raise_updates_project ON raise_investor_updates(project_id)`,
    // Round Manager (#129) — closes/tranches + pro-rata rights. Canonical
    // record is migration 169; this bootstrap self-heals an earlier DB.
    `CREATE TABLE IF NOT EXISTS raise_closes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       project_id INTEGER NOT NULL,
       round_id INTEGER NOT NULL,
       name TEXT NOT NULL,
       sequence INTEGER NOT NULL DEFAULT 0,
       state TEXT NOT NULL DEFAULT 'planned',
       target_date TEXT,
       closed_date TEXT,
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_raise_closes_round ON raise_closes(round_id, sequence)`,
    `CREATE INDEX IF NOT EXISTS idx_raise_closes_project ON raise_closes(project_id)`,
    `CREATE TABLE IF NOT EXISTS raise_pro_rata (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       project_id INTEGER NOT NULL,
       round_id INTEGER NOT NULL,
       holder_name TEXT NOT NULL,
       holder_email TEXT,
       prior_stake_pct REAL NOT NULL DEFAULT 0,
       taking_amount REAL,
       state TEXT NOT NULL DEFAULT 'offered',
       offered_at TEXT,
       responded_at TEXT,
       notes TEXT,
       created_at TEXT NOT NULL DEFAULT (datetime('now')),
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    `CREATE INDEX IF NOT EXISTS idx_raise_pro_rata_round ON raise_pro_rata(round_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_raise_pro_rata_holder ON raise_pro_rata(round_id, holder_email) WHERE holder_email IS NOT NULL`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
  // Round Manager (#129) — self-heal the round/allocation columns on
  // EXISTING tables. Canonical adds are the ALTERs in migration 169;
  // same PRAGMA-guarded pattern as `amount` below.
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(raise_rounds)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((x) => x.name));
    for (const [col, decl] of [['pro_rata_reserved', 'REAL'], ['pre_money', 'REAL']] as const) {
      if (!have.has(col)) {
        try { await env.DB.prepare(`ALTER TABLE raise_rounds ADD COLUMN ${col} ${decl}`).run(); }
        catch (e) { console.warn(`[contacts] ALTER raise_rounds.${col} failed (likely already applied)`, e); }
      }
    }
  } catch (e) { console.warn('[contacts] raise_rounds round-manager bootstrap failed', e); }
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(raise_prospects)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((x) => x.name));
    for (const [col, decl] of [['close_id', 'INTEGER'], ['commit_status', 'TEXT'], ['instrument', 'TEXT']] as const) {
      if (!have.has(col)) {
        try { await env.DB.prepare(`ALTER TABLE raise_prospects ADD COLUMN ${col} ${decl}`).run(); }
        catch (e) { console.warn(`[contacts] ALTER raise_prospects.${col} failed (likely already applied)`, e); }
      }
    }
  } catch (e) { console.warn('[contacts] raise_prospects round-manager bootstrap failed', e); }
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
  // Raise Pipeline v1 — self-heal `amount` (check size) on an EXISTING
  // raise_prospects table. Canonical add is the ALTER in migration 145; this
  // PRAGMA-guarded runtime check is the reference pattern for ALTERs (see
  // documentation/architecture/GOTCHAS.md "Migrations & schema").
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(raise_prospects)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((x) => x.name));
    if (!have.has('amount')) {
      try { await env.DB.prepare(`ALTER TABLE raise_prospects ADD COLUMN amount REAL`).run(); }
      catch (e) { console.warn('[contacts] ALTER raise_prospects.amount failed (likely already applied)', e); }
    }
  } catch (e) { console.warn('[contacts] raise_prospects.amount bootstrap failed', e); }
  // Lead attribution — self-heal utm_json/referrer on an EXISTING contacts
  // table. Canonical add is migration 166; same PRAGMA-guarded pattern as
  // promoted_ref_id above (see documentation/architecture/GOTCHAS.md "Migrations & schema").
  try {
    const info = await env.DB.prepare(`PRAGMA table_info(contacts)`).all<{ name: string }>();
    const have = new Set((info.results || []).map((x) => x.name));
    for (const [col, decl] of [['utm_json', 'TEXT'], ['referrer', 'TEXT']] as const) {
      if (!have.has(col)) {
        try { await env.DB.prepare(`ALTER TABLE contacts ADD COLUMN ${col} ${decl}`).run(); }
        catch (e) { console.warn(`[contacts] ALTER ${col} failed (likely already applied)`, e); }
      }
    }
  } catch (e) { console.warn('[contacts] attribution bootstrap failed', e); }
  _ensured = true;
}

/**
 * Ingest a captured lead into the Contacts hub. Called from the public landing
 * subscribe handler (brand.ts) and from founder-initiated invites. Best-effort:
 * callers should not let a Contacts failure break the capture response.
 */
export async function ingestContact(
  env: Env,
  opts: {
    projectId: number; landingPageId?: number | null; email: string; name?: string | null;
    audience?: string | null; cta?: string | null; message?: string | null; source?: string | null;
    status?: string;
    /** Allowlisted utm_* map from the capturing page's querystring. */
    utm?: Record<string, string> | null;
    /** document.referrer of the capturing page. */
    referrer?: string | null;
  },
): Promise<void> {
  await ensureSchema(env);
  const audience = opts.audience && CONTACT_AUDIENCES.includes(opts.audience) ? opts.audience : 'customer';
  const uid = newUid();
  // Attribution is stored as a JSON blob rather than five columns: the set of
  // useful keys changes with whatever the founder runs campaigns on, and a
  // blob keeps that from being a migration each time. It is written only from
  // the allowlisted+clipped map the caller built, never raw request input.
  const utmJson = opts.utm && Object.keys(opts.utm).length ? JSON.stringify(opts.utm) : null;
  await env.DB.prepare(
    `INSERT INTO contacts (uid, project_id, audience, routed_to, name, email, cta, message, source, landing_page_id, status, utm_json, referrer, last_activity_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    uid, opts.projectId, audience, routeFor(audience),
    opts.name || null, String(opts.email).toLowerCase(),
    opts.cta || null, opts.message || null, opts.source || 'landing',
    opts.landingPageId ?? null,
    opts.status && CONTACT_STATUSES.includes(opts.status) ? opts.status : 'new',
    utmJson, opts.referrer || null,
    nowIso(), nowIso(), nowIso(),
  ).run();
}

/** The caller's active company for this request, verified once and memoised. */
async function activeCompanyFor(c: Context<{ Bindings: Env }>, user: User): Promise<number | null> {
  const cached = (c as any).get?.(ACTIVE_COMPANY_KEY);
  if (cached !== undefined) return cached as number | null;
  const id = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  (c as any).set?.(ACTIVE_COMPANY_KEY, id);
  return id;
}
const ACTIVE_COMPANY_KEY = '__activeCompanyId';

/**
 * Project ids owned by the founder (or 'all' for admin), narrowed to the
 * caller's active company.
 *
 * Company scoping, stage 3. This is the one surface in the rollout that is not
 * a project LOADER — it is the id list twenty-one handlers filter by, so
 * narrowing it here scopes all of them at once and no handler changes shape.
 *
 * `'all'` is admin and stays unscoped, exactly as `companyScope` leaves admin
 * unscoped. The array branch is the ownership path, and it is the only place
 * the company rule may apply: `projects.company_id` is the FOUNDER's company,
 * an id no other role's own firm can ever equal.
 *
 * Filtered in code with `projectInActiveCompany` rather than in the SQL so it
 * cannot drift from the loaders the other four files use — one predicate,
 * one meaning, tested against the SQL clause it mirrors.
 *
 * NOTE ON THE LAB. `requireRaiseUser` admits an ACTIVE Spin-Out Lab member
 * (role `exploring`, `spinout_lab_active = 1`) to the raise workflow. They
 * reach this function through the array branch like any other owner, so their
 * projects narrow by company the same way — which is correct, and touches
 * nothing inside the Lab itself.
 */
async function ownedProjectScope(c: Context<{ Bindings: Env }>, user: User): Promise<'all' | number[]> {
  if (isAdmin(user)) return 'all';
  if (!user.founder_id) return [];
  const rows = await c.env.DB.prepare(
    'SELECT id, company_id FROM projects WHERE founder_id = ? AND deleted_at IS NULL',
  ).bind(user.founder_id).all<{ id: number; company_id: number | null }>();
  const companyId = await activeCompanyFor(c, user);
  return (rows.results || [])
    .filter((x) => projectInActiveCompany(companyId, x))
    .map((x) => Number(x.id));
}

/**
 * Raise-pipeline auth. Founders own the raise workflow, but ACTIVE Spin-Out
 * Lab members (role `exploring` + spinout_lab_active=1) run their Week-4
 * raise through the lab Capital page too. Safe because every raise handler
 * scopes by ownedProjectScope(), which keys off founder_id — an explorer only
 * ever sees their own projects. Role alone is NOT enough: `exploring` is also
 * the pre-admission holding role, and those accounts must not get the lab
 * exception (mirrors advisors.ts).
 */
async function requireRaiseUser(c: Context<{ Bindings: Env }>): Promise<User> {
  const user = await requireAuth(c);
  if (user.role === 'admin' || user.role === 'founder') return user;
  if (user.role === 'exploring' && Number((user as any).spinout_lab_active ?? 0) === 1) return user;
  throw new Error('Forbidden');
}

async function loadOwned(c: Context<{ Bindings: Env }>, uid: string, user: User): Promise<ContactRow | 'notfound' | 'forbidden'> {
  const row = await c.env.DB.prepare('SELECT * FROM contacts WHERE uid = ?').bind(uid).first<ContactRow>();
  if (!row) return 'notfound';
  if (isAdmin(user)) return row;
  const scope = await ownedProjectScope(c, user);
  if (scope === 'all' || (Array.isArray(scope) && scope.includes(row.project_id))) return row;
  return 'forbidden';
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Non-negative finite number or null — check sizes / round targets. */
function normAmount(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Resolve which project a raise-round/update call targets.
 * - explicit project_id → must be in the founder's scope ('forbidden' if not);
 * - omitted + founder owns exactly one project → that project;
 * - omitted + founder owns none → null (caller returns an empty result);
 * - omitted + multiple projects, or admin ('all') → 'ambiguous' (400).
 */
function resolveProjectId(scope: 'all' | number[], pidRaw: string | undefined | null):
  number | null | 'ambiguous' | 'forbidden' {
  if (pidRaw !== undefined && pidRaw !== null && pidRaw !== '') {
    const pid = Number(pidRaw);
    if (!Number.isFinite(pid)) return 'ambiguous';
    if (scope !== 'all' && !scope.includes(pid)) return 'forbidden';
    return pid;
  }
  if (scope === 'all') return 'ambiguous';
  if (scope.length === 0) return null;
  if (scope.length === 1) return scope[0];
  return 'ambiguous';
}

/**
 * Create a raise prospect and (when an email is present) create-or-link the
 * underlying Contacts-hub row — the reverse direction of /:uid/promote, so a
 * form/CSV-created prospect still has a real contact record behind it and a
 * later promote of that contact short-circuits on promoted_ref_id instead of
 * duplicating the prospect. Returns 'duplicate' when the project already
 * tracks a prospect with this email, 'invalid' on bad input.
 */
async function createProspect(
  env: Env,
  projectId: number,
  input: { name?: unknown; email?: unknown; firm?: unknown; amount?: unknown; stage?: unknown; notes?: unknown },
): Promise<{ prospect: any } | 'duplicate' | 'invalid'> {
  const name = input.name ? String(input.name).trim().slice(0, 200) : null;
  const email = input.email ? String(input.email).trim().toLowerCase() : null;
  if (email && !EMAIL_RE.test(email)) return 'invalid';
  if (!name && !email) return 'invalid';
  const firm = input.firm ? String(input.firm).trim().slice(0, 200) : null;
  const notes = input.notes ? String(input.notes).slice(0, 4000) : null;
  const amount = normAmount(input.amount);
  const stage = typeof input.stage === 'string' && RAISE_STAGES.includes(input.stage) ? input.stage : 'to_contact';

  if (email) {
    const dup = await env.DB.prepare('SELECT id FROM raise_prospects WHERE project_id = ? AND email = ?')
      .bind(projectId, email).first<{ id: number }>();
    if (dup) return 'duplicate';
  }

  const res = await env.DB.prepare(
    `INSERT INTO raise_prospects (uid, project_id, contact_id, name, email, firm, stage, amount, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(newUid(), projectId, null, name, email, firm, stage, amount, notes, nowIso(), nowIso()).run();
  const prospectId = lastInsertId(res);
  let contactId: number | null = null;

  if (email) {
    // Contacts is the relationship hub — reuse an existing row for this
    // project+email, otherwise ingest a fresh investor contact. Only claim the
    // promoted link when it is unclaimed (never clobber e.g. a discovery link).
    let contact = await env.DB.prepare(
      'SELECT * FROM contacts WHERE project_id = ? AND email = ? ORDER BY id DESC LIMIT 1',
    ).bind(projectId, email).first<ContactRow>();
    if (!contact) {
      await ingestContact(env, { projectId, email, name, audience: 'investor', source: 'raise', status: 'qualified' });
      contact = await env.DB.prepare(
        'SELECT * FROM contacts WHERE project_id = ? AND email = ? ORDER BY id DESC LIMIT 1',
      ).bind(projectId, email).first<ContactRow>();
    }
    if (contact) {
      contactId = contact.id;
      if (contact.promoted_ref_id == null) {
        await env.DB.prepare(
          `UPDATE contacts SET promoted_to='raise', promoted_ref_id=?, status='qualified', last_activity_at=?, updated_at=?
            WHERE id=? AND promoted_ref_id IS NULL`,
        ).bind(prospectId, nowIso(), nowIso(), contact.id).run();
      }
      await env.DB.prepare('UPDATE raise_prospects SET contact_id=?, updated_at=? WHERE id=?')
        .bind(contact.id, nowIso(), prospectId).run();
    }
  }

  const prospect = await env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ?').bind(prospectId).first<any>();
  return { prospect: prospect || { id: prospectId, project_id: projectId, contact_id: contactId, name, email, firm, stage, amount, notes } };
}

// GET /api/contacts — founder inbox (filter by audience / status / routed_to)
r.get('/', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const scope = await ownedProjectScope(c, user);
    // Filters are qualified with the `c.` alias — the leads query LEFT JOINs
    // landing_pages, which shares the project_id and audience column names.
    let where = '1=1';
    const params: any[] = [];
    if (scope !== 'all') {
      if (scope.length === 0) return c.json({ items: [], counts: {} });
      where += ` AND c.project_id IN (${scope.map(() => '?').join(',')})`;
      params.push(...scope);
    }
    const audience = c.req.query('audience');
    const status = c.req.query('status');
    const routed = c.req.query('routed_to');
    if (audience) { where += ' AND c.audience = ?'; params.push(audience); }
    if (status) { where += ' AND c.status = ?'; params.push(status); }
    if (routed) { where += ' AND c.routed_to = ?'; params.push(routed); }
    // LEFT JOIN the source landing page so destination pages can show WHICH
    // template a lead signed up through ("Inbound leads · Brand & Pages").
    // Manually-added / invited contacts have no landing_page_id and come back
    // with NULL attribution — the UI treats that as "added directly".
    const rows = await c.env.DB.prepare(
      `SELECT c.*, lp.template_kit AS landing_template_kit, lp.name AS landing_page_name
         FROM contacts c
         LEFT JOIN landing_pages lp ON lp.id = c.landing_page_id
        WHERE ${where}
        ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC LIMIT 500`
    ).bind(...params).all<ContactRow & { landing_template_kit: string | null; landing_page_name: string | null }>();
    const items = (rows.results || []) as (ContactRow & { landing_template_kit: string | null; landing_page_name: string | null })[];
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
    const scope = await ownedProjectScope(c, user);
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
    const scope = await ownedProjectScope(c, user);
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
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const scope = await ownedProjectScope(c, user);
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
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    const scope = await ownedProjectScope(c, user);
    if (scope !== 'all' && !scope.includes(Number(row.project_id))) return c.json({ detail: 'Forbidden' }, 403);
    const body = await c.req.json().catch(() => ({} as any));
    let stage = row.stage;
    if (body.stage && RAISE_STAGES.includes(body.stage)) stage = body.stage;
    const notes = body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 4000) : null) : row.notes;
    const firm = body.firm !== undefined ? (body.firm ? String(body.firm).slice(0, 200) : null) : row.firm;
    const name = body.name !== undefined ? (body.name ? String(body.name).slice(0, 200) : null) : row.name;
    const amount = body.amount !== undefined ? normAmount(body.amount) : (row.amount ?? null);
    // Round Manager (#129) — allocation fields. A prospect that is not
    // committed carries no commit_status: a "wired" row sitting in the
    // Meeting column would be a contradiction the funnel would then
    // count as money.
    const commitStatus = stage !== 'committed'
      ? null
      : (body.commit_status !== undefined
        ? (COMMIT_STATUSES.includes(String(body.commit_status)) ? String(body.commit_status) : null)
        : (row.commit_status ?? null));
    const instrument = body.instrument !== undefined
      ? (INSTRUMENTS.includes(String(body.instrument)) ? String(body.instrument) : null)
      : (row.instrument ?? null);
    const closeId = body.close_id !== undefined
      ? (body.close_id == null ? null : Number(body.close_id))
      : (row.close_id ?? null);
    // A close must belong to this prospect's project — otherwise money
    // could be slotted into another founder's tranche by id guess.
    if (closeId != null) {
      const own = await c.env.DB.prepare(
        'SELECT 1 FROM raise_closes WHERE id = ? AND project_id = ? LIMIT 1',
      ).bind(closeId, Number(row.project_id)).first();
      if (!own) return c.json({ detail: 'close_id does not belong to this project' }, 400);
    }
    await c.env.DB.prepare(
      `UPDATE raise_prospects SET stage=?, notes=?, firm=?, name=?, amount=?, commit_status=?, instrument=?, close_id=?, updated_at=? WHERE id=?`,
    ).bind(stage, notes, firm, name, amount, commitStatus, instrument, closeId, nowIso(), id).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ?').bind(id).first<any>();
    return c.json(fresh);
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/raise-prospects — add an investor prospect directly from
// the pipeline (form). Creates-or-links the underlying Contacts-hub row.
r.post('/raise-prospects', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    if (!Number.isFinite(projectId)) return c.json({ detail: 'project_id is required' }, 400);
    const scope = await ownedProjectScope(c, user);
    if (scope !== 'all' && !scope.includes(projectId)) return c.json({ detail: 'Forbidden' }, 403);
    const out = await createProspect(c.env, projectId, body);
    if (out === 'invalid') return c.json({ detail: 'A name or a valid email is required' }, 400);
    if (out === 'duplicate') return c.json({ detail: 'This project already tracks a prospect with that email' }, 409);
    return c.json(out.prospect, 201);
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/raise-prospects/import — CSV import (parsed client-side).
// Rows are capped at 50 per request (each row costs several D1 calls; the SPA
// chunks bigger files). Per-row failures are reported, never silently dropped.
r.post('/raise-prospects/import', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const projectId = Number(body.project_id);
    if (!Number.isFinite(projectId)) return c.json({ detail: 'project_id is required' }, 400);
    const scope = await ownedProjectScope(c, user);
    if (scope !== 'all' && !scope.includes(projectId)) return c.json({ detail: 'Forbidden' }, 403);
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows || rows.length === 0) return c.json({ detail: 'rows is required' }, 400);
    if (rows.length > 50) return c.json({ detail: 'Import at most 50 rows per request' }, 400);
    let created = 0;
    const skipped: { row: number; reason: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const out = await createProspect(c.env, projectId, rows[i] || {});
      if (out === 'invalid') { skipped.push({ row: i + 1, reason: 'A name or a valid email is required' }); continue; }
      if (out === 'duplicate') { skipped.push({ row: i + 1, reason: 'Already in the pipeline' }); continue; }
      created++;
    }
    return c.json({ created, skipped, total: rows.length });
  } catch (e) { return mapError(c, e); }
});

// GET /api/contacts/raise-prospects/:id — drawer detail incl. the linked
// Contacts-hub record (via contact_id) so the SPA can render the contact card.
r.get('/raise-prospects/:id', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const id = Number(c.req.param('id'));
    const row = await c.env.DB.prepare('SELECT * FROM raise_prospects WHERE id = ?').bind(id).first<any>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    const scope = await ownedProjectScope(c, user);
    if (scope !== 'all' && !scope.includes(Number(row.project_id))) return c.json({ detail: 'Forbidden' }, 403);
    let contact: any = null;
    if (row.contact_id != null) {
      contact = await c.env.DB.prepare(
        'SELECT uid, name, email, audience, status, source, last_activity_at, created_at FROM contacts WHERE id = ?',
      ).bind(row.contact_id).first<any>();
    }
    return c.json({ ...row, contact: contact || null });
  } catch (e) { return mapError(c, e); }
});

// GET /api/contacts/raise-round — the project's active round + raised total
// (raised = SUM(amount) over committed prospects; explicit, never a stored
// counter that can drift).
r.get('/raise-round', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const scope = await ownedProjectScope(c, user);
    const pid = resolveProjectId(scope, c.req.query('project_id'));
    if (pid === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    if (pid === 'ambiguous') return c.json({ detail: 'project_id is required' }, 400);
    if (pid === null) return c.json({ round: null, raised: 0, committed_count: 0 });
    const round = await c.env.DB.prepare(
      `SELECT * FROM raise_rounds WHERE project_id = ? AND status = 'active'`,
    ).bind(pid).first<any>();
    const agg = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS raised, COUNT(*) AS n FROM raise_prospects WHERE project_id = ? AND stage = 'committed'`,
    ).bind(pid).first<{ raised: number; n: number }>();
    // Round Manager (#129) — the funnel split alongside the legacy
    // `raised` total. `progress.committed` equals `raised` until a
    // founder starts marking rows soft/wired, so nothing moves on the
    // deploy that ships this (see migration 169's note on commit_status).
    const allocations = await loadAllocations(c.env, pid).catch(() => []);
    return c.json({
      round: round || null,
      raised: Number(agg?.raised || 0),
      committed_count: Number(agg?.n || 0),
      progress: computeRoundProgress(allocations, round?.target_amount ?? null),
    });
  } catch (e) { return mapError(c, e); }
});

// PUT /api/contacts/raise-round — upsert the project's single active round.
// SELECT→UPDATE-else-INSERT; the partial unique index (project_id WHERE
// status='active') backstops races — the losing INSERT re-reads the winner.
r.put('/raise-round', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const scope = await ownedProjectScope(c, user);
    const pid = resolveProjectId(scope, body.project_id !== undefined ? String(body.project_id) : undefined);
    if (pid === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    if (pid === 'ambiguous' || pid === null) return c.json({ detail: 'project_id is required' }, 400);
    const name = body.name !== undefined ? (body.name ? String(body.name).trim().slice(0, 200) : null) : undefined;
    const target = body.target_amount !== undefined ? normAmount(body.target_amount) : undefined;
    const close = body.close_date !== undefined
      ? (body.close_date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.close_date)) ? String(body.close_date) : null)
      : undefined;
    const notes = body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 4000) : null) : undefined;

    const existing = await c.env.DB.prepare(
      `SELECT * FROM raise_rounds WHERE project_id = ? AND status = 'active'`,
    ).bind(pid).first<any>();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE raise_rounds SET name=?, target_amount=?, close_date=?, notes=?, updated_at=? WHERE id=?`,
      ).bind(
        name !== undefined ? name : existing.name,
        target !== undefined ? target : existing.target_amount,
        close !== undefined ? close : existing.close_date,
        notes !== undefined ? notes : existing.notes,
        nowIso(), existing.id,
      ).run();
      const fresh = await c.env.DB.prepare('SELECT * FROM raise_rounds WHERE id = ?').bind(existing.id).first<any>();
      return c.json(fresh);
    }
    try {
      const res = await c.env.DB.prepare(
        `INSERT INTO raise_rounds (uid, project_id, name, target_amount, close_date, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      ).bind(newUid(), pid, name ?? null, target ?? null, close ?? null, notes ?? null, nowIso(), nowIso()).run();
      const fresh = await c.env.DB.prepare('SELECT * FROM raise_rounds WHERE id = ?').bind(lastInsertId(res)).first<any>();
      return c.json(fresh, 201);
    } catch {
      // Lost the one-active-round race — return the winner.
      const winner = await c.env.DB.prepare(
        `SELECT * FROM raise_rounds WHERE project_id = ? AND status = 'active'`,
      ).bind(pid).first<any>();
      if (winner) return c.json(winner);
      throw new Error('Failed to save the round');
    }
  } catch (e) { return mapError(c, e); }
});

// ---------- Round Manager (#129): closes/tranches + pro-rata ----------

const CLOSE_STATES = ['planned', 'open', 'closed'];
const COMMIT_STATUSES = ['soft', 'signed', 'wired'];
const INSTRUMENTS = ['safe', 'note', 'equity'];
const PRO_RATA_STATES = ['offered', 'taking', 'waived', 'expired'];

function ymd(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Allocations for the round funnel. A prospect at stage='committed' IS
 * an allocation; `commit_status` refines it. NULL maps to 'signed' so
 * the new committed total exactly reproduces the legacy `raised` figure
 * on the deploy that introduces this — no number moves under founders.
 */
async function loadAllocations(env: Env, projectId: number): Promise<Array<{
  amount: number; status: 'soft' | 'signed' | 'wired'; close_id: number | null;
}>> {
  const rows = await env.DB.prepare(
    `SELECT amount, commit_status, close_id FROM raise_prospects
      WHERE project_id = ? AND stage = 'committed'`,
  ).bind(projectId).all<any>();
  return (rows.results || []).map((x: any) => ({
    amount: Number(x.amount) || 0,
    status: (COMMIT_STATUSES.includes(String(x.commit_status)) ? x.commit_status : 'signed') as 'soft' | 'signed' | 'wired',
    close_id: x.close_id == null ? null : Number(x.close_id),
  }));
}

// GET /api/contacts/raise-closes — tranches of the active round, each
// with its own subtotal, plus the round-level funnel.
r.get('/raise-closes', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const scope = await ownedProjectScope(c, user);
    const pid = resolveProjectId(scope, c.req.query('project_id'));
    if (pid === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    if (pid === 'ambiguous') return c.json({ detail: 'project_id is required' }, 400);
    if (pid === null) return c.json({ round: null, closes: [], progress: null, unassigned: null });

    const round = await c.env.DB.prepare(
      `SELECT * FROM raise_rounds WHERE project_id = ? AND status = 'active'`,
    ).bind(pid).first<any>();
    if (!round) return c.json({ round: null, closes: [], progress: null, unassigned: null });

    const [closeRows, allocations] = await Promise.all([
      c.env.DB.prepare(
        `SELECT * FROM raise_closes WHERE round_id = ? ORDER BY sequence, id`,
      ).bind(round.id).all<any>(),
      loadAllocations(c.env, pid),
    ]);
    const { tranches, unassigned } = rollUpTranches(
      (closeRows.results || []).map((x: any) => ({
        id: Number(x.id), name: String(x.name), state: x.state,
        target_date: x.target_date, closed_date: x.closed_date,
      })),
      allocations,
    );
    // Merge the rollup back onto the stored rows so the client gets uid
    // and notes alongside the computed subtotals.
    const byId = new Map(tranches.map(t => [t.id, t]));
    const closes = (closeRows.results || []).map((x: any) => ({ ...x, ...(byId.get(Number(x.id)) || {}) }));
    return c.json({
      round,
      closes,
      progress: computeRoundProgress(allocations, round.target_amount ?? null),
      unassigned,
    });
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/raise-closes — add a tranche to the active round.
r.post('/raise-closes', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const scope = await ownedProjectScope(c, user);
    const pid = resolveProjectId(scope, body.project_id !== undefined ? String(body.project_id) : undefined);
    if (pid === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    if (pid === 'ambiguous' || pid === null) return c.json({ detail: 'project_id is required' }, 400);
    const name = body.name ? String(body.name).trim().slice(0, 200) : '';
    if (!name) return c.json({ detail: 'name is required' }, 400);
    const state = CLOSE_STATES.includes(String(body.state)) ? String(body.state) : 'planned';

    const round = await c.env.DB.prepare(
      `SELECT id FROM raise_rounds WHERE project_id = ? AND status = 'active'`,
    ).bind(pid).first<{ id: number }>();
    if (!round) return c.json({ detail: 'Set up the round before adding closes' }, 400);
    const seqRow = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(sequence), -1) + 1 AS next FROM raise_closes WHERE round_id = ?`,
    ).bind(round.id).first<{ next: number }>();

    const res = await c.env.DB.prepare(
      `INSERT INTO raise_closes (uid, project_id, round_id, name, sequence, state, target_date, closed_date, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newUid(), pid, round.id, name,
      body.sequence != null ? Number(body.sequence) : Number(seqRow?.next || 0),
      state, ymd(body.target_date), ymd(body.closed_date),
      body.notes ? String(body.notes).slice(0, 4000) : null, nowIso(), nowIso(),
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM raise_closes WHERE id = ?').bind(lastInsertId(res)).first<any>();
    return c.json(fresh, 201);
  } catch (e) { return mapError(c, e); }
});

// PUT /api/contacts/raise-closes/:id — edit a tranche.
r.put('/raise-closes/:id', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const scope = await ownedProjectScope(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM raise_closes WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<any>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    // Ownership: the close must belong to a project the caller owns.
    if (scope !== 'all' && !scope.includes(Number(row.project_id))) return c.json({ detail: 'Forbidden' }, 403);

    const state = body.state !== undefined
      ? (CLOSE_STATES.includes(String(body.state)) ? String(body.state) : row.state)
      : row.state;
    // Marking a close 'closed' with no date stamps today — a closed
    // tranche without a date is not a useful record.
    const closedDate = body.closed_date !== undefined
      ? ymd(body.closed_date)
      : (state === 'closed' && !row.closed_date ? new Date().toISOString().slice(0, 10) : row.closed_date);

    await c.env.DB.prepare(
      `UPDATE raise_closes SET name=?, sequence=?, state=?, target_date=?, closed_date=?, notes=?, updated_at=? WHERE id=?`,
    ).bind(
      body.name !== undefined ? String(body.name).trim().slice(0, 200) || row.name : row.name,
      body.sequence !== undefined ? Number(body.sequence) : row.sequence,
      state,
      body.target_date !== undefined ? ymd(body.target_date) : row.target_date,
      closedDate,
      body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 4000) : null) : row.notes,
      nowIso(), row.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM raise_closes WHERE id = ?').bind(row.id).first<any>();
    return c.json(fresh);
  } catch (e) { return mapError(c, e); }
});

// GET /api/contacts/raise-pro-rata — existing holders' rights in the
// active round. Entitlements are COMPUTED per request (roundMath.ts) so
// they can never drift from the round size; only the holder's prior
// stake and their decision are stored.
r.get('/raise-pro-rata', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const scope = await ownedProjectScope(c, user);
    const pid = resolveProjectId(scope, c.req.query('project_id'));
    if (pid === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    if (pid === 'ambiguous') return c.json({ detail: 'project_id is required' }, 400);
    if (pid === null) return c.json({ round: null, holders: [], result: null });

    const round = await c.env.DB.prepare(
      `SELECT * FROM raise_rounds WHERE project_id = ? AND status = 'active'`,
    ).bind(pid).first<any>();
    if (!round) return c.json({ round: null, holders: [], result: null });

    const rows = await c.env.DB.prepare(
      `SELECT * FROM raise_pro_rata WHERE round_id = ? ORDER BY prior_stake_pct DESC, id`,
    ).bind(round.id).all<any>();
    const stored = rows.results || [];
    const result = computeProRata(
      stored.map((h: any) => ({
        key: String(h.uid),
        prior_stake_pct: Number(h.prior_stake_pct) || 0,
        taking: h.taking_amount == null ? null : Number(h.taking_amount),
        state: h.state,
      })),
      Number(round.target_amount) || 0,
      round.pro_rata_reserved == null ? null : Number(round.pro_rata_reserved),
    );
    // Stitch the computed entitlement onto each stored row.
    const byKey = new Map(result.rows.map(x => [x.key, x]));
    const holders = stored.map((h: any) => {
      const calc = byKey.get(String(h.uid));
      return {
        ...h,
        entitlement: calc?.entitlement ?? null,
        entitlement_raw: calc?.entitlement_raw ?? null,
        scaled: calc?.scaled ?? false,
        post_round_stake_pct: postRoundStake(
          Number(h.prior_stake_pct) || 0,
          Number(h.taking_amount) || 0,
          Number(round.pre_money) || 0,
          Number(round.target_amount) || 0,
        ),
      };
    });
    return c.json({ round, holders, result });
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/raise-pro-rata — add a holder to the pro-rata list.
// `seed_from_cap_table: true` imports every cap-table holder instead.
r.post('/raise-pro-rata', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const scope = await ownedProjectScope(c, user);
    const pid = resolveProjectId(scope, body.project_id !== undefined ? String(body.project_id) : undefined);
    if (pid === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    if (pid === 'ambiguous' || pid === null) return c.json({ detail: 'project_id is required' }, 400);
    const round = await c.env.DB.prepare(
      `SELECT id FROM raise_rounds WHERE project_id = ? AND status = 'active'`,
    ).bind(pid).first<{ id: number }>();
    if (!round) return c.json({ detail: 'Set up the round before tracking pro-rata' }, 400);

    if (body.seed_from_cap_table) {
      // Import the current cap table as a starting point. Existing rows
      // are left alone — a founder's edits outrank a stale snapshot.
      const holders = await c.env.DB.prepare(
        `SELECT name, email, ownership_pct FROM cap_table_holders
          WHERE project_id = ? AND ownership_pct IS NOT NULL AND ownership_pct > 0
          ORDER BY ownership_pct DESC LIMIT 100`,
      ).bind(pid).all<any>().catch(() => ({ results: [] as any[] }));
      let added = 0, skipped = 0;
      for (const h of (holders.results || [])) {
        const email = h.email ? String(h.email).toLowerCase().slice(0, 200) : null;
        if (email) {
          const dup = await c.env.DB.prepare(
            `SELECT 1 FROM raise_pro_rata WHERE round_id = ? AND LOWER(holder_email) = ? LIMIT 1`,
          ).bind(round.id, email).first();
          if (dup) { skipped++; continue; }
        }
        await c.env.DB.prepare(
          `INSERT INTO raise_pro_rata (uid, project_id, round_id, holder_name, holder_email, prior_stake_pct, state, offered_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'offered', NULL, ?, ?)`,
        ).bind(
          newUid(), pid, round.id, String(h.name || 'Holder').slice(0, 200), email,
          Number(h.ownership_pct) || 0, nowIso(), nowIso(),
        ).run();
        added++;
      }
      return c.json({ ok: true, added, skipped }, 201);
    }

    const name = body.holder_name ? String(body.holder_name).trim().slice(0, 200) : '';
    if (!name) return c.json({ detail: 'holder_name is required' }, 400);
    const stake = Number(body.prior_stake_pct);
    if (!Number.isFinite(stake) || stake < 0 || stake > 100) {
      return c.json({ detail: 'prior_stake_pct must be between 0 and 100' }, 400);
    }
    const res = await c.env.DB.prepare(
      `INSERT INTO raise_pro_rata (uid, project_id, round_id, holder_name, holder_email, prior_stake_pct, state, offered_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'offered', ?, ?, ?, ?)`,
    ).bind(
      newUid(), pid, round.id, name,
      body.holder_email ? String(body.holder_email).toLowerCase().slice(0, 200) : null,
      stake, ymd(body.offered_at), body.notes ? String(body.notes).slice(0, 4000) : null,
      nowIso(), nowIso(),
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM raise_pro_rata WHERE id = ?').bind(lastInsertId(res)).first<any>();
    return c.json(fresh, 201);
  } catch (e) { return mapError(c, e); }
});

// PUT /api/contacts/raise-pro-rata/:id — record an offer or a response.
r.put('/raise-pro-rata/:id', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const scope = await ownedProjectScope(c, user);
    const row = await c.env.DB.prepare('SELECT * FROM raise_pro_rata WHERE id = ?')
      .bind(Number(c.req.param('id'))).first<any>();
    if (!row) return c.json({ detail: 'Not found' }, 404);
    if (scope !== 'all' && !scope.includes(Number(row.project_id))) return c.json({ detail: 'Forbidden' }, 403);

    const state = body.state !== undefined
      ? (PRO_RATA_STATES.includes(String(body.state)) ? String(body.state) : row.state)
      : row.state;
    const stake = body.prior_stake_pct !== undefined ? Number(body.prior_stake_pct) : null;
    if (stake != null && (!Number.isFinite(stake) || stake < 0 || stake > 100)) {
      return c.json({ detail: 'prior_stake_pct must be between 0 and 100' }, 400);
    }
    // A holder who waives is not also taking money — clear the amount
    // rather than leaving a contradictory row behind.
    const taking = state === 'waived' || state === 'expired'
      ? null
      : (body.taking_amount !== undefined ? normAmount(body.taking_amount) : row.taking_amount);
    // Any state change away from 'offered' is a response; stamp it once.
    const responded = state !== 'offered' && !row.responded_at ? nowIso() : row.responded_at;

    await c.env.DB.prepare(
      `UPDATE raise_pro_rata SET holder_name=?, holder_email=?, prior_stake_pct=?, taking_amount=?, state=?, offered_at=?, responded_at=?, notes=?, updated_at=? WHERE id=?`,
    ).bind(
      body.holder_name !== undefined ? String(body.holder_name).trim().slice(0, 200) || row.holder_name : row.holder_name,
      body.holder_email !== undefined ? (body.holder_email ? String(body.holder_email).toLowerCase().slice(0, 200) : null) : row.holder_email,
      stake != null ? stake : row.prior_stake_pct,
      taking, state,
      body.offered_at !== undefined ? ymd(body.offered_at) : row.offered_at,
      responded,
      body.notes !== undefined ? (body.notes ? String(body.notes).slice(0, 4000) : null) : row.notes,
      nowIso(), row.id,
    ).run();
    const fresh = await c.env.DB.prepare('SELECT * FROM raise_pro_rata WHERE id = ?').bind(row.id).first<any>();
    return c.json(fresh);
  } catch (e) { return mapError(c, e); }
});

// GET /api/contacts/raise-updates — investor updates posted from the pipeline.
r.get('/raise-updates', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const scope = await ownedProjectScope(c, user);
    const pid = resolveProjectId(scope, c.req.query('project_id'));
    if (pid === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    if (pid === 'ambiguous') return c.json({ detail: 'project_id is required' }, 400);
    if (pid === null) return c.json({ items: [] });
    const rows = await c.env.DB.prepare(
      `SELECT * FROM raise_investor_updates WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
    ).bind(pid).all<any>();
    return c.json({ items: rows.results || [] });
  } catch (e) { return mapError(c, e); }
});

// POST /api/contacts/raise-updates — record an investor update. The update is
// stored on the pipeline and logged to every linked contact's timeline as an
// outbound reply (mirrors the invite precedent). It is NOT emailed — the UI
// says so explicitly rather than pretending delivery happened.
r.post('/raise-updates', async (c) => {
  try {
    const user = await requireRaiseUser(c);
    await ensureSchema(c.env);
    const body = await c.req.json().catch(() => ({} as any));
    const scope = await ownedProjectScope(c, user);
    const pid = resolveProjectId(scope, body.project_id !== undefined ? String(body.project_id) : undefined);
    if (pid === 'forbidden') return c.json({ detail: 'Forbidden' }, 403);
    if (pid === 'ambiguous' || pid === null) return c.json({ detail: 'project_id is required' }, 400);
    const subject = body.subject ? String(body.subject).trim().slice(0, 200) : '';
    if (!subject) return c.json({ detail: 'subject is required' }, 400);
    const text = body.body ? String(body.body).slice(0, 10000) : null;

    const round = await c.env.DB.prepare(
      `SELECT id FROM raise_rounds WHERE project_id = ? AND status = 'active'`,
    ).bind(pid).first<{ id: number }>();
    const recipients = await c.env.DB.prepare(
      `SELECT id, contact_id FROM raise_prospects WHERE project_id = ? AND stage != 'passed'`,
    ).bind(pid).all<{ id: number; contact_id: number | null }>();
    const recips = recipients.results || [];

    const res = await c.env.DB.prepare(
      `INSERT INTO raise_investor_updates (uid, project_id, round_id, subject, body, recipients_count, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newUid(), pid, round?.id ?? null, subject, text, recips.length, user.id, nowIso()).run();
    const updateId = lastInsertId(res);

    // Best-effort timeline log on each linked contact — batched into one D1
    // round-trip; a logging failure never rolls back the update itself.
    let loggedContacts = 0;
    const withContact = recips.filter((p) => p.contact_id != null);
    if (withContact.length > 0) {
      try {
        const logBody = `Investor update — ${subject}${text ? `\n\n${text.slice(0, 2000)}` : ''}`;
        await c.env.DB.batch(withContact.map((p) =>
          c.env.DB.prepare(
            'INSERT INTO contact_replies (contact_id, direction, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
          ).bind(p.contact_id, 'outbound', logBody, user.id, nowIso()),
        ));
        loggedContacts = withContact.length;
      } catch (e) { console.warn('[contacts] raise-update timeline log failed', e); }
    }

    const update = await c.env.DB.prepare('SELECT * FROM raise_investor_updates WHERE id = ?').bind(updateId).first<any>();
    return c.json({ ...update, logged_contacts: loggedContacts }, 201);
  } catch (e) { return mapError(c, e); }
});

// GET /api/contacts/:uid — detail with replies + tasks
r.get('/:uid', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c, c.req.param('uid'), user);
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
    const row = await loadOwned(c, c.req.param('uid'), user);
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
    const row = await loadOwned(c, c.req.param('uid'), user);
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
    const row = await loadOwned(c, c.req.param('uid'), user);
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
    const row = await loadOwned(c, c.req.param('uid'), user);
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
// routes/progress.ts. Advisors → an Advisory Suite directory profile (plus an
// invitation email). Others (partner/cofounder) have no downstream module and
// stay in Contacts.
r.post('/:uid/promote', async (c) => {
  try {
    const user = await requireRole(c, 'founder');
    await ensureSchema(c.env);
    const row = await loadOwned(c, c.req.param('uid'), user);
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

    // ---- Advisor → Advisory Suite directory profile ----
    if (row.audience === 'advisor') {
      await ensureAdvisorProfilesSchema(c.env);

      // Idempotent — return the existing profile unless the link dangles
      // (profile since deleted → fall through and re-create).
      if (row.promoted_to === 'advisory' && row.promoted_ref_id) {
        const existing = await db.prepare('SELECT * FROM advisor_profiles WHERE id = ?')
          .bind(row.promoted_ref_id).first<any>();
        if (existing) {
          const fresh = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
          return c.json({ ...fresh, record: existing, already_promoted: true });
        }
      }

      // Advisor profiles are founder-scoped. Derive the owner from the contact's
      // project, falling back to the promoting founder — refuse rather than
      // create an orphan invisible to every directory view.
      const project = await db.prepare('SELECT name, founder_id FROM projects WHERE id = ?')
        .bind(row.project_id).first<{ name: string | null; founder_id: number | null }>();
      const founderId = project?.founder_id ?? user.founder_id ?? null;
      if (!founderId) return c.json({ detail: 'Cannot resolve an owner for this advisor.' }, 400);

      const advisorName = (row.name && row.name.trim()) ? row.name.trim() : row.email;
      // Promotion from the Contacts waitlist is the Brand & Landing pipeline, a
      // trusted source — the advisor's email stays visible in the directory.
      const res = await db.prepare(
        `INSERT INTO advisor_profiles
           (founder_id, name, email, source, status, source_contact_id, created_at, updated_at)
         VALUES (?, ?, ?, 'brand-landing', 'active', ?, ?, ?)`,
      ).bind(founderId, advisorName, row.email, row.id, nowIso(), nowIso()).run();
      const newId = lastInsertId(res);

      const upd = await db.prepare(
        `UPDATE contacts SET promoted_to='advisory', promoted_ref_id=?, status='qualified', last_activity_at=?, updated_at=?
          WHERE id=? AND (promoted_ref_id IS NULL OR promoted_ref_id = ?)`,
      ).bind(newId, nowIso(), nowIso(), row.id, row.promoted_ref_id).run();
      if (changedRows(upd) === 0) {
        // Lost the race — drop our profile and return the winner's link.
        await db.prepare('DELETE FROM advisor_profiles WHERE id = ?').bind(newId).run();
        const winner = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
        const winnerRec = winner?.promoted_ref_id
          ? await db.prepare('SELECT * FROM advisor_profiles WHERE id = ?').bind(winner.promoted_ref_id).first<any>()
          : null;
        return c.json({ ...winner, record: winnerRec, already_promoted: true });
      }

      // Invite the advisor to join (reuse the /contacts/invite email path). A
      // send failure never rolls back the profile — surface email_sent /
      // email_error so the founder can retry, mirroring POST /invite.
      const link = c.env.APP_URL || c.env.PUBLIC_BASE_URL || 'https://axal.vc';
      const inviteMsg = `You've been invited to join ${project?.name || 'the venture'} as an advisor.`;
      let emailSent = false;
      let emailError: string | null = null;
      try {
        emailSent = await sendContactInviteEmail(
          c.env, row.email, advisorName, user.name || 'Axal StudioOS',
          user.email || '', project?.name || '', link, inviteMsg,
        );
        if (!emailSent) emailError = 'Email provider is not configured or rejected the message';
      } catch (e: any) {
        emailError = e?.message || 'Unknown error sending invite email';
      }

      await logPromotion(c.env, user, row.project_id, `promoted ${row.email} to the advisory directory`);
      const fresh = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(row.id).first<ContactRow>();
      const record = await db.prepare('SELECT * FROM advisor_profiles WHERE id = ?').bind(newId).first<any>();
      return c.json({ ...fresh, record, email_sent: emailSent, ...(emailError ? { email_error: emailError } : {}) });
    }

    return c.json({ detail: 'This audience has no promotion target; manage it here.' }, 400);
  } catch (e) { return mapError(c, e); }
});

export default r;

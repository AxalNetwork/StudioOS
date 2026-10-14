/**
 * D664 (#1477) — the Grow cycle's reads and the writes behind its new stores,
 * mounted at /api/cycles/grow (#1469's shared read, D656).
 *
 *   GET  /overview?project=:pid                 the question, four figures, seven cards
 *   GET  /modules/:slug?project=&q=&filter=&sort=&page=&page_size=
 *                                               the module's card and its records
 *
 * WRITES (the owner or a co-founder; an advisor reads only). Each row records
 * who wrote it, and the write is logged to `activity_logs`.
 *   POST  /feedback                PATCH /feedback/:uid
 *   POST  /channels                PATCH /channels/:uid      PUT /channels/:uid/spend/:month
 *   PATCH /roles/:id               PATCH /applications/:id/stage
 *   POST  /partners                PATCH /partners/:uid      PUT /partners/:uid/revenue/:month
 *   POST  /markets                 PATCH /markets/:uid
 *   POST  /obligations             PATCH /obligations/:id    PUT /checklist/:key
 *
 * Every request value is bound. A typed figure is `source: 'manual'`.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { canAccessProject } from '../services/projectAccess';
import { pageOf, settleCard, type Card } from '../services/cycleCards';
import {
  APPLICATION_STAGES, CARD_FNS, DURABILITY_ITEMS, GROW_MODULES, GROW_QUESTION, MARKET_PARTS,
  channelRows, checklist, growFigures, marketRows, readiness, readSnapshots, type Ctx, type GrowSlug,
} from '../services/growCycle';
import { billingPeriods, readRecurring } from '../services/revenueMovements';
import { canAskAgain } from '../services/updateShare';
import { isAdmin } from './_t13t14t15_helpers';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID().replace(/-/g, '');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

class Refused extends Error {
  status: number; sentence: string; field: string | null;
  constructor(status: number, sentence: string, field: string | null = null) { super(sentence); this.status = status; this.sentence = sentence; this.field = field; }
}

async function project(c: C, user: User, raw: unknown, write: boolean) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Refused(400, 'project is required', 'project');
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p) throw new Refused(404, 'Project not found');
  if (!(await canAccessProject(c.env, user, p, { write }))) throw new Refused(403, write ? 'You can read this venture but not change it' : 'Forbidden');
  return p.id;
}

function fail(c: C, e: unknown) {
  if (e instanceof Refused) return c.json({ detail: e.sentence, ...(e.field ? { field: e.field } : {}) }, e.status as 400);
  throw e;
}

async function logWrite(env: Env, userId: number, action: string, entity: string, entityId: string | number) {
  try {
    await env.DB.prepare('INSERT INTO activity_logs (action, details, user_id, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)')
      .bind(action, `grow:${entity}`, userId, entity, String(entityId)).run();
  } catch (e) { console.warn('[cycle_grow] activity log not written', (e as Error).message); }
}

const ctxFor = (env: Env, projectId: number): Ctx => ({
  env, projectId, now: Date.now(),
  href: (slug) => `/grow/${slug}?project=${projectId}`,
});

async function cardFor(x: Ctx, slug: GrowSlug): Promise<Card> {
  const meta = GROW_MODULES.find((m) => m.slug === slug)!;
  return settleCard(meta, () => CARD_FNS[slug](x));
}

// GET /overview
r.get('/overview', async (c) => {
  try {
    const user = await requireAuth(c);
    const pid = await project(c, user, c.req.query('project'), false);
    const x = ctxFor(c.env, pid);
    const [figures, cards] = await Promise.all([growFigures(x), Promise.all(GROW_MODULES.map((m) => cardFor(x, m.slug)))]);
    return c.json({ cycle: 'grow', question: GROW_QUESTION, figures, cards });
  } catch (e) { return fail(c, e); }
});

// ── Records ─────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type RecordSet = { cols: string[]; rows: Row[]; parts?: Row };

const lower = (v: unknown) => String(v ?? '').toLowerCase();

async function recordsFor(x: Ctx, slug: GrowSlug, viewer: User): Promise<RecordSet> {
  const { env, projectId } = x;
  if (slug === 'product-improvement') {
    const q = await env.DB.prepare(
      `SELECT uid, body, source, theme, roadmap_item_label, status, from_name, created_at FROM product_feedback
        WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(projectId).all<Row>();
    return { cols: ['Feedback', 'Source', 'Theme', 'Roadmap item', 'Status'],
      rows: (q.results || []).map((f) => ({ ...f, theme: f.theme ?? null, roadmap_item_label: f.roadmap_item_label ?? null })) };
  }
  if (slug === 'distribution') {
    return { cols: ['Channel', 'State', 'Spend · 30 d', 'Customers', 'CAC'],
      rows: (await channelRows(x)).map((ch) => ({ ...ch, spend_source: ch.spend_cents == null ? null : 'manual' })),
      parts: { from_update_asks: await updateAskReplies(env, projectId, 'customer') } };
  }
  if (slug === 'revenue-and-traction') {
    const snaps = await readSnapshots(env, projectId);
    const kpi = (label: string, col: 'mrr' | 'paying_accounts') => {
      const have = snaps.filter((s) => s[col] != null);
      const last = have[have.length - 1];
      if (!last) return { kpi: label, value: null, change_30d: null, source: null, as_of: null, reason: 'Not recorded' };
      const cutoff = new Date(Date.parse(last.snapshot_date) - 30 * 86_400_000).toISOString().slice(0, 10);
      const before = [...have].reverse().find((s) => s.snapshot_date <= cutoff);
      return { kpi: label, value: last[col], change_30d: before ? (last[col] as number) - (before[col] as number) : null,
        source: last.source && last.source.trim() ? last.source : 'manual', as_of: last.snapshot_date, reason: null };
    };
    const ledger = await readRecurring(env, projectId);
    const mv = await env.DB.prepare(
      `SELECT month, kind, amount_cents, source, as_of FROM revenue_movements WHERE project_id = ? ORDER BY month DESC`,
    ).bind(projectId).all<{ month: string; kind: string; amount_cents: number; source: string; as_of: string }>();
    const latest = (mv.results || [])[0]?.month ?? null;
    const at = (kind: string) => (mv.results || []).find((m) => m.month === latest && m.kind === kind) ?? null;
    const movementRow = (label: string, kind: 'churned' | 'expansion' | 'new') => {
      if (billingPeriods(ledger) < 2) return { kpi: label, value: null, change_30d: null, source: null, as_of: null, reason: 'Needs 2 billings' };
      const m = at(kind);
      if (!m) {
        return { kpi: label, value: null, change_30d: null, source: null, as_of: null,
          reason: at('unsplit') ? 'Not recorded: the ledger cannot tell new from expansion for this month' : 'Not recorded' };
      }
      return { kpi: label, value: m.amount_cents, unit: 'usd_cents', change_30d: null, source: `Revenue ledger · ${m.source}`, as_of: m.as_of, reason: null };
    };
    return { cols: ['KPI', 'Value', 'Change · 30 d', 'Source', 'As of'],
      rows: [kpi('MRR', 'mrr'), kpi('Customers', 'paying_accounts'), movementRow('New MRR', 'new'), movementRow('Expansion MRR', 'expansion'), movementRow('Churn', 'churned')] };
  }
  if (slug === 'team-expansion') {
    const q = await env.DB.prepare(
      `SELECT p.id, p.title, p.team, p.target_start, p.status,
              (SELECT COUNT(*) FROM job_applications a WHERE a.posting_id = p.id) AS applicants,
              (SELECT COUNT(*) FROM job_applications a WHERE a.posting_id = p.id AND a.stage = 'interview') AS in_interview
         FROM job_postings p WHERE p.project_id = ? AND p.status IN ('open', 'published', 'draft') ORDER BY p.id DESC`,
    ).bind(projectId).all<Row>();
    return { cols: ['Role', 'Team', 'Applicants', 'In interview', 'Target start'], rows: q.results || [] };
  }
  if (slug === 'partner-network') {
    const q = await env.DB.prepare(
      `SELECT g.uid, g.name, g.type, g.stage, g.terms, (SELECT SUM(amount_cents) FROM partner_revenue r WHERE r.partner_id = g.id) AS revenue_cents
         FROM growth_partners g WHERE g.project_id = ? ORDER BY g.name COLLATE NOCASE`,
    ).bind(projectId).all<Row>();
    return { cols: ['Partner', 'Type', 'Stage', 'Terms', 'Revenue sourced'],
      rows: (q.results || []).map((p) => ({ ...p, revenue_cents: p.revenue_cents ?? null, revenue_source: p.revenue_cents == null ? null : 'manual' })),
      parts: { from_update_asks: await updateAskReplies(env, projectId, 'partner') } };
  }
  if (slug === 'market-expansion') {
    const rows = await marketRows(env, projectId);
    const replies = await marketReplies(env, projectId);
    return { cols: ['Market', 'State', 'Readiness', 'Weakest part', 'Decision'],
      rows: rows.map((m) => { const rd = readiness(m); return { ...m, readiness: rd.score, readiness_reason: rd.score == null ? `Not recorded: ${rd.missing.join(', ')} not scored` : null, weakest_part: rd.weakest, replies: replies.get(m.uid) ?? [] }; }) };
  }
  // durable-company-building
  const ev = await env.DB.prepare(
    `SELECT id, title, kind, due_at, owner_name, status FROM compliance_events WHERE project_id = ? ORDER BY due_at IS NULL, due_at`,
  ).bind(projectId).all<Row>();
  return { cols: ['Obligation', 'Kind', 'Due', 'Owner', 'State'], rows: ev.results || [],
    parts: { checklist: await checklist(env, projectId), ...(await updatesHistory(x, viewer)) } };
}

/** Customer and partner asks have no linked record; expose their replies beside the module's rows. */
export async function updateAskReplies(env: Env, projectId: number, kind: 'customer' | 'partner'): Promise<Row[]> {
  try {
    const q = await env.DB.prepare(`SELECT r.uid, r.name, r.message, r.created_at, r.landed_module, r.landed_ref, r.landed_reason,
      a.uid AS ask_uid, a.text AS ask_text FROM update_ask_replies r
      JOIN update_asks a ON a.id = r.ask_id JOIN portfolio_updates u ON u.id = a.update_id
      WHERE u.project_id = ? AND a.kind = ? ORDER BY r.id DESC`).bind(projectId, kind).all<Row>();
    return q.results || [];
  } catch { return []; }
}

async function updatesHistory(x: Ctx, viewer: User): Promise<{updates: Row[]|null; updates_reason: string|null}> {
  const { env, projectId } = x;
  try {
    const q = await env.DB.prepare(`SELECT id, uid, title, author_user_id, period, period_start, period_end, status,
      submitted_at, sent_at, updated_at FROM portfolio_updates WHERE project_id = ?
      AND (sent_at IS NOT NULL OR status = 'submitted')
      ORDER BY COALESCE(sent_at, submitted_at, updated_at) DESC, id DESC LIMIT 100`).bind(projectId).all<any>();
    const updates = q.results || [];
    if (!updates.length) return { updates: [], updates_reason: null };
    const recipients = await env.DB.prepare(`SELECT update_id, audience, COUNT(*) AS sent,
      SUM(CASE WHEN delivered_via IS NOT NULL THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened
      FROM update_recipients WHERE update_id IN (SELECT id FROM portfolio_updates WHERE project_id = ?
        AND (sent_at IS NOT NULL OR status = 'submitted')
        ORDER BY COALESCE(sent_at, submitted_at, updated_at) DESC, id DESC LIMIT 100)
      GROUP BY update_id, audience`).bind(projectId).all<any>();
    const asks = await env.DB.prepare(`SELECT a.id, a.update_id, a.asked_again_at, COUNT(r.id) AS replies
      FROM update_asks a LEFT JOIN update_ask_replies r ON r.ask_id = a.id
      WHERE a.update_id IN (SELECT id FROM portfolio_updates WHERE project_id = ?
        AND (sent_at IS NOT NULL OR status = 'submitted')
        ORDER BY COALESCE(sent_at, submitted_at, updated_at) DESC, id DESC LIMIT 100)
      GROUP BY a.id`).bind(projectId).all<any>();
    const byRecipients = new Map<number, any[]>();
    for (const row of recipients.results || []) byRecipients.set(row.update_id, [...(byRecipients.get(row.update_id) || []), row]);
    const byAsks = new Map<number, any[]>();
    for (const row of asks.results || []) byAsks.set(row.update_id, [...(byAsks.get(row.update_id) || []), row]);
    return { updates: updates.map((u) => {
      const base = { uid: u.uid, title: u.title, period: u.period_start ? null : u.period,
        period_start: u.period_start, period_end: u.period_end, sent_at: u.sent_at,
        submitted_at: u.sent_at ? null : u.submitted_at,
        href: u.author_user_id === viewer.id || isAdmin(viewer) ? `/updates/${u.uid}` : null };
      if (!u.sent_at) return { ...base, href: null, label: "Submitted to the investors' inbox", sent_to: null,
        delivered: null, opened: null, asks: null, replies: null, asks_to_ask_again: null };
      const rs = byRecipients.get(u.id) || [];
      const as = byAsks.get(u.id) || [];
      const count = (audience: string) => Number(rs.find((r) => r.audience === audience)?.sent ?? 0);
      return { ...base, label: null, sent_to: { investors: count('investor'), team: count('team'), network: count('network') },
        delivered: rs.reduce((n, r) => n + Number(r.delivered || 0), 0),
        opened: rs.reduce((n, r) => n + Number(r.opened || 0), 0), asks: as.length,
        replies: as.reduce((n, a) => n + Number(a.replies || 0), 0),
        asks_to_ask_again: as.filter((a) => canAskAgain(u.sent_at, Number(a.replies || 0), a.asked_again_at, x.now)).length };
    }), updates_reason: null };
  } catch (e) {
    console.warn('[cycle_grow] updates history unreadable', (e as Error).message);
    return { updates: null, updates_reason: 'Unreadable: Updates history could not be read' };
  }
}

/**
 * Replies to "a market contact" asks of Share an update (D654, migration 437)
 * whose ask links to a market, by that market — linked by this read, never copied.
 */
export async function marketReplies(env: Env, projectId: number): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  try {
    const q = await env.DB.prepare(
      `SELECT m.uid AS market_uid, r.uid, r.name, r.message, r.created_at FROM update_ask_replies r
         JOIN update_asks a ON a.id = r.ask_id
         JOIN portfolio_updates u ON u.id = a.update_id
         JOIN markets m ON m.project_id = u.project_id AND CAST(m.id AS TEXT) = a.link_ref
        WHERE u.project_id = ? AND a.kind = 'market' ORDER BY r.id DESC`,
    ).bind(projectId).all<Row>();
    for (const x of q.results || []) out.set(String(x.market_uid), [...(out.get(String(x.market_uid)) ?? []), x]);
  } catch { /* no update stores on this database */ }
  return out;
}

/** Search on every text field; `filter` is `field:value`; sort a field, `-` for descending. */
export function shapeRecords(rows: Row[], q: string, filter: string, sort: string): Row[] {
  let out = rows;
  if (q) out = out.filter((row) => Object.values(row).some((v) => typeof v === 'string' && lower(v).includes(lower(q))));
  if (filter.includes(':')) {
    const [k, v] = [filter.slice(0, filter.indexOf(':')), filter.slice(filter.indexOf(':') + 1)];
    out = out.filter((row) => lower(row[k]) === lower(v));
  }
  if (sort) {
    const desc = sort.startsWith('-'); const key = desc ? sort.slice(1) : sort;
    // A missing value sorts last whichever way, never as a zero.
    out = [...out].sort((a, b) => {
      const av = a[key]; const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return desc ? -cmp : cmp;
    });
  }
  return out;
}

// GET /modules/:slug
r.get('/modules/:slug', async (c) => {
  try {
    const user = await requireAuth(c);
    const pid = await project(c, user, c.req.query('project'), false);
    const meta = GROW_MODULES.find((m) => m.slug === c.req.param('slug'));
    if (!meta) return c.json({ detail: 'Not a Grow module' }, 404);
    const x = ctxFor(c.env, pid);
    const card = await cardFor(x, meta.slug);
    let recs: RecordSet;
    try { recs = await recordsFor(x, meta.slug, user); } catch (e) {
      console.error('[cycle_grow] records unreadable:', meta.slug, (e as Error).message);
      return c.json({ module: meta.slug, card, records: null, records_state: 'unreadable', reason: `Unreadable: ${meta.source} could not be read` });
    }
    const shaped = shapeRecords(recs.rows, String(c.req.query('q') || '').slice(0, 120), String(c.req.query('filter') || '').slice(0, 120), String(c.req.query('sort') || '').slice(0, 60));
    const pg = pageOf(shaped, c.req.query('page'), c.req.query('page_size'));
    return c.json({ module: meta.slug, card, records: { cols: recs.cols, ...pg }, ...(recs.parts ? { parts: recs.parts } : {}) });
  } catch (e) { return fail(c, e); }
});

// ── Writes ──────────────────────────────────────────────────────────────────

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, required = false): T | null {
  if (v == null || v === '') { if (required) throw new Refused(400, `${field} is required`, field); return null; }
  if (!(allowed as readonly string[]).includes(String(v))) throw new Refused(400, `${field} must be one of ${allowed.join(', ')}`, field);
  return String(v) as T;
}
function cents(v: unknown, field: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000_000) throw new Refused(400, `${field} must be whole cents, 0 or more`, field);
  return n;
}
function score(v: unknown, field: string): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10) throw new Refused(400, `${field} must be a whole number from 0 to 10`, field);
  return n;
}
async function body(c: C): Promise<Record<string, unknown>> { return c.req.json().catch(() => ({})); }
async function owned<T>(c: C, sql: string, key: unknown, pid: number): Promise<T> {
  const row = await c.env.DB.prepare(sql).bind(key, pid).first<T>();
  if (!row) throw new Refused(404, 'Not found');
  return row;
}

const FEEDBACK_SOURCES = ['customer', 'investor', 'team'] as const;
const FEEDBACK_STATUS = ['open', 'planned', 'shipped'] as const;
const CHANNEL_STATES = ['active', 'testing', 'paused'] as const;
const PARTNER_TYPES = ['reseller', 'integration', 'agency', 'referral', 'other'] as const;
const PARTNER_STAGES = ['talking', 'terms', 'signed', 'ended'] as const;
const MARKET_STATES = ['considering', 'entering', 'served', 'not_now'] as const;
const DECISIONS = ['enter', 'not_yet', 'exit'] as const;
const OBLIGATION_KINDS = ['governance', 'compliance', 'risk', 'tax', 'other'] as const;
const OBLIGATION_STATES = ['scheduled', 'upcoming', 'draft', 'done', 'not_set_up'] as const;

r.post('/feedback', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const text = str(b.body, 4000);
    if (!text) throw new Refused(400, 'Feedback says something', 'body');
    const source = oneOf(b.source, FEEDBACK_SOURCES, 'source', true);
    const id = uid();
    await c.env.DB.prepare(
      `INSERT INTO product_feedback (uid, project_id, body, source, from_name, from_email, theme, roadmap_item_ref, roadmap_item_label, status, shipped_on, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, pid, text, source, str(b.from_name, 200), str(b.from_email, 200)?.toLowerCase() ?? null, str(b.theme, 80),
      str(b.roadmap_item_ref, 80), str(b.roadmap_item_label, 200), oneOf(b.status, FEEDBACK_STATUS, 'status') ?? 'open',
      b.status === 'shipped' ? nowIso().slice(0, 10) : null, user.id, user.id).run();
    await logWrite(c.env, user.id, 'grow_feedback_logged', 'product_feedback', id);
    return c.json({ uid: id }, 201);
  } catch (e) { return fail(c, e); }
});

r.patch('/feedback/:uid', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const row = await owned<{ id: number; status: string; theme: string | null; roadmap_item_ref: string | null; roadmap_item_label: string | null }>(c,
      'SELECT id, status, theme, roadmap_item_ref, roadmap_item_label FROM product_feedback WHERE uid = ? AND project_id = ?', c.req.param('uid'), pid);
    const status = b.status === undefined ? row.status : oneOf(b.status, FEEDBACK_STATUS, 'status', true)!;
    await c.env.DB.prepare(
      `UPDATE product_feedback SET status = ?, theme = ?, roadmap_item_ref = ?, roadmap_item_label = ?,
         shipped_on = CASE WHEN ? = 'shipped' AND status <> 'shipped' THEN ? ELSE shipped_on END, updated_by = ?, updated_at = ? WHERE id = ?`,
    ).bind(status, b.theme === undefined ? row.theme : str(b.theme, 80), b.roadmap_item_ref === undefined ? row.roadmap_item_ref : str(b.roadmap_item_ref, 80),
      b.roadmap_item_label === undefined ? row.roadmap_item_label : str(b.roadmap_item_label, 200), status, nowIso().slice(0, 10), user.id, nowIso(), row.id).run();
    await logWrite(c.env, user.id, 'grow_feedback_updated', 'product_feedback', c.req.param('uid'));
    return c.json({ uid: c.req.param('uid'), status });
  } catch (e) { return fail(c, e); }
});

r.post('/channels', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const name = str(b.name, 120);
    const utm = str(b.utm_source, 80)?.toLowerCase() ?? null;
    if (!name || !utm) throw new Refused(400, 'A channel has a name and the UTM source its links carry', 'utm_source');
    const id = uid();
    try {
      await c.env.DB.prepare('INSERT INTO growth_channels (uid, project_id, name, utm_source, state, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, pid, name, utm, oneOf(b.state, CHANNEL_STATES, 'state') ?? 'active', user.id).run();
    } catch (e) {
      if (String((e as Error).message).toLowerCase().includes('unique')) throw new Refused(409, 'A channel already uses that UTM source', 'utm_source');
      throw e;
    }
    await logWrite(c.env, user.id, 'grow_channel_added', 'growth_channels', id);
    return c.json({ uid: id }, 201);
  } catch (e) { return fail(c, e); }
});

r.patch('/channels/:uid', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const row = await owned<{ id: number; state: string; name: string }>(c, 'SELECT id, state, name FROM growth_channels WHERE uid = ? AND project_id = ?', c.req.param('uid'), pid);
    await c.env.DB.prepare('UPDATE growth_channels SET state = ?, name = ?, updated_at = ? WHERE id = ?')
      .bind(b.state === undefined ? row.state : oneOf(b.state, CHANNEL_STATES, 'state', true), str(b.name, 120) ?? row.name, nowIso(), row.id).run();
    await logWrite(c.env, user.id, 'grow_channel_updated', 'growth_channels', c.req.param('uid'));
    return c.json({ uid: c.req.param('uid') });
  } catch (e) { return fail(c, e); }
});

r.put('/channels/:uid/spend/:month', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const month = c.req.param('month');
    if (!MONTH.test(month)) throw new Refused(400, 'month is YYYY-MM', 'month');
    const row = await owned<{ id: number }>(c, 'SELECT id FROM growth_channels WHERE uid = ? AND project_id = ?', c.req.param('uid'), pid);
    const spend = cents(b.spend_cents, 'spend_cents');
    await c.env.DB.prepare(
      `INSERT INTO channel_spend (channel_id, month, spend_cents, source, recorded_by) VALUES (?, ?, ?, 'manual', ?)
       ON CONFLICT(channel_id, month) DO UPDATE SET spend_cents = excluded.spend_cents, recorded_by = excluded.recorded_by`,
    ).bind(row.id, month, spend, user.id).run();
    await logWrite(c.env, user.id, 'grow_channel_spend', 'channel_spend', `${c.req.param('uid')}:${month}`);
    return c.json({ uid: c.req.param('uid'), month, spend_cents: spend, source: 'manual' });
  } catch (e) { return fail(c, e); }
});

r.patch('/roles/:id', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const row = await owned<{ id: number; team: string | null; target_start: string | null }>(c, 'SELECT id, team, target_start FROM job_postings WHERE id = ? AND project_id = ?', Number(c.req.param('id')), pid);
    const target = b.target_start === undefined ? row.target_start : str(b.target_start, 10);
    if (target && !DATE.test(target) && !MONTH.test(target)) throw new Refused(400, 'target_start is YYYY-MM or YYYY-MM-DD', 'target_start');
    await c.env.DB.prepare('UPDATE job_postings SET team = ?, target_start = ?, updated_at = ? WHERE id = ?')
      .bind(b.team === undefined ? row.team : str(b.team, 80), target, nowIso(), row.id).run();
    await logWrite(c.env, user.id, 'grow_role_updated', 'job_postings', row.id);
    return c.json({ id: row.id });
  } catch (e) { return fail(c, e); }
});

r.patch('/applications/:id/stage', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const row = await owned<{ id: number }>(c,
      'SELECT a.id FROM job_applications a JOIN job_postings p ON p.id = a.posting_id WHERE a.id = ? AND p.project_id = ?', Number(c.req.param('id')), pid);
    const stage = oneOf(b.stage, APPLICATION_STAGES, 'stage', true);
    await c.env.DB.prepare('UPDATE job_applications SET stage = ?, stage_changed_at = ?, stage_changed_by = ?, updated_at = ? WHERE id = ?')
      .bind(stage, nowIso(), user.id, nowIso(), row.id).run();
    await logWrite(c.env, user.id, 'grow_application_stage', 'job_applications', row.id);
    return c.json({ id: row.id, stage });
  } catch (e) { return fail(c, e); }
});

r.post('/partners', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const name = str(b.name, 200);
    if (!name) throw new Refused(400, 'A partner has a name', 'name');
    const id = uid();
    await c.env.DB.prepare('INSERT INTO growth_partners (uid, project_id, name, type, stage, terms, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, pid, name, oneOf(b.type, PARTNER_TYPES, 'type', true), oneOf(b.stage, PARTNER_STAGES, 'stage') ?? 'talking', str(b.terms, 400), user.id).run();
    await logWrite(c.env, user.id, 'grow_partner_added', 'growth_partners', id);
    return c.json({ uid: id }, 201);
  } catch (e) { return fail(c, e); }
});

r.patch('/partners/:uid', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const row = await owned<{ id: number; stage: string; terms: string | null; type: string }>(c, 'SELECT id, stage, terms, type FROM growth_partners WHERE uid = ? AND project_id = ?', c.req.param('uid'), pid);
    await c.env.DB.prepare('UPDATE growth_partners SET stage = ?, terms = ?, type = ?, updated_at = ? WHERE id = ?')
      .bind(b.stage === undefined ? row.stage : oneOf(b.stage, PARTNER_STAGES, 'stage', true), b.terms === undefined ? row.terms : str(b.terms, 400),
        b.type === undefined ? row.type : oneOf(b.type, PARTNER_TYPES, 'type', true), nowIso(), row.id).run();
    await logWrite(c.env, user.id, 'grow_partner_updated', 'growth_partners', c.req.param('uid'));
    return c.json({ uid: c.req.param('uid') });
  } catch (e) { return fail(c, e); }
});

r.put('/partners/:uid/revenue/:month', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const month = c.req.param('month');
    if (!MONTH.test(month)) throw new Refused(400, 'month is YYYY-MM', 'month');
    const row = await owned<{ id: number }>(c, 'SELECT id FROM growth_partners WHERE uid = ? AND project_id = ?', c.req.param('uid'), pid);
    const amount = cents(b.amount_cents, 'amount_cents');
    await c.env.DB.prepare(
      `INSERT INTO partner_revenue (partner_id, month, amount_cents, source, recorded_by) VALUES (?, ?, ?, 'manual', ?)
       ON CONFLICT(partner_id, month) DO UPDATE SET amount_cents = excluded.amount_cents, recorded_by = excluded.recorded_by`,
    ).bind(row.id, month, amount, user.id).run();
    await logWrite(c.env, user.id, 'grow_partner_revenue', 'partner_revenue', `${c.req.param('uid')}:${month}`);
    return c.json({ uid: c.req.param('uid'), month, amount_cents: amount, source: 'manual' });
  } catch (e) { return fail(c, e); }
});

/** The four parts from a body: a score needs its source. */
function marketParts(b: Record<string, unknown>, prev: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  for (const [k, label] of MARKET_PARTS) {
    const s = b[`${k}_score`] === undefined ? (prev[`${k}_score`] as number | null ?? null) : score(b[`${k}_score`], `${k}_score`);
    const src = b[`${k}_source`] === undefined ? (prev[`${k}_source`] as string | null ?? null) : str(b[`${k}_source`], 200);
    if (s != null && !src) throw new Refused(400, `The ${label.toLowerCase()} score needs its source`, `${k}_source`);
    out[`${k}_score`] = s; out[`${k}_source`] = s == null ? null : src;
  }
  return out;
}

r.post('/markets', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const name = str(b.name, 120);
    if (!name) throw new Refused(400, 'A market has a name', 'name');
    const p = marketParts(b);
    const id = uid();
    try {
      await c.env.DB.prepare(
        `INSERT INTO markets (uid, project_id, name, state, demand_score, demand_source, regulation_score, regulation_source,
           partners_score, partners_source, cost_score, cost_source, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, pid, name, oneOf(b.state, MARKET_STATES, 'state') ?? 'considering', p.demand_score, p.demand_source, p.regulation_score, p.regulation_source,
        p.partners_score, p.partners_source, p.cost_score, p.cost_source, user.id, user.id).run();
    } catch (e) {
      if (String((e as Error).message).toLowerCase().includes('unique')) throw new Refused(409, 'That market is already on the list', 'name');
      throw e;
    }
    await logWrite(c.env, user.id, 'grow_market_added', 'markets', id);
    return c.json({ uid: id }, 201);
  } catch (e) { return fail(c, e); }
});

r.patch('/markets/:uid', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const row = await owned<Record<string, unknown> & { id: number; state: string; decision: string | null }>(c, 'SELECT * FROM markets WHERE uid = ? AND project_id = ?', c.req.param('uid'), pid);
    const p = marketParts(b, row);
    const decision = b.decision === undefined ? row.decision : oneOf(b.decision, DECISIONS, 'decision');
    await c.env.DB.prepare(
      `UPDATE markets SET state = ?, decision = ?, decided_on = CASE WHEN ? IS NOT ? THEN ? ELSE decided_on END,
         demand_score = ?, demand_source = ?, regulation_score = ?, regulation_source = ?, partners_score = ?, partners_source = ?,
         cost_score = ?, cost_source = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    ).bind(b.state === undefined ? row.state : oneOf(b.state, MARKET_STATES, 'state', true), decision, decision, row.decision, nowIso().slice(0, 10),
      p.demand_score, p.demand_source, p.regulation_score, p.regulation_source, p.partners_score, p.partners_source,
      p.cost_score, p.cost_source, user.id, nowIso(), row.id).run();
    await logWrite(c.env, user.id, 'grow_market_updated', 'markets', c.req.param('uid'));
    return c.json({ uid: c.req.param('uid') });
  } catch (e) { return fail(c, e); }
});

r.post('/obligations', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const title = str(b.title, 200);
    if (!title) throw new Refused(400, 'An obligation has a title', 'title');
    const due = str(b.due_at, 10);
    if (due && !DATE.test(due)) throw new Refused(400, 'due_at is YYYY-MM-DD', 'due_at');
    const ins = await c.env.DB.prepare(
      'INSERT INTO compliance_events (project_id, title, due_at, status, kind, owner_name, owner_user_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(pid, title, due, oneOf(b.status, OBLIGATION_STATES, 'status') ?? 'upcoming', oneOf(b.kind, OBLIGATION_KINDS, 'kind', true),
      str(b.owner_name, 120), null, user.id).run();
    const id = (ins as any).meta?.last_row_id;
    await logWrite(c.env, user.id, 'grow_obligation_added', 'compliance_events', id);
    return c.json({ id }, 201);
  } catch (e) { return fail(c, e); }
});

r.patch('/obligations/:id', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const row = await owned<{ id: number; status: string; owner_name: string | null; due_at: string | null }>(c,
      'SELECT id, status, owner_name, due_at FROM compliance_events WHERE id = ? AND project_id = ?', Number(c.req.param('id')), pid);
    const due = b.due_at === undefined ? row.due_at : str(b.due_at, 10);
    if (due && !DATE.test(due.slice(0, 10))) throw new Refused(400, 'due_at is YYYY-MM-DD', 'due_at');
    await c.env.DB.prepare('UPDATE compliance_events SET status = ?, owner_name = ?, due_at = ? WHERE id = ?')
      .bind(b.status === undefined ? row.status : oneOf(b.status, OBLIGATION_STATES, 'status', true), b.owner_name === undefined ? row.owner_name : str(b.owner_name, 120), due, row.id).run();
    await logWrite(c.env, user.id, 'grow_obligation_updated', 'compliance_events', row.id);
    return c.json({ id: row.id });
  } catch (e) { return fail(c, e); }
});

r.put('/checklist/:key', async (c) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    const key = c.req.param('key');
    if (!DURABILITY_ITEMS.some((i) => i.key === key)) throw new Refused(404, 'Not a checklist item');
    const done = b.done === true;
    await c.env.DB.prepare(
      `INSERT INTO durability_checklist (project_id, item_key, done_at, done_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, item_key) DO UPDATE SET done_at = excluded.done_at, done_by = excluded.done_by, updated_at = excluded.updated_at`,
    ).bind(pid, key, done ? nowIso() : null, done ? user.id : null, nowIso()).run();
    await logWrite(c.env, user.id, done ? 'grow_checklist_done' : 'grow_checklist_undone', 'durability_checklist', key);
    return c.json({ key, done });
  } catch (e) { return fail(c, e); }
});

export default r;

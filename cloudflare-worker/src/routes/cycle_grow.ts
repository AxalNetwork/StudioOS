/**
 * D664 (#1477) — the Grow cycle's reads and the writes behind its new stores,
 * mounted at /api/cycles/grow (#1469's shared read, D656).
 *
 *   GET  /overview?project=:pid                 the question, four figures, seven cards, and the
 *                                               phone's focus, meter and index (D692; services/cycleFocus.ts)
 *   GET  /modules/:slug?project=&q=&filter=&sort=&page=&page_size=
 *                                               { module: { slug, name, records_title }, card,
 *                                                 records: { cols, rows, total, page, page_size, filters, sorts } }
 *     D691 (#1697): every row carries `id`, its record id (a uid, a posting
 *     or obligation id, or a KPI key); `filter` is `key:value` pairs joined
 *     with commas, all applied; `sorts[0]` is the default sort.
 *
 * WRITES (whoever `canAccessProject` lets write: the owner, a co-founder, a
 * partner, an admin; an advisor reads only). The writers are
 * `services/growWriters.ts` and `services/growKpis.ts`; each records who wrote
 * the row and logs it as `grow.<module>` with its record id (D690).
 *   POST  /feedback                PATCH /feedback/:uid
 *   POST  /channels                PATCH /channels/:uid      PUT /channels/:uid/spend/:month
 *   POST  /kpis                    (Enter a KPI, decision 4)
 *   POST  /roles                   PATCH /roles/:id          PATCH /applications/:id/stage
 *   POST  /partners                PATCH /partners/:uid      PUT /partners/:uid/revenue/:month
 *   POST  /markets                 PATCH /markets/:uid
 *   POST  /obligations             PATCH /obligations/:id    PUT /checklist/:key
 *
 * D840 part 3 (#2348): the founder's own Mercury. A fed module's read carries
 * `parts.from_mercury`, the figures for the founder's company's members only
 * (`services/mercury/growFeeds.ts`); anyone else gets `team_only`.
 *   POST   /mercury/partner-proposals/:id/accept   { growth_partner_uid? }  the founder only
 *   POST   /mercury/partner-proposals/:id/dismiss                          the founder only
 *   DELETE /mercury/facts/:id                      a writer on the founder's company; stays deleted
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
  CARD_FNS, DURABILITY_ITEMS, GROW_MODULES, GROW_QUESTION,
  channelRows, checklist, growFigures, marketRows, readiness, type Ctx, type GrowSlug,
} from '../services/growCycle';
import { ensureProjectMetricsSchema } from './progress';
import { KpiRefused, enterKpi, kpiRows } from '../services/growKpis';
import {
  CHANNEL_STATES, FEEDBACK_SOURCES, FEEDBACK_STATUS, MARKET_STATES, OBLIGATION_KINDS, PARTNER_STAGES, PARTNER_TYPES,
  REPEATS_OF, Refused, addChannel, addFeedback, addMarket, addObligation, addPartner, obligationKind, obligationState, openRole,
  logGrowWrite, setApplicationStage, setChannelSpend, setChecklistItem, setPartnerRevenue, updateChannel, updateFeedback, updateMarket, updateObligation,
  updatePartner, updateRole,
} from '../services/growWriters';
import { canAskAgain } from '../services/updateShare';
import { isAdmin } from './_t13t14t15_helpers';
import { growPhone } from '../services/cycleFocus';
import { hasRecords } from '../services/records';
import {
  GROW_FEED_SLUGS, acceptPartnerProposal, deleteGrowFact, dismissPartnerProposal, growFromMercury, isTeamViewer, isVentureFounder, type GrowFeedSlug,
} from '../services/mercury/growFeeds';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

async function project(c: C, user: User, raw: unknown, write: boolean) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Refused(400, 'project is required', 'project');
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(id).first<{ id: number; founder_id: number | null }>();
  if (!p) throw new Refused(404, 'Project not found');
  if (!(await canAccessProject(c.env, user, p, { write }))) throw new Refused(403, write ? 'You can read this venture but not change it' : 'Forbidden');
  return p.id;
}

/** Whether the viewer may write this venture: third parties' names are for writers (decision 9). */
async function writes(c: C, user: User, pid: number): Promise<boolean> {
  const p = await c.env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(pid).first<{ id: number; founder_id: number | null }>();
  return !!p && canAccessProject(c.env, user, p, { write: true });
}

function fail(c: C, e: unknown) {
  if (e instanceof Refused) return c.json({ detail: e.sentence, ...(e.field ? { field: e.field } : {}) }, e.status as 400);
  if (e instanceof KpiRefused) return c.json({ detail: e.sentence, ...(e.field ? { field: e.field } : {}) }, e.status as 400);
  throw e;
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
    return c.json({ cycle: 'grow', question: GROW_QUESTION, figures, cards, ...(await growPhone(x, user, figures, cards)) });
  } catch (e) { return fail(c, e); }
});

// ── Records ─────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type Option = { value: string; label: string };
type Filter = { key: string; label: string; options: Option[] };
type Sort = { key: string; label: string };
type RecordSet = { cols: string[]; rows: Row[]; parts?: Row; filters: Filter[]; sorts: Sort[] };

const lower = (v: unknown) => String(v ?? '').toLowerCase();
const today = (x: Ctx) => new Date(x.now).toISOString().slice(0, 10);

/** The canvas's list titles (CO:630-636). */
export const RECORDS_TITLE: Record<GrowSlug, string> = {
  'product-improvement': 'Feedback', distribution: 'Channels', 'revenue-and-traction': 'KPIs', 'team-expansion': 'Open roles',
  'partner-network': 'Partners', 'market-expansion': 'Markets', 'durable-company-building': 'Obligations',
};

const LABEL: Record<string, string> = {
  customer: 'Customer', investor: 'Investor', team: 'Team', open: 'Open', planned: 'Planned', shipped: 'Shipped',
  active: 'Active', testing: 'Testing', paused: 'Paused',
  draft: 'Draft', pending_review: 'Pending review', published: 'Live', rejected: 'Needs changes',
  reseller: 'Reseller', integration: 'Integration', agency: 'Agency', referral: 'Referral', co_marketing: 'Co-marketing', other: 'Other',
  talking: 'Talking', terms: 'Terms', signed: 'Signed', ended: 'Ended',
  considering: 'Considering', entering: 'Entering', served: 'Served', not_now: 'Not now',
  governance: 'Governance', compliance: 'Compliance', risk: 'Risk', culture: 'Culture', tax: 'Tax',
  overdue: 'Overdue', next_30: 'Next 30 days', next_90: 'Next 90 days', later: 'Later',
  rev_share: 'Rev-share', services_fee: 'Services fee', referral_fee: 'Referral fee', none: 'None yet',
};
const fixed = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: LABEL[v] ?? v }));
/** Options from the values the rows hold, for a free-text field. */
const present = (rows: Row[], key: string): Option[] =>
  [...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string' && v.trim() !== ''))]
    .sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: LABEL[v] ?? v }));

export const ROLE_STATUSES = ['draft', 'pending_review', 'published', 'rejected'] as const;
export const DUE_WINDOWS = ['overdue', 'next_30', 'next_90', 'later'] as const;

/** An obligation's Due filter: overdue, the next 30 or 90 days, or later; a past one already done is in none. */
export function dueWindow(due: string, status: string, on: string): string | null {
  if (due < on) return status === 'overdue' ? 'overdue' : null;
  const days = (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000;
  return days <= 30 ? 'next_30' : days <= 90 ? 'next_90' : 'later';
}

/** A partner's terms as the row reads them: the typed terms, or the old free text when none are typed. */
export function termsLine(p: Row): string | null {
  if (p.terms_kind == null) return (p.terms as string | null) ?? null;
  const amount = p.terms_pct != null ? `${p.terms_pct}%`
    : p.terms_amount_cents != null ? `${String(p.terms_currency ?? 'usd').toUpperCase()} ${(Number(p.terms_amount_cents) / 100).toLocaleString('en-US')}` : null;
  return [LABEL[String(p.terms_kind)] ?? String(p.terms_kind), amount].filter(Boolean).join(' · ');
}

async function recordsFor(x: Ctx, slug: GrowSlug, viewer: User, writer: boolean): Promise<RecordSet> {
  const { env, projectId } = x;
  if (slug === 'product-improvement') {
    const q = await env.DB.prepare(
      `SELECT uid, body, source, theme, roadmap_item_label, status, from_name, created_at FROM product_feedback
        WHERE project_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(projectId).all<Row>();
    const rows = (q.results || []).map((f) => {
      const { from_name, ...rest } = f;
      // A customer's name is for the venture's writers; every reader sees the feedback (decision 9).
      return { id: f.uid, ...rest, ...(writer ? { from_name } : {}), theme: f.theme ?? null, roadmap_item_label: f.roadmap_item_label ?? null };
    });
    return { cols: ['Feedback', 'Source', 'Theme', 'Roadmap item', 'Status'], rows,
      filters: [{ key: 'source', label: 'Source', options: fixed(FEEDBACK_SOURCES) }, { key: 'theme', label: 'Theme', options: present(rows, 'theme') },
        { key: 'status', label: 'Status', options: fixed(FEEDBACK_STATUS) }],
      sorts: [{ key: '-created_at', label: 'Newest' }, { key: 'created_at', label: 'Oldest' }, { key: 'theme', label: 'Theme' }] };
  }
  if (slug === 'distribution') {
    const extra = new Map(((await env.DB.prepare('SELECT uid, kind, cac_bar_cents, bar_currency FROM growth_channels WHERE project_id = ?')
      .bind(projectId).all<Row>()).results || []).map((ch) => [String(ch.uid), ch]));
    return { cols: ['Channel', 'State', 'Spend · 30 d', 'Customers', 'CAC'],
      rows: (await channelRows(x)).map((ch) => {
        const more = extra.get(ch.uid) ?? {};
        return { id: ch.uid, ...ch, kind: more.kind ?? null, cac_bar_cents: more.cac_bar_cents ?? null, bar_currency: more.bar_currency ?? null,
          spend_source: ch.spend_cents == null ? null : 'manual' };
      }),
      parts: { from_update_asks: await updateAskReplies(env, projectId, 'customer') },
      filters: [{ key: 'state', label: 'State', options: fixed(CHANNEL_STATES) }],
      sorts: [{ key: 'cac_cents', label: 'CAC' }, { key: '-cac_cents', label: 'Highest CAC' }, { key: 'name', label: 'Name' }] };
  }
  if (slug === 'revenue-and-traction') {
    const rows = await kpiRows(env, projectId, x.now);
    return { cols: ['KPI', 'Value', 'Change · 30 d', 'Source', 'As of'], rows,
      filters: [{ key: 'source', label: 'Source', options: present(rows, 'source') }, { key: 'period', label: 'Period', options: present(rows, 'period').reverse() }],
      sorts: [{ key: '-period', label: 'Period' }, { key: 'kpi', label: 'KPI' }] };
  }
  if (slug === 'team-expansion') {
    const q = await env.DB.prepare(
      `SELECT p.id, p.title, p.team, p.target_start, p.status,
              (SELECT COUNT(*) FROM job_applications a WHERE a.posting_id = p.id) AS applicants,
              (SELECT COUNT(*) FROM job_applications a WHERE a.posting_id = p.id AND a.stage = 'interview') AS in_interview
         FROM job_postings p WHERE p.project_id = ? AND p.status IN ('draft', 'pending_review', 'published', 'rejected') ORDER BY p.id DESC`,
    ).bind(projectId).all<Row>();
    const rows = (q.results || []).map((p) => ({ ...p, state: LABEL[String(p.status)] ?? p.status }));
    return { cols: ['Role', 'Team', 'Applicants', 'In interview', 'Target start'], rows,
      filters: [{ key: 'status', label: 'Stage', options: fixed(ROLE_STATUSES) }, { key: 'team', label: 'Team', options: present(rows, 'team') }],
      sorts: [{ key: '-applicants', label: 'Applicants' }, { key: 'title', label: 'Role' }, { key: 'target_start', label: 'Target start' }] };
  }
  if (slug === 'partner-network') {
    const q = await env.DB.prepare(
      `SELECT g.uid, g.name, g.type, g.stage, g.terms, g.terms_kind, g.terms_pct, g.terms_amount_cents, g.terms_currency, g.renewal_on,
              (SELECT SUM(amount_cents) FROM partner_revenue r WHERE r.partner_id = g.id) AS revenue_cents
         FROM growth_partners g WHERE g.project_id = ? ORDER BY g.name COLLATE NOCASE`,
    ).bind(projectId).all<Row>();
    return { cols: ['Partner', 'Type', 'Stage', 'Terms', 'Revenue sourced'],
      rows: (q.results || []).map((p) => ({ id: p.uid, ...p, terms: termsLine(p), revenue_cents: p.revenue_cents ?? null,
        revenue_source: p.revenue_cents == null ? null : 'manual' })),
      parts: { from_update_asks: await updateAskReplies(env, projectId, 'partner') },
      filters: [{ key: 'type', label: 'Type', options: fixed(PARTNER_TYPES) }, { key: 'stage', label: 'Stage', options: fixed(PARTNER_STAGES) }],
      sorts: [{ key: '-revenue_cents', label: 'Revenue' }, { key: 'name', label: 'Name' }] };
  }
  if (slug === 'market-expansion') {
    const rows = await marketRows(env, projectId);
    const replies = await marketReplies(env, projectId);
    const extra = new Map(((await env.DB.prepare('SELECT uid, geography_ref, size_cents, size_currency, size_source FROM markets WHERE project_id = ?')
      .bind(projectId).all<Row>()).results || []).map((m) => [String(m.uid), m]));
    return { cols: ['Market', 'State', 'Readiness', 'Weakest part', 'Decision'],
      rows: rows.map((m) => {
        const rd = readiness(m); const more = extra.get(m.uid) ?? {};
        return { id: m.uid, ...m, geography_ref: more.geography_ref ?? null, size_cents: more.size_cents ?? null, size_currency: more.size_currency ?? null,
          size_source: more.size_source ?? null, readiness: rd.score,
          readiness_reason: rd.score == null ? `Not recorded: ${rd.missing.join(', ')} not scored` : null, weakest_part: rd.weakest, replies: replies.get(m.uid) ?? [] };
      }),
      filters: [{ key: 'state', label: 'State', options: fixed(MARKET_STATES) }],
      sorts: [{ key: '-readiness', label: 'Readiness' }, { key: 'name', label: 'Name' }] };
  }
  // durable-company-building
  const ev = await env.DB.prepare(
    `SELECT id, title, kind, event_type, due_date, owner_name, completion_status, recurrence FROM compliance_events WHERE project_id = ? ORDER BY due_date`,
  ).bind(projectId).all<Row>();
  return { cols: ['Obligation', 'Kind', 'Due', 'Owner', 'State'], rows: (ev.results || []).map((event) => {
      const kind = obligationKind(event);
      const status = obligationState(event.completion_status, kind, String(event.due_date), today(x));
      return { id: event.id, title: event.title, kind, due_at: event.due_date, owner_name: event.owner_name, status,
        repeats: REPEATS_OF[String(event.recurrence)] ?? null, due_window: dueWindow(String(event.due_date), status, today(x)) };
    }),
    parts: { checklist: await checklist(env, projectId), ...(await updatesHistory(x, viewer)) },
    filters: [{ key: 'kind', label: 'Kind', options: fixed(OBLIGATION_KINDS) }, { key: 'due_window', label: 'Due', options: fixed(DUE_WINDOWS) }],
    sorts: [{ key: 'due_at', label: 'Due' }, { key: '-due_at', label: 'Due latest' }] };
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

/**
 * Search on every text field; `filter` is `key:value` pairs joined with commas
 * (as the page joins them), every one applied; sort a field, `-` for descending.
 */
export function shapeRecords(rows: Row[], q: string, filter: string, sort: string): Row[] {
  let out = rows;
  if (q) out = out.filter((row) => Object.values(row).some((v) => typeof v === 'string' && lower(v).includes(lower(q))));
  for (const pair of filter.split(',')) {
    const at = pair.indexOf(':');
    if (at <= 0) continue;
    const [k, v] = [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
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
    const mod = { slug: meta.slug, name: meta.name, records_title: RECORDS_TITLE[meta.slug] };
    const x = ctxFor(c.env, pid);
    const card = await cardFor(x, meta.slug);
    let recs: RecordSet;
    try { recs = await recordsFor(x, meta.slug, user, await writes(c, user, pid)); } catch (e) {
      console.error('[cycle_grow] records unreadable:', meta.slug, (e as Error).message);
      return c.json({ module: mod, card, records: null, records_state: 'unreadable', reason: `Unreadable: ${meta.source} could not be read` });
    }
    const sort = String(c.req.query('sort') || '').slice(0, 60) || recs.sorts[0]?.key || '';
    const shaped = shapeRecords(recs.rows, String(c.req.query('q') || '').slice(0, 120), String(c.req.query('filter') || '').slice(0, 300), sort);
    const pg = pageOf(shaped, c.req.query('page'), c.req.query('page_size'));
    const parts = { ...(recs.parts ?? {}), ...(await mercuryPart(c, user, pid, meta.slug)) };
    return c.json({ module: mod, card, records: { cols: recs.cols, ...pg, filters: recs.filters, sorts: recs.sorts, linkable: hasRecords('grow') }, ...(Object.keys(parts).length ? { parts } : {}) });
  } catch (e) { return fail(c, e); }
});

/** D840 part 3: a fed module's Mercury part; a failed read is `unreadable`, never empty, and the rest of the module still loads. */
async function mercuryPart(c: C, user: User, pid: number, slug: string): Promise<{ from_mercury?: unknown }> {
  if (!(GROW_FEED_SLUGS as readonly string[]).includes(slug)) return {};
  try {
    return { from_mercury: await growFromMercury(c.env, pid, slug as GrowFeedSlug, user, new Date().toISOString().slice(0, 10)) };
  } catch (e) {
    console.error('[cycle_grow] mercury part unreadable:', slug, (e as Error).name);
    return { from_mercury: { state: 'unreadable', reason: 'Unreadable: the Mercury figures could not be read' } };
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────
// Each route gates the venture for writing, then hands the body to its writer.

async function body(c: C): Promise<Record<string, unknown>> { return c.req.json().catch(() => ({})); }
type Writer = (c: C, user: User, pid: number, b: Record<string, unknown>) => Promise<unknown>;
const write = (fn: Writer, created = false) => async (c: C) => {
  try {
    const user = await requireAuth(c); const b = await body(c);
    const pid = await project(c, user, b.project, true);
    return c.json(await fn(c, user, pid, b) as object, created ? 201 : 200);
  } catch (e) { return fail(c, e); }
};
const param = (c: C, k: string): string => c.req.param(k) ?? '';
const intId = (v: string) => Number(v);

r.post('/feedback', write((c, u, pid, b) => addFeedback(c.env, pid, u, b), true));
r.patch('/feedback/:uid', write((c, u, pid, b) => updateFeedback(c.env, pid, u, param(c, 'uid'), b)));
r.post('/channels', write((c, u, pid, b) => addChannel(c.env, pid, u, b), true));
r.patch('/channels/:uid', write((c, u, pid, b) => updateChannel(c.env, pid, u, param(c, 'uid'), b)));
r.put('/channels/:uid/spend/:month', write((c, u, pid, b) => setChannelSpend(c.env, pid, u, param(c, 'uid'), param(c, 'month'), b)));
r.post('/kpis', write(async (c, u, pid, b) => {
  await ensureProjectMetricsSchema(c.env);
  const out = await enterKpi(c.env, pid, u.id, b);
  await logGrowWrite(c.env, pid, u.id, { module: 'revenue-and-traction', entityId: out.id, action: 'grow_kpi_entered',
    summary: `KPI entered for ${out.as_of}` });
  return out;
}, true));
r.post('/roles', write((c, u, pid, b) => openRole(c.env, pid, u, b), true));
r.patch('/roles/:id', write((c, u, pid, b) => updateRole(c.env, pid, u, intId(param(c, 'id')), b)));
r.patch('/applications/:id/stage', write((c, u, pid, b) => setApplicationStage(c.env, pid, u, intId(param(c, 'id')), b)));
r.post('/partners', write((c, u, pid, b) => addPartner(c.env, pid, u, b), true));
r.patch('/partners/:uid', write((c, u, pid, b) => updatePartner(c.env, pid, u, param(c, 'uid'), b)));
r.put('/partners/:uid/revenue/:month', write((c, u, pid, b) => setPartnerRevenue(c.env, pid, u, param(c, 'uid'), param(c, 'month'), b)));
r.post('/markets', write((c, u, pid, b) => addMarket(c.env, pid, u, b), true));
r.patch('/markets/:uid', write((c, u, pid, b) => updateMarket(c.env, pid, u, param(c, 'uid'), b)));
r.post('/obligations', write((c, u, pid, b) => addObligation(c.env, pid, u, b), true));
r.patch('/obligations/:id', write((c, u, pid, b) => updateObligation(c.env, pid, u, intId(param(c, 'id')), b)));
r.put('/checklist/:key', write(async (c, u, pid, b) => {
  const key = param(c, 'key');
  if (!DURABILITY_ITEMS.some((i) => i.key === key)) throw new Refused(404, 'Not a checklist item');
  return setChecklistItem(c.env, pid, u, key, b.done === true);
}));

// ── D840 part 3: the founder's Mercury ─────────────────────────────────────

/** The founder of the venture, whose Mercury it is; anyone else is refused. */
async function founderOf(c: C, user: User, pid: number): Promise<void> {
  if (!(await isVentureFounder(c.env, user, pid))) throw new Refused(403, 'Only the founder decides on what their Mercury proposes');
}

const DECIDED: Record<string, [number, string]> = {
  not_found: [404, 'That proposal is not on this venture'],
  decided: [409, 'That proposal was already decided'],
  unknown_partner: [404, 'That partner is not on this venture'],
};
const proposalId = (c: C) => {
  const id = Number(param(c, 'id'));
  if (!Number.isSafeInteger(id) || id <= 0) throw new Refused(404, 'That proposal is not on this venture');
  return id;
};

r.post('/mercury/partner-proposals/:id/accept', write(async (c, u, pid, b) => {
  await founderOf(c, u, pid);
  const id = proposalId(c);
  const create = async (name: string) => (await addPartner(c.env, pid, u, { name, type: 'other' })).uid;
  const out = await acceptPartnerProposal(c.env, pid, id, { growth_partner_uid: b.growth_partner_uid }, u.id, create);
  if (out !== 'ok') throw new Refused(...DECIDED[out]);
  await logGrowWrite(c.env, pid, u.id, { module: 'partner-network', entityId: id, action: 'grow_mercury_partner_accepted', summary: 'Mercury partner payment linked' });
  return { ok: true, id, state: 'accepted' };
}));
r.post('/mercury/partner-proposals/:id/dismiss', write(async (c, u, pid) => {
  await founderOf(c, u, pid);
  const id = proposalId(c);
  const out = await dismissPartnerProposal(c.env, pid, id, u.id);
  if (out !== 'ok') throw new Refused(...DECIDED[out]);
  await logGrowWrite(c.env, pid, u.id, { module: 'partner-network', entityId: id, action: 'grow_mercury_partner_dismissed', summary: 'Mercury partner payment dismissed' });
  return { ok: true, id, state: 'dismissed' };
}));
r.delete('/mercury/facts/:id', async (c) => {
  try {
    const user = await requireAuth(c);
    const pid = await project(c, user, c.req.query('project'), true);
    if (!(await isTeamViewer(c.env, user, pid))) throw new Refused(403, 'Only the venture\'s team can change its Mercury figures');
    const id = Number(param(c, 'id'));
    const slug = Number.isSafeInteger(id) && id > 0 ? await deleteGrowFact(c.env, pid, id) : null;
    if (!slug) throw new Refused(404, 'That figure is not on this venture');
    await logGrowWrite(c.env, pid, user.id, { module: slug, entityId: id, action: 'grow_mercury_fact_deleted', summary: 'Mercury figure deleted' });
    return c.json({ ok: true, id });
  } catch (e) { return fail(c, e); }
});

export default r;

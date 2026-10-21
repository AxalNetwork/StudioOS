/**
 * D664 (#1477) — the Grow cycle's overview figures and seven module cards,
 * computed from the stores (migration 443 and the ones it reuses). The route
 * (`routes/cycle_grow.ts`) wraps each card in `settleCard`, so one failing
 * source makes only its own card `unreadable`.
 *
 * SOURCES, BY CARD
 *   Product improvement      product_feedback
 *   Distribution             growth_channels + channel_spend; customers by UTM
 *                            source from contacts.utm_json (migration 166);
 *                            sign-ups from waitlist_signups
 *   Revenue and traction     project_metrics (Stripe import or typed);
 *                            movements and cohorts computed from the ledger
 *                            when the card is read
 *   Team expansion           company_people, company_headcount_plan (326),
 *                            job_postings, job_applications (132, 443)
 *   Partner network          growth_partners, partner_revenue
 *   Market expansion         markets
 *   Durable company-building compliance_events + durability_checklist, seeded
 *                            from the Spin-Out Lab's graduation gates
 *
 * A typed figure carries `source: 'manual'`; a computed one names its source
 * and date. A missing value is null with a reason, never 0.
 */
import type { Env } from '../types';
import {
  type Card, type Figure, figure, notRecordedFigure, seriesState,
} from './cycleCards';
import { billingPeriods, byMonth, cohortRetention, computeMovements, movementGap, prevMonth, readRecurring, type LedgerRecurring, type Movement } from './revenueMovements';

export const GROW_QUESTION = 'How does this venture become larger and more enduring?';

/** The seven modules, in tab order, as the canvas names them. */
export const GROW_MODULES = [
  { slug: 'product-improvement', name: 'Product improvement', range: 'Last 90 days', source: 'Product feedback',
    caption: 'Feedback themes by volume, shaded by status.' },
  { slug: 'distribution', name: 'Distribution', range: 'This month', source: 'Channels, spend and attributed contacts',
    caption: 'Cost per acquired customer by channel this calendar month; visit to paying customer.' },
  { slug: 'revenue-and-traction', name: 'Revenue and traction', range: 'Last 12 months', source: 'Revenue ledger and metric snapshots',
    caption: 'MRR per month as new and expansion above the line, churned below; cohort retention by signup month. MRR is cash by the month it was received, so an annual invoice or a late payment reads as churn and then new revenue.' },
  { slug: 'team-expansion', name: 'Team expansion', range: 'Last 6 months', source: 'Team roster, hiring plan and open roles',
    caption: 'Headcount against the hiring plan (dashed); open roles by stage.' },
  { slug: 'partner-network', name: 'Partner network', range: 'Last 6 months', source: 'Partners and partner-sourced revenue',
    caption: 'Partners by stage; revenue sourced by partners per month.' },
  { slug: 'market-expansion', name: 'Market expansion', range: 'Current', source: 'Markets',
    caption: 'Each market’s readiness, by its four parts.' },
  { slug: 'durable-company-building', name: 'Durable company-building', range: 'Next 90 days', source: 'Compliance calendar and checklist',
    caption: 'The compliance calendar for the next 90 days; checklist completion.' },
] as const;
export type GrowSlug = typeof GROW_MODULES[number]['slug'];

/**
 * The durability checklist, starting from the Spin-Out Lab's graduation gates
 * (`SpinoutLabCompliancePage.jsx`, milestone keys in `spinoutLabCatalog.ts`):
 * a Lab venture's own milestones tick them; anyone else ticks them by hand.
 */
export const DURABILITY_ITEMS: ReadonlyArray<{ key: string; label: string; lab: string | null; mercury?: 'runway' }> = [
  { key: 'ein_received', label: 'Tax ID (EIN) received', lab: 'ein_received' },
  { key: 'founder_stock_issued', label: 'Founder stock issued', lab: 'founder_stock_issued' },
  { key: 'section83b_filed', label: '83(b) elections filed', lab: 'section83b_filed' },
  { key: 'cofounder_agreement_signed', label: 'Co-founder agreement signed', lab: 'cofounder_agreement_signed' },
  { key: 'captable_locked', label: 'Cap table locked', lab: 'captable_locked' },
  { key: 'data_room_built', label: 'Data room built', lab: 'data_room_built' },
  { key: 'key_person_cover', label: 'Key-person cover set up', lab: null },
  { key: 'board_cadence', label: 'Board meeting cadence agreed', lab: null },
  // D840 part 3: the founder's own Mercury ticks it from its runway; anyone else ticks it by hand.
  { key: 'runway_12_months', label: 'Twelve months of runway', lab: null, mercury: 'runway' },
];

/** D840 part 3: the runway Mercury last measured ticks an item whose `mercury` is 'runway' at this many months. */
export const MERCURY_RUNWAY_MONTHS = 12;

export const MARKET_PARTS = [
  ['demand', 'Demand'], ['regulation', 'Regulation'], ['partners', 'Partners'], ['cost', 'Cost to enter'],
] as const;

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthsBack = (now: number, n: number) => {
  const d = new Date(now); const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
};
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;

export interface Ctx { env: Env; projectId: number; now: number; href: (slug: GrowSlug) => string }

// ── Figures ─────────────────────────────────────────────────────────────────

interface Snap { snapshot_date: string; source: string | null; mrr: number | null; paying_accounts: number | null }

const snapSource = (s: string | null) => (s && s.trim() ? s.trim() : 'manual');

/** The latest recorded value of a metric column, the one ~30 days before, and a monthly sparkline. */
function metricFigure(rows: Snap[], col: 'mrr' | 'paying_accounts', key: string, label: string, unit: string, now: number): Figure {
  const have = rows.filter((r) => typeof r[col] === 'number').sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  if (!have.length) return notRecordedFigure(key, label, unit, `Not recorded: no metric snapshot records ${label}`);
  const last = have[have.length - 1];
  const cutoff = iso(Date.parse(last.snapshot_date) - 30 * DAY);
  const before = [...have].reverse().find((r) => r.snapshot_date <= cutoff);
  const months = new Map<string, number>();
  for (const r of have) months.set(r.snapshot_date.slice(0, 7), r[col] as number);
  const spark = monthsBack(now, 8).filter((m) => months.has(m)).map((m) => months.get(m)!);
  return figure({
    key, label, unit, value: last[col] as number,
    delta_30d: before ? (last[col] as number) - (before[col] as number) : null,
    spark, source: snapSource(last.source), as_of: last.snapshot_date,
  });
}

export async function readSnapshots(env: Env, projectId: number): Promise<Snap[]> {
  const r = await env.DB.prepare(
    `SELECT snapshot_date, source, mrr, paying_accounts FROM project_metrics WHERE project_id = ? ORDER BY snapshot_date`,
  ).bind(projectId).all<Snap>();
  return r.results || [];
}

/** Net revenue retention for the latest split month: (start + expansion - churned) / start. */
export function nrrFromLedger(rows: LedgerRecurring[]): { value: number | null; reason: string | null; source: string | null; as_of: string | null; spark: number[] } {
  const gap = movementGap(rows);
  if (gap) return { value: null, reason: gap, source: null, as_of: null, spark: [] };
  const months = byMonth(rows);
  const sorted = [...months.keys()].sort();
  const values: Array<{ m: string; v: number; source: string; as_of: string }> = [];
  for (const m of sorted) {
    const cur = months.get(m)!; const prev = months.get(prevMonth(m));
    if (!prev || cur.anonymous || prev.anonymous || prev.total === 0) continue;
    // Revenue kept from last month's customers, including expansion and churn.
    let kept = 0;
    for (const [c, p] of prev.mrr) { void p; kept += cur.mrr.get(c) ?? 0; }
    values.push({ m, v: Math.round((kept / prev.total) * 1000) / 10, source: cur.source, as_of: cur.as_of });
  }
  if (!values.length) {
    return { value: null, reason: 'Not recorded: the ledger cannot tell customers apart (a Stripe charge with no customer)', source: null, as_of: null, spark: [] };
  }
  const last = values[values.length - 1];
  return { value: last.v, reason: null, source: `Revenue ledger · ${last.source}`, as_of: last.as_of, spark: values.slice(-8).map((x) => x.v) };
}

async function companyOf(env: Env, projectId: number): Promise<number | null> {
  const r = await env.DB.prepare('SELECT company_id FROM projects WHERE id = ?').bind(projectId).first<{ company_id: number | null }>();
  return r?.company_id ?? null;
}

export async function growFigures(x: Ctx): Promise<Figure[]> {
  const settle = async (key: string, label: string, unit: string, f: () => Promise<Figure>): Promise<Figure> => {
    try { return await f(); } catch (e) {
      console.error('[growCycle] figure unreadable:', key, (e as Error).message);
      return { ...notRecordedFigure(key, label, unit, `Unreadable: ${label} could not be read`), state: 'unreadable' };
    }
  };
  const snaps = () => readSnapshots(x.env, x.projectId);
  return Promise.all([
    settle('mrr', 'MRR', 'usd_cents', async () => {
      const f = metricFigure(await snaps(), 'mrr', 'mrr', 'MRR', 'usd', x.now);
      return f;
    }),
    settle('nrr', 'Net revenue retention', 'pct', async () => {
      const n = nrrFromLedger(await readRecurring(x.env, x.projectId));
      if (n.value == null) return notRecordedFigure('nrr', 'Net revenue retention', 'pct', n.reason!);
      return figure({ key: 'nrr', label: 'Net revenue retention', unit: 'pct', value: n.value,
        delta_30d: n.spark.length >= 2 ? Math.round((n.spark[n.spark.length - 1] - n.spark[n.spark.length - 2]) * 10) / 10 : null,
        spark: n.spark, source: n.source, as_of: n.as_of });
    }),
    settle('customers', 'Customers', 'count', async () => metricFigure(await snaps(), 'paying_accounts', 'customers', 'Customers', 'count', x.now)),
    settle('headcount', 'Headcount', 'count', async () => {
      const company = await companyOf(x.env, x.projectId);
      if (company == null) return notRecordedFigure('headcount', 'Headcount', 'count', 'Not recorded: this venture has no company roster yet');
      const people = await x.env.DB.prepare(
        `SELECT start_date FROM company_people WHERE company_id = ? AND status = 'active' AND person_type = 'employee'`,
      ).bind(company).all<{ start_date: string | null }>();
      const rows = people.results || [];
      if (!rows.length) return notRecordedFigure('headcount', 'Headcount', 'count', 'Not recorded: no one is on the team roster yet');
      const spark = monthsBack(x.now, 8).map((m) => rows.filter((p) => !p.start_date || p.start_date.slice(0, 7) <= m).length);
      const cutoff = iso(x.now - 30 * DAY);
      return figure({ key: 'headcount', label: 'Headcount', unit: 'count', value: rows.length,
        delta_30d: rows.filter((p) => p.start_date && p.start_date > cutoff).length,
        spark, source: 'Team roster', as_of: iso(x.now) });
    }),
  ]);
}

// ── Cards ───────────────────────────────────────────────────────────────────

type CardBody = Omit<Card, 'slug' | 'name' | 'caption'> & { caption?: string };

export async function productCard(x: Ctx): Promise<CardBody> {
  const since = iso(x.now - 90 * DAY);
  const r = await x.env.DB.prepare(
    `SELECT theme, status, source, from_email, roadmap_item_label FROM product_feedback WHERE project_id = ? AND substr(created_at, 1, 10) >= ?`,
  ).bind(x.projectId, since).all<{ theme: string | null; status: string; source: string; from_email: string | null; roadmap_item_label: string | null }>();
  const rows = r.results || [];
  if (!rows.length) {
    const any = await x.env.DB.prepare('SELECT 1 FROM product_feedback WHERE project_id = ? LIMIT 1').bind(x.projectId).first();
    return any
      ? { state: 'empty', range: 'Last 90 days', series: [], next: { text: 'Log the first piece of feedback.', href: x.href('product-improvement') }, reason: 'No feedback logged in the last 90 days' }
      : { state: 'empty', range: 'Last 90 days', series: [], next: { text: 'Log feedback', href: `${x.href('product-improvement')}&add=1` }, reason: 'No feedback yet. Themes by volume appear here.' };
  }
  const themes = new Map<string, { theme: string; open: number; planned: number; shipped: number }>();
  for (const f of rows) {
    const t = f.theme && f.theme.trim() ? f.theme.trim() : 'Not recorded';
    const e = themes.get(t) ?? { theme: t, open: 0, planned: 0, shipped: 0 };
    e[f.status as 'open' | 'planned' | 'shipped'] += 1;
    themes.set(t, e);
  }
  const series = [...themes.values()].sort((a, b) => (b.open + b.planned + b.shipped) - (a.open + a.planned + a.shipped));
  // The customers to tell: shipped items with customer feedback that left an email.
  const shipped = new Map<string, number>();
  for (const f of rows) if (f.status === 'shipped' && f.source === 'customer' && f.from_email && f.roadmap_item_label) shipped.set(f.roadmap_item_label, (shipped.get(f.roadmap_item_label) ?? 0) + 1);
  const top = [...shipped.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    state: 'ok', range: 'Last 90 days', series,
    next: top ? { text: `Tell the ${top[1]} customer${top[1] === 1 ? '' : 's'} who asked that ${top[0]} shipped.`, href: x.href('product-improvement') } : null,
    reason: null, source: 'Product feedback', as_of: iso(x.now),
  };
}

/** A channel's customers in a window: contacts whose UTM source names the channel. */
export function utmSource(utmJson: string | null): string | null {
  if (!utmJson) return null;
  try { const v = JSON.parse(utmJson)?.utm_source; return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null; } catch { return null; }
}

export interface ChannelRow { uid: string; name: string; utm_source: string; state: string; spend_cents: number | null; customers: number; cac_cents: number | null; cac_reason: string | null }

/**
 * Each channel's spend and attributed customers for ONE window, the current
 * calendar month: spend is typed per month, so customers are counted by the
 * same month, never a rolling 30 days.
 */
export async function channelRows(x: Ctx): Promise<ChannelRow[]> {
  const month = new Date(x.now).toISOString().slice(0, 7);
  const ch = await x.env.DB.prepare(
    `SELECT g.uid, g.name, g.utm_source, g.state, s.spend_cents FROM growth_channels g
       LEFT JOIN channel_spend s ON s.channel_id = g.id AND s.month = ?
      WHERE g.project_id = ? ORDER BY g.name COLLATE NOCASE`,
  ).bind(month, x.projectId).all<{ uid: string; name: string; utm_source: string; state: string; spend_cents: number | null }>();
  const contacts = await x.env.DB.prepare(
    `SELECT utm_json FROM contacts WHERE project_id = ? AND audience = 'customer' AND utm_json IS NOT NULL AND substr(created_at, 1, 7) = ?`,
  ).bind(x.projectId, month).all<{ utm_json: string }>();
  const counts = new Map<string, number>();
  for (const c of contacts.results || []) { const s = utmSource(c.utm_json); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
  return (ch.results || []).map((c) => {
    const customers = counts.get(c.utm_source) ?? 0;
    const spend = c.spend_cents;
    const cac = spend == null ? null : customers > 0 ? Math.round(spend / customers) : null;
    return { ...c, spend_cents: spend, customers, cac_cents: cac,
      cac_reason: spend == null ? 'Not recorded: no spend entered this month' : customers === 0 ? 'Not recorded: no customer attributed to this channel this month' : null };
  });
}

export async function distributionCard(x: Ctx): Promise<CardBody> {
  const rows = await channelRows(x);
  const month = new Date(x.now).toISOString().slice(0, 7);
  const signups = await x.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM waitlist_signups WHERE project_id = ? AND substr(created_at, 1, 7) = ?`,
  ).bind(x.projectId, month).first<{ n: number }>();
  const paying = (await readSnapshots(x.env, x.projectId)).filter((s) => s.paying_accounts != null).pop();
  const funnel = [
    { stage: 'Visit', value: null, reason: 'Not recorded: no page-visit store yet' },
    { stage: 'Sign-up', value: Number(signups?.n ?? 0), source: 'Waitlist sign-ups' },
    { stage: 'Paying', value: paying ? paying.paying_accounts : null, source: paying ? snapSource(paying.source) : null,
      reason: paying ? null : 'Not recorded: no snapshot records paying customers' },
  ];
  if (!rows.length) return { state: 'empty', range: 'This month', series: { channels: [], funnel }, next: { text: 'Add channel', href: `${x.href('distribution')}&add=1` }, reason: 'No channels yet. Cost per customer by channel appears here.' };
  const priced = rows.filter((r) => r.cac_cents != null && r.state !== 'paused').sort((a, b) => (b.cac_cents as number) - (a.cac_cents as number));
  const worst = priced.length >= 2 ? priced[0] : null;
  return {
    state: priced.length ? 'ok' : 'not_recorded', range: 'This month',
    series: { channels: rows.map((r) => ({ name: r.name, cac_cents: r.cac_cents, reason: r.cac_reason })), funnel },
    next: worst ? { text: `Pause ${worst.name}: CAC ${usd(worst.cac_cents as number)}.`, href: x.href('distribution') } : null,
    reason: priced.length ? null : 'Not recorded: no channel has both spend and an attributed customer this month', source: 'Channels (spend typed: manual)', as_of: iso(x.now),
  };
}

/**
 * The movements of the last 12 months, computed from the ledger when the card
 * is read. `revenue_movements` is not read: it is empty for a ledger that
 * predates migration 443, and this needs no backfill.
 */
export function recentMovements(ledger: LedgerRecurring[], now: number): Movement[] {
  const months = new Set(monthsBack(now, 12));
  return computeMovements(ledger).filter((m) => months.has(m.month));
}

export async function revenueCard(x: Ctx): Promise<CardBody> {
  const ledger = await readRecurring(x.env, x.projectId);
  const rows = recentMovements(ledger, x.now);
  const months = monthsBack(x.now, 12);
  const by = new Map<string, Record<string, number>>();
  for (const r of rows) by.set(r.month, { ...(by.get(r.month) || {}), [r.kind]: r.amount_cents });
  const series = months.filter((m) => by.has(m)).map((m) => ({ month: m, ...by.get(m) }));
  const periods = billingPeriods(ledger);
  const snapshots = await readSnapshots(x.env, x.projectId);
  const gap = movementGap(ledger);
  const churn = gap ? { value: null, state: 'not_recorded', reason: gap === 'Not recorded: needs 2 billings' ? 'Needs 2 billings' : gap } : null;
  const unsplit = rows.filter((r) => r.kind === 'unsplit').length;
  const state = series.length === 0 ? (periods === 0 ? 'empty' : 'not_recorded') : seriesState(series.length);
  return {
    state, range: 'Last 12 months',
    series: { movements: series, cohorts: cohortRetention(ledger), churn },
    next: ledger.length === 0 && !snapshots.length ? { text: 'Enter a KPI', href: `/grow/focus?project_id=${x.projectId}` }
      : unsplit ? { text: `Name the customer on the Stripe charges of ${unsplit} month${unsplit === 1 ? '' : 's'} to split expansion from new.`, href: x.href('revenue-and-traction') } : null,
    reason: ledger.length === 0 && !snapshots.length ? 'No KPIs yet. MRR and retention appear here.' : periods === 0 ? 'No recurring revenue on the ledger yet'
      : series.length === 0 ? gap ?? 'Not recorded: no two billing months in a row in the last 12 months' : null,
    source: rows.length ? `Revenue ledger · ${rows[rows.length - 1].source}` : 'Revenue ledger',
    as_of: rows.length ? rows[rows.length - 1].as_of : null,
  };
}

export const APPLICATION_STAGES = ['applied', 'screen', 'interview', 'offer', 'hired', 'declined'] as const;

/**
 * The month a hiring-plan label points at: `2027-03` or `2027-03-31` as is;
 * `Q1 2027` (or `2027 Q1`) at the quarter's last month; `H1 2027` at June.
 * Anything else names no month and is not drawn.
 */
export function planMonth(label: string): string | null {
  const s = String(label || '').trim();
  const ym = s.match(/^(\d{4})-(0[1-9]|1[0-2])/);
  if (ym) return `${ym[1]}-${ym[2]}`;
  const q = s.match(/^Q([1-4])\s*(\d{4})$/i);
  if (q) return `${q[2]}-${String(Number(q[1]) * 3).padStart(2, '0')}`;
  const q2 = s.match(/^(\d{4})\s*Q([1-4])$/i);
  if (q2) return `${q2[1]}-${String(Number(q2[2]) * 3).padStart(2, '0')}`;
  const h = s.match(/^H([12])\s*(\d{4})$/i);
  if (h) return `${h[2]}-${h[1] === '1' ? '06' : '12'}`;
  return null;
}

export async function teamCard(x: Ctx): Promise<CardBody> {
  const company = await companyOf(x.env, x.projectId);
  let actual: Array<number | null> = []; let plan: Array<number | null> = [];
  const months = monthsBack(x.now, 6);
  if (company != null) {
    const people = await x.env.DB.prepare(
      `SELECT start_date FROM company_people WHERE company_id = ? AND status = 'active' AND person_type = 'employee'`,
    ).bind(company).all<{ start_date: string | null }>();
    const ps = people.results || [];
    actual = months.map((m) => (ps.length ? ps.filter((p) => !p.start_date || p.start_date.slice(0, 7) <= m).length : null));
    const pl = await x.env.DB.prepare('SELECT period_label, target_headcount FROM company_headcount_plan WHERE company_id = ?')
      .bind(company).all<{ period_label: string; target_headcount: number }>();
    const pm = new Map<string, number>();
    for (const p of pl.results || []) { const m = planMonth(p.period_label); if (m) pm.set(m, p.target_headcount); }
    plan = months.map((m) => pm.get(m) ?? null);
  }
  const apps = await x.env.DB.prepare(
    `SELECT a.stage FROM job_applications a JOIN job_postings p ON p.id = a.posting_id
      WHERE p.project_id = ? AND p.status IN ('open', 'published')`,
  ).bind(x.projectId).all<{ stage: string | null }>();
  const stages = new Map<string, number>();
  for (const a of apps.results || []) { const s = a.stage || 'applied'; stages.set(s, (stages.get(s) ?? 0) + 1); }
  const funnel = ['applied', 'screen', 'interview', 'offer'].map((s) => ({ stage: s, count: stages.get(s) ?? 0 }));
  const recorded = actual.filter((v) => v != null).length;
  const roles = company == null ? null : await x.env.DB.prepare("SELECT 1 FROM job_postings WHERE project_id = ? AND status IN ('open', 'published') LIMIT 1").bind(x.projectId).first();
  const newApplicants = stages.get('applied') ?? 0;
  return {
    state: company == null ? 'not_recorded' : seriesState(recorded), range: 'Last 6 months',
    series: { months, headcount: actual, plan, roles_by_stage: funnel },
    next: company != null && recorded === 0 && !roles ? { text: 'Open a role', href: `/grow/team-expansion/new?project=${x.projectId}` }
      : newApplicants ? { text: `Review the ${newApplicants} new applicant${newApplicants === 1 ? '' : 's'}.`, href: x.href('team-expansion') } : null,
    reason: company == null ? 'Not recorded: this venture has no company roster yet' : recorded === 0 && !roles ? 'No open roles yet. Headcount against the plan appears here.' : recorded === 0 ? 'No one is on the team roster yet.' : null, source: 'Team roster and open roles', as_of: iso(x.now),
  };
}

export async function partnerCard(x: Ctx): Promise<CardBody> {
  const ps = await x.env.DB.prepare(
    `SELECT id, name, stage, updated_at FROM growth_partners WHERE project_id = ? ORDER BY updated_at`,
  ).bind(x.projectId).all<{ id: number; name: string; stage: string; updated_at: string }>();
  const rows = ps.results || [];
  if (!rows.length) return { state: 'empty', range: 'Last 6 months', series: { by_stage: [], revenue: [] }, next: { text: 'Add partner', href: `${x.href('partner-network')}&add=1` }, reason: 'No partners yet. Partners by stage appear here.' };
  const months = monthsBack(x.now, 6);
  const rev = await x.env.DB.prepare(
    `SELECT r.month, SUM(r.amount_cents) AS cents FROM partner_revenue r JOIN growth_partners g ON g.id = r.partner_id
      WHERE g.project_id = ? GROUP BY r.month`,
  ).bind(x.projectId).all<{ month: string; cents: number }>();
  const rm = new Map((rev.results || []).map((r) => [r.month, Number(r.cents)]));
  const terms = rows.find((r) => r.stage === 'terms');
  return {
    state: 'ok', range: 'Last 6 months',
    series: {
      by_stage: ['talking', 'terms', 'signed'].map((s) => ({ stage: s, count: rows.filter((r) => r.stage === s).length })),
      // A month no one recorded is null, not $0.
      revenue: months.map((m) => ({ month: m, cents: rm.has(m) ? rm.get(m)! : null })),
    },
    next: terms ? { text: `Agree terms with ${terms.name}.`, href: x.href('partner-network') } : null,
    reason: null, source: 'Partners (revenue typed: manual)', as_of: iso(x.now),
  };
}

export interface MarketRow {
  uid: string; name: string; state: string; decision: string | null; decided_on: string | null;
  demand_score: number | null; demand_source: string | null; regulation_score: number | null; regulation_source: string | null;
  partners_score: number | null; partners_source: string | null; cost_score: number | null; cost_source: string | null;
}

/** Readiness out of 40, only when all four parts are scored; the weakest part (an unscored part first). */
export function readiness(m: MarketRow): { score: number | null; weakest: string | null; missing: string[] } {
  const parts = MARKET_PARTS.map(([k, label]) => ({ label, v: (m as any)[`${k}_score`] as number | null }));
  const missing = parts.filter((p) => p.v == null).map((p) => p.label);
  const scored = parts.filter((p) => p.v != null);
  const weakest = missing.length ? missing[0] : scored.length ? scored.sort((a, b) => (a.v as number) - (b.v as number))[0].label : null;
  return { score: missing.length ? null : scored.reduce((n, p) => n + (p.v as number), 0), weakest, missing };
}

export async function marketRows(env: Env, projectId: number): Promise<MarketRow[]> {
  const r = await env.DB.prepare(
    `SELECT uid, name, state, decision, decided_on, demand_score, demand_source, regulation_score, regulation_source,
            partners_score, partners_source, cost_score, cost_source FROM markets WHERE project_id = ? ORDER BY name COLLATE NOCASE`,
  ).bind(projectId).all<MarketRow>();
  return r.results || [];
}

export async function marketCard(x: Ctx): Promise<CardBody> {
  const rows = await marketRows(x.env, x.projectId);
  if (!rows.length) return { state: 'empty', range: 'Current', series: [], next: { text: 'Add market', href: `${x.href('market-expansion')}&add=1` }, reason: 'No markets yet. Readiness by market appears here.' };
  const gap = rows.map((m) => ({ m, r: readiness(m) })).find((x2) => x2.r.missing.length);
  return {
    state: 'ok', range: 'Current',
    series: rows.map((m) => ({ market: m.name, parts: MARKET_PARTS.map(([k, label]) => ({ part: label, score: (m as any)[`${k}_score`], source: (m as any)[`${k}_source`] })) })),
    next: gap ? { text: `Source the ${gap.r.missing[0].toLowerCase()} score for ${gap.m.name}.`, href: x.href('market-expansion') } : null,
    reason: null, source: 'Markets', as_of: iso(x.now),
  };
}

/** The checklist, each item done by the Lab's milestone or by hand. */
export async function checklist(env: Env, projectId: number) {
  const marks = await env.DB.prepare('SELECT item_key, done_at FROM durability_checklist WHERE project_id = ?')
    .bind(projectId).all<{ item_key: string; done_at: string | null }>();
  const mine = new Map((marks.results || []).map((m) => [m.item_key, m.done_at]));
  let lab = new Map<string, string | null>();
  try {
    // The Lab records milestones per founder account, not per venture, so
    // they tick items only while that founder holds exactly one venture: with
    // two, nothing says which venture a milestone was for.
    const r = await env.DB.prepare(
      `SELECT m.milestone_key AS k, m.completed_at AS at FROM spinout_lab_milestones m
         JOIN users u ON u.id = m.user_id JOIN projects p ON p.founder_id = u.founder_id
        WHERE p.id = ?
          AND (SELECT COUNT(*) FROM projects o WHERE o.founder_id = p.founder_id AND o.deleted_at IS NULL) = 1`,
    ).bind(projectId).all<{ k: string; at: string | null }>();
    lab = new Map((r.results || []).map((x) => [x.k, x.at]));
  } catch { /* not a Lab venture's database: the Lab ticks nothing */ }
  // D840 part 3: the runway the founder's Mercury last measured. Only the tick
  // and its date are read here, never the figure, which is the team's alone.
  let runway: { months: number | null; as_of: string } | null = null;
  try {
    const r = await env.DB.prepare(`SELECT value, as_of FROM mercury_grow_facts WHERE project_id = ? AND kind = 'runway' AND period = 'current'`)
      .bind(projectId).first<{ value: number | null; as_of: string }>();
    runway = r ? { months: r.value, as_of: r.as_of } : null;
  } catch { /* no Mercury store on this database: Mercury ticks nothing */ }
  return DURABILITY_ITEMS.map((i) => {
    const byLab = i.lab ? lab.has(i.lab) : false;
    const byHand = !!mine.get(i.key);
    const byMercury = i.mercury === 'runway' && runway != null && runway.months != null && runway.months >= MERCURY_RUNWAY_MONTHS;
    return { key: i.key, label: i.label, done: byLab || byHand || byMercury,
      source: byLab ? 'Spin-Out Lab' : byHand ? 'manual' : byMercury ? `From Mercury, as of ${runway!.as_of}` : null,
      done_at: byLab ? lab.get(i.lab!) ?? null : byHand ? mine.get(i.key) ?? null : byMercury ? runway!.as_of : null };
  });
}

export async function durableCard(x: Ctx): Promise<CardBody> {
  const until = iso(x.now + 90 * DAY);
  const ev = await x.env.DB.prepare(
    `SELECT id, title, due_date, completion_status, owner_name FROM compliance_events
      WHERE project_id = ? AND due_date IS NOT NULL AND substr(due_date, 1, 10) BETWEEN ? AND ? ORDER BY due_date`,
  ).bind(x.projectId, iso(x.now), until).all<{ id: number; title: string; due_date: string; completion_status: string; owner_name: string | null }>();
  const list = await checklist(x.env, x.projectId);
  const done = list.filter((i) => i.done).length;
  const events = (ev.results || []).map(({ due_date, ...event }) => ({ ...event, due_at: due_date }));
  const anyEvent = await x.env.DB.prepare('SELECT 1 FROM compliance_events WHERE project_id = ? LIMIT 1').bind(x.projectId).first();
  const firstOpen = list.find((i) => !i.done);
  const ownerless = events.find((e) => !e.owner_name);
  return {
    state: events.length || done ? 'ok' : 'empty', range: 'Next 90 days',
    series: { calendar: events.map((e) => ({ title: e.title, due: e.due_at.slice(0, 10), owner: e.owner_name })),
      checklist: { done, total: list.length, pct: Math.round((done / list.length) * 100) } },
    next: !anyEvent && !done ? { text: 'Add obligation', href: `${x.href('durable-company-building')}&add=1` }
      : ownerless ? { text: `Give ${ownerless.title} an owner.`, href: x.href('durable-company-building') }
      : firstOpen ? { text: `${firstOpen.label}.`, href: x.href('durable-company-building') } : null,
    reason: !anyEvent && !done ? 'No obligations yet. The compliance calendar appears here.' : !events.length && !done ? 'No obligation falls due in the next 90 days.' : null, source: 'Compliance calendar and checklist', as_of: iso(x.now),
  };
}

export const CARD_FNS: Record<GrowSlug, (x: Ctx) => Promise<CardBody>> = {
  'product-improvement': productCard,
  'distribution': distributionCard,
  'revenue-and-traction': revenueCard,
  'team-expansion': teamCard,
  'partner-network': partnerCard,
  'market-expansion': marketCard,
  'durable-company-building': durableCard,
};

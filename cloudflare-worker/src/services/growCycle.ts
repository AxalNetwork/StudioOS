/**
 * D664 (#1477) — the Grow cycle's overview figures and seven module cards,
 * computed from the stores (migration 443 and the ones it reuses). The route
 * (`routes/cycle_grow.ts`) reads each card through `safeCard`, so one failing
 * source makes only its own card `unreadable`.
 *
 * SOURCES, BY CARD
 *   Product improvement      product_feedback
 *   Distribution             growth_channels + channel_spend; customers by UTM
 *                            source from contacts.utm_json (migration 166);
 *                            sign-ups from waitlist_signups
 *   Revenue and traction     project_metrics (Stripe import or typed);
 *                            revenue_movements and cohorts from the ledger
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
import { type Card, type CardState, type Figure, MIN_SERIES_POINTS, countState, safeCard, safeFigure } from './cycleCards';
import { billingPeriods, byMonth, cohortRetention, computeMovements, prevMonth, readRecurring, type LedgerRecurring, type Movement } from './revenueMovements';

export const GROW_QUESTION = 'How does this venture become larger and more enduring?';

/** The seven modules, in tab order, as the canvas names them. */
export const GROW_MODULES = [
  { slug: 'product-improvement', name: 'Product improvement', range: 'Last 90 days', source: 'Product feedback',
    caption: 'Feedback themes by volume, shaded by status.' },
  { slug: 'distribution', name: 'Distribution', range: 'This month', source: 'Channels, spend and attributed contacts',
    caption: 'Cost per acquired customer by channel this calendar month; sign-up to paying customer.' },
  { slug: 'revenue-and-traction', name: 'Revenue and traction', range: 'Last 12 months', source: 'Revenue ledger and metric snapshots',
    caption: 'Recurring revenue by the month it was received, as new and expansion against churned; retention by signup cohort. Cash by month: an annual invoice or a late payment reads as churn and new.' },
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
export const DURABILITY_ITEMS: ReadonlyArray<{ key: string; label: string; lab: string | null }> = [
  { key: 'ein_received', label: 'Tax ID (EIN) received', lab: 'ein_received' },
  { key: 'founder_stock_issued', label: 'Founder stock issued', lab: 'founder_stock_issued' },
  { key: 'section83b_filed', label: '83(b) elections filed', lab: 'section83b_filed' },
  { key: 'cofounder_agreement_signed', label: 'Co-founder agreement signed', lab: 'cofounder_agreement_signed' },
  { key: 'captable_locked', label: 'Cap table locked', lab: 'captable_locked' },
  { key: 'data_room_built', label: 'Data room built', lab: 'data_room_built' },
  { key: 'key_person_cover', label: 'Key-person cover set up', lab: null },
  { key: 'board_cadence', label: 'Board meeting cadence agreed', lab: null },
];

export const MARKET_PARTS = [
  ['demand', 'Demand'], ['regulation', 'Regulation'], ['partners', 'Partners'], ['cost', 'Cost to enter'],
] as const;

/** The label a typed value carries, here and in Share an update (`updateShare.ts`). */
export const MANUAL = 'manual';

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const monthsBack = (now: number, n: number) => {
  const d = new Date(now); const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
};
export const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
const monthLabels = (months: string[]) => months.map((m, at) => ({ at, label: m }));

export interface Ctx { env: Env; projectId: number; now: number; href: (slug: GrowSlug) => string }

/** A card's own part: the shared fields (slug, name, range, caption) come from `GROW_MODULES`. */
export type CardBody = Omit<Card, 'slug' | 'name' | 'range' | 'caption'>;
type FigureBody = Omit<Figure, 'key' | 'label' | 'unit' | 'source'>;

/** A figure's state from what it holds: a value with fewer than three points has no line. */
function figureBody(value: number, spark: number[], delta: number | null, as_of: string | null): FigureBody {
  return { value, spark, delta_30d: delta, as_of, reason: null,
    state: spark.filter((v) => Number.isFinite(v)).length < MIN_SERIES_POINTS ? 'too_little' : 'ok' };
}
const notRecorded = (reason: string): FigureBody => ({ value: null, spark: [], delta_30d: null, as_of: null, state: 'not_recorded', reason });

// ── Figures ─────────────────────────────────────────────────────────────────

export interface Snap { snapshot_date: string; source: string | null; mrr: number | null; paying_accounts: number | null }

export const snapSource = (s: string | null) => (s && s.trim() ? s.trim() : MANUAL);

/** A figure's body with its own source (a snapshot's import, or `manual`), which `safeFigure` keeps. */
type Sourced = FigureBody & { source: string };

/** The latest recorded value of a metric column, the one ~30 days before, and a monthly sparkline. */
function metricFigure(rows: Snap[], col: 'mrr' | 'paying_accounts', label: string, now: number): Sourced {
  const have = rows.filter((r) => typeof r[col] === 'number').sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
  if (!have.length) return { ...notRecorded(`Not recorded: no metric snapshot records ${label}`), source: 'Metric snapshots' };
  const last = have[have.length - 1];
  const cutoff = iso(Date.parse(last.snapshot_date) - 30 * DAY);
  const before = [...have].reverse().find((r) => r.snapshot_date <= cutoff);
  const months = new Map<string, number>();
  for (const r of have) months.set(r.snapshot_date.slice(0, 7), r[col] as number);
  const spark = monthsBack(now, 8).filter((m) => months.has(m)).map((m) => months.get(m)!);
  return { ...figureBody(last[col] as number, spark, before ? (last[col] as number) - (before[col] as number) : null, last.snapshot_date),
    source: snapSource(last.source) };
}

export async function readSnapshots(env: Env, projectId: number): Promise<Snap[]> {
  const r = await env.DB.prepare(
    `SELECT snapshot_date, source, mrr, paying_accounts FROM project_metrics WHERE project_id = ? ORDER BY snapshot_date`,
  ).bind(projectId).all<Snap>();
  return r.results || [];
}

/**
 * Why a movement cannot be read yet, or null when it can: churn needs two
 * billing periods, and two that are consecutive months (a gap month is not
 * recorded, so it is never compared).
 */
export function movementGap(rows: LedgerRecurring[]): string | null {
  const months = byMonth(rows);
  if (months.size < 2) return 'Needs 2 billings';
  for (const m of months.keys()) if (months.has(prevMonth(m))) return null;
  return 'Not recorded: no two billing months in a row';
}

/**
 * Net revenue retention for the latest month that can be split: revenue kept
 * from the previous calendar month's customers ÷ that month's total. It is
 * month on month, not a rolling 30 days.
 */
export function nrrFromLedger(rows: LedgerRecurring[]): { value: number | null; reason: string | null; source: string | null; as_of: string | null; spark: number[] } {
  const gap = movementGap(rows);
  if (gap) return { value: null, reason: gap === 'Needs 2 billings' ? 'Not recorded: needs 2 billings' : gap, source: null, as_of: null, spark: [] };
  const months = byMonth(rows);
  const values: Array<{ v: number; source: string; as_of: string }> = [];
  for (const m of [...months.keys()].sort()) {
    const cur = months.get(m)!; const prev = months.get(prevMonth(m));
    if (!prev || cur.anonymous || prev.anonymous || prev.total === 0) continue;
    let kept = 0;
    for (const c of prev.mrr.keys()) kept += cur.mrr.get(c) ?? 0;
    values.push({ v: Math.round((kept / prev.total) * 1000) / 10, source: cur.source, as_of: cur.as_of });
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

async function rosterStarts(env: Env, company: number): Promise<Array<{ start_date: string | null }>> {
  const r = await env.DB.prepare(
    `SELECT start_date FROM company_people WHERE company_id = ? AND status = 'active' AND person_type = 'employee'`,
  ).bind(company).all<{ start_date: string | null }>();
  return r.results || [];
}

/** The four headline figures, each through `safeFigure`: one failing source makes only its figure unreadable. */
export async function growFigures(x: Ctx): Promise<Figure[]> {
  let snapsP: Promise<Snap[]> | null = null;
  const snaps = () => (snapsP ??= readSnapshots(x.env, x.projectId));
  return Promise.all([
    safeFigure({ key: 'mrr', label: 'MRR', unit: 'usd', source: 'Metric snapshots' }, async () => metricFigure(await snaps(), 'mrr', 'MRR', x.now)),
    safeFigure({ key: 'nrr', label: 'Net revenue retention', unit: 'pct', source: 'Revenue ledger' }, async () => {
      const n = nrrFromLedger(await readRecurring(x.env, x.projectId));
      if (n.value == null) return notRecorded(n.reason!);
      const delta = n.spark.length >= 2 ? Math.round((n.spark[n.spark.length - 1] - n.spark[n.spark.length - 2]) * 10) / 10 : null;
      const out: Sourced = { ...figureBody(n.value, n.spark, delta, n.as_of), source: n.source! };
      return out;
    }),
    safeFigure({ key: 'customers', label: 'Customers', unit: 'count', source: 'Metric snapshots' },
      async () => metricFigure(await snaps(), 'paying_accounts', 'Customers', x.now)),
    safeFigure({ key: 'headcount', label: 'Headcount', unit: 'count', source: 'Team roster' }, async () => {
      const company = await companyOf(x.env, x.projectId);
      if (company == null) return notRecorded('Not recorded: this venture has no company roster yet');
      const rows = await rosterStarts(x.env, company);
      if (!rows.length) return notRecorded('Not recorded: no one is on the team roster yet');
      const spark = monthsBack(x.now, 8).map((m) => rows.filter((p) => !p.start_date || p.start_date.slice(0, 7) <= m).length);
      const cutoff = iso(x.now - 30 * DAY);
      return figureBody(rows.length, spark, rows.filter((p) => p.start_date && p.start_date > cutoff).length, iso(x.now));
    }),
  ]);
}

// ── Cards ───────────────────────────────────────────────────────────────────
//
// `series` is D661's list of chart specs (`frontend/src/pages/cycles/cycleModel.js`
// CHART_KINDS). A value no store holds is null in a spec, never 0.

export async function productCard(x: Ctx): Promise<CardBody> {
  const since = iso(x.now - 90 * DAY);
  const r = await x.env.DB.prepare(
    `SELECT theme, status, source, from_email, roadmap_item_label FROM product_feedback WHERE project_id = ? AND substr(created_at, 1, 10) >= ?`,
  ).bind(x.projectId, since).all<{ theme: string | null; status: string; source: string; from_email: string | null; roadmap_item_label: string | null }>();
  const rows = r.results || [];
  if (!rows.length) return { state: 'empty', series: [], next: { text: 'Log the first piece of feedback.', href: x.href('product-improvement') }, reason: 'No feedback logged in the last 90 days' };
  const themes = new Map<string, { open: number; planned: number; shipped: number }>();
  for (const f of rows) {
    const t = f.theme && f.theme.trim() ? f.theme.trim() : 'No theme';
    const e = themes.get(t) ?? { open: 0, planned: 0, shipped: 0 };
    e[f.status as 'open' | 'planned' | 'shipped'] += 1;
    themes.set(t, e);
  }
  const sorted = [...themes.entries()].sort(([, a], [, b]) => (b.open + b.planned + b.shipped) - (a.open + a.planned + a.shipped));
  // The customers to tell: shipped items with customer feedback that left an email.
  const shipped = new Map<string, number>();
  for (const f of rows) if (f.status === 'shipped' && f.source === 'customer' && f.from_email && f.roadmap_item_label) shipped.set(f.roadmap_item_label, (shipped.get(f.roadmap_item_label) ?? 0) + 1);
  const top = [...shipped.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    state: 'ok',
    series: [{ kind: 'stack', rows: sorted.map(([label, e]) => ({ label, parts: [e.open, e.planned, e.shipped] })), tones: ['grey', 'v2', 'ok'],
      legend: [{ label: 'Open', tone: 'grey' }, { label: 'Planned', tone: 'v2' }, { label: 'Shipped', tone: 'ok' }] }],
    next: top ? { text: `Tell the ${top[1]} customer${top[1] === 1 ? '' : 's'} who asked that ${top[0]} shipped.`, href: x.href('product-improvement') } : null,
    reason: null,
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
  // Visits have no store, so the funnel starts at sign-up.
  const funnel = { kind: 'funnel', steps: [{ label: 'Sign-up', value: Number(signups?.n ?? 0) }, { label: 'Paying', value: paying ? paying.paying_accounts : null }] };
  if (!rows.length) return { state: 'empty', series: [], next: { text: 'Add your first channel.', href: x.href('distribution') }, reason: 'No channel added yet' };
  const priced = rows.filter((r) => r.cac_cents != null && r.state !== 'paused').sort((a, b) => (b.cac_cents as number) - (a.cac_cents as number));
  const worst = priced.length >= 2 ? priced[0] : null;
  return {
    state: priced.length ? 'ok' : 'not_recorded',
    series: [{ kind: 'hbar', items: priced.map((r) => ({ label: r.name, value: Math.round((r.cac_cents as number) / 100) })) }, funnel],
    next: worst ? { text: `Pause ${worst.name}: CAC ${usd(worst.cac_cents as number)}.`, href: x.href('distribution') } : null,
    reason: priced.length ? null : 'Not recorded: no channel has both spend and an attributed customer this month',
  };
}

/** The movements of the last 12 months, computed from the ledger at read time. */
export function recentMovements(ledger: LedgerRecurring[], now: number): { months: string[]; by: Map<string, Partial<Record<Movement['kind'], Movement>>> } {
  const months = monthsBack(now, 12);
  const by = new Map<string, Partial<Record<Movement['kind'], Movement>>>();
  for (const m of computeMovements(ledger)) if (months.includes(m.month)) by.set(m.month, { ...(by.get(m.month) || {}), [m.kind]: m });
  return { months, by };
}

export async function revenueCard(x: Ctx): Promise<CardBody> {
  const ledger = await readRecurring(x.env, x.projectId);
  if (billingPeriods(ledger) === 0) return { state: 'empty', series: [], next: { text: 'Record the first recurring payment.', href: x.href('revenue-and-traction') }, reason: 'No recurring revenue on the ledger yet' };
  const gap = movementGap(ledger);
  if (gap) return { state: 'not_recorded', series: [], next: null, reason: gap };
  const { months, by } = recentMovements(ledger, x.now);
  const shown = months.filter((m) => by.has(m));
  const unsplit = shown.filter((m) => by.get(m)!.unsplit).length;
  const cohorts = cohortRetention(ledger).slice(-6);
  const series: unknown[] = [{
    kind: 'vstack',
    // Above the line: new, expansion (or the two unsplit); churned is drawn in its own tone.
    rows: shown.map((m) => { const d = by.get(m)!; return d.unsplit ? [0, d.unsplit.amount_cents / 100, 0] : [(d.new?.amount_cents ?? 0) / 100, (d.expansion?.amount_cents ?? 0) / 100, (d.churned?.amount_cents ?? 0) / 100]; }),
    tones: ['v1', 'v2', 'bad'], labels: monthLabels(shown),
    legend: [{ label: 'New', tone: 'v1' }, { label: unsplit ? 'Expansion (or new, unsplit)' : 'Expansion', tone: 'v2' }, { label: 'Churned', tone: 'bad' }],
  }];
  if (cohorts.length) series.push({ kind: 'heat', axis: 'Months since signup', rows: cohorts.map((c) => ({ label: c.cohort, cells: c.retention.map((v) => (v == null ? null : v / 100)) })) });
  return {
    state: countState(shown.length),
    series,
    next: unsplit ? { text: `Name the customer on the Stripe charges of ${unsplit} month${unsplit === 1 ? '' : 's'} to split expansion from new.`, href: x.href('revenue-and-traction') } : null,
    reason: shown.length ? null : 'Not recorded: no two billing months in a row in the last 12 months',
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
  const months = monthsBack(x.now, 6);
  const apps = await x.env.DB.prepare(
    `SELECT a.stage FROM job_applications a JOIN job_postings p ON p.id = a.posting_id
      WHERE p.project_id = ? AND p.status IN ('open', 'published')`,
  ).bind(x.projectId).all<{ stage: string | null }>();
  const stages = new Map<string, number>();
  for (const a of apps.results || []) { const s = a.stage || 'applied'; stages.set(s, (stages.get(s) ?? 0) + 1); }
  const funnel = { kind: 'funnel', steps: ['applied', 'screen', 'interview', 'offer'].map((s) => ({ label: s[0].toUpperCase() + s.slice(1), value: stages.get(s) ?? 0 })) };
  const newApplicants = stages.get('applied') ?? 0;
  const next = newApplicants ? { text: `Review the ${newApplicants} new applicant${newApplicants === 1 ? '' : 's'}.`, href: x.href('team-expansion') } : null;
  if (company == null) return { state: 'not_recorded', series: [], next, reason: 'Not recorded: this venture has no company roster yet' };
  const ps = await rosterStarts(x.env, company);
  if (!ps.length) return { state: 'empty', series: [], next: next ?? { text: 'Add the team to the roster.', href: x.href('team-expansion') }, reason: 'No one is on the team roster yet' };
  const actual = months.map((m) => ps.filter((p) => !p.start_date || p.start_date.slice(0, 7) <= m).length);
  const pl = await x.env.DB.prepare('SELECT period_label, target_headcount FROM company_headcount_plan WHERE company_id = ?')
    .bind(company).all<{ period_label: string; target_headcount: number }>();
  const pm = new Map<string, number>();
  for (const p of pl.results || []) { const m = planMonth(p.period_label); if (m) pm.set(m, p.target_headcount); }
  const plan = months.map((m) => pm.get(m) ?? null);
  const line: Record<string, unknown> = { kind: 'line', values: actual, labels: monthLabels(months) };
  if (plan.some((v) => v != null)) line.plan = plan;
  return { state: countState(actual.length), series: [line, funnel], next, reason: null };
}

export async function partnerCard(x: Ctx): Promise<CardBody> {
  const ps = await x.env.DB.prepare(
    `SELECT id, name, stage, updated_at FROM growth_partners WHERE project_id = ? ORDER BY updated_at`,
  ).bind(x.projectId).all<{ id: number; name: string; stage: string; updated_at: string }>();
  const rows = ps.results || [];
  if (!rows.length) return { state: 'empty', series: [], next: { text: 'Add your first partner.', href: x.href('partner-network') }, reason: 'No partner added yet' };
  const months = monthsBack(x.now, 6);
  const rev = await x.env.DB.prepare(
    `SELECT r.month, SUM(r.amount_cents) AS cents FROM partner_revenue r JOIN growth_partners g ON g.id = r.partner_id
      WHERE g.project_id = ? GROUP BY r.month`,
  ).bind(x.projectId).all<{ month: string; cents: number }>();
  const rm = new Map((rev.results || []).map((r) => [r.month, Number(r.cents)]));
  const terms = rows.find((r) => r.stage === 'terms');
  const series: unknown[] = [{ kind: 'rows', items: ['talking', 'terms', 'signed'].map((s) => ({ label: s[0].toUpperCase() + s.slice(1), value: rows.filter((r) => r.stage === s).length })) }];
  // A month no one recorded is null, not $0.
  if (months.some((m) => rm.has(m))) series.push({ kind: 'vbars', values: months.map((m) => (rm.has(m) ? rm.get(m)! / 100 : null)), labels: monthLabels(months) });
  return { state: 'ok', series, next: terms ? { text: `Agree terms with ${terms.name}.`, href: x.href('partner-network') } : null, reason: null };
}

export interface MarketRow {
  id: number; uid: string; name: string; state: string; decision: string | null; decided_on: string | null;
  demand_score: number | null; demand_source: string | null; regulation_score: number | null; regulation_source: string | null;
  partners_score: number | null; partners_source: string | null; cost_score: number | null; cost_source: string | null;
}

/** Readiness out of 40, only when all four parts are scored; the weakest part (an unscored part first). */
export function readiness(m: Omit<MarketRow, 'id' | 'uid' | 'name' | 'state' | 'decision' | 'decided_on'>): { score: number | null; weakest: string | null; missing: string[] } {
  const parts = MARKET_PARTS.map(([k, label]) => ({ label, v: (m as any)[`${k}_score`] as number | null }));
  const missing = parts.filter((p) => p.v == null).map((p) => p.label);
  const scored = parts.filter((p) => p.v != null);
  const weakest = missing.length ? missing[0] : scored.length ? scored.sort((a, b) => (a.v as number) - (b.v as number))[0].label : null;
  return { score: missing.length ? null : scored.reduce((n, p) => n + (p.v as number), 0), weakest, missing };
}

export async function marketRows(env: Env, projectId: number): Promise<MarketRow[]> {
  const r = await env.DB.prepare(
    `SELECT id, uid, name, state, decision, decided_on, demand_score, demand_source, regulation_score, regulation_source,
            partners_score, partners_source, cost_score, cost_source FROM markets WHERE project_id = ? ORDER BY name COLLATE NOCASE`,
  ).bind(projectId).all<MarketRow>();
  return r.results || [];
}

export async function marketCard(x: Ctx): Promise<CardBody> {
  const rows = await marketRows(x.env, x.projectId);
  if (!rows.length) return { state: 'empty', series: [], next: { text: 'Add a market you are considering.', href: x.href('market-expansion') }, reason: 'No market added yet' };
  const gap = rows.map((m) => ({ m, r: readiness(m) })).find((x2) => x2.r.missing.length);
  return {
    state: 'ok',
    series: [{ kind: 'stack', tones: ['v1', 'v2', 'v3', 'grey'],
      rows: rows.map((m) => ({ label: m.name, parts: MARKET_PARTS.map(([k]) => (m as any)[`${k}_score`] as number | null) })),
      legend: MARKET_PARTS.map(([, label], i) => ({ label, tone: ['v1', 'v2', 'v3', 'grey'][i] })) }],
    next: gap ? { text: `Source the ${gap.r.missing[0].toLowerCase()} score for ${gap.m.name}.`, href: x.href('market-expansion') } : null,
    reason: null,
  };
}

/**
 * The Spin-Out Lab's milestones for this venture. The Lab records them per
 * founder account, not per project, so they count only when that account's
 * founder holds exactly one venture: with two, nothing says which venture a
 * milestone was for, and it ticks neither.
 */
async function labMilestones(env: Env, projectId: number): Promise<Map<string, string | null>> {
  try {
    const r = await env.DB.prepare(
      `SELECT m.milestone_key AS k, m.completed_at AS at FROM spinout_lab_milestones m
         JOIN users u ON u.id = m.user_id
         JOIN projects p ON p.founder_id = u.founder_id
        WHERE p.id = ?
          AND (SELECT COUNT(*) FROM projects o WHERE o.founder_id = p.founder_id AND o.deleted_at IS NULL) = 1`,
    ).bind(projectId).all<{ k: string; at: string | null }>();
    return new Map((r.results || []).map((x) => [x.k, x.at]));
  } catch { return new Map(); /* no Lab store on this database: the Lab ticks nothing */ }
}

/** The checklist, each item done by the Lab's milestone or by hand. */
export async function checklist(env: Env, projectId: number) {
  const marks = await env.DB.prepare('SELECT item_key, done_at FROM durability_checklist WHERE project_id = ?')
    .bind(projectId).all<{ item_key: string; done_at: string | null }>();
  const mine = new Map((marks.results || []).map((m) => [m.item_key, m.done_at]));
  const lab = await labMilestones(env, projectId);
  return DURABILITY_ITEMS.map((i) => {
    const byLab = i.lab ? lab.has(i.lab) : false;
    const byHand = !!mine.get(i.key);
    return { key: i.key, label: i.label, done: byLab || byHand, source: byLab ? 'Spin-Out Lab' : byHand ? MANUAL : null,
      done_at: byLab ? lab.get(i.lab!) ?? null : mine.get(i.key) ?? null };
  });
}

/** Obligations in production's `compliance_events` shape (`schema_baseline.sql`, `routes/compliance.ts`). */
export interface Obligation { id: number; title: string; event_type: string; due_date: string; completion_status: string; owner_name: string | null }

export async function durableCard(x: Ctx): Promise<CardBody> {
  const ev = await x.env.DB.prepare(
    `SELECT id, title, event_type, due_date, completion_status, owner_name FROM compliance_events
      WHERE project_id = ? AND due_date BETWEEN ? AND ? ORDER BY due_date`,
  ).bind(x.projectId, iso(x.now), iso(x.now + 90 * DAY)).all<Obligation>();
  const list = await checklist(x.env, x.projectId);
  const done = list.filter((i) => i.done).length;
  const events = ev.results || [];
  const firstOpen = list.find((i) => !i.done);
  const ownerless = events.find((e) => !e.owner_name && e.completion_status !== 'completed');
  const series: unknown[] = [];
  if (events.length) series.push({ kind: 'timeline', steps: events.map((e) => ({ label: e.title, date: e.due_date, done: e.completion_status === 'completed' })) });
  series.push({ kind: 'progress', items: [{ label: `Checklist · ${done} of ${list.length}`, pct: Math.round((done / list.length) * 100) }] });
  return {
    state: events.length || done ? 'ok' : 'empty',
    series,
    next: ownerless ? { text: `Give ${ownerless.title} an owner.`, href: x.href('durable-company-building') }
      : firstOpen ? { text: `${firstOpen.label}.`, href: x.href('durable-company-building') } : null,
    reason: events.length || done ? null : 'No obligation in the next 90 days and nothing on the checklist done',
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

/** One card through `safeCard`: a thrown read makes only this card unreadable. */
export function growCard(x: Ctx, slug: GrowSlug): Promise<Card> {
  const meta = GROW_MODULES.find((m) => m.slug === slug)!;
  return safeCard(meta, () => CARD_FNS[slug](x));
}

export type { CardState };

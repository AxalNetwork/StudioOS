/**
 * D898 group C (#2676, part 4 of #2434) — the series a pitch-deck chart can
 * plot (PD9, PD9b, PD9c), read from stores StudioOS already keeps over time.
 *
 * WHAT A SERIES IS. A dated run of one figure: Grow's revenue snapshots
 * (`project_metrics`), one point per month, and Validate's held interviews,
 * one point per week. Stripe's snapshots and the founder's typed ones are two
 * series, never blended, so each keeps its own Source and grade (#2434's
 * "Sources a card binds to"): Stripe's MRR is Connector · Measured, the typed
 * MRR is Typed · Stated. A month with no snapshot is left out, never a 0; a
 * week with no interview between the first and the last is a real 0, because
 * the count was taken.
 *
 * ONLY BOUND SERIES. A chart plots what a store holds; nothing here is typed
 * into the deck and no model runs. "To chart a new figure, record it in its
 * module first" (PD9b).
 *
 * A BINDING per series is D896's five fields: `source_key` is the series key,
 * `record_ref` the newest row behind it, `as_of` its last point's day, `grade`
 * from `sourceAndGrade`, and `snapshot_hash` over the points, so Refresh sees
 * a new month as a change. Range and Keep as of are cuts the editor makes from
 * these points (`editorModel.js`): Keep as of draws the points up to the
 * binding's `as_of`, never a later month.
 *
 * All SQL is bound; none is interpolated.
 */
import type { Env } from '../../types';
import { snapshotHash, sourceAndGrade, type Grade, type Origin, type SourceLabel, type Unit } from './sources';
import { CHART_TYPES } from './slideModel';
import { posthogDeckLink, posthogWauWeekly } from '../posthog/deckFacts';

export type Point = { x: string; y: number };
export type Cadence = 'monthly' | 'weekly';
export type SeriesState = 'recorded' | 'not_recorded' | 'unreadable';

/** What a store gives: the points, where they came from, the newest row and its day. */
type Read = { points: Point[]; origin: Origin; record_ref: string; asOf: string | null };

type Def = {
  key: string; label: string; unit: Unit; cadence: Cadence; module: string; href: (pid: number) => string;
  read: (env: Env, projectId: number) => Promise<Read | null>;
};

export type Series = {
  key: string; label: string; unit: Unit; cadence: Cadence; module: string; href: string;
  state: SeriesState;
  points: Point[];
  as_of: string | null;
  source: SourceLabel | null;
  grade: Grade;
  record_ref: string | null;
  snapshot_hash: string | null;
};

const q = (path: string) => (pid: number) => `${path}?project=${pid}`;
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

type MetricCol = 'mrr' | 'arr' | 'monthly_churn_pct' | 'paying_accounts';

/** One point per month: the newest snapshot of that month from one origin, Stripe's or the founder's. */
function metricSeries(col: MetricCol, stripe: boolean): Def['read'] {
  return async (env, projectId) => {
    const rows = ((await env.DB.prepare(
      `SELECT id, snapshot_date, source, mrr, arr, monthly_churn_pct, paying_accounts FROM project_metrics
        WHERE project_id = ? AND snapshot_date IS NOT NULL ORDER BY snapshot_date ASC, id ASC`,
    ).bind(projectId).all<Record<string, unknown> & { id: number; snapshot_date: string; source: string | null }>()).results || [])
      .filter((r) => (r.source === 'stripe') === stripe && num(r[col]) != null && day(r.snapshot_date));
    if (!rows.length) return null;
    const byMonth = new Map<string, number>();
    for (const r of rows) byMonth.set(day(r.snapshot_date)!.slice(0, 7), num(r[col])!);
    const newest = rows[rows.length - 1];
    return {
      points: [...byMonth.entries()].map(([x, y]) => ({ x, y })),
      origin: stripe ? 'connector' : 'typed',
      record_ref: `project_metrics:${newest.id}`,
      asOf: day(newest.snapshot_date),
    };
  };
}

/** Monday of the UTC week holding `d`. */
function weekOf(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  const shift = (t.getUTCDay() + 6) % 7;
  return new Date(t.getTime() - shift * 86_400_000).toISOString().slice(0, 10);
}

/** Held interviews per week, from the first week to the last; a week between with none is a real 0. */
const interviewsWeekly: Def['read'] = async (env, projectId) => {
  const rows = ((await env.DB.prepare(
    `SELECT i.id, COALESCE(substr(i.done_at, 1, 10), substr(i.interview_date, 1, 10), substr(i.created_at, 1, 10)) AS held,
            EXISTS (SELECT 1 FROM interview_sessions s WHERE s.interview_id = i.id AND s.status <> 'draft') AS recorded
       FROM discovery_interviews i WHERE i.project_id = ? AND (i.stage IS NULL OR i.stage = 'done')`,
  ).bind(projectId).all<{ id: number; held: string | null; recorded: number }>()).results || []).filter((r) => day(r.held));
  if (!rows.length) return null;
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(weekOf(day(r.held)!), (counts.get(weekOf(day(r.held)!)) || 0) + 1);
  const weeks = [...counts.keys()].sort();
  const points: Point[] = [];
  for (let w = weeks[0]; w <= weeks[weeks.length - 1]; w = new Date(Date.parse(`${w}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)) {
    points.push({ x: w, y: counts.get(w) || 0 });
  }
  // A count is only as strong as its weakest member: one hand-logged interview makes it Sourced (D896).
  const origin: Origin = rows.every((r) => Number(r.recorded) === 1) ? 'recorded_session' : 'logged_by_hand';
  const held = rows.map((r) => day(r.held)!).sort();
  return { points, origin, record_ref: `discovery_interviews:${rows.length}`, asOf: held[held.length - 1] };
};

/**
 * D1601 (#3880): weekly active users from the facts PostHog's feeds store for
 * the venture's linked project. No feed stores them yet (#3731), so the series
 * is not recorded, never a run of zeros.
 */
const wauWeekly: Def['read'] = async (env, projectId) => {
  const link = await posthogDeckLink(env, projectId);
  const got = link ? await posthogWauWeekly(env, link) : null;
  if (!got) return null;
  return { points: got.points.filter((p) => day(p.x) && num(p.y) != null), origin: 'connector', record_ref: `posthog:${got.ref}`, asOf: day(got.as_of) };
};

const REVENUE = { module: 'Grow › Revenue and traction', href: q('/grow/revenue-and-traction') };
const METRICS: Array<{ key: string; label: string; unit: Unit; col: MetricCol }> = [
  { key: 'grow.mrr', label: 'MRR', unit: 'usd', col: 'mrr' },
  { key: 'grow.arr', label: 'ARR', unit: 'usd', col: 'arr' },
  { key: 'grow.churn', label: 'Churn, monthly', unit: 'percent', col: 'monthly_churn_pct' },
  { key: 'grow.paying_customers', label: 'Paying customers', unit: 'count', col: 'paying_accounts' },
];

/** Every series a chart can plot, in the order the library lists them. */
export const CHART_SERIES: Def[] = [
  ...METRICS.flatMap((m) => [
    { key: `${m.key}.monthly`, label: `${m.label}, monthly`, unit: m.unit, cadence: 'monthly' as const, ...REVENUE, read: metricSeries(m.col, true) },
    { key: `${m.key}.typed`, label: `Typed ${m.label}`, unit: m.unit, cadence: 'monthly' as const, ...REVENUE, read: metricSeries(m.col, false) },
  ]),
  { key: 'validate.interviews.weekly', label: 'Interviews per week', unit: 'count', cadence: 'weekly', module: 'Validate › Customer research', href: q('/validate/customer-research'), read: interviewsWeekly },
  { key: 'grow.wau.weekly', label: 'Weekly active users', unit: 'count', cadence: 'weekly', module: 'Connectors › PostHog', href: () => '/account/connectors/posthog', read: wauWeekly },
];

const DEFS = new Map(CHART_SERIES.map((d) => [d.key, d]));
export const isSeriesKey = (k: unknown): k is string => typeof k === 'string' && DEFS.has(k);

/** One series as the store holds it now. Never throws: a failed read is `unreadable`. */
export async function readSeries(env: Env, projectId: number, key: string): Promise<Series | null> {
  const def = DEFS.get(key);
  if (!def) return null;
  const base = { key: def.key, label: def.label, unit: def.unit, cadence: def.cadence, module: def.module, href: def.href(projectId) };
  let got: Read | null;
  try { got = await def.read(env, projectId); } catch {
    console.warn('[deck-series] unreadable', def.key);
    return { ...base, state: 'unreadable', points: [], as_of: null, source: null, grade: 'Not recorded', record_ref: null, snapshot_hash: null };
  }
  if (!got || !got.points.length) return { ...base, state: 'not_recorded', points: [], as_of: null, source: null, grade: 'Not recorded', record_ref: null, snapshot_hash: null };
  const asOf = got.asOf;
  const { source, grade } = sourceAndGrade(got.origin);
  const hash = await snapshotHash(def.key, got.record_ref, got.points, asOf);
  return { ...base, state: 'recorded', points: got.points, as_of: asOf, source, grade, record_ref: got.record_ref, snapshot_hash: hash };
}

/** Every series, read once each, for the library and the Data popover. */
export async function readAllSeries(env: Env, projectId: number): Promise<Series[]> {
  const out: Series[] = [];
  for (const d of CHART_SERIES) out.push((await readSeries(env, projectId, d.key))!);
  return out;
}

/** The library's words for each type (PD9b), in the canvas's order. */
export const CHART_TYPE_WORDS: Record<(typeof CHART_TYPES)[number], { label: string; description: string }> = {
  line: { label: 'Line', description: 'Trend over time' },
  columns: { label: 'Columns', description: 'Values by period' },
  stacked: { label: 'Stacked columns', description: 'Parts over time' },
  percent_bar: { label: '100% bar', description: 'Shares of a whole' },
  ranked_bars: { label: 'Ranked bars', description: 'Biggest first' },
  funnel: { label: 'Funnel', description: 'Stages that narrow' },
  cohort_heatmap: { label: 'Cohort heatmap', description: 'Retention by month joined' },
  timeline: { label: 'Timeline', description: 'Dated milestones' },
  metric_tiles: { label: 'Metric tiles', description: 'A few figures, each with its chip' },
  comparison_table: { label: 'Comparison table', description: 'You against the alternatives' },
  waterfall: { label: 'Waterfall', description: 'How a figure moves' },
  nested_bars: { label: 'Nested bars', description: 'Total, serviceable, obtainable' },
};

/** Why a type has nothing to draw from a dated series: the data it needs is not a series StudioOS keeps. */
const NEEDS: Partial<Record<(typeof CHART_TYPES)[number], string>> = {
  ranked_bars: 'Needs categories, such as pain themes, which no chart series gives yet.',
  funnel: 'Needs stages that narrow, which no chart series gives yet.',
  cohort_heatmap: 'Needs churn by month joined, not recorded on StudioOS yet.',
  timeline: 'Needs dated milestones, which no chart series gives yet.',
  comparison_table: 'Needs companies from Research, which no chart series gives yet.',
  nested_bars: 'Needs market sizes from Market intelligence, which no chart series gives yet.',
};

/**
 * How many of the venture's recorded series each type can draw (PD9b's "Fits
 * [n] of your series"), and, for a type with none, the reason. Line, columns
 * and waterfall need two points; stacked and 100% bars need two series in one
 * unit; metric tiles need one figure.
 */
export function chartFits(series: Series[]) {
  const rec = series.filter((s) => s.state === 'recorded' && s.points.length);
  const trend = rec.filter((s) => s.points.length >= 2);
  const byUnit = new Map<string, number>();
  for (const s of rec) byUnit.set(s.unit, (byUnit.get(s.unit) || 0) + 1);
  const sameUnit = Math.max(0, ...byUnit.values());
  return CHART_TYPES.map((type) => {
    let fits = 0;
    let reason: string | null = NEEDS[type] ?? null;
    if (type === 'line' || type === 'columns' || type === 'waterfall') { fits = trend.length; reason = fits ? null : 'Needs a series with two or more points.'; }
    else if (type === 'stacked' || type === 'percent_bar') { fits = sameUnit >= 2 ? sameUnit : 0; reason = fits ? null : 'Needs two series in the same unit.'; }
    else if (type === 'metric_tiles') { fits = rec.length; reason = fits ? null : 'Needs a recorded figure.'; }
    return { type, ...CHART_TYPE_WORDS[type], fits, reason };
  });
}

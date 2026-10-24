/**
 * D896 (#2675, part 2 of #2434) — DECK_SOURCES: every figure a pitch-deck card
 * can show, read from a store StudioOS already has, with its source, date and
 * grade.
 *
 * ONE SLOT PER ROW. Each adapter owns a fixed list of slots, so "31 of 40
 * slots" means the same 40 for every venture. A slot whose store holds nothing
 * is `not_recorded`, with the module that fills it; it is never 0. A store that
 * fails to read marks its slots `unreadable`. Mercury's four slots are
 * `withheld` from anyone but the venture's own founder (D840: only the founder
 * reads its bank, from their own connection); a withheld slot is not a slot for
 * that reader, so it is left out of the count rather than called missing.
 *
 * NO MODEL RUNS HERE, and nothing is written. Every value is a column, a count
 * or a date that code read; the deck's wording is a later part's proposal.
 *
 * GRADES. `sourceAndGrade(origin)` is the one place a store's origin becomes a
 * Source label and a default grade, until SCORING (#2428) lands its "Source to
 * default grade" mapping; then that function changes and every part follows.
 *
 * SCORING ROWS are off unless the founder includes them (owner question 4,
 * drawn A): a band, never a number. Neither band is defined yet (#2428 owns the
 * scorecard band, #2433 the Product-market fit band), so both read
 * `not_recorded` today, and `score_snapshots.total_score` is never read.
 *
 * All SQL is bound; none is interpolated.
 */
import type { Env } from '../../types';
import { claimsOf, loadHypotheses, loadInterviews } from '../cycleValidate';
import { getPainGroupsView, loadPainGroupModel } from '../painGroups';
import { FUND_SECTIONS, parseAllocation } from '../raiseCycle';
import { citableFigures } from '../mercury/raiseFeeds';

export type SourceLabel = 'Connector' | 'Document' | 'Recorded' | 'Signed' | 'Typed';
export type Grade = 'Measured' | 'Reviewed' | 'Sourced' | 'Stated' | 'Not recorded';
/** The four grades a recorded value can carry, strongest first. */
export const GRADES = ['Measured', 'Reviewed', 'Sourced', 'Stated'] as const;

/** Where a value came from, as the store tells it. */
export type Origin =
  | 'connector'         // a connected tool wrote it (Stripe, Mercury, GitHub, Carta)
  | 'platform_count'    // counted from platform records
  | 'recorded_session'  // a recorded interview session
  | 'logged_by_hand'    // an interview the founder logged by hand
  | 'file'              // typed, with a file behind it
  | 'counsel_approved'  // set or approved by someone other than the founder
  | 'typed';            // the founder typed it, with no source

/** #2434's "Sources a card binds to" table, in one function the parts share. */
export function sourceAndGrade(origin: Origin): { source: SourceLabel; grade: Exclude<Grade, 'Not recorded'> } {
  switch (origin) {
    case 'connector': return { source: 'Connector', grade: 'Measured' };
    case 'platform_count': return { source: 'Recorded', grade: 'Measured' };
    case 'recorded_session': return { source: 'Recorded', grade: 'Measured' };
    case 'logged_by_hand': return { source: 'Recorded', grade: 'Sourced' };
    case 'file': return { source: 'Document', grade: 'Sourced' };
    case 'counsel_approved': return { source: 'Document', grade: 'Reviewed' };
    default: return { source: 'Typed', grade: 'Stated' };
  }
}

export type Area = 'validate' | 'build' | 'raise' | 'grow' | 'team' | 'scoring';
export const AREAS: Array<{ id: Area; label: string }> = [
  { id: 'validate', label: 'Validate' }, { id: 'build', label: 'Build' }, { id: 'raise', label: 'Raise' },
  { id: 'grow', label: 'Grow' }, { id: 'team', label: 'Team' }, { id: 'scoring', label: 'Scoring' },
];

export type Unit = 'count' | 'usd' | 'cents' | 'percent' | 'months' | 'date' | 'text';
export type SlotState = 'recorded' | 'not_recorded' | 'unreadable' | 'withheld';

export type SourceItem = {
  source_key: string;
  area: Area;
  /** The module that holds the value, and so the one that fills it when missing. */
  module: string;
  label: string;
  value: number | string | null;
  unit: Unit;
  /** A second value read with the first ("9 of 12": `of` is 12). */
  of?: number | null;
  as_of: string | null;
  grade: Grade;
  source: SourceLabel | null;
  href: string;
  record_ref: string | null;
  snapshot_hash: string | null;
  state: SlotState;
  /** Scoring rows: shown only when the founder includes them. */
  optional?: boolean;
};

export type SourceCtx = {
  env: Env;
  projectId: number;
  /** `YYYY-MM-DD`, the day windows ("in 90 days") count back from. */
  today: string;
  /** The founder's own Mercury connection; null when the reader is not the founder, or has none. */
  mercury: { integrationId: number } | { withheld: true } | null;
};

type Slot = { key: string; label: string; unit: Unit; optional?: boolean };
type Read = { value: number | string | null; of?: number | null; as_of?: string | null; origin: Origin; record_ref?: string | null };
type Adapter = {
  id: string;
  area: Area;
  module: string;
  href: (pid: number) => string;
  slots: Slot[];
  /** Reads every slot it owns; a slot it leaves out is not recorded. */
  read: (ctx: SourceCtx) => Promise<Partial<Record<string, Read | 'withheld'>>>;
};

const q = (path: string) => (pid: number) => `${path}?project=${pid}`;
const day = (v: unknown) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const daysBefore = (today: string, n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const maxDay = (values: unknown[]) => values.map(day).filter(Boolean).sort().pop() ?? null;
const all = async <T>(env: Env, sql: string, ...binds: unknown[]) => ((await env.DB.prepare(sql).bind(...binds).all<T>()).results || []) as T[];
const first = <T>(env: Env, sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).first<T>();

// ─────────────────────────────────────────────────────────────── Validate

const interviews: Adapter = {
  id: 'interviews', area: 'validate', module: 'Validate › Customer research', href: q('/validate/customer-research'),
  slots: [{ key: 'validate.interviews', label: 'Interviews', unit: 'count' }, { key: 'validate.strong_fit', label: 'Strong fit', unit: 'count' }],
  async read({ env, projectId }) {
    // Held means a conversation that happened (cycleValidate `isHeld`).
    const rows = await all<{ id: number; icp_fit: string | null; held: string | null; recorded: number }>(env,
      `SELECT i.id, i.icp_fit, COALESCE(substr(i.done_at, 1, 10), substr(i.interview_date, 1, 10), substr(i.created_at, 1, 10)) AS held,
              EXISTS (SELECT 1 FROM interview_sessions s WHERE s.interview_id = i.id AND s.status <> 'draft') AS recorded
         FROM discovery_interviews i WHERE i.project_id = ? AND (i.stage IS NULL OR i.stage = 'done')`, projectId);
    if (!rows.length) return {};
    // A count is only as strong as its weakest member: one hand-logged interview makes it Sourced.
    const origin = (set: typeof rows): Origin => (set.every((r) => Number(r.recorded) === 1) ? 'recorded_session' : 'logged_by_hand');
    const strong = rows.filter((r) => r.icp_fit === 'strong');
    const out: Record<string, Read> = {
      'validate.interviews': { value: rows.length, as_of: maxDay(rows.map((r) => r.held)), origin: origin(rows), record_ref: `discovery_interviews:${rows.length}` },
    };
    // Fit nobody recorded is not "no strong fit".
    if (rows.some((r) => r.icp_fit != null)) {
      out['validate.strong_fit'] = { value: strong.length, as_of: maxDay(rows.map((r) => r.held)), origin: origin(strong.length ? strong : rows), record_ref: `discovery_interviews:${rows.length}` };
    }
    return out;
  },
};

const painThemes: Adapter = {
  id: 'pain_themes', area: 'validate', module: 'Validate › Problem discovery', href: q('/validate/problem-discovery'),
  slots: [{ key: 'validate.top_pain', label: 'Top pain theme', unit: 'count' }],
  async read({ env, projectId }) {
    const view = await getPainGroupsView(env, projectId, { strict: true });
    const top = [...(view.groups || [])].filter((g) => Number(g.count) > 0)
      .sort((a, b) => Number(b.count) - Number(a.count) || a.sort_order - b.sort_order)[0];
    if (!top) return {};
    const at = await first<{ at: string | null }>(env, 'SELECT MAX(updated_at) AS at FROM pain_groups WHERE id = ? AND project_id = ?', top.id, projectId);
    return { 'validate.top_pain': { value: Number(top.count), of: num(view.interview_total), as_of: day(at?.at), origin: 'platform_count', record_ref: `pain_groups:${top.id}` } };
  },
};

const claims: Adapter = {
  id: 'claims', area: 'validate', module: 'Validate › Experiments', href: q('/validate/experiments'),
  slots: [{ key: 'validate.claims_validated', label: 'Claims validated', unit: 'count' }],
  async read(ctx) {
    const vctx = { env: ctx.env, projectId: ctx.projectId, today: ctx.today };
    const { hyps, links } = await loadHypotheses(vctx);
    if (!hyps.length) return {};
    const list = claimsOf(hyps, links, await loadInterviews(vctx), await loadPainGroupModel(ctx.env, ctx.projectId, { strict: true }));
    const validated = list.filter((c) => c.verdict === 'validated');
    return { 'validate.claims_validated': { value: validated.length, of: list.length, as_of: maxDay(hyps.map((h) => h.updated_at)), origin: 'platform_count', record_ref: `hypotheses:${list.length}` } };
  },
};

const demand: Adapter = {
  id: 'demand', area: 'validate', module: 'Validate › Demand signals', href: q('/validate/demand-signals'),
  slots: [{ key: 'validate.lois', label: 'Letters of intent', unit: 'count' }, { key: 'validate.demand', label: 'Other demand signals', unit: 'count' }],
  async read({ env, projectId }) {
    // Confirmed or counted only: a signal still "to confirm" is not demand yet.
    const rows = await all<{ id: number; kind: string; signal_date: string | null; updated_at: string | null; filed: number }>(env,
      `SELECT id, kind, signal_date, updated_at, (evidence_file_key IS NOT NULL) AS filed FROM demand_signals
        WHERE project_id = ? AND status IN ('confirmed', 'counted')`, projectId);
    const one = (set: typeof rows): Read | null => (set.length
      ? { value: set.length, as_of: maxDay(set.map((r) => r.signal_date || r.updated_at)), origin: set.every((r) => Number(r.filed) === 1) ? 'file' : 'typed', record_ref: `demand_signals:${set.map((r) => r.id).sort((a, b) => a - b).join(',')}` }
      : null);
    const out: Record<string, Read> = {};
    const lois = one(rows.filter((r) => r.kind === 'loi'));
    const other = one(rows.filter((r) => r.kind !== 'loi'));
    if (lois) out['validate.lois'] = lois;
    if (other) out['validate.demand'] = other;
    return out;
  },
};

const competitors: Adapter = {
  id: 'competitors', area: 'validate', module: 'Validate › Market intelligence', href: q('/validate/market-intelligence'),
  slots: [{ key: 'validate.competitors', label: 'Competitors tracked', unit: 'count' }],
  async read({ env, projectId }) {
    const r = await first<{ n: number; at: string | null }>(env,
      'SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM competitor_tracking WHERE project_id = ? AND stopped_at IS NULL', projectId);
    if (!Number(r?.n)) return {};
    return { 'validate.competitors': { value: Number(r!.n), as_of: day(r!.at), origin: 'file', record_ref: `competitor_tracking:${r!.n}` } };
  },
};

// ─────────────────────────────────────────────────────────────── Build

const mustHaves: Adapter = {
  id: 'must_haves', area: 'build', module: 'Build › Prototype / MVP', href: q('/build/prototype-mvp'),
  slots: [{ key: 'build.must_haves', label: 'Must-haves done', unit: 'count' }],
  async read({ env, projectId }) {
    const r = await first<{ total: number; done: number; linked: number; at: string | null }>(env,
      `SELECT COUNT(*) AS total, SUM(CASE WHEN delivery_status = 'Done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN pr_state IS NOT NULL THEN 1 ELSE 0 END) AS linked, MAX(COALESCE(done_at, updated_at)) AS at
         FROM mvp_features WHERE project_id = ? AND is_must_have = 1 AND COALESCE(scope, 'core') <> 'out'`, projectId);
    const total = Number(r?.total) || 0;
    if (!total) return {};
    return { 'build.must_haves': { value: Number(r!.done) || 0, of: total, as_of: day(r!.at), origin: Number(r!.linked) === total ? 'connector' : 'typed', record_ref: `mvp_features:${total}` } };
  },
};

const roadmap: Adapter = {
  id: 'roadmap', area: 'build', module: 'Build › Product roadmap', href: q('/build/product-roadmap'),
  slots: [{ key: 'build.releases_90d', label: 'Releases in 90 days', unit: 'count' }, { key: 'build.roadmap', label: 'Roadmap objectives', unit: 'count' }],
  async read({ env, projectId, today }) {
    const out: Record<string, Read> = {};
    const rel = await first<{ n: number; at: string | null }>(env,
      'SELECT COUNT(*) AS n, MAX(published_at) AS at FROM roadmap_releases WHERE project_id = ? AND COALESCE(prerelease, 0) = 0 AND substr(published_at, 1, 10) >= ?',
      projectId, daysBefore(today, 90));
    // GitHub connected with no release in the window is a measured 0; no release ever is not recorded.
    const any = await first<{ n: number }>(env, 'SELECT COUNT(*) AS n FROM roadmap_releases WHERE project_id = ?', projectId);
    if (Number(any?.n)) out['build.releases_90d'] = { value: Number(rel?.n) || 0, as_of: day(rel?.at) ?? today, origin: 'connector', record_ref: `roadmap_releases:90d` };
    const okr = await first<{ n: number; at: string | null }>(env, 'SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM roadmap_okrs WHERE project_id = ?', projectId);
    if (Number(okr?.n)) out['build.roadmap'] = { value: Number(okr!.n), as_of: day(okr!.at), origin: 'typed', record_ref: `roadmap_okrs:${okr!.n}` };
    return out;
  },
};

const github: Adapter = {
  id: 'github', area: 'build', module: 'Build › Product roadmap', href: q('/build/connect'),
  slots: [{ key: 'build.commits_90d', label: 'Commits in 90 days', unit: 'count' }],
  async read({ env, projectId }) {
    const r = await first<{ commits: number; people: number; at: string | null }>(env,
      'SELECT SUM(commits_90d) AS commits, COUNT(DISTINCT login) AS people, MAX(updated_at) AS at FROM github_contributors WHERE project_id = ?', projectId);
    if (!Number(r?.people)) return {};
    return { 'build.commits_90d': { value: Number(r!.commits) || 0, of: Number(r!.people), as_of: day(r!.at), origin: 'connector', record_ref: `github_contributors:${r!.people}` } };
  },
};

// ─────────────────────────────────────────────────────────────── Raise

const round: Adapter = {
  id: 'round', area: 'raise', module: 'Raise › Round planner', href: q('/raise/calls'),
  slots: [
    { key: 'raise.round_target', label: 'Round', unit: 'usd' },
    { key: 'raise.round_close', label: 'Close', unit: 'date' },
    { key: 'raise.round_terms', label: 'Instrument', unit: 'text' },
  ],
  async read({ env, projectId }) {
    const out: Record<string, Read> = {};
    const r = await first<{ id: number; target_amount: number | null; close_date: string | null; updated_at: string | null }>(env,
      "SELECT id, target_amount, close_date, updated_at FROM raise_rounds WHERE project_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", projectId);
    // The latest round call; its terms are Reviewed only while counsel's approval covers them (roundCalls.ts).
    const call = await first<{ id: number; instrument: string | null; approved: number; updated_at: string | null }>(env,
      `SELECT id, instrument, updated_at,
              (counsel_approved_hash IS NOT NULL AND counsel_approved_hash = terms_hash AND counsel_approved_by IS NOT NULL
               AND counsel_approved_at IS NOT NULL AND counsel_approval_reference IS NOT NULL) AS approved
         FROM round_calls WHERE project_id = ? ORDER BY id DESC LIMIT 1`, projectId);
    const origin: Origin = Number(call?.approved) === 1 ? 'counsel_approved' : 'typed';
    if (r && num(r.target_amount) != null && Number(r.target_amount) > 0) out['raise.round_target'] = { value: Number(r.target_amount), as_of: day(r.updated_at), origin, record_ref: `raise_rounds:${r.id}` };
    if (r && day(r.close_date)) out['raise.round_close'] = { value: day(r.close_date), as_of: day(r.updated_at), origin, record_ref: `raise_rounds:${r.id}` };
    if (call?.instrument) out['raise.round_terms'] = { value: call.instrument, as_of: day(call.updated_at), origin, record_ref: `round_calls:${call.id}` };
    return out;
  },
};

const capTable: Adapter = {
  id: 'cap_table', area: 'raise', module: 'Raise › Cap table', href: q('/raise/cap-table'),
  slots: [{ key: 'raise.cap_table', label: 'Cap table holders', unit: 'count' }, { key: 'raise.vesting', label: 'Vesting schedules', unit: 'count' }],
  async read({ env, projectId }) {
    const out: Record<string, Read> = {};
    // Carta writes holders without a project (carta.ts); the deck reads them by the founder's user, as the Demo Day deck does.
    const holders = await all<{ id: number; carta: number; updated_at: string | null }>(env,
      `SELECT h.id, (h.source = 'carta' OR h.carta_stakeholder_id IS NOT NULL) AS carta, h.updated_at FROM cap_table_holders h
        WHERE h.project_id = ? OR (h.project_id IS NULL AND h.user_id IN (SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ?))`,
      projectId, projectId);
    if (!holders.length) return out;
    const origin: Origin = holders.every((h) => Number(h.carta) === 1) ? 'connector' : 'typed';
    out['raise.cap_table'] = { value: holders.length, as_of: maxDay(holders.map((h) => h.updated_at)), origin, record_ref: `cap_table_holders:${holders.length}` };
    const v = await all<{ id: number; carta: number; updated_at: string | null }>(env,
      `SELECT v.id, (v.source = 'carta' OR v.carta_vesting_id IS NOT NULL) AS carta, v.updated_at FROM cap_table_vesting v
        WHERE v.holder_id IN (SELECT h.id FROM cap_table_holders h WHERE h.project_id = ?
          OR (h.project_id IS NULL AND h.user_id IN (SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ?)))`,
      projectId, projectId);
    if (v.length) out['raise.vesting'] = { value: v.length, as_of: maxDay(v.map((r) => r.updated_at)), origin: v.every((r) => Number(r.carta) === 1) ? 'connector' : 'typed', record_ref: `cap_table_vesting:${v.length}` };
    return out;
  },
};

const useOfFunds: Adapter = {
  id: 'use_of_funds', area: 'raise', module: 'Raise › Use of funds', href: q('/raise/use-of-funds'),
  slots: [{ key: 'raise.use_of_funds', label: 'Use of funds', unit: 'text' }],
  async read({ env, projectId }) {
    const p = await first<{ use_of_funds: string | null; updated_at: string | null }>(env, 'SELECT use_of_funds, updated_at FROM projects WHERE id = ?', projectId);
    const alloc = parseAllocation(p?.use_of_funds);
    if (!alloc) return {};
    const text = alloc.map((pct, i) => (pct > 0 ? `${FUND_SECTIONS[i].label} ${pct}%` : null)).filter(Boolean).join(' · ');
    return { 'raise.use_of_funds': { value: text, as_of: day(p?.updated_at), origin: 'typed', record_ref: `projects:${projectId}:use_of_funds` } };
  },
};

const narrative: Adapter = {
  id: 'narrative', area: 'raise', module: 'Raise › Investor narrative', href: q('/raise/investor-narrative'),
  slots: [{ key: 'raise.narrative', label: 'Narrative versions', unit: 'count' }],
  async read({ env, projectId }) {
    const r = await first<{ n: number; latest: number | null; at: string | null }>(env,
      'SELECT COUNT(*) AS n, MAX(version) AS latest, MAX(updated_at) AS at FROM narrative_version_meta WHERE project_id = ?', projectId);
    if (!Number(r?.n)) return {};
    return { 'raise.narrative': { value: Number(r!.n), as_of: day(r!.at), origin: 'typed', record_ref: `narrative_version_meta:v${r!.latest}` } };
  },
};

// ─────────────────────────────────────────────────────────────── Grow

const METRIC_SLOTS: Array<Slot & { col: 'mrr' | 'arr' | 'monthly_churn_pct' | 'paying_accounts' }> = [
  { key: 'grow.mrr', label: 'MRR', unit: 'usd', col: 'mrr' },
  { key: 'grow.arr', label: 'ARR', unit: 'usd', col: 'arr' },
  { key: 'grow.churn', label: 'Churn, monthly', unit: 'percent', col: 'monthly_churn_pct' },
  { key: 'grow.paying_customers', label: 'Paying customers', unit: 'count', col: 'paying_accounts' },
];

const revenue: Adapter = {
  id: 'revenue', area: 'grow', module: 'Grow › Revenue and traction', href: q('/grow/revenue-and-traction'),
  slots: METRIC_SLOTS,
  async read({ env, projectId }) {
    const rows = await all<Record<string, unknown> & { id: number; snapshot_date: string; source: string | null }>(env,
      'SELECT id, snapshot_date, source, mrr, arr, monthly_churn_pct, paying_accounts FROM project_metrics WHERE project_id = ? ORDER BY snapshot_date DESC, id DESC', projectId);
    const out: Record<string, Read> = {};
    for (const s of METRIC_SLOTS) {
      // Stripe's latest snapshot first; the founder's typed one only when Stripe has none.
      const row = rows.find((r) => r.source === 'stripe' && num(r[s.col]) != null) || rows.find((r) => r.source !== 'stripe' && num(r[s.col]) != null);
      if (row) out[s.key] = { value: num(row[s.col]), as_of: day(row.snapshot_date), origin: row.source === 'stripe' ? 'connector' : 'typed', record_ref: `project_metrics:${row.id}` };
    }
    return out;
  },
};

const MERCURY_SLOTS: Array<Slot & { fact: string }> = [
  { key: 'grow.mercury_revenue', label: 'Revenue last month', unit: 'cents', fact: 'revenue_last_month' },
  { key: 'grow.mercury_growth', label: 'Growth · m/m', unit: 'percent', fact: 'revenue_growth' },
  { key: 'grow.net_burn', label: 'Net burn', unit: 'cents', fact: 'net_burn' },
  { key: 'grow.runway', label: 'Runway', unit: 'months', fact: 'runway' },
];

const mercury: Adapter = {
  id: 'mercury', area: 'grow', module: 'Grow › Revenue and traction', href: q('/grow/revenue-and-traction'),
  slots: MERCURY_SLOTS,
  async read({ env, projectId, mercury: m }) {
    if (m && 'withheld' in m) return Object.fromEntries(MERCURY_SLOTS.map((s) => [s.key, 'withheld' as const]));
    if (!m) return {};
    const { figures } = await citableFigures(env, m.integrationId, projectId);
    const facts = await all<{ id: number; as_of: string }>(env, 'SELECT id, as_of FROM mercury_raise_facts WHERE integration_id = ? AND project_id = ?', m.integrationId, projectId);
    const asOf = new Map(facts.map((f) => [Number(f.id), day(f.as_of)]));
    const out: Record<string, Read> = {};
    for (const s of MERCURY_SLOTS) {
      const f = figures.find((x) => x.key === s.fact);
      if (f && f.value != null) out[s.key] = { value: f.value, as_of: asOf.get(Number(f.fact_id)) ?? null, origin: 'connector', record_ref: `mercury_raise_facts:${f.fact_id}` };
    }
    return out;
  },
};

const updates: Adapter = {
  id: 'updates', area: 'grow', module: 'Grow › Investor updates', href: q('/grow/updates'),
  slots: [{ key: 'grow.investor_updates', label: 'Investor updates sent', unit: 'count' }],
  async read({ env, projectId }) {
    const r = await first<{ n: number; at: string | null }>(env,
      "SELECT COUNT(*) AS n, MAX(COALESCE(sent_at, submitted_at)) AS at FROM portfolio_updates WHERE project_id = ? AND (sent_at IS NOT NULL OR status = 'submitted')", projectId);
    if (!Number(r?.n)) return {};
    return { 'grow.investor_updates': { value: Number(r!.n), as_of: day(r!.at), origin: 'typed', record_ref: `portfolio_updates:${r!.n}` } };
  },
};

// ─────────────────────────────────────────────────────────────── Team

const team: Adapter = {
  id: 'team', area: 'team', module: 'Build › Founding team', href: q('/build/founding-team'),
  slots: [
    { key: 'team.founders', label: 'Founders on the cap table', unit: 'count' },
    { key: 'team.skills', label: 'Skills', unit: 'text' },
    { key: 'team.archetypes', label: 'Archetypes', unit: 'text' },
  ],
  async read({ env, projectId }) {
    const out: Record<string, Read> = {};
    const f = await all<{ id: number; carta: number; updated_at: string | null }>(env,
      `SELECT id, (source = 'carta' OR carta_stakeholder_id IS NOT NULL) AS carta, updated_at FROM cap_table_holders
        WHERE project_id = ? AND founder_role IS NOT NULL`, projectId);
    if (f.length) out['team.founders'] = { value: f.length, as_of: maxDay(f.map((r) => r.updated_at)), origin: f.every((r) => Number(r.carta) === 1) ? 'connector' : 'platform_count', record_ref: `cap_table_holders:founders:${f.length}` };
    const skills = await all<{ axis: string; w: number; at: string | null }>(env,
      // The venture's people: its founder's account and its accepted owners and cofounders.
      `SELECT axis, SUM(weighted) AS w, MAX(computed_at) AS at FROM skill_evidence
        WHERE user_id IN (SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ?
          UNION SELECT m.user_id FROM project_members m WHERE m.project_id = ? AND m.status = 'accepted' AND m.role IN ('owner', 'cofounder'))
        GROUP BY axis HAVING SUM(weighted) > 0 ORDER BY w DESC, axis LIMIT 3`,
      projectId, projectId);
    if (skills.length) out['team.skills'] = { value: skills.map((s) => s.axis).join(' · '), as_of: maxDay(skills.map((s) => s.at)), origin: 'platform_count', record_ref: `skill_evidence:${skills.length}` };
    // Published only: an archetype its person has not published never reaches a deck.
    const arch = await all<{ label: string; at: string | null }>(env,
      `SELECT a.archetype_label AS label, a.computed_at AS at FROM profile_archetypes a
         JOIN profile_archetype_publish pub ON pub.user_id = a.user_id AND pub.published = 1
        WHERE a.user_id IN (SELECT u.id FROM users u JOIN projects p ON p.founder_id = u.founder_id WHERE p.id = ?
          UNION SELECT m.user_id FROM project_members m WHERE m.project_id = ? AND m.status = 'accepted' AND m.role IN ('owner', 'cofounder'))
          AND a.archetype_label IS NOT NULL
          AND a.id = (SELECT MAX(b.id) FROM profile_archetypes b WHERE b.user_id = a.user_id)`,
      projectId, projectId);
    if (arch.length) out['team.archetypes'] = { value: [...new Set(arch.map((a) => a.label))].join(' · '), as_of: maxDay(arch.map((a) => a.at)), origin: 'typed', record_ref: `profile_archetypes:${arch.length}` };
    return out;
  },
};

// ─────────────────────────────────────────────────────────────── Scoring

const scoring: Adapter = {
  id: 'scoring', area: 'scoring', module: 'Raise › Fundraising readiness', href: q('/raise/fundraising-readiness'),
  slots: [
    { key: 'scoring.scorecard_band', label: 'Scorecard band', unit: 'text', optional: true },
    { key: 'scoring.pmf_band', label: 'Product-market fit', unit: 'text', optional: true },
  ],
  // Neither band is defined yet (#2428, #2433); a score is never read in its place.
  async read() { return {}; },
};

export const DECK_SOURCES: Adapter[] = [
  interviews, painThemes, claims, demand, competitors,
  mustHaves, roadmap, github,
  round, capTable, useOfFunds, narrative,
  revenue, mercury, updates,
  team, scoring,
];

/** A short, stable hash of what a binding saw: same value, same date, same record. */
export async function snapshotHash(sourceKey: string, recordRef: string | null, value: unknown, asOf: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([sourceKey, recordRef, value ?? null, asOf]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type Coverage = {
  slots: number;
  filled: number;
  by_grade: Record<(typeof GRADES)[number], number>;
  not_recorded: number;
  unreadable: number;
};

/** Counts only record-filled slots; a withheld slot is not a slot for this reader. */
export function coverageOf(items: SourceItem[]): Coverage {
  const by_grade = { Measured: 0, Reviewed: 0, Sourced: 0, Stated: 0 };
  let not_recorded = 0;
  let unreadable = 0;
  for (const it of items) {
    if (it.state === 'withheld') continue;
    if (it.state === 'recorded' && it.grade !== 'Not recorded') by_grade[it.grade] += 1;
    else if (it.state === 'unreadable') unreadable += 1;
    else not_recorded += 1;
  }
  const filled = GRADES.reduce((n, g) => n + by_grade[g], 0);
  return { slots: filled + not_recorded + unreadable, filled, by_grade, not_recorded, unreadable };
}

/** Every slot of every adapter, read. Scoring slots only when `includeScoring`. */
export async function readSources(ctx: SourceCtx, opts: { includeScoring?: boolean } = {}): Promise<{ items: SourceItem[]; coverage: Coverage }> {
  const items: SourceItem[] = [];
  for (const a of DECK_SOURCES) {
    const slots = a.slots.filter((s) => !s.optional || opts.includeScoring);
    if (!slots.length) continue;
    let got: Partial<Record<string, Read | 'withheld'>> | null;
    try { got = await a.read(ctx); } catch { got = null; }
    for (const s of slots) {
      const base = { source_key: s.key, area: a.area, module: a.module, label: s.label, unit: s.unit, href: a.href(ctx.projectId), ...(s.optional ? { optional: true } : {}) };
      const r = got?.[s.key];
      if (r === 'withheld' || r == null || r.value == null) {
        const state: SlotState = got == null ? 'unreadable' : r === 'withheld' ? 'withheld' : 'not_recorded';
        items.push({ ...base, value: null, as_of: null, grade: 'Not recorded', source: null, record_ref: null, snapshot_hash: null, state });
        continue;
      }
      const { source, grade } = sourceAndGrade(r.origin);
      const record_ref = r.record_ref ?? null;
      const as_of = r.as_of ?? null;
      items.push({
        ...base, value: r.value, ...(r.of != null ? { of: r.of } : {}), as_of, grade, source, record_ref,
        snapshot_hash: await snapshotHash(s.key, record_ref, [r.value, r.of ?? null], as_of), state: 'recorded',
      });
    }
  }
  return { items, coverage: coverageOf(items) };
}

export type Binding = { source_key: string; record_ref?: string | null; as_of?: string | null; grade?: string | null; snapshot_hash?: string | null };

/** Every binding a version's slides carry, with where it sits. */
export function bindingsOf(slides: unknown): Array<{ slide: number; field: string | null; binding: Binding }> {
  const out: Array<{ slide: number; field: string | null; binding: Binding }> = [];
  const ok = (b: any): b is Binding => b && typeof b === 'object' && typeof b.source_key === 'string' && b.source_key.length > 0;
  (Array.isArray(slides) ? slides : []).forEach((s: any, i) => {
    if (ok(s?.binding)) out.push({ slide: i, field: null, binding: s.binding });
    for (const f of Array.isArray(s?.fields) ? s.fields : []) if (ok(f?.binding)) out.push({ slide: i, field: String(f.key ?? ''), binding: f.binding });
    for (const [j, b] of (Array.isArray(s?.blocks) ? s.blocks : []).entries()) if (ok(b?.binding)) out.push({ slide: i, field: `block:${j}`, binding: b.binding });
  });
  return out;
}

export type RefreshRow = {
  slide: number;
  field: string | null;
  source_key: string;
  bound: { as_of: string | null; grade: string | null; snapshot_hash: string | null };
  /** `stale`: the store holds a different value now; `gone`: it holds none; `unknown`: it could not be read for this reader. */
  state: 'fresh' | 'stale' | 'gone' | 'unknown';
  current: SourceItem | null;
};

/** Compares each binding's snapshot with its store; writes nothing. */
export function compareBindings(bindings: ReturnType<typeof bindingsOf>, items: SourceItem[]): RefreshRow[] {
  const byKey = new Map(items.map((it) => [it.source_key, it]));
  return bindings.map(({ slide, field, binding }) => {
    const cur = byKey.get(binding.source_key) ?? null;
    const recorded = cur && cur.state === 'recorded' ? cur : null;
    const state = !recorded ? (cur?.state === 'unreadable' || cur?.state === 'withheld' ? 'unknown' : 'gone')
      : recorded.snapshot_hash === (binding.snapshot_hash ?? null) ? 'fresh' : 'stale';
    return {
      slide, field, source_key: binding.source_key,
      bound: { as_of: binding.as_of ?? null, grade: binding.grade ?? null, snapshot_hash: binding.snapshot_hash ?? null },
      state, current: cur,
    };
  });
}

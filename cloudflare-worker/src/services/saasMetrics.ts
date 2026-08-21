/**
 * Build queue #121 — derived SaaS metrics from the snapshot series.
 *
 * Pure functions over `metrics_snapshots` rows. No I/O, no clock.
 *
 * SCHEMA NOTE. `metrics_snapshots` has two incompatible definitions in
 * this repo — the legacy `sql/schema.sql` shape (project_id,
 * snapshot_date, mrr, active_users, …) and an unused
 * `scope`/`metric_name`/`value` shape from `sql/infrastructure.sql` +
 * migration 034. The LIVE one is the legacy lineage: it is what
 * `ensureMetricsSnapshotsSchema()` in routes/progress.ts creates and
 * self-heals (adding arr/cac/ltv/monthly_churn_pct/new_users), and what
 * every metrics handler reads. This module targets that shape only.
 *
 * Every function returns null rather than a plausible number when the
 * inputs cannot support the calculation. That matters more here than
 * almost anywhere else in the product: these figures go into investor
 * updates and board packs, and a fabricated burn multiple is a number
 * someone will repeat in a room.
 */

export interface Snapshot {
  snapshot_date: string;
  mrr?: number | null;
  arr?: number | null;
  cac?: number | null;
  ltv?: number | null;
  monthly_churn_pct?: number | null;
  active_users?: number | null;
  new_users?: number | null;
}

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function round(v: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/** Chronological, malformed dates dropped. */
export function sortSeries(rows: Snapshot[]): Snapshot[] {
  return (rows || [])
    .filter(r => r && !Number.isNaN(Date.parse(String(r.snapshot_date))))
    .slice()
    .sort((a, b) => Date.parse(a.snapshot_date) - Date.parse(b.snapshot_date));
}

/**
 * Period-over-period growth as a PERCENT.
 *
 * Growth from zero is null, not "infinite" and not 100%: a company
 * going 0 → 10k grew by an undefined multiple, and rendering ∞ or a
 * made-up figure in an investor update is worse than an em-dash.
 * A decline from a positive base is a real negative number.
 */
export function growthPct(current: number | null, previous: number | null): number | null {
  const c = n(current), p = n(previous);
  if (c === null || p === null) return null;
  if (p === 0) return null;
  if (p < 0) return null; // a negative base makes the ratio meaningless
  return round(((c - p) / p) * 100);
}

/**
 * Compound monthly growth rate across the whole series, as a percent.
 * Uses first and last non-null MRR and the number of periods BETWEEN
 * them — not the row count, which would understate growth by one
 * period.
 */
export function cmgrPct(rows: Snapshot[]): number | null {
  const s = sortSeries(rows).filter(r => n(r.mrr) !== null);
  if (s.length < 2) return null;
  const first = n(s[0].mrr)!;
  const last = n(s[s.length - 1].mrr)!;
  const periods = s.length - 1;
  if (first <= 0 || last <= 0 || periods <= 0) return null;
  return round((Math.pow(last / first, 1 / periods) - 1) * 100);
}

/**
 * LTV:CAC. The convention investors quote is a bare ratio ("3.1x"),
 * and the healthy floor is generally taken as 3. Null when CAC is zero
 * or missing — an "infinite" LTV:CAC is a data problem, not a triumph.
 */
export function ltvCac(ltv: number | null, cac: number | null): number | null {
  const l = n(ltv), c = n(cac);
  if (l === null || c === null || c <= 0 || l < 0) return null;
  return round(l / c);
}

/**
 * CAC payback in MONTHS: how long the gross profit on a new customer
 * takes to repay its acquisition cost.
 *
 *   payback = CAC / (monthly ARPA × gross margin)
 *
 * Gross margin defaults to 1.0 (i.e. revenue-basis payback) when not
 * supplied, and the caller is expected to say which basis it used —
 * a revenue-basis payback flatters a low-margin business badly.
 */
export function cacPaybackMonths(
  cac: number | null,
  monthlyArpa: number | null,
  grossMargin = 1,
): number | null {
  const c = n(cac), a = n(monthlyArpa), g = n(grossMargin);
  if (c === null || a === null || g === null) return null;
  if (a <= 0 || g <= 0 || c < 0) return null;
  return round(c / (a * g), 1);
}

/**
 * Burn multiple = net burn ÷ net new ARR (Sacks). How many dollars
 * burned per dollar of new recurring revenue; lower is better, under
 * 1.0 is exceptional, over 3 is a warning.
 *
 * Null when net new ARR is zero or negative: burning while shrinking
 * has no meaningful multiple, and dividing by a negative would produce
 * a *better-looking* number the worse the quarter got. The caller
 * should present that case as "not meaningful", never as a figure.
 */
export function burnMultiple(netBurn: number | null, netNewArr: number | null): number | null {
  const b = n(netBurn), a = n(netNewArr);
  if (b === null || a === null) return null;
  if (a <= 0) return null;
  if (b <= 0) return 0; // cash-flow positive while growing
  return round(b / a);
}

/**
 * Rule of 40: growth rate % + profit margin %. Both arguments are
 * percents, and the margin is normally free-cash-flow or EBITDA margin
 * (negative while burning).
 */
export function ruleOf40(growthRatePct: number | null, profitMarginPct: number | null): number | null {
  const g = n(growthRatePct), m = n(profitMarginPct);
  if (g === null || m === null) return null;
  return round(g + m);
}

/**
 * Annualised retention implied by a monthly churn percentage.
 * A 5%/month churn is not 60% annual retention — it compounds to about
 * 54%. Getting this wrong overstates retention every time.
 */
export function annualRetentionPct(monthlyChurnPct: number | null): number | null {
  const c = n(monthlyChurnPct);
  if (c === null || c < 0 || c >= 100) return null;
  return round(Math.pow(1 - c / 100, 12) * 100, 1);
}

export interface MetricsSummary {
  as_of: string | null;
  mrr: number | null;
  arr: number | null;
  /** MRR growth vs the previous snapshot. */
  mrr_growth_pct: number | null;
  /** Compound monthly growth across the whole series. */
  cmgr_pct: number | null;
  active_users: number | null;
  user_growth_pct: number | null;
  ltv_cac: number | null;
  cac_payback_months: number | null;
  monthly_churn_pct: number | null;
  annual_retention_pct: number | null;
  /** Count of snapshots the summary was derived from. */
  snapshot_count: number;
  /** Metrics that could not be computed, and why — shown, not hidden. */
  unavailable: Array<{ metric: string; reason: string }>;
}

/**
 * Roll the series into the KPI board summary.
 *
 * `unavailable` is part of the contract: a founder looking at a blank
 * metric should be told it needs CAC on the latest snapshot, not left
 * to guess whether the number is zero, broken, or missing.
 */
export function summarise(rows: Snapshot[]): MetricsSummary {
  const s = sortSeries(rows);
  const unavailable: Array<{ metric: string; reason: string }> = [];
  const latest = s.length > 0 ? s[s.length - 1] : null;
  const prev = s.length > 1 ? s[s.length - 2] : null;

  const mrr = latest ? n(latest.mrr) : null;
  // ARR is stored when given, else derived from MRR — the 12x identity
  // is definitional, not an estimate.
  const arr = latest ? (n(latest.arr) ?? (mrr !== null ? round(mrr * 12) : null)) : null;

  const mrrGrowth = growthPct(mrr, prev ? n(prev.mrr) : null);
  if (mrrGrowth === null) {
    unavailable.push({
      metric: 'mrr_growth_pct',
      reason: s.length < 2 ? 'Needs at least two snapshots.' : 'The previous period had no positive MRR to grow from.',
    });
  }

  const cmgr = cmgrPct(s);
  if (cmgr === null && s.length >= 2) {
    unavailable.push({ metric: 'cmgr_pct', reason: 'Needs positive MRR at both the start and end of the series.' });
  }

  const users = latest ? n(latest.active_users) : null;
  const userGrowth = growthPct(users, prev ? n(prev.active_users) : null);

  const lc = latest ? ltvCac(n(latest.ltv), n(latest.cac)) : null;
  if (lc === null) {
    unavailable.push({ metric: 'ltv_cac', reason: 'Needs both LTV and a CAC greater than zero on the latest snapshot.' });
  }

  // ARPA from MRR ÷ active users — the only basis available from this
  // table. Documented so nobody mistakes it for a blended ACV.
  const arpa = mrr !== null && users !== null && users > 0 ? mrr / users : null;
  const payback = latest ? cacPaybackMonths(n(latest.cac), arpa) : null;
  if (payback === null) {
    unavailable.push({
      metric: 'cac_payback_months',
      reason: 'Needs CAC plus MRR and active users on the latest snapshot (ARPA is derived from those).',
    });
  }

  const churn = latest ? n(latest.monthly_churn_pct) : null;
  const retention = annualRetentionPct(churn);
  if (retention === null) {
    unavailable.push({ metric: 'annual_retention_pct', reason: 'Needs a monthly churn rate between 0 and 100 on the latest snapshot.' });
  }

  return {
    as_of: latest ? latest.snapshot_date : null,
    mrr, arr,
    mrr_growth_pct: mrrGrowth,
    cmgr_pct: cmgr,
    active_users: users,
    user_growth_pct: userGrowth,
    ltv_cac: lc,
    cac_payback_months: payback,
    monthly_churn_pct: churn,
    annual_retention_pct: retention,
    snapshot_count: s.length,
    unavailable,
  };
}

/**
 * A compact series for sparklines: one point per snapshot, nulls kept
 * as nulls so a chart shows a GAP rather than interpolating a straight
 * line through a month nobody reported.
 */
export function sparkline(rows: Snapshot[], field: keyof Snapshot = 'mrr'): Array<{ date: string; value: number | null }> {
  return sortSeries(rows).map(r => ({ date: r.snapshot_date, value: n(r[field] as unknown) }));
}

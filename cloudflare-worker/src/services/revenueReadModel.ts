/**
 * D5950 (#5950, slice 6 of #5038): the Revenue read model, one envelope per metric with its source, period, currencies,
 * last reconciliation, incomplete rows and coverage gap.
 *
 * WHAT IT IS. `GET /api/admin/revenue/summary` answers each Revenue metric in the same shape (`RevenueMetric`), so the
 * page never has to explain a missing store or guess a zero. One function per metric; each reads its own store and
 * fails alone, so an unreadable store makes that metric `unreadable` and leaves the others answering.
 *
 * THE STATES.
 *   complete       every row the metric reads for the period is there and whole
 *   incomplete     figures are shown, and `incomplete_rows` / `coverage` say what is missing from them
 *   not_recorded   the store exists, and holds nothing for this period (before coverage, or nothing set)
 *   not_available  no store records this yet; `pending_issue` names the slice that will
 *   unreadable     the store could not be read; no figure is shown
 * A figure the store does not hold is null, never 0. Money is integer minor units in its own currency, one bucket per
 * currency, and nothing here adds across currencies (there is no FX policy).
 *
 * THE LAST TWO (D5950 part 2). Revenue per subsidiary reads the measured gross branches report since #5947, and AI
 * billed, cost and margin per licence read the licence #5948 stamps on AI runs. No metric is `not_available` now; the
 * state stays in the vocabulary for a store a later slice adds.
 *
 * NO STRIPE CALL. Every read is D1.
 */
import type { Env } from '../types';
import { SUBSCRIPTION_LEDGER_ROWS, type subscriptionRevenue } from './subscriptionRevenue';
import type { licenceFeeReceivables } from './licenceFeeReceivables';
import { promoIssuedState, type LatestReport } from './promoIssuedReport';
import { licenceAiPeriod, type LicenceAiPeriod } from './aiLicenceAttribution';

export type MetricState = 'complete' | 'incomplete' | 'not_recorded' | 'not_available' | 'unreadable';

/** When recording began for this metric's store, and how much of the period that leaves out. */
export type MetricCoverage = {
  /** covered: recording began on or before the period. partial: during it. none: after it. unknown: no start is held. */
  state: 'covered' | 'partial' | 'none' | 'unknown';
  /** The time recording began, when the database holds one; null otherwise. */
  recorded_from: string | null;
  /** Where that start comes from: a `financial_event_coverage` row, or the migration that began recording. */
  recorded_by: string;
};

export type RevenueMetric<V = unknown> = {
  key: string;
  label: string;
  state: MetricState;
  reason: string | null;
  /** The store the figures are read from. */
  source: string;
  /** `YYYY-Qn` for a period figure, `as_of_now` for a point-in-time one. */
  period: string;
  /** The currencies the figures are in, one bucket each. Null when nothing was read. */
  currencies: string[] | null;
  /** The latest reconciliation of a row this metric reads; null when none was (see `last_reconciled_basis`). */
  last_reconciled_at: string | null;
  last_reconciled_basis: string;
  /** Rows the figures leave out or cannot place; null when nothing was read. */
  incomplete_rows: number | null;
  incomplete_detail: Record<string, number> | null;
  coverage: MetricCoverage;
  /** The open slice of #5038 that will record this metric, for `not_available`. */
  pending_issue: number | null;
  values: V | null;
};

type Quarter = { key: string; start: string; end: string };

const LEDGER_RECONCILED =
  'The latest `reconciled_at` of a ledger row in the period (D5299); null while every row is still pending.';

/** Where recording began relative to the period. */
export function coverageFor(start: string | null | undefined, quarter: Quarter, recordedBy: string): MetricCoverage {
  const at = start ? Date.parse(start) : NaN;
  if (!start || !Number.isFinite(at)) return { state: 'unknown', recorded_from: null, recorded_by: recordedBy };
  const state = at <= Date.parse(`${quarter.start}T00:00:00Z`) ? 'covered'
    : at >= Date.parse(`${quarter.end}T00:00:00Z`) ? 'none' : 'partial';
  return { state, recorded_from: start, recorded_by: recordedBy };
}

function unreadable(base: Omit<RevenueMetric, 'state' | 'reason' | 'currencies' | 'last_reconciled_at' | 'incomplete_rows' | 'incomplete_detail' | 'values' | 'coverage'>, reason: string, coverage: MetricCoverage): RevenueMetric {
  return {
    ...base, state: 'unreadable', reason, currencies: null, last_reconciled_at: null,
    incomplete_rows: null, incomplete_detail: null, coverage, values: null,
  };
}

const sum = (d: Record<string, number>) => Object.values(d).reduce((a, b) => a + b, 0);

// ── Subscription revenue (#5946) ──────────────────────────────────────────────

type SubscriptionRead = Awaited<ReturnType<typeof subscriptionRevenue>>;

/** Subscription receipts and refunds per currency, from the D5946 reader's result for the same quarter. */
export async function subscriptionRevenueMetric(env: Env, quarter: Quarter, read: SubscriptionRead): Promise<RevenueMetric> {
  const base = {
    key: 'subscription_revenue', label: 'Subscription revenue',
    source: 'financial_events: Stripe invoice rows and refund rows for the tier, investor and mi streams (D5946)',
    period: quarter.key, last_reconciled_basis: LEDGER_RECONCILED, pending_issue: null,
  };
  const recordedFrom = 'coverage_starts_at' in read ? read.coverage_starts_at : null;
  const coverage = coverageFor(recordedFrom, quarter, "financial_event_coverage, source 'stripe'");
  if (read.state === 'unreadable') return unreadable(base, read.reason, coverage);
  if (read.state === 'not_recorded') {
    return {
      ...base, state: 'not_recorded', reason: read.reason, currencies: [], last_reconciled_at: null,
      incomplete_rows: null, incomplete_detail: null, coverage, values: null,
    };
  }
  try {
    // Over exactly the reader's rows. A row with no date cannot be placed in any period, so it is counted as a gap.
    const row = await env.DB.prepare(
      `SELECT
         COUNT(CASE WHEN occurred_at IS NOT NULL
                     AND ((CASE kind WHEN 'invoice' THEN gross_cents ELSE refund_cents END) IS NULL OR revenue_stream IS NULL)
               THEN 1 END) AS incomplete,
         COUNT(CASE WHEN occurred_at IS NULL THEN 1 END) AS undated,
         MAX(CASE WHEN occurred_at IS NOT NULL THEN reconciled_at END) AS last_reconciled
       FROM financial_events
      WHERE (occurred_at IS NULL OR (occurred_at >= ? AND occurred_at < ?))
        AND ${SUBSCRIPTION_LEDGER_ROWS}`,
    ).bind(quarter.start, quarter.end).first<{ incomplete: number; undated: number; last_reconciled: string | null }>();
    if (!row) throw new Error('subscription ledger counts unreadable');
    const undated = Number(row.undated) || 0;
    const reasons = [read.reason, undated ? `${undated} ledger rows have no date, so they may belong to this period.` : null]
      .filter((x): x is string => !!x);
    return {
      ...base,
      state: read.state === 'incomplete' || undated ? 'incomplete' : 'complete',
      reason: reasons.length ? reasons.join(' ') : null,
      currencies: read.by_currency.map((b) => b.currency),
      last_reconciled_at: row.last_reconciled ?? null,
      incomplete_rows: (Number(row.incomplete) || 0) + undated,
      incomplete_detail: { missing_amount: read.missing_amount_rows, unattributed: read.unattributed_rows, undated },
      coverage,
      values: { by_currency: read.by_currency, mrr: read.mrr, arr: read.arr, ltv: read.ltv },
    };
  } catch {
    return unreadable(base, 'The financial ledger could not be read to count its incomplete rows.', coverage);
  }
}

// ── Refunds and disputes (#5299) ──────────────────────────────────────────────

export type RefundDisputeBucket = {
  currency: string;
  refunds: number;
  refunded_cents: number | null;
  disputes: number;
  /** What disputes opened in the period withdrew. */
  dispute_withdrawn_cents: number | null;
  /** What disputes won in the period reinstated. */
  dispute_reinstated_cents: number | null;
};

const REFUND_DISPUTE_ROWS = `livemode IS NOT 0
        AND ((kind = 'refund' AND source IN ('stripe', 'hq')) OR (kind = 'dispute' AND source = 'stripe'))`;

/** Every refund and dispute in the period, all streams, per currency, from the ledger. */
export async function refundsAndDisputesMetric(env: Env, quarter: Quarter): Promise<RevenueMetric<{ by_currency: RefundDisputeBucket[] }>> {
  const base = {
    key: 'refunds_and_disputes', label: 'Refunds and disputes',
    source: 'financial_events: refund rows (Stripe and HQ, one per refund key) and Stripe dispute rows, every stream (D5299)',
    period: quarter.key, last_reconciled_basis: LEDGER_RECONCILED, pending_issue: null,
  };
  const recordedBy = "financial_event_coverage, the later of sources 'stripe' and 'hq'";
  let coverage: MetricCoverage = { state: 'unknown', recorded_from: null, recorded_by: recordedBy };
  try {
    const cov = await env.DB.prepare(
      "SELECT source, coverage_starts_at FROM financial_event_coverage WHERE source IN ('stripe', 'hq')",
    ).all<{ source: string; coverage_starts_at: string }>();
    const starts = (cov.results || []).map((r) => r.coverage_starts_at).filter((s) => Number.isFinite(Date.parse(s)));
    if (starts.length < 2) throw new Error('ledger coverage missing');
    const latest = starts.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
    coverage = coverageFor(latest, quarter, recordedBy);
    if (coverage.state === 'none') {
      return {
        ...base, state: 'not_recorded', reason: `The ledger began recording refunds and disputes on ${latest}, after this period.`,
        currencies: [], last_reconciled_at: null, incomplete_rows: null, incomplete_detail: null, coverage, values: null,
      } as RevenueMetric<{ by_currency: RefundDisputeBucket[] }>;
    }
    const groups = await env.DB.prepare(
      `SELECT currency, kind, COUNT(*) AS events,
              SUM(CASE WHEN gross_cents IS NULL OR refund_cents IS NULL THEN 1 ELSE 0 END) AS missing,
              SUM(refund_cents) AS out_cents, SUM(gross_cents) AS back_cents,
              MAX(reconciled_at) AS last_reconciled
         FROM financial_events
        WHERE occurred_at >= ? AND occurred_at < ? AND ${REFUND_DISPUTE_ROWS}
        GROUP BY currency, kind
        ORDER BY currency, kind`,
    ).bind(quarter.start, quarter.end).all<{
      currency: string | null; kind: 'refund' | 'dispute'; events: number; missing: number;
      out_cents: number | null; back_cents: number | null; last_reconciled: string | null;
    }>();
    if (!groups.success) throw new Error('refund ledger query failed');
    const undatedRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM financial_events WHERE occurred_at IS NULL AND ${REFUND_DISPUTE_ROWS}`,
    ).first<{ n: number }>();
    if (!undatedRow) throw new Error('refund ledger count unreadable');

    let missing = 0;
    let noCurrency = 0;
    let lastReconciled: string | null = null;
    const buckets = new Map<string, RefundDisputeBucket>();
    for (const g of groups.results || []) {
      missing += Number(g.missing) || 0;
      if (g.last_reconciled && (!lastReconciled || g.last_reconciled > lastReconciled)) lastReconciled = g.last_reconciled;
      if (g.currency === null) { noCurrency += Number(g.events) || 0; continue; }
      const b = buckets.get(g.currency) ?? {
        currency: g.currency, refunds: 0, refunded_cents: 0, disputes: 0, dispute_withdrawn_cents: 0, dispute_reinstated_cents: 0,
      };
      // SUM over rows whose amounts are all NULL is NULL: that side stays unknown, never 0.
      if (g.kind === 'refund') {
        b.refunds = Number(g.events) || 0;
        b.refunded_cents = g.out_cents;
      } else {
        b.disputes = Number(g.events) || 0;
        b.dispute_withdrawn_cents = g.out_cents;
        b.dispute_reinstated_cents = g.back_cents;
      }
      buckets.set(g.currency, b);
    }
    const undated = Number(undatedRow.n) || 0;
    // A row with no currency has no amount (the ledger's CHECK), so it is already in `missing`; `no_currency` says why.
    const detail = { missing_amount: missing, undated };
    const gaps: string[] = [];
    if (coverage.state === 'partial') gaps.push(`The ledger began recording refunds and disputes on ${coverage.recorded_from}, during this period.`);
    if (missing) gaps.push(`${missing} refund or dispute rows have no recorded amount${noCurrency ? ` (${noCurrency} with no currency)` : ''}.`);
    if (undated) gaps.push(`${undated} refund or dispute rows have no date, so they may belong to this period.`);
    return {
      ...base,
      state: gaps.length ? 'incomplete' : 'complete',
      reason: gaps.length ? gaps.join(' ') : null,
      currencies: [...buckets.keys()],
      last_reconciled_at: lastReconciled,
      incomplete_rows: sum(detail),
      incomplete_detail: detail,
      coverage,
      values: { by_currency: [...buckets.values()] },
    };
  } catch {
    return unreadable(base, 'Refunds and disputes could not be read from the financial ledger.', coverage) as RevenueMetric<{ by_currency: RefundDisputeBucket[] }>;
  }
}

// ── Revenue per subsidiary (#5947) ────────────────────────────────────────────

export type SubsidiaryStreamLine = {
  stream: string;
  /** The branch's measured gross in `currency`; null when the branch measured none. Never added to another stream. */
  gross_cents: number | null;
  /** The figure's own currency; null when there is no figure to state it for. */
  currency: string | null;
  is_estimate: boolean;
  /** What the branch said about the stream (D5947); null for a row a build before D5947 reported. */
  state: string | null;
  reason: string | null;
  source: string | null;
  source_as_of: string | null;
  reported_at: string;
};

export type SubsidiaryRevenueLine = {
  licence_uid: string;
  licence_ref: string | null;
  brand_name: string | null;
  reported: boolean;
  reported_at: string | null;
  streams: SubsidiaryStreamLine[];
};

const UNMEASURED_STATES = new Set(['not_recorded', 'not_available', 'unreadable']);

/**
 * What each branch reported to HQ for the period, stream by stream, with the measured gross D5947 carries. One line per
 * licence that is not terminated, plus any licence that reported without being one. Nothing is totalled: not across
 * streams, licences or currencies.
 */
export async function revenuePerSubsidiaryMetric(env: Env, quarter: Quarter): Promise<RevenueMetric<{ by_licence: SubsidiaryRevenueLine[] }>> {
  type Out = RevenueMetric<{ by_licence: SubsidiaryRevenueLine[] }>;
  const base = {
    key: 'revenue_per_subsidiary', label: 'Revenue per subsidiary',
    source: "subsidiary_usage_reports: each branch's daily report of the quarter, per stream, with its measured gross, "
      + 'currency, state, source and as-of time (D266, D5947)',
    period: quarter.key,
    last_reconciled_basis: 'HQ reconciles nothing against a branch report. Each stream carries `source_as_of`, when the '
      + 'branch read its own ledger, which is not a reconciliation.',
    pending_issue: null,
  };
  const coverage: MetricCoverage = {
    state: 'unknown', recorded_from: null,
    recorded_by: 'migration 202611161359_5947_usage_report_source (D5947) began storing a measured figure with its state '
      + 'and source; a row with no state was reported by an earlier build, which measured nothing. The database does '
      + 'not hold when the migration was applied.',
  };
  type ReportRow = {
    licence_uid: string; stream: string; gross_cents: number | null; currency: string | null; is_estimate: number | null;
    reported_at: string; state: string | null; reason: string | null; source: string | null; source_as_of: string | null;
  };
  let licences: { uid: string; licence_ref: string | null; brand_name: string | null }[];
  let rows: ReportRow[];
  try {
    const l = await env.DB.prepare(
      `SELECT uid, licence_ref, brand_name FROM territory_licences WHERE status != 'terminated' ORDER BY licence_ref, uid`,
    ).all<{ uid: string; licence_ref: string | null; brand_name: string | null }>();
    const r = await env.DB.prepare(
      `SELECT licence_uid, stream, gross_cents, currency, is_estimate, reported_at, state, reason, source, source_as_of
         FROM subsidiary_usage_reports
        WHERE period = ?
        ORDER BY licence_uid, stream`,
    ).bind(quarter.key).all<ReportRow>();
    if (!l.success || !r.success) throw new Error('usage reports unreadable');
    licences = l.results || [];
    rows = r.results || [];
  } catch {
    return unreadable(base, 'The subsidiary usage reports could not be read.', coverage) as Out;
  }

  const byLicence = new Map<string, SubsidiaryRevenueLine>();
  for (const l of licences) {
    byLicence.set(String(l.uid), {
      licence_uid: String(l.uid), licence_ref: l.licence_ref ?? null, brand_name: l.brand_name ?? null,
      reported: false, reported_at: null, streams: [],
    });
  }
  const detail: Record<string, number> = {};
  const bump = (k: string) => { detail[k] = (detail[k] ?? 0) + 1; };
  const currencies = new Set<string>();
  for (const x of rows) {
    const uid = String(x.licence_uid);
    const line = byLicence.get(uid) ?? {
      licence_uid: uid, licence_ref: null, brand_name: null, reported: false, reported_at: null, streams: [],
    };
    const state = x.state ?? null;
    // A figure is what the branch measured; a state that says it measured nothing keeps it null whatever was stored.
    const gross = x.gross_cents === null || x.gross_cents === undefined || (state && UNMEASURED_STATES.has(state))
      ? null : Number(x.gross_cents);
    const currency = gross === null ? null : String(x.currency || '').toUpperCase() || null;
    const estimate = Number(x.is_estimate) === 1;
    if (gross !== null && currency === null) bump('no_currency');
    else if (gross !== null) {
      currencies.add(currency!);
      if (estimate) bump('estimated');
      else if (state === 'incomplete') bump('incomplete');
      else if (state === null) bump('no_state');
    } else if (state !== 'not_available') {
      // `not_available` is a stream the branch has no store for (D5947), by design. Every other unmeasured stream is a gap.
      bump(state ?? 'no_state');
    }
    line.streams.push({
      stream: String(x.stream), gross_cents: currency === null ? null : gross, currency, is_estimate: estimate,
      state, reason: x.reason ?? null, source: x.source ?? null, source_as_of: x.source_as_of ?? null,
      reported_at: x.reported_at,
    });
    line.reported = true;
    if (!line.reported_at || x.reported_at > line.reported_at) line.reported_at = x.reported_at;
    byLicence.set(uid, line);
  }
  const lines = [...byLicence.values()];
  const notReported = lines.filter((l) => !l.reported).length;
  if (notReported) detail.not_reported = notReported;
  const gaps = sum(detail);

  if (!rows.length) {
    return {
      ...base, state: 'not_recorded',
      reason: lines.length
        ? `No branch has reported ${quarter.key} to HQ, so there is no figure for any of the ${lines.length} licences.`
        : `No licence is in force and no branch has reported ${quarter.key}.`,
      currencies: [], last_reconciled_at: null, incomplete_rows: gaps, incomplete_detail: detail, coverage, values: null,
    };
  }
  if (!currencies.size) {
    // Reports arrived and every stream in them is unmeasured: no figure, but each licence's line says why.
    return {
      ...base, state: 'not_recorded',
      reason: `Every stream reported for ${quarter.key} arrived unmeasured, so there is no figure per subsidiary. `
        + 'Each licence\'s streams carry the branch\'s own reason.',
      currencies: [], last_reconciled_at: null, incomplete_rows: gaps, incomplete_detail: detail, coverage,
      values: { by_licence: lines },
    };
  }
  return {
    ...base,
    state: gaps ? 'incomplete' : 'complete',
    reason: gaps
      ? `${gaps} licences or streams for ${quarter.key} have no measured, complete figure; each figure is in its own `
        + 'currency and none is totalled.'
      : null,
    currencies: [...currencies].sort(),
    last_reconciled_at: null,
    incomplete_rows: gaps,
    incomplete_detail: detail,
    coverage,
    values: { by_licence: lines },
  };
}

// ── AI billed, cost and margin per licence (#5948) ────────────────────────────

export type AiLicenceLine = {
  licence_uid: string;
  runs: number;
  runs_not_recorded: number;
  included_microusd: number;
  /** Null when no run of the licence has a usage row to cost it: unknown, not 0. */
  billed_microusd: number | null;
  cost_microusd: number | null;
  margin_microusd: number | null;
};

const AI_START_BY = "ai_licence_attribution_start, written by migration 202611150131_5948_ai_licence_uid (D5948)";

/** SQLite's `datetime('now')` (`YYYY-MM-DD HH:MM:SS`, UTC) as ISO, so it is never parsed as local time. */
function sqliteUtc(at: string | null): string | null {
  if (!at) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at) ? `${at.replace(' ', 'T')}Z` : at;
}

/**
 * AI billed (top-up spend), provider cost and margin per licence, in micro-USD, from D5948's `licenceAiPeriod` over
 * this Worker's own database. HQ's runs name no licence (U1), and a branch's runs sit in the branch's database: its
 * report to HQ carries no AI figure (D5947, `token_margin` is `not_available`). So at HQ this metric reads as not
 * recorded with the runs it could not attribute counted, and never as a zero per licence.
 */
export async function aiMarginPerLicenceMetric(
  env: Env, quarter: Quarter,
): Promise<RevenueMetric<{ unit: 'microusd'; by_licence: AiLicenceLine[]; unattributed_runs: number; pre_migration_runs: number | null }>> {
  type Out = RevenueMetric<{ unit: 'microusd'; by_licence: AiLicenceLine[]; unattributed_runs: number; pre_migration_runs: number | null }>;
  const base = {
    key: 'ai_margin_per_licence', label: 'AI billed, cost and margin per licence',
    source: "ai_budget_reservations and ai_usage_logs on this Worker's database: settled member holds by licence_uid, "
      + "with tokenMargin's arithmetic (D762, D5948)",
    period: quarter.key,
    last_reconciled_basis: 'AI holds are settled by the Worker when the run ends, and nothing reconciles them against '
      + "the provider's invoice, so there is no reconciliation time.",
    pending_issue: null,
  };
  let p: LicenceAiPeriod;
  try {
    p = await licenceAiPeriod(env, { start: quarter.start, end: quarter.end });
  } catch {
    return unreadable(base, 'The AI holds and usage log could not be read by licence.',
      { state: 'unknown', recorded_from: null, recorded_by: AI_START_BY }) as Out;
  }
  const coverage = coverageFor(sqliteUtc(p.attribution_started_at), quarter, AI_START_BY);
  const notRecorded = p.licences.reduce((a, l) => a + l.runs_not_recorded, 0);
  const detail: Record<string, number> = { unattributed: p.unattributed_runs, not_recorded: notRecorded };
  if (p.pre_migration_runs !== null) detail.pre_migration = p.pre_migration_runs;
  const gaps = sum(detail);
  const notes: string[] = [];
  if (coverage.state === 'unknown') notes.push('When attribution began cannot be read, so runs that name no licence are all counted as unattributed.');
  if (coverage.state === 'partial') notes.push(`Runs began naming their licence on ${coverage.recorded_from}, during this period.`);
  if (p.pre_migration_runs) notes.push(`${p.pre_migration_runs} runs settled in the period started before that and name no licence.`);
  if (p.unattributed_runs) notes.push(`${p.unattributed_runs} runs name no licence.`);
  if (notRecorded) notes.push(`${notRecorded} runs have no usage row to cost them, so they are outside the cost and margin.`);

  if (coverage.state === 'none' || !p.licences.length) {
    const why = coverage.state === 'none'
      ? `Runs began naming their licence on ${coverage.recorded_from}, after this period.`
      : `No AI run settled in ${quarter.key} names a licence on this database.`
        + (env.BRANCH_CODE ? '' : ' HQ\'s own runs name none (no account names its licence yet), and a branch\'s runs '
          + 'are recorded on its own database: its report to HQ carries no AI figure (D5947).');
    return {
      ...base, state: 'not_recorded', reason: [why, ...notes].join(' '),
      currencies: [], last_reconciled_at: null, incomplete_rows: gaps, incomplete_detail: detail, coverage, values: null,
    };
  }
  const lines: AiLicenceLine[] = p.licences.map((l) => {
    // tokenMargin leaves an uncosted run out with COALESCE(…, 0); with no costed run at all, billed and cost are unknown.
    const costed = l.runs - l.runs_not_recorded > 0;
    return {
      licence_uid: l.licence_uid, runs: l.runs, runs_not_recorded: l.runs_not_recorded,
      included_microusd: l.included_microusd,
      billed_microusd: costed ? l.billed_microusd : null,
      cost_microusd: costed ? l.cost_microusd : null,
      margin_microusd: costed ? l.margin_microusd : null,
    };
  });
  const incomplete = gaps > 0 || coverage.state === 'partial' || coverage.state === 'unknown';
  return {
    ...base,
    state: incomplete ? 'incomplete' : 'complete',
    reason: notes.length ? notes.join(' ') : null,
    currencies: ['USD'],
    last_reconciled_at: null,
    incomplete_rows: gaps,
    incomplete_detail: detail,
    coverage,
    values: { unit: 'microusd', by_licence: lines, unattributed_runs: p.unattributed_runs, pre_migration_runs: p.pre_migration_runs },
  };
}

// ── Promo issued per licence (#5949) ──────────────────────────────────────────

export type PromoIssuedLine = {
  licence_uid: string;
  licence_ref: string | null;
  brand_name: string | null;
  currency: string;
  ceiling_cents: number;
  /** The branch's figure in the ceiling's currency; null unless the state is `reported` or `stale`. */
  issued_cents: number | null;
  spent_cents: number | null;
  reported_at: string | null;
  issued_state: string;
  issued_state_reason: string | null;
};

const PROMO_SOURCE_MIGRATION = 'migration 202611150136_5949_promo_issued_reports (D5949)';

/** What each branch reports it has issued against its ceiling for the period, HQ's reported copy (D5949). */
export async function promoIssuedMetric(env: Env, quarter: Quarter, now: Date): Promise<RevenueMetric<{ by_licence: PromoIssuedLine[] }>> {
  const base = {
    key: 'promo_issued_per_licence', label: 'Promo issued per licence',
    source: "licence_promo_ceilings: each branch's reported issued and spent figures, and licence_promo_issued_reports (D5949)",
    period: quarter.key,
    last_reconciled_basis: "The branch's own as-of time of the latest report HQ wrote into one of this period's ceilings.",
    pending_issue: null,
  };
  const coverage: MetricCoverage = {
    state: 'unknown', recorded_from: null,
    recorded_by: `${PROMO_SOURCE_MIGRATION}. No branch report reached HQ before it, and the database does not hold when it was applied.`,
  };
  type CeilingRow = {
    licence_uid: string; period: string; ceiling_cents: number; currency: string; issued_cents: number | null;
    spent_cents: number | null; issued_currency: string | null; issued_reported_at: string | null;
    licence_ref: string | null; brand_name: string | null;
  };
  let rows: CeilingRow[];
  try {
    const res = await env.DB.prepare(
      `SELECT p.licence_uid, p.period, p.ceiling_cents, p.currency, p.issued_cents, p.spent_cents, p.issued_currency,
              p.issued_reported_at, l.licence_ref, l.brand_name
         FROM licence_promo_ceilings p
         LEFT JOIN territory_licences l ON l.uid = p.licence_uid
        WHERE p.period = ?
        ORDER BY p.licence_uid`,
    ).bind(quarter.key).all<CeilingRow>();
    rows = res.results || [];
  } catch {
    return unreadable(base, 'The promo ceilings could not be read.', coverage) as RevenueMetric<{ by_licence: PromoIssuedLine[] }>;
  }
  if (!rows.length) {
    return {
      ...base, state: 'not_recorded', reason: `HQ has set no promo ceiling for ${quarter.key}, so no branch reports against one.`,
      currencies: [], last_reconciled_at: null, incomplete_rows: null, incomplete_detail: null, coverage, values: null,
    };
  }
  // The reports are read apart: if they fail, a row with a figure keeps it, and one without reads `unreadable`.
  let latest: Map<string, LatestReport> | 'unreadable';
  try {
    const reps = await env.DB.prepare(
      'SELECT licence_uid, period, currency, reported_at, outcome FROM licence_promo_issued_reports',
    ).all<LatestReport & { licence_uid: string }>();
    latest = new Map((reps.results || []).map((r) => [r.licence_uid, r]));
  } catch { latest = 'unreadable'; }

  const detail: Record<string, number> = {};
  let lastReconciled: string | null = null;
  const lines: PromoIssuedLine[] = rows.map((x) => {
    const { state, reason } = promoIssuedState(x, latest === 'unreadable' ? 'unreadable' : latest.get(x.licence_uid), now);
    const usable = state === 'reported' || state === 'stale';
    if (state !== 'reported') detail[state] = (detail[state] ?? 0) + 1;
    if (usable && x.issued_reported_at && (!lastReconciled || x.issued_reported_at > lastReconciled)) lastReconciled = x.issued_reported_at;
    return {
      licence_uid: x.licence_uid, licence_ref: x.licence_ref ?? null, brand_name: x.brand_name ?? null,
      currency: String(x.currency || '').toUpperCase(), ceiling_cents: Number(x.ceiling_cents),
      issued_cents: usable ? x.issued_cents : null,
      spent_cents: usable ? x.spent_cents : null,
      reported_at: usable ? x.issued_reported_at : null,
      issued_state: state, issued_state_reason: reason,
    };
  });
  const incomplete = sum(detail);
  return {
    ...base,
    state: incomplete ? 'incomplete' : 'complete',
    reason: incomplete
      ? `${incomplete} of ${lines.length} ceilings for ${quarter.key} have no current report from their branch.`
      : null,
    currencies: [...new Set(lines.map((l) => l.currency))].sort(),
    last_reconciled_at: lastReconciled,
    incomplete_rows: incomplete,
    incomplete_detail: detail,
    coverage,
    values: { by_licence: lines },
  };
}

// ── Licence fees invoiced (#5036) ─────────────────────────────────────────────

type InvoicesRead = Awaited<ReturnType<typeof licenceFeeReceivables>>;

/** Licence fees invoiced and collected in the period, from the D5036 reader's result. */
export function licenceInvoicesMetric(quarter: Quarter, read: InvoicesRead): RevenueMetric {
  const base = {
    key: 'licence_fees_invoiced', label: 'Licence fees invoiced',
    source: 'licence_fee_invoices, by issue date (D5036)', period: quarter.key,
    last_reconciled_basis: 'Payments are entered by HQ and nothing reconciles them against a bank (migration 513), so there is no reconciliation time.',
    pending_issue: null,
  };
  const coverage: MetricCoverage = {
    state: 'unknown', recorded_from: null,
    recorded_by: 'migration 513_licence_fee_invoices (D802). The database does not hold when it was applied.',
  };
  if (!read.available) return unreadable(base, read.reason, coverage);
  const cannot = read.cannot_invoice.length;
  return {
    ...base,
    state: cannot ? 'incomplete' : 'complete',
    reason: cannot ? `${cannot} billable licences have no fee or no start date, so they cannot be invoiced.` : null,
    currencies: read.by_currency.map((b) => b.currency),
    last_reconciled_at: null,
    incomplete_rows: cannot,
    incomplete_detail: { cannot_invoice: cannot },
    coverage,
    values: { by_currency: read.by_currency, expected_not_invoiced: read.expected_not_invoiced.length },
  };
}

// ── The read model ────────────────────────────────────────────────────────────

/**
 * Every metric for one quarter. `subscriptions` and `licenceInvoices` are the readers' results the summary already
 * holds, so their stores are not read twice. Never throws: each metric carries its own failure.
 */
export async function revenueReadModel(
  env: Env, quarter: Quarter, now: Date,
  reads: { subscriptions: SubscriptionRead; licenceInvoices: InvoicesRead },
): Promise<{ period: string; metrics: Record<string, RevenueMetric> }> {
  const list = [
    await subscriptionRevenueMetric(env, quarter, reads.subscriptions),
    await refundsAndDisputesMetric(env, quarter),
    await revenuePerSubsidiaryMetric(env, quarter),
    await aiMarginPerLicenceMetric(env, quarter),
    await promoIssuedMetric(env, quarter, now),
    licenceInvoicesMetric(quarter, reads.licenceInvoices),
  ];
  return { period: quarter.key, metrics: Object.fromEntries(list.map((m) => [m.key, m])) };
}

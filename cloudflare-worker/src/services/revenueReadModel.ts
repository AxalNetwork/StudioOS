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
 * WHAT IS NOT HERE YET (2026-11-16). Revenue per subsidiary needs branches to report a measured gross (#5947), and AI
 * billed, cost and margin per licence need the licence stamped on AI runs (#5948). Neither is merged, so both metrics
 * are `not_available` with the issue named, and read nothing.
 *
 * NO STRIPE CALL. Every read is D1.
 */
import type { Env } from '../types';
import { SUBSCRIPTION_LEDGER_ROWS, type subscriptionRevenue } from './subscriptionRevenue';
import type { licenceFeeReceivables } from './licenceFeeReceivables';
import { promoIssuedState, type LatestReport } from './promoIssuedReport';

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

// ── The two metrics whose slices have not shipped ─────────────────────────────

function notAvailable(key: string, label: string, quarter: Quarter, issue: number, source: string, reason: string): RevenueMetric {
  return {
    key, label, state: 'not_available', reason, source, period: quarter.key, currencies: null,
    last_reconciled_at: null, last_reconciled_basis: `Nothing is recorded until #${issue} ships.`,
    incomplete_rows: null, incomplete_detail: null,
    coverage: { state: 'none', recorded_from: null, recorded_by: `Not recorded: #${issue} has not shipped.` },
    pending_issue: issue, values: null,
  };
}

/** Revenue per subsidiary. Not available until branches report a measured gross (#5947). */
export function revenuePerSubsidiaryMetric(quarter: Quarter): RevenueMetric {
  return notAvailable(
    'revenue_per_subsidiary', 'Revenue per subsidiary', quarter, 5947,
    'subsidiary_usage_reports.gross_cents, as each branch reports it (D266)',
    'Not recorded yet. Branches report each stream to HQ with no measured amount, so there is no figure per '
      + 'subsidiary. #5947 makes the branch report a measured gross, its currency and its source.',
  );
}

/** AI billed, cost and margin per licence. Not available until AI runs carry their licence (#5948). */
export function aiMarginPerLicenceMetric(quarter: Quarter): RevenueMetric {
  return notAvailable(
    'ai_margin_per_licence', 'AI billed, cost and margin per licence', quarter, 5948,
    'ai_budget_reservations and ai_usage_logs, by licence',
    'Not recorded yet. AI runs do not carry the licence they ran for, so cost, billed amount and margin cannot be '
      + 'split by licence. #5948 stamps the licence on each run.',
  );
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
    revenuePerSubsidiaryMetric(quarter),
    aiMarginPerLicenceMetric(quarter),
    await promoIssuedMetric(env, quarter, now),
    licenceInvoicesMetric(quarter, reads.licenceInvoices),
  ];
  return { period: quarter.key, metrics: Object.fromEntries(list.map((m) => [m.key, m])) };
}

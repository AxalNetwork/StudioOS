/** Quarterly subscription receipts and refunds by currency from the local financial ledger (#5946). */
import type { Env } from '../types';

type Quarter = { key: string; start: string; end: string };
type CurrencyTotal = {
  currency: string;
  gross_cents: number | null;
  refund_cents: number | null;
  net_cents: number | null;
};
type LedgerGroup = {
  currency: string | null;
  kind: 'invoice' | 'refund';
  unattributed: number;
  missing_amounts: number;
  event_count: number;
  amount: number | null;
};

const metrics = {
  mrr: { state: 'not_recorded', reason: 'Cash events do not record the recurring contract amount or effective billing interval.' },
  arr: { state: 'not_recorded', reason: 'Cash events do not record the recurring contract amount or effective billing interval.' },
  ltv: { state: 'not_recorded', reason: 'The ledger has no pre-coverage customer payment history.' },
} as const;

/**
 * The ledger rows the subscription stream is read from (D5946), as one SQL condition. D5950's read model counts its
 * incomplete rows and last reconciliation over exactly these rows, so the two can never disagree on the set.
 */
export const SUBSCRIPTION_LEDGER_ROWS = `((kind = 'invoice' AND source = 'stripe') OR (kind = 'refund' AND source IN ('stripe', 'hq')))
          AND livemode IS NOT 0
          AND (revenue_stream IN ('tier', 'investor', 'mi') OR revenue_stream IS NULL)`;

export async function subscriptionRevenue(env: Env, quarter: Quarter) {
  const base = { period: quarter.key, ...metrics };
  try {
    // Keep this GET read-only. coverageStarts() also runs the writer's runtime schema safety net.
    const coverage = await env.DB.prepare(
      "SELECT coverage_starts_at FROM financial_event_coverage WHERE source = 'stripe'",
    ).first<{ coverage_starts_at: string }>();
    const start = coverage?.coverage_starts_at;
    const coverageTime = start ? Date.parse(start) : NaN;
    if (!start || !Number.isFinite(coverageTime)) throw new Error('Missing Stripe ledger coverage');
    const recorded = { ...base, coverage_starts_at: start };
    if (coverageTime >= Date.parse(quarter.end)) {
      return { ...recorded, state: 'not_recorded' as const, reason: `Stripe ledger coverage began on ${start}, after the requested period.` };
    }

    // These are the kinds stamped by subscription checkout (billing.ts). NULL streams are kept as
    // possible subscription activity. Charges and PaymentIntents repeat the invoice's inflow.
    const { success, results } = await env.DB.prepare(
      `SELECT currency, kind, revenue_stream IS NULL AS unattributed,
              COUNT(*) AS event_count,
              COUNT(*) - COUNT(CASE kind WHEN 'invoice' THEN gross_cents ELSE refund_cents END) AS missing_amounts,
              SUM(CASE kind WHEN 'invoice' THEN gross_cents ELSE refund_cents END) AS amount
         FROM financial_events
        WHERE occurred_at >= ? AND occurred_at < ?
          AND ${SUBSCRIPTION_LEDGER_ROWS}
        GROUP BY currency, kind, revenue_stream IS NULL
        ORDER BY currency, kind`,
    ).bind(quarter.start, quarter.end).all<LedgerGroup>();
    if (!success) throw new Error('Subscription ledger query failed');

    let unattributedRows = 0;
    let missingAmountRows = 0;
    const amountsByCurrency = new Map<string, { gross: number | null; refund: number | null }>();
    for (const row of results) {
      missingAmountRows += row.missing_amounts;
      if (row.unattributed) {
        unattributedRows += row.event_count;
        continue;
      }
      if (row.currency === null) continue;
      const amounts = amountsByCurrency.get(row.currency) ?? { gross: 0, refund: 0 };
      amounts[row.kind === 'invoice' ? 'gross' : 'refund'] = row.amount;
      amountsByCurrency.set(row.currency, amounts);
    }
    const byCurrency: CurrencyTotal[] = Array.from(amountsByCurrency, ([currency, { gross, refund }]) => ({
      currency,
      gross_cents: gross,
      refund_cents: refund,
      net_cents: gross === null || refund === null ? null : gross - refund,
    }));

    const gaps: string[] = [];
    if (coverageTime > Date.parse(quarter.start)) gaps.push(`Stripe ledger coverage began on ${start}, during the requested period.`);
    if (missingAmountRows) gaps.push(`${missingAmountRows} ledger rows have no recorded amount.`);
    if (unattributedRows) gaps.push(`${unattributedRows} ledger rows have no recorded revenue stream.`);
    return {
      ...recorded,
      state: gaps.length ? 'incomplete' as const : 'complete' as const,
      reason: gaps.length ? gaps.join(' ') : null,
      by_currency: byCurrency,
      missing_amount_rows: missingAmountRows,
      unattributed_rows: unattributedRows,
    };
  } catch {
    return { ...base, state: 'unreadable' as const, reason: 'Subscription revenue could not be read from the financial ledger.' };
  }
}

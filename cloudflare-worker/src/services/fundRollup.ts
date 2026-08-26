/**
 * Fund analytics — every number here comes from a D1 row, and every number
 * that has no row is null.
 *
 * These two surfaces (/funds/performance, /funds/accounting) previously
 * rendered a fixture that invented NAV, IRR, TVPI, RVPI and DPI for four
 * funds that do not exist. Invented fiduciary figures are the one thing the
 * funds honesty rule forbids outright, so the replacement reports only what
 * the schema can actually support:
 *
 *   committed   vc_funds.fund_size_cents, or legacy total_commitment dollars
 *   called      Σ limited_partners.invested_amount  (legacy dollars)
 *   deployed    vc_funds.deployed_capital           (legacy dollars)
 *   distributed Σ fund_distributions.amount_cents WHERE status = 'paid'
 *   dpi         distributed / called, null when nothing has been called
 *
 * and refuses the rest, each with the reason it cannot be computed:
 *
 *   nav         there is no fund-level valuation mark anywhere in the schema.
 *               portfolio_positions carries marks per PROJECT, and nothing
 *               attributes a position to a fund, so a fund NAV would be a
 *               guess at which positions belong to which vehicle.
 *   rvpi, tvpi  both are NAV over (or plus) paid-in. No NAV, no ratio.
 *   irr         needs dated contributions. A per-fund capital call is
 *               recorded as a `capital_call_notice` job, not as a dated cash
 *               receipt, so the contribution dates do not exist.
 *               limited_partners.commitment_date is a promise, not a
 *               transfer, and using it here would manufacture a plausible
 *               IRR out of the wrong dates — worse than reporting none.
 *
 * When capital calls start settling into dated rows, `irr` becomes a
 * computeFundMetrics() call over those flows and this comment loses a
 * paragraph. Nothing else about the shape changes.
 */


/** One vc_funds row joined with its two correlated sums, straight from D1. */
export interface FundRollupRow {
  id: number | string;
  name: string;
  vintage_year: number | null;
  status: string;
  total_commitment: number | null;
  fund_size_cents: number | null;
  deployed_capital: number | null;
  lp_rows: number | null;
  called_dollars: number | null;
  distributed_cents: number | null;
  management_fee: number | null;
  carried_interest: number | null;
}

export interface FundRollup {
  id: number;
  name: string;
  vintage_year: number | null;
  status: string;
  lp_count: number;
  committed_cents: number;
  called_cents: number;
  deployed_cents: number;
  distributed_cents: number;
  dpi: number | null;
  /** Contracted rates from vc_funds. Real terms; the ACCRUALS have no source. */
  management_fee: number | null;
  carried_interest: number | null;
  nav_cents: null;
  rvpi: null;
  tvpi: null;
  irr: null;
}

export const FUND_METRIC_UNAVAILABLE = {
  nav_cents: 'No fund-level valuation marks are recorded. Marks exist per portfolio project, and no position is attributed to a fund.',
  rvpi: 'Requires NAV.',
  tvpi: 'Requires NAV.',
  irr: 'Requires dated contributions. Capital calls are recorded as notices, not as dated cash receipts.',
  fee_accrual: 'The management fee and carry RATES are contracted terms and are shown. Accrued amounts per period have no table to read from.',
  expenses: 'No fund expense ledger exists in the schema.',
} as const;

/** Legacy money columns are REAL dollars; everything leaving here is cents. */
export const dollarsToCents = (v: unknown) => Math.round((Number(v) || 0) * 100);

/** null, not 0, when the denominator is absent — 0.00x reads as a real result. */
export function ratioOrNull(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

export function rollUpFundRow(r: FundRollupRow): FundRollup {
  // fund_size_cents is authoritative once set; total_commitment is the legacy
  // dollars column that predates the v2 cents migration.
  const committed = Number(r.fund_size_cents) > 0
    ? Number(r.fund_size_cents)
    : dollarsToCents(r.total_commitment);
  const called = dollarsToCents(r.called_dollars);
  const distributed = Number(r.distributed_cents) || 0;
  return {
    id: Number(r.id),
    name: String(r.name),
    vintage_year: r.vintage_year == null ? null : Number(r.vintage_year),
    status: String(r.status || ''),
    lp_count: Number(r.lp_rows) || 0,
    committed_cents: committed,
    called_cents: called,
    deployed_cents: dollarsToCents(r.deployed_capital),
    distributed_cents: distributed,
    dpi: ratioOrNull(distributed, called),
    // A rate of exactly 0 is a real term (a no-fee vehicle), so only a
    // missing column becomes null.
    management_fee: r.management_fee == null ? null : Number(r.management_fee),
    carried_interest: r.carried_interest == null ? null : Number(r.carried_interest),
    nav_cents: null,
    rvpi: null,
    tvpi: null,
    irr: null,
  };
}

export function totalFundRollups(items: FundRollup[]) {
  const sum = (k: 'committed_cents' | 'called_cents' | 'deployed_cents' | 'distributed_cents') =>
    items.reduce((a, f) => a + f[k], 0);
  const called = sum('called_cents');
  const distributed = sum('distributed_cents');
  return {
    fund_count: items.length,
    lp_count: items.reduce((a, f) => a + f.lp_count, 0),
    committed_cents: sum('committed_cents'),
    called_cents: called,
    deployed_cents: sum('deployed_cents'),
    distributed_cents: distributed,
    // Blended DPI is the family's distributions over the family's called
    // capital, not the mean of per-fund DPIs — averaging ratios would weight
    // a $2m fund the same as a $200m one.
    dpi: ratioOrNull(distributed, called),
    nav_cents: null as null,
    rvpi: null as null,
    tvpi: null as null,
    irr: null as null,
  };
}

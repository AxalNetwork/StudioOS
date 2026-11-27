/** Fund analytics from recorded rows. Receipt totals use migration 312's
 * append-only ledger; performance calculations remain outside D550's scope.
 * Legacy invested_amount still supplies DPI's paid-in denominator.
 */
import type { Env } from '../types';

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
  called_cents: number | null;
  paid_in_cents: number;
  collected_cents: number | null;
  outstanding_cents: number | null;
  capital_state: 'recorded' | 'not_recorded' | 'unreadable';
  capital_reason: string | null;
  lp_capital: LpCapitalRollup[];
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
  irr: 'Dated capital-call receipts are recorded, but a complete dated cash-flow history and terminal fund valuation are not recorded.',
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
    paid_in_cents: called,
    collected_cents: null,
    outstanding_cents: null,
    capital_state: 'not_recorded',
    capital_reason: NO_RECEIPTS,
    lp_capital: [],
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
  const sum = (k: 'committed_cents' | 'paid_in_cents' | 'deployed_cents' | 'distributed_cents') =>
    items.reduce((a, f) => a + f[k], 0);
  const knownSum = (k: 'called_cents' | 'collected_cents' | 'outstanding_cents') =>
    items.length && items.every(f => f[k] != null) ? items.reduce((a, f) => a + f[k]!, 0) : null;
  const called = knownSum('called_cents');
  const distributed = sum('distributed_cents');
  return {
    fund_count: items.length,
    lp_count: items.reduce((a, f) => a + f.lp_count, 0),
    committed_cents: sum('committed_cents'),
    called_cents: called,
    collected_cents: knownSum('collected_cents'),
    outstanding_cents: knownSum('outstanding_cents'),
    deployed_cents: sum('deployed_cents'),
    distributed_cents: distributed,
    // Preserve the existing paid-in denominator; D550 changes receipt
    // reporting, not the performance calculations awaiting #1138.
    dpi: ratioOrNull(distributed, sum('paid_in_cents')),
    nav_cents: null as null,
    rvpi: null as null,
    tvpi: null as null,
    irr: null as null,
  };
}


const NO_RECEIPTS = 'No dated capital-call receipts are recorded.';
const NO_CALLS = 'No capital-call lines are recorded.';
const UNREADABLE_CAPITAL = 'Capital-call lines and receipts could not be read.';

interface LpCapitalRow {
  id: number; name: string | null; call_count: number; called_cents: number | null;
  receipt_count: number; collected_cents: number | null;
}
export interface LpCapitalRollup {
  limited_partner_id: number; name: string | null;
  called_cents: number | null; collected_cents: number | null; outstanding_cents: number | null;
  capital_state: 'recorded' | 'not_recorded'; capital_reason: string | null;
}

/** Only called with fund IDs already selected through the GP/admin scope.
 * Independent sums prevent multiple receipts from multiplying call amounts.
 * A failed ledger read leaves the fund visible, with explicitly unknown cash.
 */
export async function readFundCapital(env: Env, fund: FundRollup): Promise<FundRollup> {
  try {
    const result = await env.DB.prepare(
      `SELECT lp.id, lp.name,
        (SELECT COUNT(*) FROM capital_calls cc WHERE cc.limited_partner_id = lp.id) AS call_count,
        (SELECT SUM(COALESCE(cc.amount_cents, CAST(ROUND(cc.amount * 100) AS INTEGER)))
          FROM capital_calls cc WHERE cc.limited_partner_id = lp.id) AS called_cents,
        (SELECT COUNT(*) FROM capital_call_receipts r
          WHERE r.limited_partner_id = lp.id AND r.fund_id = ?) AS receipt_count,
        (SELECT SUM(r.amount_cents) FROM capital_call_receipts r
          WHERE r.limited_partner_id = lp.id AND r.fund_id = ?) AS collected_cents
       FROM limited_partners lp WHERE lp.fund_id = ? ORDER BY lp.id`
    ).bind(fund.id, fund.id, fund.id).all<LpCapitalRow>();
    if (!result.success) throw new Error('Ledger read failed');
    const rows = result.results || [];
    const lp_capital: LpCapitalRollup[] = rows.map(r => {
      const called = Number(r.call_count) > 0 ? Number(r.called_cents) : null;
      const collected = Number(r.receipt_count) > 0 ? Number(r.collected_cents) : null;
      return {
        limited_partner_id: Number(r.id), name: r.name,
        called_cents: called, collected_cents: collected,
        outstanding_cents: called != null && collected != null ? called - collected : null,
        capital_state: collected == null ? 'not_recorded' : 'recorded',
        capital_reason: collected == null ? NO_RECEIPTS : called == null ? NO_CALLS : null,
      };
    });
    const called = rows.some(r => Number(r.call_count) > 0)
      ? rows.reduce((n, r) => n + Number(r.called_cents || 0), 0) : null;
    const collected = rows.some(r => Number(r.receipt_count) > 0)
      ? rows.reduce((n, r) => n + Number(r.collected_cents || 0), 0) : null;
    return { ...fund, called_cents: called, collected_cents: collected,
      outstanding_cents: called != null && collected != null ? called - collected : null,
      capital_state: collected == null ? 'not_recorded' : 'recorded',
      capital_reason: collected == null ? NO_RECEIPTS : called == null ? NO_CALLS : null,
      lp_capital };
  } catch {
    return { ...fund, called_cents: null, collected_cents: null, outstanding_cents: null,
      capital_state: 'unreadable', capital_reason: UNREADABLE_CAPITAL, lp_capital: [] };
  }
}

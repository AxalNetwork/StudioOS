/** D627: investments-only marks and called-capital performance. No cost-as-value fallback. */
import type { Env } from '../types';
export type Flow = { amount_cents: number; date: string | null };
export type Mark = { id: number; value_cents: number | null; valuation_date: string | null };
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
const cents = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const total = (values: number[]) => {
  const sum = values.reduce((a, b) => a + b, 0);
  return Number.isSafeInteger(sum) ? sum : null;
};
/** XIRR: actual days / 365, solved in log(1+r), with ambiguous roots withheld. */
export function xirr(flows: Flow[]): number | null {
  if (flows.length < 2 || flows.some(f => !validDate(f.date) || !Number.isSafeInteger(f.amount_cents))) return null;
  const sorted = [...flows].sort((a, b) => a.date!.localeCompare(b.date!));
  const start = Date.parse(sorted[0].date!);
  const points = sorted.map(f => ({ amount: f.amount_cents, years: (Date.parse(f.date!) - start) / 86400000 / 365 }));
  if (!points.some(p => p.amount < 0) || !points.some(p => p.amount > 0) || points.at(-1)!.years === 0) return null;
  const scale = Math.max(...points.map(p => Math.abs(p.amount)));
  const npv = (y: number) => points.reduce((sum, p) => sum + p.amount / scale * Math.exp(-y * p.years), 0);
  const brackets: [number, number][] = [];
  let left = -20, prior = npv(left);
  for (let i = 1; i <= 800; i++) {
    const right = -20 + i / 20, next = npv(right);
    if (Number.isFinite(prior) && Number.isFinite(next) && ((prior < 0 && next >= 0) || (prior > 0 && next <= 0))) brackets.push([left, right]);
    left = right; prior = next;
  }
  if (brackets.length !== 1) return null;
  let [lo, hi] = brackets[0];
  let low = npv(lo);
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2, value = npv(mid);
    if (Math.abs(value) < 1e-12) return Math.expm1(mid);
    if ((low < 0) === (value < 0)) { lo = mid; low = value; } else hi = mid;
  }
  const rate = Math.expm1((lo + hi) / 2);
  return Number.isFinite(rate) ? rate : null;
}
export function calculatePerformance(positions: Mark[], calls: Flow[], distributions: Flow[], asOf: string) {
  const unavailable: Record<string, string> = {};
  const nav = positions.length && positions.every(p => cents(p.value_cents)) ? total(positions.map(p => p.value_cents!)) : null;
  const paid = calls.length && calls.every(f => cents(f.amount_cents)) ? total(calls.map(f => f.amount_cents)) : null;
  const dist = distributions.length && distributions.every(f => cents(f.amount_cents)) ? total(distributions.map(f => f.amount_cents)) : null;
  if (nav === null) unavailable.nav_cents = 'Every attributed position needs a dated valuation; no complete investment NAV is recorded.';
  if (paid === null) unavailable.paid_in_cents = 'No complete capital-called amount is recorded for this fund.';
  if (dist === null) unavailable.distributed_cents = 'No complete paid distribution amount is recorded for this fund.';
  const ratio = (key: string, numerator: number | null) => {
    if (paid === null || paid <= 0 || numerator === null || !Number.isSafeInteger(numerator)) {
      unavailable[key] = 'This figure needs its recorded investment NAV or paid distributions and positive capital called.';
      return null;
    }
    return numerator / paid;
  };
  const rvpi = ratio('rvpi', nav), dpi = ratio('dpi', dist), tvpi = ratio('tvpi', nav === null || dist === null ? null : nav + dist);
  let irr: number | null = null;
  if (nav !== null && paid !== null && paid > 0 && dist !== null && validDate(asOf)
    && [...calls, ...distributions].every(f => validDate(f.date) && f.date! <= asOf)) {
    irr = xirr([...calls.map(f => ({ ...f, amount_cents: -f.amount_cents })), ...distributions, { amount_cents: nav, date: asOf }]);
  }
  if (irr === null) unavailable.irr = 'IRR needs complete dated calls, paid distributions and terminal investment NAV, with a unique solvable cash-flow series.';
  return { as_of: asOf, nav_basis: 'Investments only; cash balances, liabilities, fees and carry are not included.',
    nav_cents: nav, paid_in_cents: paid, distributed_cents: dist, rvpi, dpi, tvpi, irr, unavailable };
}
async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  if (!result.success) throw new Error('Fund performance read failed');
  return result.results;
}
export async function readFundPerformance(env: Env, fund: any, asOf: string) {
  const positions = await rows<Mark>(env.DB.prepare(
    `SELECT p.id, v.value_cents, v.valuation_date FROM portfolio_positions p
     LEFT JOIN fund_position_valuations v ON v.id = (
       SELECT m.id FROM fund_position_valuations m WHERE m.position_id = p.id AND m.valuation_date <= ?
       ORDER BY m.valuation_date DESC, m.id DESC LIMIT 1)
     WHERE p.fund_id = ?`).bind(asOf, fund.id));
  // Headers are authoritative. Legacy unnumbered LP lines are included once;
  // numbered lines and receipts never double-count the amount called.
  const calls = await rows<Flow>(env.DB.prepare(
    `SELECT amount_cents, substr(created_at, 1, 10) AS date FROM fund_capital_calls WHERE fund_id = ?
     UNION ALL
     SELECT CASE WHEN c.amount_cents IS NOT NULL THEN c.amount_cents ELSE round(c.amount * 100) END AS amount_cents,
       substr(c.created_at, 1, 10) AS date FROM capital_calls c JOIN limited_partners lp ON lp.id = c.limited_partner_id
       WHERE lp.fund_id = ? AND c.fund_call_id IS NULL`).bind(fund.id, fund.id));
  const distributions = await rows<Flow>(env.DB.prepare(
    `SELECT amount_cents, substr(distributed_at, 1, 10) AS date FROM fund_distributions WHERE fund_id = ? AND status = 'paid'`).bind(fund.id));
  return { id: fund.id, name: fund.name, vintage_year: fund.vintage_year, status: fund.status,
    ...calculatePerformance(positions, calls, distributions, asOf) };
}

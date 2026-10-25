/**
 * D1158 (#3065) — two reads for FND10, the fund's positions board:
 *
 *   readFundPositions   each position attributed to the fund, with its latest
 *                       dated mark (D627's store). A position with no mark
 *                       says so: `marked: false` and its value is null with a
 *                       reason. Invested cost is never shown as value.
 *   readFundHistory     `readFundPerformance` as of each quarter end since the
 *                       fund's first call, point in time. A quarter it cannot
 *                       compute keeps D627's `unavailable` reasons, never 0.
 *
 * Both are computed from the stores on every read; nothing is kept.
 */
import type { Env } from '../types';
import { readFundPerformance } from './fundPerformance';

const NO_MARK = 'No valuation is recorded for this position; invested cost is not its value.';
export const NO_CALL = 'No capital call is recorded for this fund, so it has no quarter to read.';
/** Forty years of quarters: more than any fund lives, and a bound on the reads one request makes. */
export const HISTORY_QUARTERS_LIMIT = 160;

async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  if (!result.success) throw new Error('Fund positions read failed');
  return result.results;
}

export async function readFundPositions(env: Env, fundId: number, today: string) {
  const rows = await all<any>(env.DB.prepare(
    `SELECT p.id, p.uid, p.project_id, pr.name AS company_name, p.round_name, p.invested_amount, p.position_date,
            v.value_cents, v.valuation_date, v.source, v.recorded_by, u.name AS recorded_by_name
       FROM portfolio_positions p
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN fund_position_valuations v ON v.id = (
         SELECT m.id FROM fund_position_valuations m WHERE m.position_id = p.id AND m.valuation_date <= ?
         ORDER BY m.valuation_date DESC, m.id DESC LIMIT 1)
       LEFT JOIN users u ON u.id = v.recorded_by
      WHERE p.fund_id = ?
      ORDER BY p.id`).bind(today, fundId));
  const items = rows.map((r) => {
    const marked = r.value_cents != null;
    return {
      id: r.id,
      uid: r.uid ?? null,
      project_id: r.project_id ?? null,
      company_name: r.company_name ?? null,
      round_name: r.round_name,
      invested_amount: r.invested_amount ?? null,
      position_date: r.position_date ?? null,
      marked,
      value_cents: marked ? Number(r.value_cents) : null,
      valuation_date: marked ? r.valuation_date : null,
      source: marked ? r.source : null,
      recorded_by: marked ? { id: r.recorded_by, name: r.recorded_by_name ?? null } : null,
      unavailable: marked ? {} : { value_cents: NO_MARK },
    };
  });
  return { fund_id: fundId, as_of: today, items, unmarked: items.filter((p) => !p.marked).length };
}

/** `2026-05-14` → `2026-06-30`, the end of the quarter the date falls in. */
export function quarterEndOf(date: string): string {
  const y = Number(date.slice(0, 4)), q = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  return new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10);
}

/** Every quarter end from the one holding `first` through the last one on or before `today`. */
export function quarterEnds(first: string, today: string): string[] {
  const out: string[] = [];
  let end = quarterEndOf(first);
  while (end <= today) {
    out.push(end);
    const next = new Date(Date.parse(end + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
    end = quarterEndOf(next);
  }
  return out;
}

export async function readFundHistory(env: Env, fund: any, today: string) {
  // The same two call stores `readFundPerformance` counts: headers, and legacy unnumbered LP lines.
  const first = await env.DB.prepare(
    `SELECT MIN(d) AS first_call FROM (
       SELECT substr(created_at, 1, 10) AS d FROM fund_capital_calls WHERE fund_id = ?
       UNION ALL
       SELECT substr(c.created_at, 1, 10) FROM capital_calls c JOIN limited_partners lp ON lp.id = c.limited_partner_id
        WHERE lp.fund_id = ? AND c.fund_call_id IS NULL)`).bind(fund.id, fund.id).first<{ first_call: string | null }>();
  const firstCall = first?.first_call ?? null;
  const base = { fund_id: fund.id, step: 'quarter' as const, as_of: today, first_call: firstCall };
  if (!firstCall || !/^\d{4}-\d{2}-\d{2}$/.test(firstCall)) return { ...base, first_call: null, items: [], reason: NO_CALL, truncated: false };
  const ends = quarterEnds(firstCall, today);
  const kept = ends.slice(-HISTORY_QUARTERS_LIMIT);
  const items = [];
  for (const end of kept) {
    const p = await readFundPerformance(env, fund, end, { pointInTime: true });
    items.push({ quarter: `Q${Math.floor(Number(end.slice(5, 7)) / 3)} ${end.slice(0, 4)}`, quarter_end: end,
      nav_cents: p.nav_cents, paid_in_cents: p.paid_in_cents, distributed_cents: p.distributed_cents,
      rvpi: p.rvpi, dpi: p.dpi, tvpi: p.tvpi, irr: p.irr, unavailable: p.unavailable });
  }
  return { ...base, nav_basis: 'Investments only; cash balances, liabilities, fees and carry are not included.',
    items, reason: items.length ? null : 'The fund\'s first quarter has not ended yet.', truncated: kept.length < ends.length };
}

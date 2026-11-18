/**
 * D6870 (#6870): the fund figures a reporting period freezes when it is
 * issued, for the overview chart (IF0) and the quarterly history (IF5).
 *
 * A GP's own issue (`saveFundPeriod`) freezes all of these. The reporting
 * queue's pack (`lp_quarterly_report/1`) already carries called, collected and
 * NAV, and takes deployed and the sector mix from here:
 *
 * - called to date: every capital-call line of the fund's LPs dated on or
 *   before the period end (the pack's `called_to_date` works the same lines,
 *   over the LPs admitted by the period end);
 * - collected: every capital-call receipt of the fund received on or before
 *   the period end (the pack's `receipts_to_date`);
 * - deployed: the invested amount of the fund's positions, as `readFundPage`
 *   reads it (the owner chose `invested_cents` on #6801, not
 *   `vc_funds.deployed_capital`);
 * - sector mix: that invested amount by the sector recorded on each position's
 *   company, with an unrecorded sector kept as its own row, never dropped.
 *
 * NAV is the pack's own `fundFigures(...).nav`, so it is not worked here.
 * Every amount is integer cents; a figure that cannot be worked is
 * `{ cents: null, reason }`, never 0. Frozen at issue, so a past quarter never
 * moves; a failed read throws and the issue is refused as Unreadable.
 */
import type { Env } from '../types';
import type { Line } from './fundReportBuild';
import { dollarsToCents } from './capRelReads';

export type SectorMix = {
  basis: string;
  items: Array<{ sector: string | null; invested_cents: number; position_count: number }>;
};

const SECTOR_BASIS = "Invested amount of the fund's positions at issue, by the sector recorded on each company.";

/** A position's invested amount (USD, a REAL of dollars) in cents, or a throw: a stored amount that is not money is unreadable. */
function centsOf(value: unknown): number {
  const cents = typeof value === 'number' ? dollarsToCents(value, 'USD') : null;
  if (cents === null || !Number.isSafeInteger(cents)) throw new Error('Fund money unreadable');
  return cents;
}

async function sum(env: Env, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number | null }>();
  if (!row) throw new Error('Fund figures unreadable');
  const n = row.n ?? 0;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Fund money unreadable');
  return n;
}

/** Called to date and collected to date, as of `end` (YYYY-MM-DD). */
export async function capitalToDate(env: Env, fundId: number, end: string): Promise<{ called: Line; collected: Line }> {
  const called = await sum(env, `SELECT SUM(COALESCE(c.amount_cents, CAST(ROUND(c.amount * 100) AS INTEGER))) AS n
      FROM capital_calls c JOIN limited_partners lp ON lp.id = c.limited_partner_id
     WHERE lp.fund_id = ? AND substr(c.created_at, 1, 10) <= ?`, fundId, end);
  const collected = await sum(env, `SELECT SUM(amount_cents) AS n FROM capital_call_receipts
     WHERE fund_id = ? AND received_on <= ?`, fundId, end);
  return { called: { cents: called }, collected: { cents: collected } };
}

/** Deployed (the positions' invested amount) and its sector mix, read at issue. */
export async function deployedAndSectors(env: Env, fundId: number): Promise<{ deployed: Line; sector_mix: SectorMix }> {
  const rows = await env.DB.prepare(`SELECT NULLIF(TRIM(p.sector), '') AS sector, pp.invested_amount
      FROM portfolio_positions pp LEFT JOIN projects p ON p.id = pp.project_id
     WHERE pp.fund_id = ? ORDER BY pp.id`).bind(fundId).all<{ sector: string | null; invested_amount: unknown }>();
  if (rows.success !== true || !Array.isArray(rows.results)) throw new Error('Fund positions unreadable');
  if (!rows.results.length) {
    return { deployed: { cents: null, reason: 'No positions are attributed to this fund.' }, sector_mix: { basis: SECTOR_BASIS, items: [] } };
  }
  const bySector = new Map<string | null, { invested_cents: number; position_count: number }>();
  let total = 0;
  for (const row of rows.results) {
    const cents = centsOf(row.invested_amount);
    total += cents;
    const sector = typeof row.sector === 'string' ? row.sector : null;
    const entry = bySector.get(sector) ?? { invested_cents: 0, position_count: 0 };
    entry.invested_cents += cents; entry.position_count += 1;
    bySector.set(sector, entry);
  }
  if (!Number.isSafeInteger(total)) throw new Error('Fund money unreadable');
  // Largest first; the unrecorded row last, whatever its size; ties by name.
  const items = [...bySector.entries()].map(([sector, v]) => ({ sector, ...v }))
    .sort((a, b) => (a.sector === null ? 1 : 0) - (b.sector === null ? 1 : 0)
      || b.invested_cents - a.invested_cents || String(a.sector).localeCompare(String(b.sector)));
  return { deployed: { cents: total }, sector_mix: { basis: SECTOR_BASIS, items } };
}

/** A Line as the GP snapshot's `<key>_cents` / `<key>_reason` pair. */
export function asTotals(key: string, line: Line): Record<string, number | string | null> {
  return line.cents === null
    ? { [`${key}_cents`]: null, [`${key}_reason`]: line.reason }
    : { [`${key}_cents`]: line.cents, [`${key}_reason`]: null };
}

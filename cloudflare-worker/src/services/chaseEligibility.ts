/**
 * D7650 (#7650): whether an investor's chase may ask a company for its report.
 *
 * `POST /api/portfolio/chase` (`routes/portfolio.ts`) used to accept any
 * company the caller could see. A chase is now accepted only when a reporting
 * obligation applies to the company in the caller's book and the report for
 * its current period is due or overdue and has not arrived. The obligation is
 * the one `GET /api/positions/kpi-compliance` measures (D6204, D4647):
 *
 *   - It applies to a company held in the caller's book: a position the
 *     caller holds, or one in a fund they run, or any position for an admin.
 *   - Its current period is the last completed one at the asked cadence
 *     (quarterly unless the request says monthly).
 *   - Its report is due `due_days` after the period ends: the earliest
 *     active `after_end` reporting duty at that cadence in the caller's book,
 *     else the firm default of 30 days.
 *   - It is reported when a submitted update counts for the period
 *     (`periodCounts`, D1057).
 *
 * "Due" includes the due day itself: on that day the report is owed, though
 * D6204 does not yet call it late. The due day is compared with the clock in
 * SQL, `datetime(?) <= datetime('now')`, so both sides are normalised.
 *
 * Every refusal is typed, and any read that fails is `unreadable`: a company
 * whose obligation could not be read is never chased.
 */
import type { Env } from '../types';
import type { PositionScope } from '../routes/positions';
import { type KpiCadence, completedPeriod, periodBounds, periodCounts, reportDue } from './portfolioMetrics';

export type ChaseSkipReason = 'no_obligation' | 'not_due' | 'already_reported' | 'unreadable';

export const CHASE_SKIP_MESSAGES: Readonly<Record<ChaseSkipReason, string>> = Object.freeze({
  no_obligation: 'No reporting obligation in your book applies to this company.',
  not_due: 'This period’s report is not due yet.',
  already_reported: 'The company has already reported for this period.',
  unreadable: 'The reporting obligation could not be read, so the company was not chased.',
});

export type ChaseObligation =
  | { eligible: true; period: string; due_date: string }
  | { eligible: false; reason: ChaseSkipReason; period: string | null; due_date: string | null };

const skip = (reason: ChaseSkipReason, period: string | null = null, due_date: string | null = null): ChaseObligation =>
  ({ eligible: false, reason, period, due_date });

class ReadFailed extends Error {}
const failed = (result: { success: boolean }) => result.success === false;

/**
 * The obligation for one company, for this caller. `scope` is the caller's
 * `positionScope` (null: no book at all). `today` is the Worker's UTC date and
 * picks the period; the due comparison itself is made by SQLite's clock.
 */
export async function chaseObligation(
  env: Env, scope: PositionScope | null, userId: number, projectId: number, cadence: KpiCadence, today: string,
): Promise<ChaseObligation> {
  return (await chaseObligations(env, scope, userId, [projectId], cadence, today)).get(projectId)!;
}

/** D9204: fixed D1 round trips for a bounded list, with the same fail-closed decisions. */
export async function chaseObligations(
  env: Env, scope: PositionScope | null, userId: number, projectIds: number[], cadence: KpiCadence, today: string,
): Promise<Map<number, ChaseObligation>> {
  const ids = [...new Set(projectIds)];
  const period = completedPeriod(cadence, today);
  const bounds = period ? periodBounds(cadence, period) : null;
  const result = new Map<number, ChaseObligation>(ids.map(id => [id, skip(scope ? 'unreadable' : 'no_obligation', scope ? period : null)]));
  if (!scope || !period || !bounds || !ids.length) return result;
  try {
    const heldStmt = env.DB.prepare(`SELECT 1 AS held FROM portfolio_positions p
      WHERE p.project_id = ? AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0
        OR instr(',' || ? || ',', ',' || CAST(p.fund_id AS TEXT) || ',') > 0) LIMIT 1`);
    const held = await env.DB.batch(ids.map(id => heldStmt.bind(id, scope.heldCsv, scope.heldCsv, scope.fundCsv)));
    const heldIds = ids.filter((id, i) => {
      if (failed(held[i])) throw new ReadFailed('held read failed');
      if (held[i].results?.length) return true;
      result.set(id, skip('no_obligation')); return false;
    });
    if (!heldIds.length) return result;
    const dutiesStmt = env.DB.prepare(`SELECT MIN(due_days) AS due_days FROM reporting_duties
      WHERE status = 'active' AND due_rule = 'after_end' AND cadence = ? AND (? IS NULL OR holder_user_id = ?) AND project_id = ?`);
    const updatesStmt = env.DB.prepare(`SELECT DISTINCT period FROM portfolio_updates WHERE project_id = ? AND status = 'submitted'`);
    const reads = await env.DB.batch<{ due_days?: unknown; period?: string }>(heldIds.flatMap(id => [dutiesStmt.bind(cadence, scope.heldCsv, Number(userId), id), updatesStmt.bind(id)]));
    const dueDates = new Map<number, string>();
    for (const [i, id] of heldIds.entries()) {
      const duties = reads[i * 2], updates = reads[i * 2 + 1];
      if (failed(duties) || failed(updates)) throw new ReadFailed('obligation read failed');
      const n = duties.results?.[0]?.due_days;
      const dutyDays = n != null && Number.isInteger(Number(n)) && Number(n) >= 0 ? Number(n) : null;
      if (updates.results?.some(u => periodCounts(cadence, period, u.period || ''))) { result.set(id, skip('already_reported', period)); continue; }
      const dueDate = reportDue(bounds.until, dutyDays, false, today).due_date;
      if (dueDate) dueDates.set(id, dueDate);
    }
    const pending = [...dueDates];
    const clockStmt = env.DB.prepare(`SELECT CASE WHEN datetime(?) <= datetime('now') THEN 1 ELSE 0 END AS due`);
    const clocks = pending.length ? await env.DB.batch<{ due: number | null }>(pending.map(([, date]) => clockStmt.bind(date))) : [];
    for (const [i, [id, due_date]] of pending.entries()) {
      const due = clocks[i].results?.[0]?.due;
      result.set(id, failed(clocks[i]) || due == null ? skip('unreadable', period, due_date)
        : Number(due) !== 1 ? skip('not_due', period, due_date) : { eligible: true, period, due_date });
    }
    return result;
  } catch {
    // An unreadable batch must never make an unverified target eligible.
    return result;
  }
}

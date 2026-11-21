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
async function rows(stmt: any): Promise<any[]> {
  const res = await stmt.all();
  if (!res || res.success === false) throw new ReadFailed('read failed');
  return res.results || [];
}

/**
 * The obligation for one company, for this caller. `scope` is the caller's
 * `positionScope` (null: no book at all). `today` is the Worker's UTC date and
 * picks the period; the due comparison itself is made by SQLite's clock.
 */
export async function chaseObligation(
  env: Env, scope: PositionScope | null, userId: number, projectId: number, cadence: KpiCadence, today: string,
): Promise<ChaseObligation> {
  if (!scope) return skip('no_obligation');
  const period = completedPeriod(cadence, today);
  const bounds = period ? periodBounds(cadence, period) : null;
  if (!period || !bounds) return skip('unreadable');
  try {
    const held = await rows(env.DB.prepare(
      `SELECT 1 AS held FROM portfolio_positions p
        WHERE p.project_id = ?
          AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0
               OR instr(',' || ? || ',', ',' || CAST(p.fund_id AS TEXT) || ',') > 0)
        LIMIT 1`,
    ).bind(projectId, scope.heldCsv, scope.heldCsv, scope.fundCsv));
    if (!held.length) return skip('no_obligation');

    // The same duties `kpi-compliance` reads (D6204), for this one company.
    const duties = await rows(env.DB.prepare(
      `SELECT MIN(due_days) AS due_days
         FROM reporting_duties
        WHERE status = 'active' AND due_rule = 'after_end' AND cadence = ?
          AND (? IS NULL OR holder_user_id = ?)
          AND project_id = ?`,
    ).bind(cadence, scope.heldCsv, Number(userId), projectId));
    const n = duties[0]?.due_days;
    const dutyDays = n != null && Number.isInteger(Number(n)) && Number(n) >= 0 ? Number(n) : null;

    const updates = await rows(env.DB.prepare(
      `SELECT DISTINCT period FROM portfolio_updates WHERE project_id = ? AND status = 'submitted'`,
    ).bind(projectId));
    if (updates.some((u) => periodCounts(cadence, period, u.period))) return skip('already_reported', period);

    const dueDate = reportDue(bounds.until, dutyDays, false, today).due_date;
    if (!dueDate) return skip('unreadable', period);
    const clock = await rows(env.DB.prepare(
      `SELECT CASE WHEN datetime(?) <= datetime('now') THEN 1 ELSE 0 END AS due`,
    ).bind(dueDate));
    if (clock[0]?.due == null) return skip('unreadable', period, dueDate);
    if (Number(clock[0].due) !== 1) return skip('not_due', period, dueDate);
    return { eligible: true, period, due_date: dueDate };
  } catch {
    return skip('unreadable', period);
  }
}

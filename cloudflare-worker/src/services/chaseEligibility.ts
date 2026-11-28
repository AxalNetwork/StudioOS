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
    const selected = JSON.stringify(ids);
    const held = await env.DB.prepare(`SELECT DISTINCT p.project_id FROM portfolio_positions p
      WHERE p.project_id IN (SELECT value FROM json_each(?))
        AND (? IS NULL OR instr(',' || ? || ',', ',' || CAST(p.project_id AS TEXT) || ',') > 0
          OR instr(',' || ? || ',', ',' || CAST(p.fund_id AS TEXT) || ',') > 0)`)
      .bind(selected, scope.heldCsv, scope.heldCsv, scope.fundCsv).all<{ project_id: number }>();
    if (failed(held)) throw new ReadFailed('held read failed');
    const heldSet = new Set((held.results || []).map(row => row.project_id));
    const heldIds = ids.filter(id => {
      if (heldSet.has(id)) return true;
      result.set(id, skip('no_obligation')); return false;
    });
    if (!heldIds.length) return result;
    const heldJson = JSON.stringify(heldIds);
    const duties = await env.DB.prepare(`SELECT project_id, MIN(due_days) AS due_days FROM reporting_duties
      WHERE status = 'active' AND due_rule = 'after_end' AND cadence = ? AND (? IS NULL OR holder_user_id = ?)
        AND project_id IN (SELECT value FROM json_each(?)) GROUP BY project_id`)
      .bind(cadence, scope.heldCsv, Number(userId), heldJson).all<{ project_id: number; due_days: unknown }>();
    if (failed(duties)) throw new ReadFailed('duty read failed');
    const updates = await env.DB.prepare(`SELECT DISTINCT project_id, period FROM portfolio_updates
      WHERE project_id IN (SELECT value FROM json_each(?)) AND status = 'submitted'`)
      .bind(heldJson).all<{ project_id: number; period: string }>();
    if (failed(updates)) throw new ReadFailed('update read failed');
    const dutyById = new Map((duties.results || []).map(row => [row.project_id, row.due_days]));
    const reported = new Set((updates.results || []).filter(row => periodCounts(cadence, period, row.period)).map(row => row.project_id));
    const dueDates = new Map<number, string>();
    for (const id of heldIds) {
      const n = dutyById.get(id);
      const dutyDays = n != null && Number.isInteger(Number(n)) && Number(n) >= 0 ? Number(n) : null;
      if (reported.has(id)) { result.set(id, skip('already_reported', period)); continue; }
      const dueDate = reportDue(bounds.until, dutyDays, false, today).due_date;
      if (dueDate) dueDates.set(id, dueDate);
    }
    if (dueDates.size) {
      const clocks = await env.DB.prepare(`SELECT json_extract(value, '$.id') AS project_id,
        CASE WHEN datetime(json_extract(value, '$.date')) <= datetime('now') THEN 1 ELSE 0 END AS due
        FROM json_each(?)`).bind(JSON.stringify([...dueDates].map(([id, date]) => ({ id, date }))))
        .all<{ project_id: number; due: number | null }>();
      if (failed(clocks)) throw new ReadFailed('clock read failed');
      for (const { project_id, due } of clocks.results || []) {
        const due_date = dueDates.get(project_id)!;
        result.set(project_id, due == null ? skip('unreadable', period, due_date)
          : Number(due) !== 1 ? skip('not_due', period, due_date) : { eligible: true, period, due_date });
      }
    }
    return result;
  } catch {
    // An unreadable batch must never make an unverified target eligible.
    return result;
  }
}

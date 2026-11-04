/** D1614 (#3968): W1's live E3 run reader, with guard-inclusive charges and unknown-cost preservation. */
import type { Env } from '../../types';
import type { WorkRun, WorkRunReader } from './workBoard';
import type { RunRow } from '../../agents/engine';
import { outcomeOf } from './runActivity';

type Latest = Pick<RunRow, 'task_id' | 'uid' | 'status' | 'refusal' | 'started_at' | 'ended_at'>;
type Costs = { task_id: number; uid: string; charged: number | null; missing: number; total_cost: number | null; missing_cost: number };
const money = (value: number | null) => value != null && Number.isSafeInteger(value) && value >= 0;

/** The caller has already gated and selected these tasks. No per-card reads. */
export const recordedWorkRuns: WorkRunReader = async (env: Env, taskIds) => {
  if (!taskIds.length) return new Map();
  const ids = JSON.stringify(taskIds);
  // Run-store failures reach the page as Unreadable, never a successful empty board.
  const latest = (await env.DB.prepare(`SELECT task_id, uid, status, refusal, started_at, ended_at FROM (
    SELECT r.task_id, r.uid, r.status, r.refusal, r.started_at, r.ended_at,
      ROW_NUMBER() OVER (PARTITION BY r.task_id ORDER BY r.attempt DESC, r.id DESC) AS rank
    FROM agent_task_runs r WHERE r.task_id IN (SELECT value FROM json_each(?))
  ) WHERE rank = 1`).bind(ids).all<Latest>()).results ?? [];
  const result = new Map<number, WorkRun>(latest.map((r) => {
    const outcome = outcomeOf(r, [], true);
    const display_status = r.status === 'waiting_decision' ? 'waiting' : outcome.kind === 'in_progress' ? 'running' : outcome.kind;
    return [r.task_id, { ...r, display_status, charged_microusd: null, total_cost: null, missing_cost: 1 }];
  }));
  if (!latest.length) return result;
  try {
    // Match chargedFor: a usage charge includes its guard rows. First aggregate
    // each attempt, then all attempts, so guards do not multiply the task total.
    const costs = (await env.DB.prepare(`WITH attempt_costs AS (
      SELECT r.task_id, r.uid, r.attempt, r.id,
        SUM(u.charged_microusd) AS charged,
        SUM(CASE WHEN u.charged_microusd IS NULL OR u.charged_microusd < 0 THEN 1 ELSE 0 END) AS missing
      FROM agent_task_runs r LEFT JOIN ai_usage_logs u ON u.id = r.usage_log_id OR u.guard_for = r.usage_log_id
      WHERE r.task_id IN (SELECT value FROM json_each(?)) GROUP BY r.id
    ) SELECT task_id, uid, charged, missing, total_cost, missing_cost FROM (
      SELECT task_id, uid, charged, missing,
        SUM(charged) OVER (PARTITION BY task_id) AS total_cost,
        SUM(missing) OVER (PARTITION BY task_id) AS missing_cost,
        ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY attempt DESC, id DESC) AS rank
      FROM attempt_costs
    ) WHERE rank = 1`).bind(ids).all<Costs>()).results ?? [];
    for (const c of costs) {
      const run = result.get(c.task_id);
      // A new attempt between the two reads cannot put its charge on an older run.
      if (!run || run.uid !== c.uid) continue;
      run.charged_microusd = !c.missing && money(c.charged) ? c.charged : null;
      run.total_cost = !c.missing_cost && money(c.total_cost) ? c.total_cost : null;
      run.missing_cost = run.total_cost == null ? 1 : 0;
    }
  } catch {
    // Usage is optional: retain the known run and leave both costs unavailable.
  }
  return result;
};

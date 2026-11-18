/**
 * D7074 (#7074, part of #7072) — how much a scope's agents may do at once.
 *
 * Before this, three numbers were fixed in code or in a CHECK: one live run
 * per agent, at most five per scope, and admission stopping at five proposals
 * awaiting a decision. They are settings now, under ceilings HQ records:
 *
 *   LANES. An agent holds one live run per lane. Lane 0 is the agent; lanes 1
 *   and up are its sub-agents. A sub-agent is the same `team_agents` row, so
 *   nothing new is granted: same role, rule book, sponsor, tools and cap.
 *   A second lane is admitted only when the agent's monthly cap still covers
 *   it (`laneBudget`), which needs HQ's per-run ceiling to bound one run.
 *
 *   ELASTIC. A scope's `capacity_mode` is `fixed` (`max_parallel_runs`, 1 to
 *   5, as before) or `elastic` (`elastic_max_runs`, up to HQ's ceiling). The
 *   task list supplies the demand: only a ready task is ever offered. The
 *   budget supplies the limit: each run takes its own hold, each agent has
 *   its cap, each sub-agent lane must fit under that cap.
 *
 *   CEILINGS. `ai_agent_policy.elastic_runs_ceiling` and `lanes_ceiling`.
 *   NULL (every database until HQ sets them) means not offered: a scope then
 *   reads as fixed with one lane whatever its row says, so withdrawing a
 *   ceiling takes effect at the next admission, with no rows to rewrite.
 *
 * Everything here is pure except `capacityCeilings`, one read of the policy
 * row. A scope on the defaults (fixed, one lane) never makes that read.
 */
import type { Env } from '../types';
import type { Spend } from '../services/agents/teams';
import { DAILY_LIMIT, OPEN_PROPOSALS_MAX } from './runtime';

export type CapacityMode = 'fixed' | 'elastic';
export type Capacity = {
  capacity_mode: CapacityMode;
  max_parallel_runs: number;
  /** Elastic mode's own limit; null takes HQ's ceiling. */
  elastic_max_runs: number | null;
  lanes_per_agent: number;
  /** Null is `OPEN_PROPOSALS_MAX`. */
  review_backlog_max: number | null;
  /** Null is `DAILY_LIMIT`. */
  daily_runs_per_agent: number | null;
};
export const DEFAULT_CAPACITY: Capacity = {
  capacity_mode: 'fixed', max_parallel_runs: 2, elastic_max_runs: null, lanes_per_agent: 1, review_backlog_max: null, daily_runs_per_agent: null,
};

/** The schema's own bounds (migration 202611170130); a team's setting is also held under HQ's ceiling. */
export const FIXED_RUNS_MAX = 5;
export const ELASTIC_RUNS_MAX = 500;
export const LANES_MAX = 50;
export const REVIEW_BACKLOG_MAX = 200;
export const DAILY_RUNS_MAX = 1000;

export type Ceilings = { elastic_runs: number | null; lanes: number | null; per_run_microusd: number | null };
export const NO_CEILINGS: Ceilings = { elastic_runs: null, lanes: null, per_run_microusd: null };

const whole = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v != null && Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};

/** A settings row as capacity. A column the row lacks, or a value outside its range, reads as the default. */
export function capacityOf(row: Record<string, unknown> | null | undefined): Capacity {
  if (!row) return { ...DEFAULT_CAPACITY };
  return {
    capacity_mode: row.capacity_mode === 'elastic' ? 'elastic' : 'fixed',
    max_parallel_runs: whole(row.max_parallel_runs, 1, FIXED_RUNS_MAX) ?? DEFAULT_CAPACITY.max_parallel_runs,
    elastic_max_runs: whole(row.elastic_max_runs, 1, ELASTIC_RUNS_MAX),
    lanes_per_agent: whole(row.lanes_per_agent, 1, LANES_MAX) ?? 1,
    review_backlog_max: whole(row.review_backlog_max, 1, REVIEW_BACKLOG_MAX),
    daily_runs_per_agent: whole(row.daily_runs_per_agent, 1, DAILY_RUNS_MAX),
  };
}

/** Whether admission needs HQ's ceilings at all. On the defaults it does not, and reads nothing more than before. */
export const needsCeilings = (c: Capacity) => c.capacity_mode === 'elastic' || c.lanes_per_agent > 1;

/** Sub-agents are offered when HQ set a lane ceiling AND a per-run ceiling: without the second, one run's cost has no bound. */
export const lanesOffered = (ceil: Ceilings) => ceil.lanes != null && ceil.per_run_microusd != null;

/** The most runs a scope may have live at once. Elastic without HQ's ceiling is fixed. */
export function parallelLimit(c: Capacity, ceil: Ceilings): number {
  if (c.capacity_mode !== 'elastic' || ceil.elastic_runs == null) return c.max_parallel_runs;
  return Math.max(1, Math.min(c.elastic_max_runs ?? ceil.elastic_runs, ceil.elastic_runs));
}

/** The most live runs one agent may hold: itself and its sub-agents. One unless HQ offers sub-agents. */
export function laneLimit(c: Capacity, ceil: Ceilings): number {
  if (!lanesOffered(ceil)) return 1;
  return Math.max(1, Math.min(c.lanes_per_agent, ceil.lanes as number));
}

export const backlogLimit = (c: Capacity) => c.review_backlog_max ?? OPEN_PROPOSALS_MAX;
export const dailyLimit = (c: Capacity) => c.daily_runs_per_agent ?? DAILY_LIMIT;

/** The lowest lane under `limit` that no live run holds, or null when all are taken. */
export function freeLane(taken: readonly number[], limit: number): number | null {
  const held = new Set(taken.map(Number));
  for (let lane = 0; lane < limit; lane += 1) if (!held.has(lane)) return lane;
  return null;
}

export type LaneBudget = { ok: true; headroom_microusd: number } | { ok: false; reason: 'no_ceiling' | 'spend_unreadable' | 'cap' };

/**
 * Whether the agent's monthly cap covers one more live run beside the `live`
 * it already has. Each live run is counted at the per-run ceiling, the most
 * `agentRun` lets one run hold, because a live run's charge is not in the
 * month's spend until it settles. An unknown spend or no ceiling covers
 * nothing: it is never read as zero.
 */
export function laneBudget(i: { cap_microusd: number; spent: Spend; live: number; per_run_microusd: number | null }): LaneBudget {
  if (i.per_run_microusd == null || !(i.per_run_microusd > 0)) return { ok: false, reason: 'no_ceiling' };
  if (!i.spent.available) return { ok: false, reason: 'spend_unreadable' };
  const headroom = i.cap_microusd - i.spent.value_microusd - i.live * i.per_run_microusd;
  return headroom >= i.per_run_microusd ? { ok: true, headroom_microusd: headroom } : { ok: false, reason: 'cap' };
}

/**
 * HQ's ceilings: one read of the policy row. A database before the migration,
 * a missing row and an unreadable policy all answer `NO_CEILINGS`, which
 * offers nothing: capacity fails closed to the fixed rule.
 */
export async function capacityCeilings(env: Env): Promise<Ceilings> {
  try {
    const r = await env.DB.prepare('SELECT elastic_runs_ceiling, lanes_ceiling, per_run_ceiling_microusd FROM ai_agent_policy WHERE id = 1')
      .first<{ elastic_runs_ceiling: number | null; lanes_ceiling: number | null; per_run_ceiling_microusd: number | null }>();
    if (!r) return { ...NO_CEILINGS };
    const perRun = Number(r.per_run_ceiling_microusd);
    return {
      elastic_runs: whole(r.elastic_runs_ceiling, 1, ELASTIC_RUNS_MAX),
      lanes: whole(r.lanes_ceiling, 1, LANES_MAX),
      per_run_microusd: r.per_run_ceiling_microusd != null && Number.isSafeInteger(perRun) && perRun > 0 ? perRun : null,
    };
  } catch {
    return { ...NO_CEILINGS };
  }
}

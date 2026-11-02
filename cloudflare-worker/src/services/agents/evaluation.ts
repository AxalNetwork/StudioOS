/**
 * #3851 (E7 of #3742, under D1528) — the agent engine's cost reads and its
 * evaluation board (TM14).
 *
 * COSTS. Every sum is a `Spend`: `{ available: true, value_microusd }` or
 * `{ available: false }`. A read that fails, or a run whose charge is not
 * recorded (`ai_usage_logs.charged_microusd` NULL, or the log row gone), makes
 * the sum unknown — "Not recorded" on the page — never smaller and never 0.
 * No `COALESCE(…, 0)`: a sum is taken only over rows whose charge is known,
 * after checking that every row's is.
 *   · per task:  its runs (`agent_task_runs.usage_log_id`) — `runCostReader`,
 *                E1's `CostReader` seam (`tasks.ts`).
 *   · per goal:  the sum of its tasks' (`scope_tasks.goal_id`), which
 *                `goalDto` (`goals.ts`) adds up from `runCostReader`'s.
 *   · per agent: its usage logs (`ai_usage_logs.agent_id`), over a window.
 * A task with no run has spent nothing: 0, read and known.
 *
 * THE BOARD, live from `ai_rail_proposals` joined to `team_agents`, one row
 * per role in the scope, over 30 or 90 days. Read-only: it never changes an
 * agent's autonomy, cap or status.
 *   decided            accepted + edited + discarded (a withdrawn proposal is
 *                      no one's decision and is left out)
 *   acceptance         (accepted + edited) / decided — an edit is an acceptance
 *   edit, discard      edited / decided, discarded / decided
 *   median_decision_h  hours from proposal to decision, the median
 *   open_past_3d       still proposed, three days or more after it was made
 *   expired            runs that ended `decision_expired` (no decision in 7 days)
 *   cost_per_accepted  the role's charges in the window / (accepted + edited)
 *   refused            runs refused, by reason
 * Under 10 decisions the rates are null and the row says "Too few decisions
 * to rate (n)".
 *
 * Bound SQL only.
 */
import type { Env } from '../../types';
import type { Scope, Spend } from './teams';
import type { CostReader } from './tasks';

export const EVALUATION_DAYS = [30, 90] as const;
export type EvaluationDays = (typeof EVALUATION_DAYS)[number];
/** Fewer decisions than this and a role is not rated. */
export const MIN_DECISIONS = 10;
/** A proposal still open this many days counts as waiting too long. */
export const OPEN_TOO_LONG_DAYS = 3;
/** The most rows the board reads per window; past it the board is a sample of the newest. */
const BOARD_ROWS_MAX = 5000;

export const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
const daysBefore = (now: Date, days: number) => sqlTime(new Date(now.getTime() - days * 86_400_000));

type SumRow = { id: number; runs: number; charged: number | null; unknown: number | null };

/** Rows of (id, runs, charged over known rows, unknown count) to known sums; an id with an unknown charge is left out. */
function knownSums(rows: SumRow[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) {
    if (Number(r.unknown) > 0) continue;
    const v = Number(r.runs) > 0 ? Number(r.charged) : 0;
    if (Number.isSafeInteger(v) && v >= 0) out.set(Number(r.id), v);
  }
  return out;
}

/** A run with a usage log whose row or charge is missing makes its sum unknown. */
const UNKNOWN_CHARGE = 'CASE WHEN r.usage_log_id IS NOT NULL AND (l.id IS NULL OR l.charged_microusd IS NULL) THEN 1 ELSE 0 END';

/**
 * E1's `CostReader`, filled: each task's charges, the sum over its runs' usage
 * logs. A task with no run is 0; a task with any unrecorded charge is left out
 * (so `taskCosts` keeps it `{ available: false }`).
 */
export const runCostReader: CostReader = async (env, taskIds) => {
  if (!taskIds.length) return new Map();
  const rows = (await env.DB.prepare(
    `SELECT t.value AS id, COUNT(r.id) AS runs,
            SUM(CASE WHEN l.charged_microusd IS NOT NULL THEN l.charged_microusd END) AS charged,
            SUM(${UNKNOWN_CHARGE}) AS unknown
       FROM json_each(?) t
       LEFT JOIN agent_task_runs r ON r.task_id = t.value
       LEFT JOIN ai_usage_logs l ON l.id = r.usage_log_id
      GROUP BY t.value`,
  ).bind(JSON.stringify(taskIds)).all<SumRow>()).results ?? [];
  return knownSums(rows);
};

/** Each agent's charges since `since` (all time when null), from its usage logs. */
export async function agentCosts(env: Env, agentIds: number[], since: string | null = null): Promise<Map<number, Spend>> {
  const out = new Map<number, Spend>(agentIds.map((id) => [id, { available: false }]));
  if (!agentIds.length) return out;
  try {
    const rows = (await env.DB.prepare(
      `SELECT a.value AS id, COUNT(l.id) AS runs,
              SUM(CASE WHEN l.charged_microusd IS NOT NULL THEN l.charged_microusd END) AS charged,
              SUM(CASE WHEN l.id IS NOT NULL AND l.charged_microusd IS NULL THEN 1 ELSE 0 END) AS unknown
         FROM json_each(?) a
         LEFT JOIN ai_usage_logs l ON l.agent_id = a.value AND (? IS NULL OR l.created_at >= ?)
        GROUP BY a.value`,
    ).bind(JSON.stringify(agentIds), since, since).all<SumRow>()).results ?? [];
    for (const [id, v] of knownSums(rows)) out.set(id, { available: true, value_microusd: v });
  } catch { /* unknown, never 0 */ }
  return out;
}

// ── The board ────────────────────────────────────────────────────────────────

export type RoleEvaluation = {
  role_key: string;
  decided: number;
  rated: boolean;
  /** "Too few decisions to rate (n)" when not rated; null when rated. */
  note: string | null;
  acceptance: number | null;
  edit: number | null;
  discard: number | null;
  median_decision_h: number | null;
  open_past_3d: number;
  expired: number;
  cost_per_accepted: Spend;
  refused: { reason: string; n: number }[];
};

/** The rule as one function, so the page and the tests read the same numbers. */
export function rateRole(role_key: string, p: { status: string; created_at: string; decided_at: string | null }[],
  runs: { status: string; refusal: string | null; usage_log_id: number | null; log_id: number | null; charged: number | null }[],
  now: Date): RoleEvaluation {
  const accepted = p.filter((x) => x.status === 'accepted').length;
  const edited = p.filter((x) => x.status === 'edited').length;
  const discarded = p.filter((x) => x.status === 'discarded').length;
  const decided = accepted + edited + discarded;
  const rated = decided >= MIN_DECISIONS;
  const rate = (n: number) => (rated ? Math.round((n / decided) * 1000) / 1000 : null);
  const hours = p
    .filter((x) => ['accepted', 'edited', 'discarded'].includes(x.status) && x.decided_at)
    .map((x) => (Date.parse(`${x.decided_at!.replace(' ', 'T')}Z`) - Date.parse(`${x.created_at.replace(' ', 'T')}Z`)) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b);
  const median = hours.length
    ? Math.round((hours.length % 2 ? hours[(hours.length - 1) / 2] : (hours[hours.length / 2 - 1] + hours[hours.length / 2]) / 2) * 10) / 10
    : null;
  const tooLong = sqlTime(new Date(now.getTime() - OPEN_TOO_LONG_DAYS * 86_400_000));
  const refusedBy = new Map<string, number>();
  for (const r of runs) if (r.status === 'refused') refusedBy.set(r.refusal ?? 'unknown', (refusedBy.get(r.refusal ?? 'unknown') ?? 0) + 1);
  // The window's charges, known only when every run's charge is.
  const unknown = runs.some((r) => r.usage_log_id != null && (r.log_id == null || r.charged == null));
  const spent = runs.reduce((s, r) => s + (r.charged == null ? 0 : Number(r.charged)), 0);
  const kept = accepted + edited;
  return {
    role_key,
    decided,
    rated,
    note: rated ? null : `Too few decisions to rate (${decided})`,
    acceptance: rate(kept),
    edit: rate(edited),
    discard: rate(discarded),
    median_decision_h: median,
    open_past_3d: p.filter((x) => x.status === 'proposed' && x.created_at <= tooLong).length,
    expired: runs.filter((r) => r.refusal === 'decision_expired').length,
    cost_per_accepted: unknown || kept === 0 ? { available: false } : { available: true, value_microusd: Math.round(spent / kept) },
    refused: [...refusedBy].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason)),
  };
}

const scopeWhere = (s: Scope) => (s.kind === 'company'
  ? { sql: "a.scope_kind = 'company' AND a.company_id = ?", id: s.id }
  : { sql: "a.scope_kind = 'project' AND a.project_id = ?", id: s.id });

/** TM14: the scope's roles over the last `days` days. */
export async function evaluateScope(env: Env, s: Scope, days: EvaluationDays, now = new Date()): Promise<{ days: EvaluationDays; roles: RoleEvaluation[] }> {
  const w = scopeWhere(s);
  const since = daysBefore(now, days);
  const roles = (await env.DB.prepare(
    `SELECT DISTINCT a.role_key FROM team_agents a WHERE ${w.sql} AND a.status != 'removed' ORDER BY a.role_key`,
  ).bind(w.id).all<{ role_key: string }>()).results ?? [];
  const proposals = (await env.DB.prepare(
    `SELECT a.role_key, p.status, p.created_at, p.decided_at
       FROM ai_rail_proposals p JOIN team_agents a ON a.id = p.agent_id
      WHERE ${w.sql} AND p.created_at >= ?
      ORDER BY p.id DESC LIMIT ?`,
  ).bind(w.id, since, BOARD_ROWS_MAX).all<{ role_key: string; status: string; created_at: string; decided_at: string | null }>()).results ?? [];
  const runs = (await env.DB.prepare(
    `SELECT a.role_key, r.status, r.refusal, r.usage_log_id, l.id AS log_id, l.charged_microusd AS charged
       FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id
       LEFT JOIN ai_usage_logs l ON l.id = r.usage_log_id
      WHERE ${w.sql} AND r.created_at >= ?
      ORDER BY r.id DESC LIMIT ?`,
  ).bind(w.id, since, BOARD_ROWS_MAX).all<{ role_key: string; status: string; refusal: string | null; usage_log_id: number | null; log_id: number | null; charged: number | null }>()).results ?? [];
  const keys = new Set<string>([...roles.map((r) => r.role_key), ...proposals.map((p) => p.role_key), ...runs.map((r) => r.role_key)]);
  return {
    days,
    roles: [...keys].sort().map((k) => rateRole(k, proposals.filter((p) => p.role_key === k), runs.filter((r) => r.role_key === k), now)),
  };
}

/** `?days=` as a window: absent is 30; anything but 30 or 90 is null (400 `invalid_days`). */
export function daysOf(v: string | undefined | null): EvaluationDays | null {
  if (v == null || v === '') return 30;
  return v === '30' ? 30 : v === '90' ? 90 : null;
}

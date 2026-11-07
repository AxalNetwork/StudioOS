/**
 * D4592 (#4592, R2-05) — fair eligible-work discovery extends D1528's agent
 * sweep. The caller is every five minutes (`UTC minute % 5 === 1`), not every
 * minute. A durable KV keyset cursor visits ready work in agent-id order;
 * resetting or losing it safely starts at the lowest id because this query
 * filters unready work before it applies its bound. Admission still belongs
 * to the scope runtime, which rechecks every safety and spending gate.
 *
 * D1528 (#3847, E3 of #3742) — the agent sweep, from the five-minute
 * dispatcher in `index.ts`: on `now.getUTCMinutes() % 5 === 1`, under the
 * existing `cron:queue:lease`, whenever team agents are on (D4387: the cap
 * resume below; before it, only while the engine was enabled), and NOT gated
 * on `hqCadences` (each deployment sweeps its own rows). No new cron line.
 *
 * It has two independent bounded lanes, in this order:
 *   1. at most `RESEND_MAX` (20) runs still `admitted` 5 minutes after
 *      admission, whose queue message was lost or never sent, are sent again
 *      (a redelivery is a no-op);
 *   2. at most `SWEEP_MAX` (60) new runs, from a bounded keyset scan of
 *      genuinely ready work. A per-scope candidate cap means one busy scope
 *      cannot consume every inspection in a rotation. With AGENT_AUTONOMY
 *      `self_start` and the engine `on`, each candidate is offered through
 *      its scope's object. With `manual` (the default) this step admits
 *      nothing.
 * Halted, it does neither.
 *
 * D4387 (#4387, E8): before either, and before the halt and engine checks,
 * it resumes the agents paused at their monthly cap in an earlier UTC month
 * (`resumeCapPauses`, at most 60 a sweep). That is a status change and admits
 * no run, so it is safe while halted or off; holding it back would leave a
 * cap-paused agent stuck for a month after the engine came back, and the
 * sponsor's own run (`agentRun`) does not need the engine at all. `index.ts`
 * therefore calls this sweep whenever team agents are on, and the engine's
 * own steps still stop at the checks below. A failed resume read is logged
 * and the sweep goes on. It never resumes any other pause reason.
 *
 * D1530 (#3849, E5): `sweepAgentDuties`, called from the same block, claims
 * the duties that are due (claim before act, `services/agents/duties.ts`).
 * Each claim makes a task for its agent and tells the sponsor; with
 * `self_start` and the engine `on` it also asks the scope's object to admit
 * that task. Halted or off, it claims nothing, so a due duty waits for the
 * engine rather than being skipped.
 */
import type { Env } from '../types';
import type { AgentRow } from '../services/agents/teams';
import { scopeOfRow } from './engine';
import { autonomy, engineMode, haltedAll, type AgentRuntime } from './runtime';
import { enqueueAgentRun } from './agentQueue';
import { defaultTokensLeft, sweepDuties, type DutyDeps } from '../services/agents/duties';
import { notify } from '../services/notify';
import { purgeExpired } from '../services/agents/memory';
import { resumeCapPauses } from '../services/agents/sponsor';

export const SWEEP_MAX = 60;
/** Resends are repair traffic; they never spend the new-work admission budget. */
export const RESEND_MAX = 20;
/** Bound database and runtime work even when every candidate is refused at admission. */
export const DISCOVERY_SCAN_MAX = 120;
/** One saturated scope never crowds all other scopes out of a scan. */
export const DISCOVERY_PER_SCOPE_MAX = 4;
export const RESEND_AFTER_MIN = 5;
const READY_CURSOR_KEY = 'agents:sweep:ready-cursor:v1';

export type SweepDeps = { enqueue: (env: Env, runUid: string) => Promise<void>; runtime: () => Promise<AgentRuntime> };

type ReadyCandidate = AgentRow & { task_id: number; task_created_at: string };
type SweepStats = { examined: number; eligible: number; refused: number; oldestEligibleAgeSeconds: number | null; cursorReset: boolean };

/** A malformed or unavailable cursor is equivalent to cursor loss: start a complete rotation safely at zero. */
async function readyCursor(env: Env): Promise<number> {
  try {
    const raw = await env.RATE_LIMITS.get(READY_CURSOR_KEY);
    return raw && /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : 0;
  } catch {
    console.warn('[agents] sweep_cursor_unreadable');
    return 0;
  }
}

async function saveReadyCursor(env: Env, agentId: number) {
  try { await env.RATE_LIMITS.put(READY_CURSOR_KEY, String(agentId)); }
  catch { console.warn('[agents] sweep_cursor_unwritable'); }
}

/**
 * One task per agent, already ready by the same dependency rule `isReady`
 * enforces later. This is discovery only: `AgentRuntime.admit` repeats every
 * authorization, halt, scope-cap, financial and single-flight check.
 */
async function readyAfter(env: Env, afterAgentId: number): Promise<ReadyCandidate[]> {
  const rows = await env.DB.prepare(
    `WITH task_ranked AS (
       SELECT a.*, t.id AS task_id, t.created_at AS task_created_at,
         ROW_NUMBER() OVER (PARTITION BY a.id ORDER BY t.priority DESC, t.id) AS task_rank
       FROM team_agents a
       JOIN scope_tasks t ON t.assignee_kind = 'agent' AND t.assignee_agent_id = a.id
       WHERE a.status = 'active' AND a.id > ?
         AND t.status = 'open' AND (t.board_column IS NULL OR t.board_column = 'ready')
         AND NOT EXISTS (
           SELECT 1 FROM agent_task_runs r
           WHERE r.agent_id = a.id AND r.status IN ('admitted', 'running')
         )
         AND NOT EXISTS (
           SELECT 1 FROM scope_task_deps d
           JOIN scope_tasks dep ON dep.id = d.depends_on_task_id
           WHERE d.task_id = t.id AND dep.status <> 'done'
         )
     ), one_per_agent AS (
       SELECT * FROM task_ranked WHERE task_rank = 1
     ), fairly_scoped AS (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY scope_kind, IFNULL(company_id, 0), IFNULL(project_id, 0)
         ORDER BY id
       ) AS scope_rank
       FROM one_per_agent
     )
     SELECT * FROM fairly_scoped WHERE scope_rank <= ? ORDER BY id LIMIT ?`,
  ).bind(afterAgentId, DISCOVERY_PER_SCOPE_MAX, DISCOVERY_SCAN_MAX).all<ReadyCandidate>();
  return rows.results ?? [];
}

/**
 * Resume after the cursor, wrapping only after it reaches the end. A lost KV
 * value merely begins a new rotation; because readiness is in SQL, a prefix
 * of blocked agents cannot hide ready work beyond it.
 */
async function readyCandidates(env: Env): Promise<{ candidates: ReadyCandidate[]; wrapped: boolean }> {
  const cursor = await readyCursor(env);
  const later = await readyAfter(env, cursor);
  if (later.length || cursor === 0) return { candidates: later, wrapped: false };
  return { candidates: await readyAfter(env, 0), wrapped: true };
}

async function recordSweepMetrics(env: Env, now: Date, out: { resent: number; admitted: number; cap_resumed: number }, stats: SweepStats) {
  const values: Array<[string, number]> = [
    ['agent_sweep_candidates_examined', stats.examined],
    ['agent_sweep_eligible', stats.eligible],
    ['agent_sweep_admitted', out.admitted],
    ['agent_sweep_refused', stats.refused],
    ['agent_sweep_resent', out.resent],
  ];
  if (stats.oldestEligibleAgeSeconds != null) values.push(['agent_sweep_oldest_eligible_age_seconds', stats.oldestEligibleAgeSeconds]);
  // Low-cardinality labels only: no tenant, task, agent, prompt or output is telemetry.
  const labels = JSON.stringify({ cadence_minutes: 5, cursor_reset: stats.cursorReset });
  try {
    await env.DB.batch(values.map(([name, value]) => env.DB.prepare(
      'INSERT INTO system_metrics (timestamp, metric_name, value, labels) VALUES (?, ?, ?, ?)',
    ).bind(now.toISOString().slice(0, 19).replace('T', ' '), name, value, labels)));
  } catch { console.warn('[agents] sweep_metrics_unreadable'); }
}

const sqlTime = (value: string): number | null => {
  const ms = Date.parse(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  return Number.isFinite(ms) ? ms : null;
};

export async function sweepAgents(env: Env, now: Date, deps?: Partial<SweepDeps>): Promise<{ resent: number; admitted: number; cap_resumed: number }> {
  const out = { resent: 0, admitted: 0, cap_resumed: 0 };
  const stats: SweepStats = { examined: 0, eligible: 0, refused: 0, oldestEligibleAgeSeconds: null, cursorReset: false };
  const finish = async () => { await recordSweepMetrics(env, now, out, stats); return out; };
  try { out.cap_resumed = await resumeCapPauses(env, now); } catch { console.warn('[agents] cap_resume_failed'); }
  if (await haltedAll(env)) return finish();
  const mode = await engineMode(env);
  if (mode === 'off') return finish();
  const enqueue = deps?.enqueue ?? enqueueAgentRun;
  const before = new Date(now.getTime() - RESEND_AFTER_MIN * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  const stale = (await env.DB.prepare(
    "SELECT uid FROM agent_task_runs WHERE status = 'admitted' AND created_at <= ? ORDER BY id LIMIT ?",
  ).bind(before, RESEND_MAX).all<{ uid: string }>()).results ?? [];
  for (const r of stale) {
    try { await enqueue(env, r.uid); out.resent += 1; } catch { console.warn('[agents] sweep_enqueue_failed'); }
  }
  if (autonomy(env) === 'manual' || mode !== 'on') return finish();
  let budget = SWEEP_MAX;
  const rt = deps?.runtime ? await deps.runtime() : await (await import('./runtime')).agentRuntime(env);
  const discovery = await readyCandidates(env);
  const candidates = discovery.candidates;
  stats.cursorReset = discovery.wrapped;
  stats.eligible = candidates.length;
  const ages = candidates.map((c) => sqlTime(c.task_created_at)).filter((v): v is number => v != null);
  if (ages.length) stats.oldestEligibleAgeSeconds = Math.max(0, Math.floor((now.getTime() - Math.min(...ages)) / 1000));
  let lastExamined: number | null = null;
  for (const a of candidates) {
    if (budget <= 0) break;
    stats.examined += 1;
    lastExamined = a.id;
    const r = await rt.admit(scopeOfRow(a), { agentId: a.id, taskId: a.task_id, by: null, source: 'sweep' });
    if (r.ok) out.admitted += 1;
    else stats.refused += 1;
    if (r.ok) budget -= 1;
  }
  if (lastExamined != null) await saveReadyCursor(env, lastExamined);
  return finish();
}

/** Claim the due duties. Off or halted: nothing is claimed. */
export async function sweepAgentDuties(env: Env, now: Date, deps?: Partial<DutyDeps> & { runtime?: () => Promise<AgentRuntime> }) {
  // The retention (Q6 A) applies even while halted: it only forgets.
  try { await purgeExpired(env, now); } catch { console.warn('[agents] purge_failed'); }
  if (await haltedAll(env)) return null;
  const mode = await engineMode(env);
  if (mode === 'off') return null;
  const selfStart = autonomy(env) === 'self_start' && mode === 'on';
  const rt = async () => (deps?.runtime ? deps.runtime() : (await import('./runtime')).agentRuntime(env));
  return sweepDuties(env, now, {
    tokensLeft: deps?.tokensLeft ?? defaultTokensLeft,
    admit: deps?.admit !== undefined ? deps.admit : selfStart
      ? async (_env, a, task) => { await (await rt()).admit(scopeOfRow(a), { agentId: a.id, taskId: task.id, by: null, source: 'duty' }); }
      : null,
    tell: deps?.tell ?? (async (e, a, task) => {
      await notify(e, {
        userId: a.sponsor_user_id, type: 'agent_duty', channels: ['in_app'], category: 'proactive_nudges', link: null,
        title: 'A duty made a task',
        body: `A duty made a task: "${task.title.slice(0, 120)}". Press Start when you want the agent to draft it.`,
      });
    }),
  });
}

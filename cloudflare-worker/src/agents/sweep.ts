/**
 * D1528 (#3847, E3 of #3742) — the agent sweep, from the every-minute
 * dispatcher in `index.ts`: on `now.getUTCMinutes() % 5 === 1`, under the
 * existing `cron:queue:lease`, whenever team agents are on (D4387: the cap
 * resume below; before it, only while the engine was enabled), and NOT gated
 * on `hqCadences` (each deployment sweeps its own rows). No new cron line.
 *
 * It admits at most `SWEEP_MAX` (60) runs a minute, in this order:
 *   1. a run still `admitted` 5 minutes after admission, whose queue message
 *      was lost or never sent, is sent again (a redelivery is a no-op);
 *   2. with AGENT_AUTONOMY `self_start` and the engine `on`, each active
 *      agent with no live run is offered its next ready task through its
 *      scope's object. With `manual` (the default) this step admits nothing.
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
import { depsOf, isReady, type TaskRow } from '../services/agents/tasks';
import { scopeOfRow } from './engine';
import { autonomy, engineMode, haltedAll, type AgentRuntime } from './runtime';
import { enqueueAgentRun } from './agentQueue';
import { defaultTokensLeft, sweepDuties, type DutyDeps } from '../services/agents/duties';
import { notify } from '../services/notify';
import { purgeExpired } from '../services/agents/memory';
import { resumeCapPauses } from '../services/agents/sponsor';

export const SWEEP_MAX = 60;
export const RESEND_AFTER_MIN = 5;

export type SweepDeps = { enqueue: (env: Env, runUid: string) => Promise<void>; runtime: () => Promise<AgentRuntime> };

export async function sweepAgents(env: Env, now: Date, deps?: Partial<SweepDeps>): Promise<{ resent: number; admitted: number; cap_resumed: number }> {
  const out = { resent: 0, admitted: 0, cap_resumed: 0 };
  try { out.cap_resumed = await resumeCapPauses(env, now); } catch { console.warn('[agents] cap_resume_failed'); }
  if (await haltedAll(env)) return out;
  const mode = await engineMode(env);
  if (mode === 'off') return out;
  const enqueue = deps?.enqueue ?? enqueueAgentRun;
  const before = new Date(now.getTime() - RESEND_AFTER_MIN * 60_000).toISOString().slice(0, 19).replace('T', ' ');
  const stale = (await env.DB.prepare(
    "SELECT uid FROM agent_task_runs WHERE status = 'admitted' AND created_at <= ? ORDER BY id LIMIT ?",
  ).bind(before, SWEEP_MAX).all<{ uid: string }>()).results ?? [];
  for (const r of stale) {
    try { await enqueue(env, r.uid); out.resent += 1; } catch { console.warn('[agents] sweep_enqueue_failed'); }
  }
  if (autonomy(env) === 'manual' || mode !== 'on') return out;
  let budget = SWEEP_MAX - out.resent;
  if (budget <= 0) return out;
  const rt = deps?.runtime ? await deps.runtime() : await (await import('./runtime')).agentRuntime(env);
  const agents = (await env.DB.prepare(
    `SELECT a.* FROM team_agents a
      WHERE a.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM agent_task_runs r WHERE r.agent_id = a.id AND r.status IN ('admitted', 'running'))
      ORDER BY a.id LIMIT ?`,
  ).bind(SWEEP_MAX).all<AgentRow>()).results ?? [];
  for (const a of agents) {
    if (budget <= 0) break;
    const tasks = (await env.DB.prepare(
      "SELECT * FROM scope_tasks WHERE assignee_kind = 'agent' AND assignee_agent_id = ? AND status = 'open' ORDER BY priority DESC, id LIMIT 20",
    ).bind(a.id).all<TaskRow>()).results ?? [];
    const deps2 = await depsOf(env, tasks.map((t) => t.id));
    const next = tasks.find((t) => isReady(t, deps2.get(t.id) ?? []));
    if (!next) continue;
    const r = await rt.admit(scopeOfRow(a), { agentId: a.id, taskId: next.id, by: null, source: 'sweep' });
    budget -= 1;
    if (r.ok) out.admitted += 1;
  }
  return out;
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

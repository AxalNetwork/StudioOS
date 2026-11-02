/**
 * D1528 (#3847, E3 of #3742) — the agent sweep, from the every-minute
 * dispatcher in `index.ts`: on `now.getUTCMinutes() % 5 === 1`, under the
 * existing `cron:queue:lease`, only while the engine is enabled, and NOT gated
 * on `hqCadences` (each deployment sweeps its own rows). No new cron line.
 *
 * It admits at most `SWEEP_MAX` (60) runs a minute, in this order:
 *   1. a run still `admitted` 5 minutes after admission, whose queue message
 *      was lost or never sent, is sent again (a redelivery is a no-op);
 *   2. with AGENT_AUTONOMY `self_start` and the engine `on`, each active
 *      agent with no live run is offered its next ready task through its
 *      scope's object. With `manual` (the default) this step admits nothing.
 * Halted, it does neither.
 */
import type { Env } from '../types';
import type { AgentRow } from '../services/agents/teams';
import { depsOf, isReady, type TaskRow } from '../services/agents/tasks';
import { scopeOfRow } from './engine';
import { autonomy, engineMode, haltedAll, type AgentRuntime } from './runtime';
import { enqueueAgentRun } from './agentQueue';

export const SWEEP_MAX = 60;
export const RESEND_AFTER_MIN = 5;

export type SweepDeps = { enqueue: (env: Env, runUid: string) => Promise<void>; runtime: () => Promise<AgentRuntime> };

export async function sweepAgents(env: Env, now: Date, deps?: Partial<SweepDeps>): Promise<{ resent: number; admitted: number }> {
  const out = { resent: 0, admitted: 0 };
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

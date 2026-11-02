/**
 * D1528 (#3847, E3 of #3742) — the product amendment (owner, #3742 comment
 * 6543010158): removing an agent, hard-deleting a project or a company, and
 * deleting an account clear the scope object's state and terminate any
 * Workflow instance waiting on it.
 *
 *   eraseAgentRuntime    the agent's runs end, its timers go; an object left
 *                        holding nothing is emptied.       (team_agents DELETE)
 *   eraseScopeRuntime    every run of the scope ends; the object is emptied.
 *                        (projectTrash's hard delete; a company's when one exists)
 *   eraseAccountRuntime  every agent the account sponsors, as above.
 *                        (the manual erasure of a data-subject request, D168)
 *
 * Each is best effort toward the deletion that called it: a failure is logged
 * as a code and never stops the deletion. No D1 row is deleted here; the
 * caller's own deletion and migration 728's cascades do that.
 *
 * WITH THE ENGINE OFF, a deletion reaches the runtime only when D1 shows it has
 * something there (an open run or an active duty), so a deployment that never
 * turned the engine on behaves exactly as before.
 */
import type { Env } from '../types';
import type { AgentRow } from '../services/agents/teams';
import { scopeOfRow } from './engine';
import { agentRuntime, engineVar, type AgentRuntime, type ScopeRef } from './runtime';

type Rt = () => Promise<AgentRuntime>;

/** True when D1 shows the runtime holds something for these agents. A read that fails answers true. */
async function hasState(env: Env, where: { agentId: number } | { scope: ScopeRef }): Promise<boolean> {
  try {
    const row = 'agentId' in where
      ? await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM agent_task_runs WHERE agent_id = ? AND status IN ('admitted', 'running', 'waiting_decision'))
              + (SELECT COUNT(*) FROM agent_duties WHERE agent_id = ? AND status = 'active') AS n`,
      ).bind(where.agentId, where.agentId).first<{ n: number }>()
      : await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id
                  WHERE a.scope_kind = ? AND IFNULL(a.company_id, 0) = ? AND IFNULL(a.project_id, 0) = ?
                    AND r.status IN ('admitted', 'running', 'waiting_decision'))
              + (SELECT COUNT(*) FROM agent_duties d JOIN team_agents a ON a.id = d.agent_id
                  WHERE a.scope_kind = ? AND IFNULL(a.company_id, 0) = ? AND IFNULL(a.project_id, 0) = ? AND d.status = 'active') AS n`,
      ).bind(...binds(where.scope), ...binds(where.scope)).first<{ n: number }>();
    return Number(row?.n ?? 0) > 0;
  } catch {
    return true;
  }
}
const binds = (s: ScopeRef): [string, number, number] => [s.kind, s.kind === 'company' ? s.id : 0, s.kind === 'project' ? s.id : 0];

export async function eraseAgentRuntime(env: Env, a: Pick<AgentRow, 'id' | 'scope_kind' | 'company_id' | 'project_id'>, rt: Rt = () => agentRuntime(env)) {
  try {
    if (engineVar(env) === 'off' && !(await hasState(env, { agentId: a.id }))) return;
    await (await rt()).erase(scopeOfRow(a), a.id);
  } catch { console.warn('[agents] erase_agent_failed'); }
}

export async function eraseScopeRuntime(env: Env, scope: ScopeRef, rt: Rt = () => agentRuntime(env)) {
  try {
    if (engineVar(env) === 'off' && !(await hasState(env, { scope }))) return;
    await (await rt()).erase(scope, null);
  } catch { console.warn('[agents] erase_scope_failed'); }
}

export async function eraseAccountRuntime(env: Env, userId: number, rt: Rt = () => agentRuntime(env)) {
  let agents: AgentRow[] = [];
  try {
    agents = (await env.DB.prepare('SELECT * FROM team_agents WHERE sponsor_user_id = ?').bind(userId).all<AgentRow>()).results ?? [];
  } catch { console.warn('[agents] erase_account_unreadable'); return; }
  for (const a of agents) await eraseAgentRuntime(env, a, rt);
}

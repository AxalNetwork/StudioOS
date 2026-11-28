/**
 * D5586 part 4 (#5586): recorders for the capacity read model's `not_recorded` signals, from records the Worker already
 * keeps. Read-only: nothing here writes, and each reader is one statement bound to the venture's company.
 *
 *   registered_agents     `team_agents` (#3742): the company's agents and its projects' agents that are not removed.
 *                         A registered agent holds no capacity (D5586 §2); this is the count the read model holds apart.
 *   image_model_capacity  `ai_usage_logs` (the AI router's one row per call): calls by those agents to an image (draw)
 *                         model since `sinceIso`, how many every model failed (`all_models_failed`), how many a budget
 *                         refused and how many fell back. A call made by a person, not an agent, carries no company and
 *                         is not counted, so the figure is the venture's agents' image calls only (`basis`).
 *
 * Still `not_recorded`, because no table holds them: GitHub PR/CI wait, preview transcoding, egress, and the CI
 * minutes, Stream output, egress and storage GB-month cost categories (D5586-p4 §4).
 *
 * Both answer `unavailable` when their statement fails, never 0. A rate over no calls is `not_recorded`.
 */
import type { Env } from '../../types';
import type { Scope } from '../workGraphContracts';
import { MODEL_CONNECTIONS } from '../ai/moduleConnections';
import { NOT_RECORDED, type ImageModelCapacity, type Signal } from './swarmCapacity';

/** The image models: every catalogued model whose operation is `draw`. */
export const IMAGE_MODELS: readonly string[] = Object.freeze(Object.entries(MODEL_CONNECTIONS)
  .filter(([, v]) => (v as { operation?: string })?.operation === 'draw').map(([k]) => k).sort());

export type RegisteredAgents = { registered: number; active: number; paused: number };

const n = (v: unknown) => Number(v ?? 0);
async function signal<T>(read: () => Promise<T>): Promise<Signal<T>> {
  try { return await read(); } catch { return 'unavailable'; }
}
export async function readRegisteredAgents(env: Pick<Env, 'DB'>, scope: Scope): Promise<Signal<RegisteredAgents>> {
  return signal(async () => {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS registered, SUM(status = 'active') AS active, SUM(status = 'paused') AS paused
        FROM (SELECT id, status FROM team_agents
               WHERE status <> 'removed'
                 AND ((scope_kind = 'company' AND company_id = ?) OR (scope_kind = 'project' AND project_id IN (SELECT id FROM projects WHERE company_id = ?))))`)
      .bind(scope.companyId, scope.companyId).first<{ registered: number; active: number; paused: number }>();
    return { registered: n(r?.registered), active: n(r?.active), paused: n(r?.paused) };
  });
}

export async function readImageModelCapacity(env: Pick<Env, 'DB'>, scope: Scope, sinceIso: string): Promise<Signal<ImageModelCapacity>> {
  return signal(async () => {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS calls, SUM(refusal = 'all_models_failed') AS failed,
              SUM(refusal LIKE 'budget%') AS budget, SUM(fallback_used <> 0) AS fallback
         FROM ai_usage_logs
        WHERE agent_id IN (SELECT id FROM team_agents
                            WHERE (scope_kind = 'company' AND company_id = ?)
                               OR (scope_kind = 'project' AND project_id IN (SELECT id FROM projects WHERE company_id = ?)))
          AND model IN (SELECT value FROM json_each(?))
          AND datetime(created_at) >= datetime(?)`)
      .bind(scope.companyId, scope.companyId, JSON.stringify(IMAGE_MODELS), sinceIso).first<{ calls: number; failed: number; budget: number; fallback: number }>();
    const calls = n(r?.calls), failed = n(r?.failed);
    return { basis: 'venture_agents' as const, calls, all_models_failed: failed, budget_refused: n(r?.budget), fallback_used: n(r?.fallback),
      failure_rate: calls > 0 ? failed / calls : NOT_RECORDED };
  });
}

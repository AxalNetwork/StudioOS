/**
 * D1067 (#2937, part 4 of #2426) — what a Verdict does to the build plan, the
 * plan's pause and resume, and "new evidence since the plan" (VB13, VB14).
 *
 *   - A given Proceed or Pivot prepares a plan for the decision's scope, by
 *     rule (D1065's `preparePlan`, trigger `decision`): no model, no cost. A
 *     Proceed on one hypothesis plans that claim; a Pivot plans a prototype
 *     test of the new claim. A newer given decision supersedes the current
 *     plan, paused or not: undecided proposals withdraw, decided items stay.
 *   - A withheld decision prepares nothing. The founder may still press
 *     "Plan anyway", which is D1065's own `POST /api/cycles/build/plan`.
 *   - A given Stop pauses the open plan: on the venture, every scope's; on one
 *     hypothesis, that scope's. Accepted items stay. A paused plan prepares
 *     nothing and sends nothing (D1068 reads `status`).
 *   - `POST /resume` reopens a plan the founder paused, never one a Stop
 *     paused: "Record a new decision to resume."
 *
 * The trigger runs after the decision has committed; a failure is logged as
 * an outcome and never fails the decision.
 */
import type { Env } from '../types';
import { latestDecision, type Scope } from './verdict';
import { BuildPlanError, SEEN_KEY, currentPlan, evidenceHash, preparePlan, readEvidenceSeen, type SeenItem } from './buildPlanner';

/** The plan scope a decision's scope plans: the venture, or `h-<id>`. */
export const planScopeOf = (scope: Scope): string => (scope === 'venture' ? 'venture' : `h-${scope}`);

export type DecisionOutcome = 'prepared' | 'paused' | 'withheld' | 'no_evidence' | 'failed';

/** What one recorded decision does to the plan. Never throws. */
export async function onDecision(env: Env, projectId: number, userId: number,
  decision: { kind: 'proceed' | 'pivot' | 'stop'; state: 'given' | 'withheld'; for: Scope }): Promise<DecisionOutcome> {
  if (decision.state !== 'given') return 'withheld';
  try {
    if (decision.kind === 'stop') {
      await pauseOnStop(env, projectId, decision.for);
      return 'paused';
    }
    await preparePlan(env, projectId, userId, planScopeOf(decision.for), 'decision');
    return 'prepared';
  } catch (e) {
    if (e instanceof BuildPlanError && e.code === 'no_evidence') return 'no_evidence';
    console.warn(`[build-plan] decision trigger: ${e instanceof BuildPlanError ? e.code : 'store unavailable'}`);
    return 'failed';
  }
}

/** A venture Stop pauses every open plan of the venture; a hypothesis Stop, that scope's. */
async function pauseOnStop(env: Env, projectId: number, scope: Scope) {
  await env.DB.prepare(`UPDATE build_plans SET status = 'paused' WHERE project_id = ? AND status IN ('draft', 'open') AND (? = 1 OR scope = ?)`)
    .bind(projectId, scope === 'venture' ? 1 : 0, planScopeOf(scope)).run();
}

/** True when a given Stop is the latest decision for the venture or for this scope. */
async function stopped(env: Env, projectId: number, scope: string): Promise<boolean> {
  const isStop = (d: { decision: string; state: string } | null) => Boolean(d && d.state === 'given' && d.decision === 'stop');
  if (isStop(await latestDecision(env, projectId, 'venture'))) return true;
  return scope !== 'venture' && isStop(await latestDecision(env, projectId, Number(scope.slice(2))));
}

/** "Pause the plan": the current plan stops proposing and sending. Accepted items stay. */
export async function pausePlan(env: Env, projectId: number, scope: string) {
  const plan = await currentPlan(env, projectId, scope);
  if (!plan) throw new BuildPlanError('no_evidence', 404);
  if (plan.status !== 'paused') {
    await env.DB.prepare(`UPDATE build_plans SET status = 'paused' WHERE id = ? AND project_id = ? AND status IN ('draft', 'open')`).bind(plan.id, projectId).run();
  }
  return { status: 'paused' as const };
}

/**
 * Reopens a paused plan: `open` once any item was decided, else `draft`.
 * Refused while a given Stop stands, which only a new decision lifts.
 */
export async function resumePlan(env: Env, projectId: number, scope: string) {
  const plan = await currentPlan(env, projectId, scope);
  if (!plan) throw new BuildPlanError('no_evidence', 404);
  if (plan.status !== 'paused') return { status: plan.status };
  if (await stopped(env, projectId, scope)) throw new BuildPlanError('plan_stopped');
  const decided = await env.DB.prepare(`SELECT 1 AS d FROM build_plan_items i JOIN ai_rail_proposals q ON q.uid = i.proposal_uid
    WHERE i.plan_id = ? AND q.status IN ('accepted', 'edited', 'discarded') LIMIT 1`).bind(plan.id).first<{ d: number }>();
  const status = decided ? 'open' : 'draft';
  await env.DB.prepare(`UPDATE build_plans SET status = ? WHERE id = ? AND project_id = ? AND status = 'paused'`).bind(status, plan.id, projectId).run();
  return { status };
}

/**
 * VB13: whether today's evidence is the evidence the plan was prepared on, by
 * its hash, and how many pieces are new since, how many of them contradict.
 * A plan prepared before D1067 kept no list of its evidence, so its counts
 * are null ("Not recorded"), never 0; its hash still answers `changed`.
 */
export async function evidenceSince(env: Env, projectId: number, scope: string) {
  const plan = await currentPlan(env, projectId, scope);
  if (!plan) return { plan: null, status: null, changed: null, new: null, contradicting: null };
  const { evidence, seen } = await readEvidenceSeen(env, projectId, scope);
  const changed = (await evidenceHash(evidence)) !== plan.evidence_hash;
  let kept: SeenItem[] | null = null;
  try {
    const list = JSON.parse(plan.brief_json || '{}')?.[SEEN_KEY];
    if (Array.isArray(list)) kept = list.filter((x: any) => x && typeof x.id === 'string');
  } catch { kept = null; }
  if (!kept) return { plan: plan.uid, status: plan.status, changed, new: null, contradicting: null };
  const before = new Set(kept.map((x) => x.id));
  const fresh = seen.filter((x) => !before.has(x.id));
  return {
    plan: plan.uid, status: plan.status, changed,
    new: fresh.length, contradicting: fresh.filter((x) => x.direction === 'contradicts').length,
  };
}

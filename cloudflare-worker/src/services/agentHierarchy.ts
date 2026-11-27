/**
 * D8081 (#8081) — a task planned by one agent, worked by others and reviewed by a third, as a handoff tree
 * no deeper than three (D1530's `agent_handoffs.depth`). `services/agents/handoffs.ts` calls these rules when
 * a run asks for a handoff (`proposeHandoff`) and again when a person accepts it (`decideHandoff`); each
 * refusal is a `refused` step of its chain with its own code, like D1530's.
 *
 * ROLES (`agent_handoffs.hierarchy_role`). The step asks its target to be a planner, a worker or a reviewer.
 * A step written before D8081 has none and reads as a worker. The task a person started (no handoff above
 * it) is the root, and plans.
 *   `planner_not_allowed`   only the root or a planner may hand off to a planner: a worker or a reviewer may not.
 *   `too_many_workers`      a planner's task hands off at most N workers (proposed or accepted), N from
 *                           `agent_scope_settings.planner_max_workers` (NULL: 3).
 *   `review_target_missing` a reviewer step names the run it reviews (`reviews_run_uid`), and that run exists.
 *   `self_review`           a reviewer step whose target agent is the reviewed run's agent: the reviewer is
 *                           never the author. Checked again at Accept, where the target is read again.
 *
 * BUDGETS (D8071's contract, no second ledger). A child's share is its task's `budget_tokens_cap`. At Accept,
 * before the child's task exists, the parent reserves it:
 *   · the parent's cap is its task's token cap, else its agent's monthly token cap (D8071: a task's NULL
 *     cap is the agent's); both NULL is no cap, so the child has none either;
 *   · what is left is the cap less the parent task's tree (`taskTreeTokens`: its own settled tokens and
 *     every child's hold); the share is an equal part of it, keeping one part for the parent:
 *     left ÷ (worker slots left + 1) for a planner's worker, left ÷ 2 for any other step;
 *   · `agentBudgets.reserve(parent run, share)` must pass, so every other cap of the parent still holds;
 *   · a share under MIN_SHARE_TOKENS refuses `share_exhausted`.
 * A child over its share halts by D8071's own `task_tokens` check. When the child's task is done or
 * cancelled it holds only what it used, so the rest returns to the parent: derived, never written, so a
 * retried step or a second settle cannot return or charge twice.
 *
 * Bound SQL only. Codes in logs, never a title, a note or a prompt.
 */
import type { Env } from '../types';
import { agentCaps, reserve, taskTreeTokens, type BudgetRun, type Verdict } from './agentBudgets';

type DbEnv = Pick<Env, 'DB'>;

export const HIERARCHY_ROLES = ['planner', 'worker', 'reviewer'] as const;
export type HierarchyRole = (typeof HIERARCHY_ROLES)[number];
export const PLANNER_MAX_WORKERS_DEFAULT = 3;
export const MIN_SHARE_TOKENS = 1000;
const RUN_UID = /^[A-Za-z0-9-]{8,80}$/;

/** A step's role as stored; NULL (a step from before D8081) is a worker. */
export const roleOf = (r: string | null | undefined): HierarchyRole => (HIERARCHY_ROLES.includes(r as HierarchyRole) ? (r as HierarchyRole) : 'worker');
/** What the asking task is: the root (no handoff above it) plans; otherwise the role its own step gave it. */
export const taskRoleOf = (parent: { hierarchy_role: string | null } | null): HierarchyRole => (parent ? roleOf(parent.hierarchy_role) : 'planner');

/** The role and the reviewed run a handoff line asks for. A bad role or run uid is no handoff (null). */
export function askedRole(h: { role?: unknown; reviews?: unknown }): { role: HierarchyRole; reviews: string | null } | null {
  const role = h.role == null || h.role === '' ? 'worker' : h.role;
  if (!HIERARCHY_ROLES.includes(role as HierarchyRole)) return null;
  if (h.reviews != null && (typeof h.reviews !== 'string' || !RUN_UID.test(h.reviews))) return null;
  return { role: role as HierarchyRole, reviews: role === 'reviewer' && typeof h.reviews === 'string' ? h.reviews : null };
}

/** The pure role rule: may a task of `from` role hand off a step of `to` role? */
export function roleRefusal(from: HierarchyRole, to: HierarchyRole): 'planner_not_allowed' | null {
  return to === 'planner' && from !== 'planner' ? 'planner_not_allowed' : null;
}

type ScopeCols = { scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null };

/** N: how many workers one planner's task may hand off in this scope. */
export async function plannerMaxWorkers(env: DbEnv, s: ScopeCols): Promise<number> {
  try {
    const row = await env.DB.prepare(
      `SELECT planner_max_workers AS n FROM agent_scope_settings WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?`,
    ).bind(s.scope_kind, s.company_id ?? 0, s.project_id ?? 0).first<{ n: number | null }>();
    return row?.n != null ? Number(row.n) : PLANNER_MAX_WORKERS_DEFAULT;
  } catch {
    return PLANNER_MAX_WORKERS_DEFAULT;
  }
}

/** The worker steps a task has handed off and not lost (proposed or accepted). `except` leaves one step out. */
async function workersFrom(env: DbEnv, taskId: number, except: string | null = null): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM agent_handoffs WHERE from_task_id = ? AND IFNULL(hierarchy_role, 'worker') = 'worker'
        AND status IN ('proposed', 'accepted') AND uid IS NOT ?`,
  ).bind(taskId, except).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** The agent that made a run, or null when there is no such run. */
async function authorOf(env: DbEnv, runUid: string): Promise<number | null> {
  const r = await env.DB.prepare('SELECT agent_id FROM agent_task_runs WHERE uid = ?').bind(runUid).first<{ agent_id: number }>();
  return r ? Number(r.agent_id) : null;
}

export type RoleCheck = {
  from: ScopeCols; fromTaskId: number; fromRole: HierarchyRole; role: HierarchyRole; reviews: string | null;
  targetAgentId: number | null; self?: string | null;
};

/** The role rules, in order; the first that refuses gives the code, or null. `self` is the step's own uid at Accept. */
export async function checkRole(env: DbEnv, c: RoleCheck): Promise<string | null> {
  const byRole = roleRefusal(c.fromRole, c.role);
  if (byRole) return byRole;
  if (c.role === 'worker' && c.fromRole === 'planner') {
    if (await workersFrom(env, c.fromTaskId, c.self ?? null) >= await plannerMaxWorkers(env, c.from)) return 'too_many_workers';
  }
  if (c.role === 'reviewer') {
    if (!c.reviews) return 'review_target_missing';
    const author = await authorOf(env, c.reviews);
    if (author == null) return 'review_target_missing';
    if (c.targetAgentId != null && author === c.targetAgentId) return 'self_review';
  }
  return null;
}

export type Share = { ok: true; tokens: number | null } | { ok: false; code: 'share_exhausted' | Exclude<Verdict, { ok: true }>['code'] };

/** The parent's cap for its children: its task's token cap, else its agent's monthly cap; null is none. */
async function parentCap(env: DbEnv, agentId: number, taskId: number): Promise<number | null> {
  const t = await env.DB.prepare('SELECT budget_tokens_cap FROM scope_tasks WHERE id = ?').bind(taskId).first<{ budget_tokens_cap: number | null }>();
  if (t?.budget_tokens_cap != null) return Number(t.budget_tokens_cap);
  return (await agentCaps(env, agentId)).tokens_cap;
}

/** The parent's run for a step: the run that asked for it (`ho-<run uid>`). */
async function parentRunOf(env: DbEnv, handoffUid: string): Promise<BudgetRun | null> {
  const runUid = handoffUid.startsWith('ho-') ? handoffUid.slice(3) : '';
  if (!runUid) return null;
  return env.DB.prepare(
    `SELECT r.uid, r.agent_id, r.task_id, r.attempt, a.scope_kind, a.company_id, a.project_id
       FROM agent_task_runs r JOIN team_agents a ON a.id = r.agent_id WHERE r.uid = ?`,
  ).bind(runUid).first<BudgetRun>();
}

/**
 * The share the parent reserves for one child, before the child's task exists. Reads only: the share is
 * written as the child task's `budget_tokens_cap` by the caller, and `shareStillFits` checks it after.
 */
export async function reserveShare(env: DbEnv, h: { uid: string; from_agent_id: number; from_task_id: number | null; hierarchy_role: string | null }, fromRole: HierarchyRole, from: ScopeCols): Promise<Share> {
  if (h.from_task_id == null) return { ok: true, tokens: null };
  try {
    const cap = await parentCap(env, h.from_agent_id, h.from_task_id);
    if (cap == null) return { ok: true, tokens: null };
    const left = cap - await taskTreeTokens(env, h.from_task_id);
    const planned = roleOf(h.hierarchy_role) === 'worker' && fromRole === 'planner';
    const slots = planned ? Math.max(1, (await plannerMaxWorkers(env, from)) - (await acceptedWorkers(env, h.from_task_id))) : 1;
    const tokens = Math.floor(Math.max(0, left) / (slots + 1));
    if (tokens < MIN_SHARE_TOKENS) return { ok: false, code: 'share_exhausted' };
    const run = await parentRunOf(env, h.uid);
    if (run) {
      const v = await reserve(env, run, { tokens }, `share:${h.uid}`);
      if (!v.ok) return { ok: false, code: v.code };
    }
    return { ok: true, tokens };
  } catch {
    return { ok: false, code: 'budget_unreadable' };
  }
}

async function acceptedWorkers(env: DbEnv, taskId: number): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM agent_handoffs WHERE from_task_id = ? AND IFNULL(hierarchy_role, 'worker') = 'worker' AND status = 'accepted'`,
  ).bind(taskId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/**
 * After the child's task carries its share: the parent's tree still fits its cap. Two Accepts read the
 * same "left" at once; whichever sees the tree over the cap gives its step back (the caller cancels it).
 */
export async function shareStillFits(env: DbEnv, fromAgentId: number, fromTaskId: number): Promise<boolean> {
  const cap = await parentCap(env, fromAgentId, fromTaskId);
  return cap == null || await taskTreeTokens(env, fromTaskId) <= cap;
}

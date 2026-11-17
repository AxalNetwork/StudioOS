/**
 * D7075 (#7075, part of #7072) — recruits: a plan that names a role the team
 * has no agent for asks the team to add one.
 *
 * ON ACCEPT. `acceptPlan` adds, inside its one batch, a request per role the
 * plan names with no active agent in the scope (`recruitStatements`): the
 * scope, the role, the plan, the agent that drafted it, and the tasks waiting
 * on it. One open request per scope and role: a second plan that needs the
 * same role adds its tasks to the open request (the partial unique index).
 *
 * A PERSON DECIDES (owner decision D1). A manager of the team approves or
 * declines. Approving adds the agent through the ordinary add path
 * (`team_agents.ts` `addAgentAs`) with every check it makes, the approver as
 * the sponsor; then the waiting tasks the new agent may work on (its rule
 * book's modules) are assigned to it. Declining leaves them unassigned, with
 * the reason on each task's timeline. No agent adds an agent: a request is a
 * proposal, and nothing is created, granted or charged until a person approves.
 *
 * NEVER AN EMAIL, NEVER A NUMERIC USER ID. A person is `{ uid, name }`.
 */
import type { Env } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { moduleOf, roleOf } from './catalogue';
import { personaOf } from './personas';
import { scopeCols, type AgentRow, type Scope } from './teams';
import { agentFits } from './tasks';

export const DECLINE_REASON_MAX = 500;

export type RecruitRow = {
  id: number; uid: string; scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null;
  role_key: string; plan_proposal_uid: string; planner_agent_id: number | null; requested_by_user_id: number | null;
  status: 'open' | 'approved' | 'declined'; decided_by_user_id: number | null; decided_at: string | null;
  decline_reason: string | null; agent_id: number | null; created_at: string; updated_at: string;
};

const scopeArgs = (s: Scope) => { const [c, p] = scopeCols(s); return [s.kind, c ?? 0, p ?? 0] as const; };

/**
 * The statements `acceptPlan` adds to its batch for each item whose role has
 * no active agent in the scope. Every statement is gated on the plan's
 * private claim marker, as the tasks are, so a losing claim writes nothing.
 */
export function recruitStatements(env: Env, s: Scope, args: {
  proposalUid: string; marker: string; userId: number;
  missing: Array<{ role_key: string; taskUid: string }>;
}): D1PreparedStatement[] {
  const [companyId, projectId] = scopeCols(s);
  const out: D1PreparedStatement[] = [];
  const roles = [...new Set(args.missing.map((m) => m.role_key))];
  for (const role of roles) {
    out.push(env.DB.prepare(
      `INSERT OR IGNORE INTO agent_recruit_requests (uid, scope_kind, company_id, project_id, role_key, plan_proposal_uid, planner_agent_id, requested_by_user_id)
       SELECT ?, ?, ?, ?, ?, uid, agent_id, ? FROM ai_rail_proposals WHERE uid = ? AND decided_payload_json = ?`,
    ).bind(newUid(), s.kind, companyId, projectId, role, args.userId, args.proposalUid, args.marker));
  }
  for (const m of args.missing) {
    out.push(env.DB.prepare(
      `INSERT OR IGNORE INTO agent_recruit_tasks (request_id, task_id)
       SELECT r.id, t.id FROM agent_recruit_requests r, scope_tasks t
        WHERE r.status = 'open' AND r.scope_kind = ? AND IFNULL(r.company_id, 0) = ? AND IFNULL(r.project_id, 0) = ? AND r.role_key = ? AND t.uid = ?`,
    ).bind(s.kind, companyId ?? 0, projectId ?? 0, m.role_key, m.taskUid));
  }
  return out;
}

export async function recruitByUid(env: Env, uid: string): Promise<RecruitRow | null> {
  return env.DB.prepare('SELECT * FROM agent_recruit_requests WHERE uid = ?').bind(uid).first<RecruitRow>();
}

type TaskBrief = { id: number; uid: string; title: string; module: string | null; option: string | null; status: string; assignee_kind: string; assignee_agent_id: number | null };

async function tasksOf(env: Env, requestId: number): Promise<TaskBrief[]> {
  return (await env.DB.prepare(
    `SELECT t.id, t.uid, t.title, t.module, t.option, t.status, t.assignee_kind, t.assignee_agent_id
       FROM agent_recruit_tasks rt JOIN scope_tasks t ON t.id = rt.task_id WHERE rt.request_id = ? ORDER BY t.id`,
  ).bind(requestId).all<TaskBrief>()).results ?? [];
}

async function personOf(env: Env, userId: number | null): Promise<{ uid: string; name: string } | null> {
  if (userId == null) return null;
  const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(userId).first<{ uid: string | null; name: string | null }>();
  return u?.uid ? { uid: u.uid, name: u.name || 'A team member' } : null;
}

async function agentRef(env: Env, id: number | null) {
  if (id == null) return null;
  const a = await env.DB.prepare('SELECT uid, persona_key, role_key FROM team_agents WHERE id = ?').bind(id).first<Pick<AgentRow, 'uid' | 'persona_key' | 'role_key'>>();
  if (!a) return null;
  const p = personaOf(a.persona_key);
  return { uid: a.uid, persona: p ? { key: p.key, name: p.name } : null };
}

/** One request as the team reads it. */
export async function recruitDto(env: Env, r: RecruitRow) {
  const tasks = await tasksOf(env, r.id);
  const role = roleOf(r.role_key);
  return {
    uid: r.uid,
    role: { key: r.role_key, name: role?.name ?? r.role_key },
    status: r.status,
    plan: r.plan_proposal_uid,
    asked_by: await agentRef(env, r.planner_agent_id),
    requested_by: await personOf(env, r.requested_by_user_id),
    tasks: tasks.map((t) => ({ uid: t.uid, title: t.title, module: t.module, status: t.status })),
    modules: [...new Set(tasks.map((t) => t.module).filter((m): m is string => !!m))].map((k) => ({ key: k, label: moduleOf(k)?.label ?? k })),
    decided_by: await personOf(env, r.decided_by_user_id),
    decided_at: r.decided_at,
    decline_reason: r.decline_reason,
    agent: await agentRef(env, r.agent_id),
    created_at: r.created_at,
  };
}

export async function recruitsOf(env: Env, s: Scope, status: 'open' | 'all'): Promise<RecruitRow[]> {
  const rows = status === 'open'
    ? await env.DB.prepare(
      "SELECT * FROM agent_recruit_requests WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? AND status = 'open' ORDER BY id DESC LIMIT 100",
    ).bind(...scopeArgs(s)).all<RecruitRow>()
    : await env.DB.prepare(
      'SELECT * FROM agent_recruit_requests WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ? ORDER BY id DESC LIMIT 100',
    ).bind(...scopeArgs(s)).all<RecruitRow>();
  return rows.results ?? [];
}

export type RecruitRefusal = { ok: false; status: 400 | 404 | 409 | 503; code: string; message: string };

/**
 * After the add path created the agent: close the request (once) and assign
 * the waiting tasks that are still open, unassigned and in a module the new
 * agent's rule book lists. Returns the tasks it assigned.
 */
export async function settleApproved(env: Env, r: RecruitRow, agent: AgentRow, userId: number): Promise<{ ok: true; assigned: TaskBrief[]; left: TaskBrief[] } | RecruitRefusal> {
  const closed = await env.DB.prepare(
    "UPDATE agent_recruit_requests SET status = 'approved', agent_id = ?, decided_by_user_id = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'",
  ).bind(agent.id, userId, r.id).run();
  if (!Number(closed.meta?.changes ?? 0)) return { ok: false, status: 409, code: 'recruit_decided', message: 'This request was already approved or declined.' };
  const assigned: TaskBrief[] = [];
  const left: TaskBrief[] = [];
  for (const t of await tasksOf(env, r.id)) {
    const waiting = t.assignee_kind === 'none' && t.status === 'open';
    if (waiting && !(await agentFits(env, agent, t.module, null))) assigned.push(t);
    else left.push(t);
  }
  const statements: D1PreparedStatement[] = [];
  for (const t of assigned) {
    // Only a task still unassigned: a person may have taken it meanwhile.
    statements.push(env.DB.prepare(
      "UPDATE scope_tasks SET assignee_kind = 'agent', assignee_agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND assignee_kind = 'none' AND status = 'open'",
    ).bind(agent.id, t.id));
    statements.push(env.DB.prepare(
      "INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json) SELECT ?, ?, 'assigned', ? WHERE EXISTS (SELECT 1 FROM scope_tasks WHERE id = ? AND assignee_agent_id = ?)",
    ).bind(t.id, userId, JSON.stringify({ source: 'recruit', request: r.uid, agent: agent.uid }), t.id, agent.id));
  }
  if (!statements.length) return { ok: true, assigned, left };
  const results = await env.DB.batch(statements);
  // A task a person took meanwhile was not changed: it is left, not assigned.
  const took = assigned.filter((_, i) => Number(results[i * 2]?.meta?.changes ?? 0) === 1);
  return { ok: true, assigned: took, left: [...left, ...assigned.filter((t) => !took.includes(t))] };
}

/** Decline once: the tasks stay unassigned and each says why on its timeline. */
export async function declineRecruit(env: Env, r: RecruitRow, userId: number, reason: unknown): Promise<{ ok: true } | RecruitRefusal> {
  if (reason != null && (typeof reason !== 'string' || reason.trim().length > DECLINE_REASON_MAX)) {
    return { ok: false, status: 400, code: 'invalid_reason', message: `A reason is at most ${DECLINE_REASON_MAX} characters.` };
  }
  const why = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
  const closed = await env.DB.prepare(
    "UPDATE agent_recruit_requests SET status = 'declined', decline_reason = ?, decided_by_user_id = ?, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'",
  ).bind(why, userId, r.id).run();
  if (!Number(closed.meta?.changes ?? 0)) return { ok: false, status: 409, code: 'recruit_decided', message: 'This request was already approved or declined.' };
  const tasks = await tasksOf(env, r.id);
  if (tasks.length) {
    await env.DB.batch(tasks.map((t) => env.DB.prepare(
      "INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json) VALUES (?, ?, 'updated', ?)",
    ).bind(t.id, userId, JSON.stringify({ source: 'recruit', request: r.uid, recruit_declined: true, role_key: r.role_key, reason: why }))));
  }
  return { ok: true };
}

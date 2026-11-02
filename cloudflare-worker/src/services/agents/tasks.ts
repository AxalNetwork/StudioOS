/**
 * D1529 (#3845, E1 of #3742) — a scope's tasks and what they wait on
 * (migration 727's `scope_tasks`, `scope_task_deps`, `scope_task_events`).
 *
 * A task belongs to one company or one project, may serve one of that scope's
 * goals, and is assigned to a person, a team agent (D1496) or no one:
 *  - an agent must be live in this scope (409 `agent_not_live`), the task's
 *    module must be in its rule book's `works_in` (422 `module_not_allowed`)
 *    and its option, when it has one, in `may_propose` (422 `option_not_allowed`);
 *  - a person must pass the scope's read gate (422 `assignee_not_member`).
 *    Inviting someone stays on the floor (`invite_person`): assigning never
 *    invites.
 *  - a company task may be about one of its projects (`context_project_id`,
 *    422 `project_not_in_company`).
 *
 * READY IS DERIVED: an open task whose every dependency is done. It is never
 * stored, so it cannot go stale.
 *
 * DEPENDENCIES stay in one scope (422 `cross_scope`) and never loop (422
 * `dependency_cycle`): a depth-first walk from each new dependency, bounded to
 * 200 tasks; a graph larger than that is refused (422 `too_many_dependencies`)
 * rather than half-checked.
 *
 * COST is per task through E3's `agent_task_runs.usage_log_id`. Until E3 no
 * run is recorded against a task, so `taskCosts` answers `{ available: false }`
 * for every task; a read that throws answers the same. It is never 0 for
 * unknown.
 *
 * Bound SQL only. No email in any answer.
 */
import type { Env, User } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { moduleOf, optionsIn } from './catalogue';
import { canRead, effectiveBook, scopeCols, scopeOfAgent, type AgentRow, type Scope, type Spend } from './teams';
import { text, type Refusal } from './goals';

export const TASK_KINDS = ['work', 'duty', 'handoff', 'review'] as const;
export const TASK_STATUSES = ['open', 'in_progress', 'waiting_decision', 'done', 'blocked', 'cancelled'] as const;
export const SOURCE_KINDS = ['manual', 'plan', 'duty', 'handoff', 'build_plan_item', 'lifecycle_check', 'one_next_thing'] as const;
export const DEP_WALK_MAX = 200;
export const DEPS_MAX = 50;
const TITLE_MAX = 200, DETAIL_MAX = 4000, REASON_MAX = 500, REF_MAX = 200;

export type TaskRow = {
  id: number; uid: string; scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null;
  goal_id: number | null; title: string; detail: string | null; module: string | null; option: string | null;
  context_project_id: number | null; kind: string; assignee_kind: 'person' | 'agent' | 'none';
  assignee_user_id: number | null; assignee_agent_id: number | null; status: string; blocked_reason: string | null;
  priority: number; due_at: string | null; attempts: number; source_kind: string; source_ref: string | null;
  created_by_user_id: number | null; created_by_agent_id: number | null; created_at: string; updated_at: string;
};

const no = (status: number, code: string, message: string): Refusal => ({ status, code, message });
const invalid = (message: string) => no(400, 'invalid_task', message);
const sameScope = (a: { scope_kind: string; company_id: number | null; project_id: number | null }, s: Scope) => {
  const [c, p] = scopeCols(s);
  return a.scope_kind === s.kind && (a.company_id ?? null) === c && (a.project_id ?? null) === p;
};

export type TaskWrite = Partial<Pick<TaskRow, 'goal_id' | 'title' | 'detail' | 'module' | 'option' | 'context_project_id' | 'kind'
  | 'assignee_kind' | 'assignee_user_id' | 'assignee_agent_id' | 'status' | 'blocked_reason' | 'priority' | 'due_at' | 'source_kind' | 'source_ref'>>;

/**
 * Read a task's body against its scope. `current` is the stored task on an
 * update, so a new assignee is checked against the module it will work in,
 * and a new module against the agent already assigned.
 */
export async function taskWrite(env: Env, s: Scope, b: Record<string, any>, current: TaskRow | null): Promise<{ ok: true; write: TaskWrite } | { ok: false; refusal: Refusal }> {
  const w: TaskWrite = {};
  const fail = (r: Refusal) => ({ ok: false as const, refusal: r });
  if (!current || 'title' in b) {
    const t = text(b.title, TITLE_MAX, true);
    if (!t.ok) return fail(invalid(`A task has a title of at most ${TITLE_MAX} characters.`));
    w.title = t.value!;
  }
  if ('detail' in b) {
    const t = text(b.detail, DETAIL_MAX);
    if (!t.ok) return fail(invalid(`The detail is at most ${DETAIL_MAX} characters.`));
    w.detail = t.value;
  }
  if ('kind' in b) {
    if (!(TASK_KINDS as readonly string[]).includes(b.kind)) return fail(invalid(`A task is one of ${TASK_KINDS.join(', ')}.`));
    w.kind = b.kind;
  }
  if ('source_kind' in b) {
    if (!(SOURCE_KINDS as readonly string[]).includes(b.source_kind)) return fail(invalid('That is not where a task can come from.'));
    w.source_kind = b.source_kind;
  }
  if ('source_ref' in b) {
    const t = text(b.source_ref, REF_MAX);
    if (!t.ok) return fail(invalid(`The source is at most ${REF_MAX} characters.`));
    w.source_ref = t.value;
  }
  if ('priority' in b) {
    if (!Number.isSafeInteger(b.priority) || b.priority < 0 || b.priority > 1000) return fail(invalid('The priority is a whole number from 0 to 1000.'));
    w.priority = b.priority;
  }
  if ('due_at' in b) {
    if (b.due_at !== null && !(typeof b.due_at === 'string' && b.due_at.length <= 40 && !Number.isNaN(Date.parse(b.due_at)))) {
      return fail(invalid('The due date is a date, such as 2027-03-31.'));
    }
    w.due_at = b.due_at;
  }
  const status = statusWrite(b);
  if (status && !status.ok) return fail(status.refusal);
  if (status) Object.assign(w, status.write);
  if ('goal_uid' in b) {
    if (b.goal_uid === null) w.goal_id = null;
    else {
      const g = typeof b.goal_uid === 'string'
        ? await env.DB.prepare('SELECT id, scope_kind, company_id, project_id FROM scope_goals WHERE uid = ?').bind(b.goal_uid)
          .first<{ id: number; scope_kind: string; company_id: number | null; project_id: number | null }>()
        : null;
      if (!g || !sameScope(g, s)) return fail(no(422, 'goal_not_in_scope', 'A task serves a goal of its own company or project.'));
      w.goal_id = g.id;
    }
  }
  if ('context_project_id' in b) {
    if (b.context_project_id === null) w.context_project_id = null;
    else {
      const p = s.kind === 'company' && Number.isSafeInteger(b.context_project_id)
        ? await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND company_id = ?').bind(b.context_project_id, s.id).first<{ id: number }>()
        : null;
      if (!p) return fail(no(422, 'project_not_in_company', 'A company task can be about one of the company’s own projects only.'));
      w.context_project_id = p.id;
    }
  }
  if ('module' in b) {
    if (b.module !== null && !(typeof b.module === 'string' && moduleOf(b.module))) return fail(invalid('That is not a module.'));
    w.module = b.module;
  }
  if ('option' in b) {
    const mod = 'module' in w ? w.module : current?.module ?? null;
    if (b.option !== null && !(typeof b.option === 'string' && mod && optionsIn(mod).includes(b.option))) {
      return fail(invalid('That option is not offered in the task’s module.'));
    }
    w.option = b.option;
  }
  if ('assignee' in b) {
    const a = await assigneeWrite(env, s, b.assignee);
    if (!a.ok) return fail(a.refusal);
    Object.assign(w, a.write);
  }
  // An agent works only where its rule book lets it: checked on the task as it will be.
  const agentId = 'assignee_kind' in w ? w.assignee_agent_id : current?.assignee_agent_id ?? null;
  if (agentId) {
    const agent = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(agentId).first<AgentRow>();
    const fit = await agentFits(env, agent!, 'module' in w ? w.module ?? null : current?.module ?? null, 'option' in w ? w.option ?? null : current?.option ?? null);
    if (fit) return fail(fit);
  }
  return { ok: true, write: w };
}

/** `status` and `blocked_reason`: what a person assignee may change. Null when neither was sent. */
export function statusWrite(b: Record<string, any>): { ok: true; write: TaskWrite } | { ok: false; refusal: Refusal } | null {
  if (!('status' in b) && !('blocked_reason' in b)) return null;
  const w: TaskWrite = {};
  if ('status' in b) {
    if (!(TASK_STATUSES as readonly string[]).includes(b.status)) return { ok: false, refusal: invalid(`A task is one of ${TASK_STATUSES.join(', ')}.`) };
    w.status = b.status;
    if (b.status !== 'blocked') w.blocked_reason = null;
  }
  if ('blocked_reason' in b) {
    const t = text(b.blocked_reason, REASON_MAX);
    if (!t.ok) return { ok: false, refusal: invalid(`The reason is at most ${REASON_MAX} characters.`) };
    w.blocked_reason = t.value;
  }
  return { ok: true, write: w };
}

async function assigneeWrite(env: Env, s: Scope, v: any): Promise<{ ok: true; write: TaskWrite } | { ok: false; refusal: Refusal }> {
  if (v === null || v?.kind === 'none') return { ok: true, write: { assignee_kind: 'none', assignee_user_id: null, assignee_agent_id: null } };
  if (v?.kind === 'person' && typeof v.uid === 'string') {
    const u = await env.DB.prepare('SELECT * FROM users WHERE uid = ? AND is_active = 1').bind(v.uid).first<User>();
    if (!u || !(await canRead(env, s, u))) {
      return { ok: false, refusal: no(422, 'assignee_not_member', 'Only someone on this team can be given a task. Invite them first.') };
    }
    return { ok: true, write: { assignee_kind: 'person', assignee_user_id: u.id, assignee_agent_id: null } };
  }
  if (v?.kind === 'agent' && typeof v.uid === 'string' && /^[a-f0-9]{32}$/.test(v.uid)) {
    const a = await env.DB.prepare('SELECT * FROM team_agents WHERE uid = ?').bind(v.uid).first<AgentRow>();
    if (!a || !sameScope(a, s) || a.status !== 'active') {
      return { ok: false, refusal: no(409, 'agent_not_live', 'That agent is not working on this team right now.') };
    }
    return { ok: true, write: { assignee_kind: 'agent', assignee_agent_id: a.id, assignee_user_id: null } };
  }
  return { ok: false, refusal: invalid('An assignee is a person or an agent, by uid, or none.') };
}

/** Why the agent may not take this module and option, or null when it may. */
export async function agentFits(env: Env, a: AgentRow, module: string | null, option: string | null): Promise<Refusal | null> {
  const own = await scopeOfAgent(env, a);
  if (!own) return no(409, 'agent_not_live', 'That agent is not working on this team right now.');
  const { rules } = await effectiveBook(env, own, a.role_key);
  if (!module || !rules.works_in.includes(module)) {
    return no(422, 'module_not_allowed', 'That agent does not work in this module. Its rule book lists where it works.');
  }
  if (option && !rules.may_propose.includes(option)) {
    return no(422, 'option_not_allowed', 'That agent may not propose this. Its rule book lists what it may propose.');
  }
  return null;
}

export async function insertTask(env: Env, s: Scope, w: TaskWrite, by: number): Promise<TaskRow> {
  const [companyId, projectId] = scopeCols(s);
  const uid = newUid();
  await env.DB.prepare(
    `INSERT INTO scope_tasks (uid, scope_kind, company_id, project_id, goal_id, title, detail, module, option, context_project_id, kind,
       assignee_kind, assignee_user_id, assignee_agent_id, status, blocked_reason, priority, due_at, source_kind, source_ref, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, s.kind, companyId, projectId, w.goal_id ?? null, w.title!, w.detail ?? null, w.module ?? null, w.option ?? null,
    w.context_project_id ?? null, w.kind ?? 'work', w.assignee_kind ?? 'none', w.assignee_user_id ?? null, w.assignee_agent_id ?? null,
    w.status ?? 'open', w.blocked_reason ?? null, w.priority ?? 0, w.due_at ?? null, w.source_kind ?? 'manual', w.source_ref ?? null, by).run();
  const t = (await taskByUid(env, uid))!;
  await taskEvent(env, t.id, by, 'created', { assignee_kind: t.assignee_kind });
  return t;
}

export async function updateTask(env: Env, t: TaskRow, w: TaskWrite, by: number): Promise<TaskRow> {
  const n = { ...t, ...w };
  await env.DB.prepare(
    `UPDATE scope_tasks SET goal_id = ?, title = ?, detail = ?, module = ?, option = ?, context_project_id = ?, kind = ?,
       assignee_kind = ?, assignee_user_id = ?, assignee_agent_id = ?, status = ?, blocked_reason = ?, priority = ?, due_at = ?,
       source_kind = ?, source_ref = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(n.goal_id, n.title, n.detail, n.module, n.option, n.context_project_id, n.kind, n.assignee_kind, n.assignee_user_id,
    n.assignee_agent_id, n.status, n.blocked_reason, n.priority, n.due_at, n.source_kind, n.source_ref, t.id).run();
  if ('assignee_kind' in w && (w.assignee_user_id !== t.assignee_user_id || w.assignee_agent_id !== t.assignee_agent_id)) {
    await taskEvent(env, t.id, by, 'assigned', { assignee_kind: n.assignee_kind });
  }
  if ('status' in w && w.status !== t.status) await taskEvent(env, t.id, by, 'status', { from: t.status, to: w.status });
  const rest = Object.keys(w).filter((k) => !['assignee_kind', 'assignee_user_id', 'assignee_agent_id', 'status', 'blocked_reason'].includes(k));
  if (rest.length) await taskEvent(env, t.id, by, 'updated', { fields: rest });
  return (await taskByUid(env, t.uid))!;
}

export async function taskEvent(env: Env, taskId: number, actor: number | null, kind: string, detail?: unknown) {
  await env.DB.prepare('INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json) VALUES (?, ?, ?, ?)')
    .bind(taskId, actor, kind, detail === undefined ? null : JSON.stringify(detail)).run();
}

export async function taskByUid(env: Env, uid: string): Promise<TaskRow | null> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM scope_tasks WHERE uid = ?').bind(uid).first<TaskRow>();
}

export type TaskFilter = { goalId?: number | null; assignee?: 'person' | 'agent' | 'none' | null; status?: string | null; module?: string | null };

export async function tasksOf(env: Env, s: Scope, f: TaskFilter = {}): Promise<TaskRow[]> {
  const [companyId, projectId] = scopeCols(s);
  // A null filter matches every row: `? IS NULL OR column = ?`, bound twice.
  const r = await env.DB.prepare(
    `SELECT * FROM scope_tasks
      WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?
        AND (? IS NULL OR goal_id = ?) AND (? IS NULL OR assignee_kind = ?)
        AND (? IS NULL OR status = ?) AND (? IS NULL OR module = ?)
      ORDER BY CASE status WHEN 'cancelled' THEN 2 WHEN 'done' THEN 1 ELSE 0 END, priority DESC, id
      LIMIT 500`,
  ).bind(s.kind, companyId ?? 0, projectId ?? 0, f.goalId ?? null, f.goalId ?? null, f.assignee ?? null, f.assignee ?? null,
    f.status ?? null, f.status ?? null, f.module ?? null, f.module ?? null).all<TaskRow>();
  return r.results ?? [];
}

/** Each task's dependencies, as `{ task_id, uid, status }` rows of the task depended on. */
export async function depsOf(env: Env, taskIds: number[]): Promise<Map<number, { uid: string; status: string }[]>> {
  const out = new Map<number, { uid: string; status: string }[]>();
  for (const id of taskIds) out.set(id, []);
  if (!taskIds.length) return out;
  // One bound statement per task: no SQL built from values.
  for (const id of taskIds) {
    const r = await env.DB.prepare(
      'SELECT t.uid, t.status FROM scope_task_deps d JOIN scope_tasks t ON t.id = d.depends_on_task_id WHERE d.task_id = ? ORDER BY t.id',
    ).bind(id).all<{ uid: string; status: string }>();
    out.set(id, r.results ?? []);
  }
  return out;
}

/**
 * Ready: open, every dependency done, and (D1614 W1, #3969) on a project board
 * only in its Ready column. A task with no board column (a company task, or one
 * from before migration 762) keeps E1's rule, so triage and backlog work is never
 * offered to an agent. Derived on every read, never stored.
 */
export const isReady = (t: Pick<TaskRow, 'status'> & { board_column?: string | null }, deps: { status: string }[]) =>
  t.status === 'open' && (t.board_column == null || t.board_column === 'ready') && deps.every((d) => d.status === 'done');

/**
 * Would `taskId` depending on `on` close a loop? A depth-first walk from each
 * of `on` along what it depends on, looking for `taskId`, visiting at most
 * `DEP_WALK_MAX` tasks. `'too_many'` when the walk would go further.
 */
export async function closesCycle(env: Env, taskId: number, on: number[]): Promise<boolean | 'too_many'> {
  const seen = new Set<number>();
  const stack = [...on];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    if (seen.size > DEP_WALK_MAX) return 'too_many';
    const r = await env.DB.prepare('SELECT depends_on_task_id AS id FROM scope_task_deps WHERE task_id = ?').bind(id).all<{ id: number }>();
    for (const row of r.results ?? []) stack.push(row.id);
  }
  return false;
}

/** Replace what a task depends on. Every uid must be a task of the same scope, and no loop may form. */
export async function setDeps(env: Env, t: TaskRow, uids: unknown, by: number): Promise<{ ok: true } | { ok: false; refusal: Refusal }> {
  if (!Array.isArray(uids) || uids.length > DEPS_MAX || !uids.every((u) => typeof u === 'string')) {
    return { ok: false, refusal: invalid(`depends_on is a list of at most ${DEPS_MAX} task uids.`) };
  }
  const ids: number[] = [];
  for (const uid of new Set(uids as string[])) {
    const d = await taskByUid(env, uid);
    if (!d || d.scope_kind !== t.scope_kind || d.company_id !== t.company_id || d.project_id !== t.project_id) {
      return { ok: false, refusal: no(422, 'cross_scope', 'A task can wait only on tasks of its own company or project.') };
    }
    if (d.id === t.id) return { ok: false, refusal: no(422, 'dependency_cycle', 'A task cannot wait on itself.') };
    ids.push(d.id);
  }
  const loop = await closesCycle(env, t.id, ids);
  if (loop === 'too_many') return { ok: false, refusal: no(422, 'too_many_dependencies', `These tasks wait on more than ${DEP_WALK_MAX} others; split the work first.`) };
  if (loop) return { ok: false, refusal: no(422, 'dependency_cycle', 'That would make these tasks wait on each other forever.') };
  await env.DB.prepare('DELETE FROM scope_task_deps WHERE task_id = ?').bind(t.id).run();
  for (const id of ids) await env.DB.prepare('INSERT INTO scope_task_deps (task_id, depends_on_task_id) VALUES (?, ?)').bind(t.id, id).run();
  await taskEvent(env, t.id, by, 'deps_set', { count: ids.length });
  return { ok: true };
}

/**
 * Each task's cost. E3 (`agent_task_runs.usage_log_id`) records a task's runs;
 * until it lands there is nothing to sum, so every task is `{ available: false }`.
 * `read` is E3's seam: a reader that throws, or that knows nothing of a task,
 * leaves it unknown. Never 0 for unknown.
 */
export type CostReader = (env: Env, taskIds: number[]) => Promise<Map<number, number>>;
export const NO_RUNS_RECORDED_YET: CostReader = async () => new Map();

export async function taskCosts(env: Env, taskIds: number[], read: CostReader = NO_RUNS_RECORDED_YET): Promise<Map<number, Spend>> {
  const out = new Map<number, Spend>(taskIds.map((id) => [id, { available: false }]));
  let known: Map<number, number>;
  try { known = await read(env, taskIds); } catch { return out; }
  for (const [id, v] of known) {
    if (out.has(id) && Number.isSafeInteger(v) && v >= 0) out.set(id, { available: true, value_microusd: v });
  }
  return out;
}

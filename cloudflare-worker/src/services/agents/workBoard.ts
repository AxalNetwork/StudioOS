/** D1614 / W1 (#3969). Project Work extends E1's scope_tasks; never a second store.
 * This service is prepared independently while the migration number and mount
 * are coordinated on the issue. Company tasks remain with E1.
 */
import type { Env, User } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { notify, type NotifyArgs } from '../notify';
import { canManage, canRead, scopeOfAgent, type Scope } from './teams';
import { closesCycle, DEPS_MAX, DEP_WALK_MAX, taskByUid, taskWrite, type TaskRow, type TaskWrite } from './tasks';

export const BOARD_COLUMNS = ['triage', 'backlog', 'ready', 'in_progress', 'in_review', 'done'] as const;
export const WORK_TYPES = ['task', 'bug', 'feature', 'research', 'compliance', 'chore'] as const;
export const CLOSE_REASONS = ['completed', 'not_planned', 'duplicate'] as const;
type Column = typeof BOARD_COLUMNS[number];
type Project = Extract<Scope, { kind: 'project' }>;
export type WorkTask = TaskRow & {
  board_column: Column | null; estimate_points: number | null; position: number; labels_json: string;
  close_reason: typeof CLOSE_REASONS[number] | null; duplicate_of: number | null; task_number: number | null;
  body: string | null; type: typeof WORK_TYPES[number]; parent_task_id: number | null;
  work_version: number; work_change_uid: string | null;
};
export type WorkActor = { user: User; agentId?: never } | { agentId: number; user?: never };
type Blocker = { uid: string; task_number: number | null; title: string };
export class WorkRefusal extends Error {
  status: number; code: string; blockers?: Blocker[];
  constructor(status: number, code: string, message: string, blockers?: Blocker[]) {
    super(message); this.status = status; this.code = code; this.blockers = blockers;
  }
}
const bad = (message: string): never => { throw new WorkRefusal(400, 'invalid_task', message); };
type ScopeRow = Pick<TaskRow,'id'|'scope_kind'|'project_id'|'company_id'>;
const same = (a: ScopeRow, b: ScopeRow) => a.scope_kind === b.scope_kind && a.project_id === b.project_id && a.company_id === b.company_id;
export const columnOf = (t: Pick<WorkTask, 'board_column' | 'status'>): Column => {
  // E1 statuses are recorded facts. Backlog is only the presentation of an
  // existing open/blocked task, not a claim that someone triaged it.
  const derived: Record<string, Column> = { open: 'backlog', blocked: 'backlog', in_progress: 'in_progress', waiting_decision: 'in_review', done: 'done', cancelled: 'done' };
  return t.board_column ?? derived[t.status];
};
const closed = (t: Pick<WorkTask, 'status'>) => t.status === 'done' || t.status === 'cancelled';
const reasonOf = (t: WorkTask) => t.close_reason ?? (t.status === 'done' ? 'completed' : null);

export async function blockersOf(env: Env, taskId: number): Promise<Blocker[]> {
  const r = await env.DB.prepare(
    `SELECT b.uid, b.task_number, b.title FROM scope_task_deps d JOIN scope_tasks b ON b.id = d.depends_on_task_id
     WHERE d.task_id = ? AND NOT (b.status = 'done' AND (b.close_reason = 'completed' OR b.close_reason IS NULL)) ORDER BY b.task_number, b.id`,
  ).bind(taskId).all<Blocker>();
  return r.results ?? [];
}
function blocked(blockers: Blocker[]): never {
  throw new WorkRefusal(409, 'task_blocked', 'Complete the blocking tasks before starting this work.', blockers);
}

/** Internal agent callers must pass a stored agent id, never request-body actor fields. */
export async function workPermission(env: Env, t: WorkTask, actor: WorkActor, fields: string[]) {
  const scope = await scopeOfAgent(env, t);
  if (!scope || scope.kind !== 'project') throw new WorkRefusal(404, 'not_found', 'There is no project task here.');
  if (actor.user) {
    if (!(await canRead(env, scope, actor.user))) throw new WorkRefusal(404, 'not_found', 'There is no such task.');
    if (!(await canManage(env, scope, actor.user))) {
      const own = t.assignee_kind === 'person' && t.assignee_user_id === actor.user.id;
      const movement = ['board_column', 'column', 'position', 'status', 'state', 'close_reason', 'duplicate_of', 'blocked_reason'];
      if (!own || fields.some((k) => !movement.includes(k))) throw new WorkRefusal(403, 'not_manager', 'Only the task’s assignee or a project editor can move it.');
    }
  } else {
    const a = await env.DB.prepare('SELECT id, scope_kind, project_id, status FROM team_agents WHERE id = ?')
      .bind(actor.agentId).first<{ id: number; scope_kind: string; project_id: number | null; status: string }>();
    if (!a || a.scope_kind !== 'project' || a.project_id !== t.project_id || a.status !== 'active'
      || t.assignee_kind !== 'agent' || t.assignee_agent_id !== a.id) throw new WorkRefusal(403, 'not_assignee', 'Only the assigned active agent can move this task.');
    if (fields.some((k) => !['board_column', 'column', 'position'].includes(k))) throw new WorkRefusal(403, 'agent_move_only', 'An agent can move only its assigned work.');
  }
  return scope;
}

type BoardWrite = Partial<WorkTask> & TaskWrite;
const FIELDS = new Set(['title','detail','body','type','parent_task_id','goal_uid','module','option','kind','assignee','priority','due_at',
  'status','blocked_reason','source_kind','source_ref','board_column','column','estimate_points','position','labels','labels_json','close_reason','duplicate_of','state']);
async function linked(env: Env, current: ScopeRow, value: unknown, field: string) {
  if (value === null) return null;
  // External references are uids. Numeric internal ids never leave this service.
  const t = typeof value === 'string' ? await taskByUid(env, value) : null;
  if (!t || !same(t, current) || t.id === current.id) bad(`${field} names another task of this project, by uid.`);
  return t!.id;
}
export async function boardWrite(env: Env, scope: Project, b: Record<string, any>, current: WorkTask | null): Promise<BoardWrite> {
  if (Object.keys(b).some((k) => !FIELDS.has(k))) bad('That task field is not editable here.');
  const base = await taskWrite(env, scope, b, current);
  if (!base.ok) throw new WorkRefusal(base.refusal.status, base.refusal.code, base.refusal.message);
  const w: BoardWrite = { ...base.write };
  if ('body' in b) {
    if (b.body !== null && (typeof b.body !== 'string' || b.body.length > 50000)) bad('The Markdown body is at most 50,000 characters.');
    w.body = b.body;
  }
  if ('type' in b) {
    if (!(WORK_TYPES as readonly unknown[]).includes(b.type)) bad('Choose task, bug, feature, research, compliance or chore.');
    w.type = b.type;
  }
  if ('estimate_points' in b) {
    if (b.estimate_points !== null && (typeof b.estimate_points !== 'number' || !Number.isFinite(b.estimate_points) || b.estimate_points < 0 || b.estimate_points > 1000000)) bad('An estimate is a nonnegative number of points or null.');
    w.estimate_points = b.estimate_points;
  }
  if ('position' in b) {
    if (typeof b.position !== 'number' || !Number.isFinite(b.position) || b.position < 0 || b.position > 1e12) bad('Position is a nonnegative finite number.');
    w.position = b.position;
  }
  if ('labels' in b || 'labels_json' in b) {
    let labels = b.labels;
    if ('labels' in b && 'labels_json' in b) bad('Send labels once.');
    if ('labels_json' in b) { try { labels = JSON.parse(b.labels_json); } catch { bad('Labels are a JSON array.'); } }
    if (!Array.isArray(labels) || labels.length > 20 || labels.some((v) => typeof v !== 'string' || !v.trim() || v.length > 80)) bad('Send at most 20 label names, each at most 80 characters.');
    w.labels_json = JSON.stringify([...new Set(labels.map((v: string) => v.trim()))]);
  }
  const ownRef: ScopeRow = current ?? {id:-1,scope_kind:'project',project_id:scope.id,company_id:null};
  if ('parent_task_id' in b) {
    w.parent_task_id = await linked(env, ownRef, b.parent_task_id, 'parent_task_id');
    if (w.parent_task_id) {
      const seen = new Set([ownRef.id]); let id: number | null = w.parent_task_id;
      while (id) {
        if (seen.has(id) || seen.size > DEP_WALK_MAX) bad('Parent tasks cannot form a cycle.');
        seen.add(id);
        const p: { parent_task_id: number | null } | null = await env.DB.prepare('SELECT parent_task_id FROM scope_tasks WHERE id = ?').bind(id).first();
        id = p?.parent_task_id ?? null;
      }
    }
  }
  if ('column' in b && 'board_column' in b && b.column !== b.board_column) bad('Send one matching column.');
  let col = b.board_column ?? b.column;
  if (('column' in b || 'board_column' in b) && !(BOARD_COLUMNS as readonly unknown[]).includes(col)) bad('Choose a board column.');
  if ('state' in b && !['open', 'closed'].includes(b.state)) bad('State is open or closed.');
  if (b.state === 'closed') {
    if (col && col !== 'done') bad('Closed tasks belong in Done.');
    col = 'done';
  } else if (b.state === 'open') {
    if (col === 'done') bad('An open task cannot be in Done.');
    col ??= current && !closed(current) ? columnOf(current) : 'backlog';
  }
  if (!col && w.status) col = columnOf({ status: w.status, board_column: null });
  col ??= current ? columnOf(current) : 'backlog';
  let reason = 'close_reason' in b ? b.close_reason : current ? reasonOf(current) : null;
  if (reason !== null && !(CLOSE_REASONS as readonly unknown[]).includes(reason)) bad('Choose completed, not_planned or duplicate.');
  if (col === 'done') reason ??= b.status === 'cancelled' ? 'not_planned' : 'completed';
  else {
    if (b.close_reason != null || b.duplicate_of != null) bad('Only a closed task has a close reason or duplicate.');
    reason = null;
  }
  w.board_column = col; w.close_reason = reason;
  const status = col === 'done' ? (reason === 'completed' ? 'done' : 'cancelled')
    : col === 'in_progress' ? 'in_progress' : col === 'in_review' ? 'waiting_decision'
    : b.status === 'blocked' ? 'blocked' : 'open';
  if (b.status && b.status !== status) bad('The status and board column must agree.');
  w.status = status;
  if (status !== 'blocked') w.blocked_reason = null;
  if (reason === 'duplicate') {
    w.duplicate_of = 'duplicate_of' in b ? await linked(env, ownRef, b.duplicate_of, 'duplicate_of') : current?.duplicate_of ?? null;
    if (!w.duplicate_of) bad('A duplicate names the original task.');
  } else w.duplicate_of = null;
  const blockers = current ? await blockersOf(env, current.id) : [];
  if (blockers.length && (col === 'ready' || col === 'in_progress' || ('assignee' in b && w.assignee_kind === 'agent'))) blocked(blockers);
  return w;
}

const eventStmt = (env: Env, id: number, actor: WorkActor, kind: string, detail: unknown, change: string) => env.DB.prepare(
  `INSERT INTO scope_task_events (task_id, actor_user_id, actor_agent_id, kind, detail_json)
   SELECT id, ?, ?, ?, ? FROM scope_tasks WHERE id = ? AND work_change_uid = ?`,
).bind(actor.user?.id ?? null, actor.agentId ?? null, kind, JSON.stringify(detail), id, change);
const changed = () => { throw new WorkRefusal(409, 'task_changed', 'This task changed. Read it again before retrying.'); };

/** Writes and their audit commit together. The revision protects against stale concurrent edits. */
export async function updateWorkTask(env: Env, t: WorkTask, b: Record<string, any>, actor: WorkActor, publish: (env: Env, args: NotifyArgs) => Promise<unknown> = notify) {
  const agentClosing = !!actor.agentId && (b.column === 'done' || b.board_column === 'done' || b.state === 'closed' || ['done','cancelled'].includes(b.status));
  const scope = await workPermission(env, t, actor, agentClosing ? [] : Object.keys(b));
  if (agentClosing) throw new WorkRefusal(403,'agent_cannot_close','A named person reviews and closes an agent’s work.');
  const w = await boardWrite(env, scope, b, t);
  if (actor.agentId && (!['ready', 'in_progress', 'in_review'].includes(w.board_column!) || w.status === 'done' || w.status === 'cancelled')) {
    throw new WorkRefusal(403, 'agent_cannot_close', 'A named person reviews and closes an agent’s work.');
  }
  const n = { ...t, ...w }, change = newUid();
  const starting = n.board_column === 'ready' || n.board_column === 'in_progress' || ('assignee' in b && n.assignee_kind === 'agent');
  const moved = columnOf(t) !== n.board_column;
  const statements = [env.DB.prepare(
    `UPDATE scope_tasks SET title = ?, detail = ?, body = ?, type = ?, parent_task_id = ?, goal_id = ?, module = ?, option = ?, kind = ?,
      assignee_kind = ?, assignee_user_id = ?, assignee_agent_id = ?, status = ?, blocked_reason = ?, priority = ?, due_at = ?,
      source_kind = ?, source_ref = ?, board_column = ?, estimate_points = ?, position = ?, labels_json = ?, close_reason = ?, duplicate_of = ?,
      work_version = work_version + 1, work_change_uid = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND work_version = ? AND (? = 0 OR NOT EXISTS (SELECT 1 FROM scope_task_deps d JOIN scope_tasks b ON b.id = d.depends_on_task_id WHERE d.task_id = scope_tasks.id AND NOT (b.status = 'done' AND (b.close_reason = 'completed' OR b.close_reason IS NULL))))
        AND NOT EXISTS (WITH parents(id) AS (SELECT ? WHERE ? IS NOT NULL UNION
          SELECT p.parent_task_id FROM scope_tasks p JOIN parents ON p.id = parents.id WHERE p.parent_task_id IS NOT NULL LIMIT 201)
          SELECT 1 FROM parents WHERE id = scope_tasks.id OR (SELECT COUNT(*) FROM parents) > 200)`,
  ).bind(n.title,n.detail,n.body,n.type,n.parent_task_id,n.goal_id,n.module,n.option,n.kind,n.assignee_kind,n.assignee_user_id,n.assignee_agent_id,
    n.status,n.blocked_reason,n.priority,n.due_at,n.source_kind,n.source_ref,n.board_column,n.estimate_points,n.position,n.labels_json,n.close_reason,n.duplicate_of,
    change,t.id,t.work_version,starting ? 1 : 0,n.parent_task_id,n.parent_task_id),
  eventStmt(env,t.id,actor,moved ? 'moved' : 'updated',{ change,from:columnOf(t),to:n.board_column,from_status:t.status,to_status:n.status,close_reason:n.close_reason,fields:Object.keys(b) },change)];
  if (t.status !== n.status) statements.push(eventStmt(env,t.id,actor,'status',{change,from:t.status,to:n.status},change));
  if (t.assignee_user_id !== n.assignee_user_id || t.assignee_agent_id !== n.assignee_agent_id) statements.push(eventStmt(env,t.id,actor,'assigned',{change,assignee_kind:n.assignee_kind},change));
  const completing = closed(n) && (!closed(t) || reasonOf(t) !== n.close_reason);
  if (completing) {
    // In the same transaction as completion: two blockers completing at once
    // cannot both miss (or both claim) the final unblock.
    statements.push(env.DB.prepare(
      `INSERT INTO scope_task_events (task_id,actor_user_id,actor_agent_id,kind,detail_json)
       SELECT waiting.id, ?, ?, ?, ? FROM scope_task_deps d JOIN scope_tasks waiting ON waiting.id = d.task_id
       WHERE d.depends_on_task_id = ? AND waiting.scope_kind = 'project' AND waiting.project_id = ?
         AND waiting.status NOT IN ('done','cancelled')
         AND EXISTS (SELECT 1 FROM scope_tasks source WHERE source.id = ? AND source.work_change_uid = ?)
         AND (? = 0 OR NOT EXISTS (SELECT 1 FROM scope_task_deps dd JOIN scope_tasks b ON b.id = dd.depends_on_task_id WHERE dd.task_id = waiting.id AND NOT (b.status = 'done' AND (b.close_reason = 'completed' OR b.close_reason IS NULL))))`,
    ).bind(actor.user?.id ?? null,actor.agentId ?? null,n.close_reason === 'completed' ? 'unblocked' : 'dependency_incomplete',
      JSON.stringify({ change,blocker_uid:t.uid,close_reason:n.close_reason,unblocks:n.close_reason === 'completed' }),t.id,t.project_id,t.id,change,n.close_reason === 'completed' ? 1 : 0));
  }
  const result = await env.DB.batch(statements);
  if (!result[0]?.meta?.changes) {
    const bs = await blockersOf(env,t.id); if (starting && bs.length) blocked(bs); changed();
  }
  if (completing && n.close_reason === 'completed') {
    const recipients = await env.DB.prepare(
      `SELECT t.uid,t.title,t.assignee_kind,t.assignee_user_id,a.uid AS agent_uid,a.sponsor_user_id
       FROM scope_task_events e JOIN scope_tasks t ON t.id = e.task_id LEFT JOIN team_agents a ON a.id = t.assignee_agent_id
       WHERE e.kind = 'unblocked' AND json_extract(e.detail_json,'$.change') = ?`,
    ).bind(change).all<{ uid:string;title:string;assignee_kind:string;assignee_user_id:number|null;agent_uid:string|null;sponsor_user_id:number|null }>();
    for (const r of recipients.results ?? []) {
      const userId = r.assignee_kind === 'person' ? r.assignee_user_id : r.sponsor_user_id;
      if (userId) await publish(env,{ userId,type:'task_unblocked',title:'A task is ready to pick up',body:r.title,
        link:`/projects/${t.project_id}/work?item=${r.uid}`,category:'proactive_nudges',channels:['in_app'],payload:{ task_uid:r.uid,agent_uid:r.agent_uid } });
    }
  }
  return (await taskByUid(env,t.uid)) as WorkTask;
}

export async function createWorkTask(env: Env, scope: Project, b: Record<string, any>, user: User): Promise<WorkTask> {
  if (!(await canRead(env,scope,user)) || !(await canManage(env,scope,user))) throw new WorkRefusal(403,'not_manager','Only a project editor can create tasks.');
  const w = await boardWrite(env,scope,b,null), uid = newUid(), change = newUid();
  await env.DB.batch([env.DB.prepare(
    `INSERT INTO scope_tasks (uid,scope_kind,project_id,task_number,title,detail,body,type,parent_task_id,goal_id,module,option,kind,
      assignee_kind,assignee_user_id,assignee_agent_id,status,blocked_reason,priority,due_at,source_kind,source_ref,created_by_user_id,
      board_column,estimate_points,position,labels_json,close_reason,duplicate_of,work_change_uid)
     SELECT ?, 'project', ?, COALESCE(MAX(task_number),0)+1, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
     FROM scope_tasks WHERE project_id = ? AND scope_kind = 'project'`,
  ).bind(uid,scope.id,w.title!,w.detail??null,w.body??null,w.type??'task',w.parent_task_id??null,w.goal_id??null,w.module??null,w.option??null,w.kind??'work',
    w.assignee_kind??'none',w.assignee_user_id??null,w.assignee_agent_id??null,w.status!,w.blocked_reason??null,w.priority??0,w.due_at??null,
    w.source_kind??'manual',w.source_ref??null,user.id,w.board_column!,w.estimate_points??null,w.position??0,w.labels_json??'[]',w.close_reason??null,w.duplicate_of??null,change,scope.id),
  env.DB.prepare(`INSERT INTO scope_task_events (task_id,actor_user_id,kind,detail_json) SELECT id,?,'created',? FROM scope_tasks WHERE uid = ?`)
    .bind(user.id,JSON.stringify({ change,column:w.board_column }),uid)]);
  return (await taskByUid(env,uid)) as WorkTask;
}

/** Reuses E1's bounded cycle walk; transaction-time recheck closes concurrent A↔B races. */
export async function setWorkDeps(env: Env, t: WorkTask, uids: unknown, user: User) {
  const scope = await workPermission(env,t,{user},['depends_on']);
  if (!(await canManage(env,scope,user))) throw new WorkRefusal(403,'not_manager','Only project editors can change dependencies.');
  if (!Array.isArray(uids) || uids.length > DEPS_MAX || uids.some((v) => typeof v !== 'string')) bad(`Send at most ${DEPS_MAX} dependency uids.`);
  const ids: number[] = [];
  for (const uid of new Set(uids as string[])) {
    const d = await taskByUid(env,uid);
    if (!d || !same(d,t)) throw new WorkRefusal(422,'cross_scope','A dependency must belong to the same project.');
    ids.push(d.id);
  }
  const cycle = await closesCycle(env,t.id,ids);
  if (cycle) throw new WorkRefusal(422,cycle === 'too_many' ? 'too_many_dependencies' : 'dependency_cycle','Dependencies cannot form a cycle or an unbounded graph.');
  const change = newUid();
  const result = await env.DB.batch([
    env.DB.prepare(`WITH walk(id) AS (SELECT CAST(value AS INTEGER) FROM json_each(?) UNION
      SELECT d.depends_on_task_id FROM scope_task_deps d JOIN walk ON walk.id = d.task_id LIMIT 201)
      UPDATE scope_tasks SET work_version = work_version+1,work_change_uid = ?,updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND work_version = ? AND NOT EXISTS (SELECT 1 FROM walk WHERE id = ?)
        AND (SELECT COUNT(*) FROM walk) <= ?`).bind(JSON.stringify(ids),change,t.id,t.work_version,t.id,DEP_WALK_MAX),
    env.DB.prepare(`DELETE FROM scope_task_deps WHERE task_id = ? AND EXISTS (SELECT 1 FROM scope_tasks WHERE id = ? AND work_change_uid = ?)`).bind(t.id,t.id,change),
    env.DB.prepare(`INSERT INTO scope_task_deps (task_id,depends_on_task_id)
      SELECT ?,CAST(value AS INTEGER) FROM json_each(?) WHERE EXISTS (SELECT 1 FROM scope_tasks WHERE id = ? AND work_change_uid = ?)`).bind(t.id,JSON.stringify(ids),t.id,change),
    eventStmt(env,t.id,{user},'deps_set',{change,count:ids.length},change),
  ]);
  if (!result[0]?.meta?.changes) changed();
  return (await taskByUid(env,t.uid)) as WorkTask;
}

type Filter = { text: string[]; fields: [string,string][] };
export function boardFilter(raw: string): Filter {
  if (raw.length > 500) throw new WorkRefusal(400,'invalid_filter','The filter is at most 500 characters.');
  const out: Filter = { text:[],fields:[] };
  const tokens = raw.match(/(?:[^\s"]|"[^"]*")+/g) ?? [];
  for (const token of tokens) {
    const colon = token.indexOf(':');
    if (colon < 0) { out.text.push(token.replaceAll('"','').toLowerCase()); continue; }
    const key = token.slice(0,colon), value = token.slice(colon+1).replaceAll('"','');
    if (!['is','assignee','label','goal','module','due','type'].includes(key) || !value) throw new WorkRefusal(400,'invalid_filter','Use a keyword, is, assignee, label, goal, module, due or type filter.');
    if (key === 'is' && !['open','closed','blocked'].includes(value)) throw new WorkRefusal(400,'invalid_filter','is is open, closed or blocked.');
    out.fields.push([key,value.toLowerCase()]);
  }
  return out;
}

/** Board DTOs have named assignees and uid references, never numeric user ids or emails. */
export type WorkRun = {task_id:number;uid:string;status:string;started_at:string|null;ended_at:string|null;charged_microusd:number|null;total_cost:number|null;missing_cost:number};
/** E3 supplies this reader with its run-table migration. Until then no run
 * exists in the canonical schema, so status and charge are not recorded. */
export type WorkRunReader = (env: Env, taskIds: number[]) => Promise<Map<number,WorkRun>>;
export const NO_WORK_RUNS_RECORDED: WorkRunReader = async () => new Map();
export async function workCards(env: Env, tasks: WorkTask[], readRuns: WorkRunReader = NO_WORK_RUNS_RECORDED) {
  const cards = [];
  const ids = JSON.stringify(tasks.map(t => t.id));
  const refs = await env.DB.prepare(`SELECT t.id,u.uid AS person_uid,u.name AS person_name,
    a.uid AS agent_uid,a.role_key,a.first_name,a.last_name,g.uid AS goal_uid,g.title AS goal_title,
    p.uid AS parent_uid,p.task_number AS parent_number,p.title AS parent_title,
    d.uid AS duplicate_uid,d.task_number AS duplicate_number,d.title AS duplicate_title
    FROM scope_tasks t LEFT JOIN users u ON u.id = t.assignee_user_id
    LEFT JOIN team_agents a ON a.id = t.assignee_agent_id AND a.scope_kind = 'project' AND a.project_id = t.project_id
    LEFT JOIN scope_goals g ON g.id = t.goal_id AND g.scope_kind = 'project' AND g.project_id = t.project_id
    LEFT JOIN scope_tasks p ON p.id = t.parent_task_id AND p.project_id = t.project_id
    LEFT JOIN scope_tasks d ON d.id = t.duplicate_of AND d.project_id = t.project_id
    WHERE t.id IN (SELECT value FROM json_each(?))`).bind(ids).all<{
      id:number;person_uid:string|null;person_name:string|null;agent_uid:string|null;role_key:string|null;first_name:string|null;last_name:string|null;
      goal_uid:string|null;goal_title:string|null;parent_uid:string|null;parent_number:number|null;parent_title:string|null;
      duplicate_uid:string|null;duplicate_number:number|null;duplicate_title:string|null;
    }>();
  const refsById = new Map((refs.results??[]).map(r=>[r.id,r]));
  const deps = await env.DB.prepare(`SELECT d.task_id,b.uid,b.task_number,b.title,b.status,b.close_reason
    FROM scope_task_deps d JOIN scope_tasks b ON b.id = d.depends_on_task_id
    JOIN scope_tasks t ON t.id = d.task_id AND t.project_id = b.project_id AND t.scope_kind = b.scope_kind
    WHERE d.task_id IN (SELECT value FROM json_each(?)) ORDER BY b.id`).bind(ids)
    .all<Blocker & {task_id:number;status:string;close_reason:string|null}>();
  const runByTask = await readRuns(env,tasks.map(t=>t.id));
  for (const t of tasks) {
    const r = refsById.get(t.id);
    if (!r) throw new Error('Missing recorded work task');
    const person = r.person_uid ? {uid:r.person_uid,name:r.person_name} : null;
    const agent = r.agent_uid ? {uid:r.agent_uid,role_key:r.role_key,first_name:r.first_name,last_name:r.last_name} : null;
    const parent = r.parent_uid ? {uid:r.parent_uid,task_number:r.parent_number,title:r.parent_title} : null;
    const duplicate = r.duplicate_uid ? {uid:r.duplicate_uid,task_number:r.duplicate_number,title:r.duplicate_title} : null;
    const ownDeps = (deps.results??[]).filter(d=>d.task_id===t.id);
    const blockers = ownDeps.filter(d=>!(d.status==='done'&&(d.close_reason===null||d.close_reason==='completed'))).map(({uid,task_number,title})=>({uid,task_number,title}));
    const run = runByTask.get(t.id);
    let labels: string[];
    try { labels = JSON.parse(t.labels_json); } catch { throw new Error('Invalid recorded work labels'); }
    if (!Array.isArray(labels) || labels.some((l) => typeof l !== 'string')) throw new Error('Invalid recorded work labels');
    const cost = run?.charged_microusd != null && Number.isSafeInteger(run.charged_microusd) && run.charged_microusd >= 0
      ? {available:true as const,value_microusd:run.charged_microusd} : {available:false as const};
    cards.push({
      uid:t.uid,task_number:t.task_number,title:t.title,detail:t.detail,body:t.body,type:t.type,
      project:{id:t.project_id},column:columnOf(t),board_column:columnOf(t),status:t.status,state:closed(t)?'closed':'open',
      close_reason:reasonOf(t),duplicate_of:duplicate,parent,
      estimate:t.estimate_points,estimate_points:t.estimate_points,position:t.position,labels,milestone:null,
      assignee:person?{kind:'person' as const,uid:person.uid,name:person.name,person}
        :agent?{kind:'agent' as const,uid:agent.uid,agent_uid:agent.uid,name:[agent.first_name,agent.last_name].filter(Boolean).join(' ')||null,role:agent.role_key,agent}
        :{kind:'none' as const},
      priority:t.priority,due:t.due_at,due_at:t.due_at,module:t.module,option:t.option,kind:t.kind,
      source:t.source_kind,goal:r.goal_title,goal_uid:r.goal_uid,depends_on:ownDeps.map(({uid,task_number,title})=>({uid,task_number,title})),blocked:blockers.length>0||t.status==='blocked',blocked_reason:t.blocked_reason,blockers,
      ready:t.status==='open'&&columnOf(t)==='ready'&&!blockers.length,
      run:run?{uid:run.uid,status:({done:'completed',waiting_decision:'waiting',admitted:'running'} as Record<string,string>)[run.status]??run.status,
        recorded_status:run.status,charged_microusd:cost.available?cost.value_microusd:null,cost,started_at:run.started_at,ended_at:run.ended_at}:null,
      cost:run&&!run.missing_cost&&run.total_cost!=null?{available:true,value_microusd:run.total_cost}:{available:false},created_at:t.created_at,updated_at:t.updated_at,version:t.work_version,
    });
  }
  return cards;
}

export async function projectBoard(env: Env, scope: Project, filter = '', readRuns: WorkRunReader = NO_WORK_RUNS_RECORDED) {
  const f = boardFilter(filter);
  const r = await env.DB.prepare(`SELECT * FROM scope_tasks WHERE scope_kind = 'project' AND project_id = ? ORDER BY position,id LIMIT 5001`)
    .bind(scope.id).all<WorkTask>();
  if ((r.results?.length??0)>5000) throw new WorkRefusal(413,'board_too_large','This project has more tasks than one board response can show.');
  const cards = await workCards(env,r.results??[],readRuns);
  const items = cards.filter((c) => f.text.every((v) => `${c.title} ${c.body??c.detail??''}`.toLowerCase().includes(v)) && f.fields.every(([key,value]) => {
    switch(key) {
      case 'is': return value==='blocked'?c.blocked:c.state===value;
      case 'assignee': return [c.assignee.kind,'uid' in c.assignee?c.assignee.uid:''].includes(value);
      case 'label': return c.labels.some((l)=>l.toLowerCase()===value);
      case 'goal': return c.goal_uid===value||c.goal?.toLowerCase()===value;
      case 'module': return c.module===value;
      case 'type': return c.type===value;
      case 'due': return c.due?.slice(0,10)===value;
      default: return false;
    }
  }));
  const columns = BOARD_COLUMNS.map((key) => {
    const rows = items.filter((c)=>c.column===key);
    const known = rows.filter((c)=>c.estimate_points!==null);
    // A partially estimated column must not claim that its known subtotal is
    // the whole estimate. Explicit zero points remains measured zero.
    return {key,count:rows.length,estimate_points:rows.length&&known.length!==rows.length?null:known.reduce((n,c)=>n+c.estimate_points!,0),
      estimate_recorded:known.length,cards:rows};
  });
  return {project:{id:scope.id,name:scope.name},items,columns,count:items.length};
}

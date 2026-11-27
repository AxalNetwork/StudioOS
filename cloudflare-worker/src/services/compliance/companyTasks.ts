/**
 * D1614 CO2–CO5 (#3976) — a company's compliance tasks, on D1384's store
 * (`compliance_events`, rebuilt by migration 202611021812 to hold company rows).
 *
 * Companies carry the legal and compliance duties; projects carry the work
 * (the owner, 2026-11-01). So a task belongs to its company, and the work done
 * for it is an item on one of that company's project boards, linked back by
 * `scope_tasks.compliance_ref`.
 *
 * WHO MAY DO WHAT
 * - Read: anyone with a seat on the company (`user_company_links`), or HQ.
 * - Change a task (create, edit, assign, mark done, reopen, create work): a
 *   company admin — a seat whose role is Owner, Admin or Founder, or the
 *   primary admin; or an HQ admin who also holds a seat. An HQ admin without a
 *   seat reads through the staff scope and changes nothing:
 *   403 `read_only_admin` (the owner's "admins on read-only access").
 * - Comment and set "ready for review": any seat holder, and the company's own
 *   active agents. An agent never marks a task done: 403 `agent_cannot_close`.
 * - Assign to: a seat holder or one of the company's active agents; anyone
 *   else is 422 `assignee_not_member`.
 * - Create work in a project: the project must be this company's
 *   (422 `company_mismatch`; a standalone project, 422 `standalone_project`),
 *   and the caller must manage that project (W1's gate, `createWorkTask`).
 *
 * No email, address or token is in any reply or log line. Bound SQL only.
 */
import type { Env, User } from '../../types';
import { isAdmin, newUid } from '../../routes/_t13t14t15_helpers';
import { loadScope, type Scope } from '../agents/teams';
import { columnOf, createWorkTask, type WorkTask } from '../agents/workBoard';

type Company = Extract<Scope, { kind: 'company' }>;
export type ComplianceActor = { user: User; agentId?: never } | { agentId: number; costMicrousd?: number | null; user?: never };

export class ComplianceRefusal extends Error {
  status: number; code: string; sentence: string;
  constructor(status: number, code: string, sentence: string) { super(sentence); this.status = status; this.code = code; this.sentence = sentence; }
}
const refuse = (status: number, code: string, sentence: string): never => { throw new ComplianceRefusal(status, code, sentence); };
const invalid = (sentence: string): never => refuse(400, 'invalid_task', sentence);

/** The canvas's five types (CO2), stored lower-case in `event_type`; D1384's seeded types keep their own words. */
export const TASK_TYPES = ['filing', 'payment', 'renewal', 'report', 'signature'] as const;
const TYPE_WORDS: Record<string, string> = {
  filing: 'Filing', payment: 'Payment', renewal: 'Renewal', report: 'Report', signature: 'Signature',
  annual_report: 'Filing', franchise_tax: 'Payment', registered_agent: 'Renewal', board_meeting: 'Meeting', other: 'Other',
};
export const RECURRENCES = ['annual', 'quarterly', 'monthly', 'one_time'] as const;
const ROLL_DAYS: Record<string, number> = { annual: 365, quarterly: 91, monthly: 30 };
const ADMIN_ROLES = ['Owner', 'Admin', 'Founder'];
export const LIST_CAP = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Row = {
  id: number; uid: string; project_id: number | null; company_id: number | null; jurisdiction: string; event_type: string;
  title: string; description: string | null; due_date: string; completion_status: string; completed_at: string | null;
  recurrence: string; source: string; assignee_kind: string | null; assignee_user_id: number | null; assignee_agent_id: number | null;
  review_state: string | null; needs_reassignment: number; created_at: string; updated_at: string;
  person_uid: string | null; person_name: string | null; agent_uid: string | null; agent_role: string | null;
  agent_first: string | null; agent_last: string | null; project_name: string | null;
};
// Each read spells its columns out: no query text is built from a fragment (check-sql-prepare).

export async function companyOf(env: Env, uid: string): Promise<Company> {
  const s = await loadScope(env, 'company', uid);
  if (!s || s.kind !== 'company') refuse(404, 'not_found', 'There is no company here.');
  return s as Company;
}

/** What the viewer may do here. `seat` is a `user_company_links` row; HQ reads without one. */
export async function viewerOf(env: Env, s: Company, user: User) {
  const link = await env.DB.prepare('SELECT role_in_company, is_primary_admin FROM user_company_links WHERE company_id = ? AND user_id = ?')
    .bind(s.id, user.id).first<{ role_in_company: string; is_primary_admin: number }>();
  const hq = isAdmin(user);
  const seat = !!link;
  const manage = seat && (hq || !!link!.is_primary_admin || ADMIN_ROLES.includes(link!.role_in_company));
  return { seat, can_read: seat || hq, can_manage: manage, read_only: hq && !seat };
}

async function gate(env: Env, s: Company, user: User, need: 'read' | 'seat' | 'manage') {
  const v = await viewerOf(env, s, user);
  if (!v.can_read) refuse(403, 'not_member', 'Only the company’s people can read its compliance tasks.');
  if (need === 'read') return v;
  if (v.read_only) refuse(403, 'read_only_admin', 'An admin without a seat on this company reads its compliance tasks and changes nothing.');
  if (need === 'manage' && !v.can_manage) refuse(403, 'not_company_admin', 'Only a company admin changes compliance tasks.');
  return v;
}

async function agentOfCompany(env: Env, s: Company, agentId: number) {
  const a = await env.DB.prepare(`SELECT id, uid FROM team_agents WHERE id = ? AND scope_kind = 'company' AND company_id = ? AND status = 'active'`)
    .bind(agentId, s.id).first<{ id: number; uid: string }>();
  return a ?? null;
}

const agentName = (r: { agent_first: string | null; agent_last: string | null; agent_role: string | null }) =>
  [r.agent_first, r.agent_last].filter(Boolean).join(' ') || r.agent_role || 'Agent';

function dto(r: Row, links: LinkedItem[]) {
  const owner = r.assignee_kind === 'person' && r.person_uid ? { kind: 'person' as const, uid: r.person_uid, name: r.person_name }
    : r.assignee_kind === 'agent' && r.agent_uid ? { kind: 'agent' as const, uid: r.agent_uid, name: agentName(r) } : null;
  return {
    uid: r.uid, title: r.title, description: r.description, due: r.due_date,
    status: r.completion_status === 'completed' ? 'done' : r.completion_status === 'snoozed' ? 'snoozed' : 'due',
    done_at: r.completed_at, type: TYPE_WORDS[r.event_type] ?? 'Other', type_key: r.event_type,
    jurisdiction: r.jurisdiction && r.jurisdiction !== 'Unspecified' ? r.jurisdiction : null,
    recurrence: r.recurrence, source: r.source, owner,
    review_state: r.review_state, needs_reassignment: r.needs_reassignment === 1,
    project: r.project_id ? { id: r.project_id, name: r.project_name } : null,
    linked_work: links[0] ?? null, linked_items: links,
  };
}
export type TaskDto = ReturnType<typeof dto>;

type LinkedItem = { uid: string; task_number: number | null; title: string; project_id: number; project_name: string | null; column: string };
async function linksOf(env: Env, ids: number[]): Promise<Map<number, LinkedItem[]>> {
  const out = new Map<number, LinkedItem[]>();
  if (!ids.length) return out;
  const r = await env.DB.prepare(`SELECT t.compliance_ref, t.uid, t.task_number, t.title, t.project_id, t.board_column, t.status, p.name AS project_name
      FROM scope_tasks t LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.compliance_ref IN (SELECT value FROM json_each(?)) AND t.scope_kind = 'project' ORDER BY t.id`)
    .bind(JSON.stringify(ids)).all<{ compliance_ref: number; uid: string; task_number: number | null; title: string; project_id: number; board_column: string | null; status: string; project_name: string | null }>();
  for (const x of r.results ?? []) {
    const list = out.get(x.compliance_ref) ?? [];
    list.push({ uid: x.uid, task_number: x.task_number, title: x.title, project_id: x.project_id, project_name: x.project_name,
      column: columnOf({ board_column: x.board_column as WorkTask['board_column'], status: x.status as WorkTask['status'] }) });
    out.set(x.compliance_ref, list);
  }
  return out;
}

async function rowOf(env: Env, s: Company, taskUid: string): Promise<Row> {
  const r = await env.DB.prepare(`SELECT e.id, e.uid, e.project_id, e.company_id, e.jurisdiction, e.event_type, e.title, e.description, e.due_date,
    e.completion_status, e.completed_at, e.recurrence, e.source, e.assignee_kind, e.assignee_user_id, e.assignee_agent_id,
    e.review_state, e.needs_reassignment, e.created_at, e.updated_at,
    u.uid AS person_uid, u.name AS person_name, a.uid AS agent_uid, a.role_key AS agent_role, a.first_name AS agent_first, a.last_name AS agent_last,
    p.name AS project_name
  FROM compliance_events e
  LEFT JOIN users u ON u.id = e.assignee_user_id AND e.assignee_kind = 'person'
  LEFT JOIN team_agents a ON a.id = e.assignee_agent_id AND e.assignee_kind = 'agent'
  LEFT JOIN projects p ON p.id = e.project_id WHERE e.uid = ? AND e.company_id = ?`).bind(taskUid, s.id).first<Row>();
  if (!r) refuse(404, 'not_found', 'There is no such compliance task on this company.');
  return r as Row;
}

export type ListFilter = { status?: string | null; jurisdiction?: string | null; owner?: string | null; type?: string | null };

/** CO2: the company's tasks (every row with its company_id, its projects' included), and the projects "Create work" can pick. */
export async function listTasks(env: Env, s: Company, user: User, f: ListFilter = {}) {
  const viewer = await gate(env, s, user, 'read');
  let status: string | null = null;
  if (f.status) {
    status = ({ done: 'completed', due: 'pending', snoozed: 'snoozed' } as Record<string, string>)[f.status] ?? null;
    if (!status) invalid('Status is due, done or snoozed.');
  }
  let types: string | null = null;
  if (f.type) {
    const keys = Object.entries(TYPE_WORDS).filter(([, w]) => w.toLowerCase() === f.type!.toLowerCase()).map(([k]) => k);
    if (!keys.length) invalid('That is not a compliance task type.');
    types = JSON.stringify(keys);
  }
  const jurisdiction = f.jurisdiction ? f.jurisdiction.slice(0, 64) : null;
  const owner = f.owner || null;
  // One literal statement: each filter is a bound value, and NULL means "any".
  const r = await env.DB.prepare(`SELECT e.id, e.uid, e.project_id, e.company_id, e.jurisdiction, e.event_type, e.title, e.description, e.due_date,
    e.completion_status, e.completed_at, e.recurrence, e.source, e.assignee_kind, e.assignee_user_id, e.assignee_agent_id,
    e.review_state, e.needs_reassignment, e.created_at, e.updated_at,
    u.uid AS person_uid, u.name AS person_name, a.uid AS agent_uid, a.role_key AS agent_role, a.first_name AS agent_first, a.last_name AS agent_last,
    p.name AS project_name
  FROM compliance_events e
  LEFT JOIN users u ON u.id = e.assignee_user_id AND e.assignee_kind = 'person'
  LEFT JOIN team_agents a ON a.id = e.assignee_agent_id AND e.assignee_kind = 'agent'
  LEFT JOIN projects p ON p.id = e.project_id WHERE e.company_id = ?
      AND (? IS NULL OR e.completion_status = ?)
      AND (? IS NULL OR e.jurisdiction = ?)
      AND (? IS NULL OR e.event_type IN (SELECT value FROM json_each(?)))
      AND (? IS NULL OR (? = 'none' AND e.assignee_kind IS NULL) OR u.uid = ? OR a.uid = ?)
    ORDER BY e.due_date, e.id LIMIT ?`)
    .bind(s.id, status, status, jurisdiction, jurisdiction, types, types, owner, owner, owner, owner, LIST_CAP + 1).all<Row>();
  const rows = (r.results ?? []).slice(0, LIST_CAP);
  const links = await linksOf(env, rows.map((x) => x.id));
  const projects = await env.DB.prepare('SELECT id, name FROM projects WHERE company_id = ? ORDER BY name, id LIMIT 200')
    .bind(s.id).all<{ id: number; name: string }>();
  return {
    company: { uid: s.uid, name: s.name },
    viewer: { can_manage: viewer.can_manage, can_comment: viewer.seat, read_only: viewer.read_only },
    tasks: rows.map((x) => dto(x, links.get(x.id) ?? [])),
    truncated: (r.results ?? []).length > LIST_CAP,
    projects: projects.results ?? [],
  };
}

type TimelineEntry = { uid: string; kind: string; at: string; body: string | null; detail: unknown;
  actor: { kind: 'person' | 'agent' | 'system'; uid: string | null; name: string | null }; cost_microusd: number | null };

/** CO3: one task, its linked work and its timeline. */
export async function readTask(env: Env, s: Company, user: User, taskUid: string) {
  const viewer = await gate(env, s, user, 'read');
  const row = await rowOf(env, s, taskUid);
  const links = await linksOf(env, [row.id]);
  const ev = await env.DB.prepare(`SELECT c.uid, c.kind, c.created_at, c.body, c.detail_json, c.actor_kind, c.cost_microusd,
      u.uid AS person_uid, u.name AS person_name, a.uid AS agent_uid, a.role_key AS agent_role, a.first_name AS agent_first, a.last_name AS agent_last
    FROM compliance_task_events c LEFT JOIN users u ON u.id = c.actor_user_id LEFT JOIN team_agents a ON a.id = c.actor_agent_id
    WHERE c.event_id = ? ORDER BY c.id LIMIT 500`).bind(row.id).all<any>();
  const timeline: TimelineEntry[] = (ev.results ?? []).map((e: any) => {
    let detail: unknown = null;
    try { detail = e.detail_json ? JSON.parse(e.detail_json) : null; } catch { detail = null; }
    return {
      uid: e.uid, kind: e.kind, at: e.created_at, body: e.body, detail,
      actor: e.actor_kind === 'person' ? { kind: 'person', uid: e.person_uid, name: e.person_name }
        : e.actor_kind === 'agent' ? { kind: 'agent', uid: e.agent_uid, name: agentName(e) } : { kind: 'system', uid: null, name: null },
      cost_microusd: e.actor_kind === 'agent' && Number.isSafeInteger(e.cost_microusd) ? e.cost_microusd : null,
    };
  });
  return {
    company: { uid: s.uid, name: s.name },
    viewer: { can_manage: viewer.can_manage, can_comment: viewer.seat, read_only: viewer.read_only },
    task: dto(row, links.get(row.id) ?? []), timeline,
  };
}

function eventStmt(env: Env, eventId: number, kind: string, actor: ComplianceActor | 'system', o: { body?: string | null; detail?: unknown } = {}) {
  const person = actor !== 'system' && actor.user ? actor.user.id : null;
  const agent = actor !== 'system' && !actor.user ? actor.agentId : null;
  const cost = actor !== 'system' && !actor.user && Number.isSafeInteger(actor.costMicrousd) && (actor.costMicrousd as number) >= 0 ? actor.costMicrousd : null;
  return env.DB.prepare(`INSERT INTO compliance_task_events (uid, event_id, kind, actor_kind, actor_user_id, actor_agent_id, body, detail_json, cost_microusd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(newUid(), eventId, kind, actor === 'system' ? 'system' : person ? 'person' : 'agent',
    person, agent, o.body ?? null, o.detail === undefined ? null : JSON.stringify(o.detail), cost);
}

const text = (v: unknown, max: number, what: string, required = false): string | null => {
  if (v === undefined || v === null || v === '') { if (required) invalid(`${what} is required.`); return null; }
  if (typeof v !== 'string' || !v.trim() || v.length > max) invalid(`${what} is at most ${max} characters.`);
  return (v as string).trim();
};

function fieldsOf(b: Record<string, any>, creating: boolean) {
  const allowed = new Set(['title', 'description', 'due', 'type', 'jurisdiction', 'recurrence', 'project_id']);
  if (Object.keys(b).some((k) => !allowed.has(k))) invalid('That compliance task field is not editable here.');
  const out: Record<string, unknown> = {};
  if (creating || 'title' in b) out.title = text(b.title, 200, 'A title', true);
  if (creating || 'due' in b) { if (typeof b.due !== 'string' || !DAY.test(b.due) || Number.isNaN(Date.parse(`${b.due}T00:00:00Z`))) invalid('A due date is YYYY-MM-DD.'); out.due_date = b.due; }
  if ('description' in b) out.description = text(b.description, 5000, 'A description');
  if ('jurisdiction' in b) out.jurisdiction = text(b.jurisdiction, 64, 'A jurisdiction') ?? 'Unspecified';
  else if (creating) out.jurisdiction = 'Unspecified';
  if (creating || 'type' in b) { const t = b.type ?? 'filing'; if (!(TASK_TYPES as readonly unknown[]).includes(t)) invalid('Choose filing, payment, renewal, report or signature.'); out.event_type = t; }
  if (creating || 'recurrence' in b) { const r = b.recurrence ?? 'one_time'; if (!(RECURRENCES as readonly unknown[]).includes(r)) invalid('Recurrence is annual, quarterly, monthly or one time.'); out.recurrence = r; }
  return out;
}

/** New compliance task (company admins). An optional `project_id` must be one of this company's projects. */
export async function createTask(env: Env, s: Company, user: User, b: Record<string, any>) {
  await gate(env, s, user, 'manage');
  const f = fieldsOf(b, true);
  let projectId: number | null = null;
  if (b.project_id !== undefined && b.project_id !== null) {
    const p = await env.DB.prepare('SELECT id, company_id FROM projects WHERE id = ?').bind(Number(b.project_id)).first<{ id: number; company_id: number | null }>();
    if (!p || p.company_id !== s.id) refuse(422, 'company_mismatch', 'That project is not one of this company’s.');
    projectId = p!.id;
  }
  const uid = newUid();
  try {
    await env.DB.prepare(`INSERT INTO compliance_events (uid, project_id, company_id, jurisdiction, event_type, title, description, due_date, recurrence, source, created_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`).bind(uid, projectId, s.id, f.jurisdiction, f.event_type, f.title, f.description ?? null, f.due_date, f.recurrence, user.id).run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) refuse(409, 'duplicate_task', 'That project already has a task of this type due that day.');
    throw e;
  }
  const row = await rowOf(env, s, uid);
  await eventStmt(env, row.id, 'created', { user }).run();
  return dto(row, []);
}

/** Edit a task's fields (company admins). */
export async function updateTask(env: Env, s: Company, user: User, taskUid: string, b: Record<string, any>) {
  await gate(env, s, user, 'manage');
  const row = await rowOf(env, s, taskUid);
  if ('project_id' in b) invalid('A task’s project is not changed here.');
  const f = fieldsOf(b, false);
  const keys = Object.keys(f);
  if (!keys.length) invalid('Send a field to change.');
  // One literal statement: a field changes only when its flag is 1; a new due date clears the reminders sent.
  const has = (k: string) => (k in f ? 1 : 0);
  await env.DB.batch([
    env.DB.prepare(`UPDATE compliance_events SET
        title = CASE WHEN ? = 1 THEN ? ELSE title END,
        description = CASE WHEN ? = 1 THEN ? ELSE description END,
        due_date = CASE WHEN ? = 1 THEN ? ELSE due_date END,
        reminders_sent_json = CASE WHEN ? = 1 THEN '[]' ELSE reminders_sent_json END,
        jurisdiction = CASE WHEN ? = 1 THEN ? ELSE jurisdiction END,
        event_type = CASE WHEN ? = 1 THEN ? ELSE event_type END,
        recurrence = CASE WHEN ? = 1 THEN ? ELSE recurrence END,
        updated_at = datetime('now')
      WHERE id = ?`).bind(
      has('title'), f.title ?? null, has('description'), f.description ?? null, has('due_date'), f.due_date ?? null, has('due_date'),
      has('jurisdiction'), f.jurisdiction ?? null, has('event_type'), f.event_type ?? null, has('recurrence'), f.recurrence ?? null, row.id),
    eventStmt(env, row.id, 'updated', { user }, { detail: { fields: keys.map((k) => (k === 'due_date' ? 'due' : k === 'event_type' ? 'type' : k)) } }),
  ]);
  return dto(await rowOf(env, s, taskUid), (await linksOf(env, [row.id])).get(row.id) ?? []);
}

/** The assignee picker (company-scoped, mirroring #3994's project one): seat holders in two groups, and the company's agents. No email. */
export async function assignable(env: Env, s: Company, user: User) {
  await gate(env, s, user, 'read');
  const people = await env.DB.prepare(`SELECT u.uid, u.name, u.role, l.role_in_company,
      (SELECT COUNT(*) FROM compliance_events e WHERE e.company_id = l.company_id AND e.assignee_kind = 'person' AND e.assignee_user_id = u.id AND e.completion_status <> 'completed') AS open_tasks
    FROM user_company_links l JOIN users u ON u.id = l.user_id WHERE l.company_id = ? ORDER BY u.name, u.id LIMIT 500`)
    .bind(s.id).all<{ uid: string; name: string; role: string; role_in_company: string; open_tasks: number }>();
  const agentRows = await env.DB.prepare(`SELECT a.id, a.uid, a.role_key, a.first_name, a.last_name
    FROM team_agents a WHERE a.scope_kind = 'company' AND a.company_id = ? AND a.status = 'active' ORDER BY a.id LIMIT 200`)
    .bind(s.id).all<{ id: number; uid: string; role_key: string; first_name: string | null; last_name: string | null }>();
  const agentOpen = await env.DB.prepare(`SELECT e.assignee_agent_id AS id, COUNT(*) AS n FROM compliance_events e
    WHERE e.company_id = ? AND e.assignee_kind = 'agent' AND e.completion_status <> 'completed' GROUP BY e.assignee_agent_id`)
    .bind(s.id).all<{ id: number; n: number }>();
  const openOf = new Map((agentOpen.results ?? []).map((r) => [r.id, Number(r.n)]));
  const agents = { results: (agentRows.results ?? []).map((a) => ({ ...a, open_tasks: openOf.get(a.id) ?? 0 })) };
  const platform = new Set(['investor', 'advisor', 'partner', 'admin']);
  const person = (p: { uid: string; name: string; role: string; role_in_company: string; open_tasks: number }) =>
    ({ kind: 'person' as const, uid: p.uid, name: p.name, role: p.role_in_company, licence: p.role, open_tasks: Number(p.open_tasks), capacity: null });
  const all = people.results ?? [];
  return {
    team: all.filter((p) => !platform.has(p.role)).map(person),
    platform: all.filter((p) => platform.has(p.role)).map(person),
    agents: (agents.results ?? []).map((a) => ({ kind: 'agent' as const, uid: a.uid, name: agentName({ agent_first: a.first_name, agent_last: a.last_name, agent_role: a.role_key }), role: a.role_key, open_tasks: Number(a.open_tasks), capacity: null })),
  };
}

/** Assign or unassign (company admins). `{ kind: 'person' | 'agent', uid }`, or null to clear. */
export async function assignTask(env: Env, s: Company, user: User, taskUid: string, to: unknown) {
  await gate(env, s, user, 'manage');
  const row = await rowOf(env, s, taskUid);
  let kind: 'person' | 'agent' | null = null, personId: number | null = null, agentId: number | null = null;
  if (to !== null) {
    const t = to as { kind?: unknown; uid?: unknown };
    if (!t || typeof t !== 'object' || typeof t.uid !== 'string' || (t.kind !== 'person' && t.kind !== 'agent')) invalid('Assign to { kind: person or agent, uid }, or null.');
    if (t.kind === 'person') {
      const p = await env.DB.prepare('SELECT u.id FROM users u JOIN user_company_links l ON l.user_id = u.id AND l.company_id = ? WHERE u.uid = ?')
        .bind(s.id, t.uid).first<{ id: number }>();
      if (!p) refuse(422, 'assignee_not_member', 'Only someone with a seat on this company can own its compliance tasks.');
      kind = 'person'; personId = p!.id;
    } else {
      const a = await env.DB.prepare(`SELECT id FROM team_agents WHERE uid = ? AND scope_kind = 'company' AND company_id = ? AND status = 'active'`)
        .bind(t.uid, s.id).first<{ id: number }>();
      if (!a) refuse(422, 'assignee_not_member', 'Only this company’s own active agents can own its compliance tasks.');
      kind = 'agent'; agentId = a!.id;
    }
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE compliance_events SET assignee_kind = ?, assignee_user_id = ?, assignee_agent_id = ?, needs_reassignment = 0, updated_at = datetime('now') WHERE id = ?`)
      .bind(kind, personId, agentId, row.id),
    eventStmt(env, row.id, 'assigned', { user }, { detail: { assignee_kind: kind } }),
  ]);
  return dto(await rowOf(env, s, taskUid), (await linksOf(env, [row.id])).get(row.id) ?? []);
}

async function preparer(env: Env, s: Company, actor: ComplianceActor) {
  if (actor.user) { await gate(env, s, actor.user, 'seat'); return; }
  if (!(await agentOfCompany(env, s, actor.agentId))) refuse(403, 'not_member', 'Only this company’s own active agents work on its compliance tasks.');
}

/** A comment, by a seat holder or one of the company's agents (an agent's carries its cost). */
export async function commentOn(env: Env, s: Company, actor: ComplianceActor, taskUid: string, body: unknown) {
  await preparer(env, s, actor);
  const row = await rowOf(env, s, taskUid);
  const said = text(body, 10000, 'A comment', true);
  await eventStmt(env, row.id, 'comment', actor, { body: said }).run();
  return { ok: true as const };
}

/** "Ready for review": prepared, for a company admin to check and mark done. */
export async function readyForReview(env: Env, s: Company, actor: ComplianceActor, taskUid: string) {
  await preparer(env, s, actor);
  const row = await rowOf(env, s, taskUid);
  if (row.completion_status === 'completed') refuse(409, 'already_done', 'This task is already done.');
  await env.DB.batch([
    env.DB.prepare(`UPDATE compliance_events SET review_state = 'ready_for_review', updated_at = datetime('now') WHERE id = ?`).bind(row.id),
    eventStmt(env, row.id, 'ready_for_review', actor),
  ]);
  return dto(await rowOf(env, s, taskUid), (await linksOf(env, [row.id])).get(row.id) ?? []);
}

/**
 * Mark done (a company admin, never an agent). A recurring task rolls its next
 * occurrence forward from the original due date, as D1384's PATCH does; a
 * company row carries its company, and the same title and type are never
 * rolled twice onto one day.
 */
export async function markDone(env: Env, s: Company, actor: ComplianceActor, taskUid: string, note: unknown) {
  if (!actor.user) refuse(403, 'agent_cannot_close', 'An agent prepares a compliance task; only a company admin marks it done.');
  const user = actor.user as User;
  await gate(env, s, user, 'manage');
  const row = await rowOf(env, s, taskUid);
  if (row.completion_status === 'completed') refuse(409, 'already_done', 'This task is already done.');
  const said = text(note, 2000, 'A note');
  const stmts = [
    env.DB.prepare(`UPDATE compliance_events SET completion_status = 'completed', completed_at = ?, completed_by_user_id = ?, review_state = NULL, needs_reassignment = 0, updated_at = datetime('now') WHERE id = ?`)
      .bind(new Date().toISOString(), user.id, row.id),
    eventStmt(env, row.id, 'done', { user }, { body: said }),
  ];
  const days = ROLL_DAYS[row.recurrence];
  if (days) {
    const next = new Date(Date.parse(`${row.due_date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
    stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO compliance_events (uid, project_id, company_id, entity_id, jurisdiction, event_type, title, description, due_date, recurrence, source, created_by_user_id, assignee_kind, assignee_user_id, assignee_agent_id)
      SELECT ?, project_id, company_id, entity_id, jurisdiction, event_type, title, description, ?, recurrence, source, COALESCE(created_by_user_id, ?), assignee_kind, assignee_user_id, assignee_agent_id
        FROM compliance_events src WHERE src.id = ?
         AND NOT EXISTS (SELECT 1 FROM compliance_events o WHERE o.company_id IS src.company_id AND o.project_id IS src.project_id AND o.event_type = src.event_type AND o.title = src.title AND o.due_date = ?)`)
      .bind(newUid(), next, user.id, row.id, next));
  }
  await env.DB.batch(stmts);
  return dto(await rowOf(env, s, taskUid), (await linksOf(env, [row.id])).get(row.id) ?? []);
}

/** Reopen a done task (a company admin). */
export async function reopenTask(env: Env, s: Company, user: User, taskUid: string) {
  await gate(env, s, user, 'manage');
  const row = await rowOf(env, s, taskUid);
  if (row.completion_status !== 'completed') refuse(409, 'not_done', 'Only a done task can be reopened.');
  await env.DB.batch([
    env.DB.prepare(`UPDATE compliance_events SET completion_status = 'pending', completed_at = NULL, completed_by_user_id = NULL, updated_at = datetime('now') WHERE id = ?`).bind(row.id),
    eventStmt(env, row.id, 'reopened', { user }),
  ]);
  return dto(await rowOf(env, s, taskUid), (await linksOf(env, [row.id])).get(row.id) ?? []);
}

/**
 * CO3 "Create work in a project…": a Backlog item on one of this company's
 * project boards, linked back by `compliance_ref`. The obligation stays here.
 */
export async function createWork(env: Env, s: Company, user: User, taskUid: string, b: Record<string, any>) {
  await gate(env, s, user, 'manage');
  const row = await rowOf(env, s, taskUid);
  const p = await loadScope(env, 'project', String(b?.project_id ?? ''));
  if (!p || p.kind !== 'project') refuse(404, 'not_found', 'There is no such project.');
  const project = p as Extract<Scope, { kind: 'project' }>;
  if (project.company_id === null) refuse(422, 'standalone_project', 'A project with no company has no compliance to link.');
  if (project.company_id !== s.id) refuse(422, 'company_mismatch', 'Work is linked only from a project of the same company.');
  const title = text(b?.title, 300, 'A title') ?? row.title;
  const item = await createWorkTask(env, project, { title, type: 'compliance', column: 'backlog' }, user, { complianceRef: row.id });
  await eventStmt(env, row.id, 'work_linked', { user }, { detail: { project_id: project.id, task_uid: item.uid } }).run();
  return { item: { uid: item.uid, task_number: item.task_number, title: item.title, project_id: project.id, project_name: project.name, column: columnOf(item) } };
}

/**
 * When a company seat ends, the member's open tasks there are flagged for
 * reassignment, with an event each. Never reassigned automatically. Returns
 * the statements to batch AFTER the seat's removal: each runs only when the
 * seat is gone, so a removal the batch refused flags nothing.
 */
export function seatEndedStatements(env: Env, companyId: number, userId: number): D1PreparedStatement[] {
  return [
    env.DB.prepare(`INSERT INTO compliance_task_events (uid, event_id, kind, actor_kind, detail_json)
      SELECT lower(hex(randomblob(16))), id, 'needs_reassignment', 'system', '{"reason":"seat_ended"}' FROM compliance_events
       WHERE company_id = ? AND assignee_kind = 'person' AND assignee_user_id = ? AND completion_status <> 'completed' AND needs_reassignment = 0
         AND NOT EXISTS (SELECT 1 FROM user_company_links l WHERE l.company_id = ? AND l.user_id = ?)`)
      .bind(companyId, userId, companyId, userId),
    env.DB.prepare(`UPDATE compliance_events SET needs_reassignment = 1, updated_at = datetime('now')
       WHERE company_id = ? AND assignee_kind = 'person' AND assignee_user_id = ? AND completion_status <> 'completed' AND needs_reassignment = 0
         AND NOT EXISTS (SELECT 1 FROM user_company_links l WHERE l.company_id = ? AND l.user_id = ?)`)
      .bind(companyId, userId, companyId, userId),
  ];
}

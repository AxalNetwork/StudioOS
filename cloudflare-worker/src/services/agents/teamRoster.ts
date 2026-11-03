/**
 * D1614 W8 (#3994): who may be given a task, and the tasks given to you.
 *
 * THE TEAM (owner, 2026-11-02, on #3994): a task goes only to someone on the
 * scope's Team, people and agents together. Not "anyone who can read".
 *  - A project's people are D1497's roster: its accepted `project_members`
 *    and its founder-owner (whose row `seedOwnerMember` writes on the first
 *    roster read, so the owner is matched by `founder_id` too).
 *  - A company's people are its `user_company_links` (#3976's compliance tasks
 *    use this; E1's company tasks already did).
 *  - Agents are the scope's own `team_agents`. One of another project or of the
 *    parent company is not on this Team.
 *  An Investor, Advisor, Operating Partner or Admin is assignable once they are
 *  on the Team, and not before. An admin reaches a venture from HQ, which is
 *  read-only, so an admin who is not on the Team is refused with
 *  `read_only_admin` rather than the general `assignee_not_member`.
 *
 * SEAT END: removing a member flags each of their open tasks on that project
 * `needs_reassignment`, with an `updated` event naming why
 * (`seatEndStatements`, in the removal's own batch). Nothing is reassigned
 * automatically; assigning the task (to anyone, or no one) clears the flag.
 *
 * Bound SQL only. No email in any answer.
 */
import type { Env, User } from '../../types';
import { canRead, loadScope, onTeam, type Scope } from './teams';
import { columnOf, WorkRefusal } from './workBoard';

type Project = Extract<Scope, { kind: 'project' }>;

export type TeamPerson = {
  kind: 'person'; uid: string; name: string | null;
  /** The seat on this Team: owner, cofounder, advisor, … */
  team_role: string;
  /** The account's licence, for the role badge in its accent. */
  licence: string;
  open_tasks: number;
  /** W4's `work_capacity.weekly_capacity_points` (#4195) on this project; null is "Not recorded", never 0. */
  capacity: number | null;
};
export type TeamAgent = {
  kind: 'agent'; uid: string; name: string | null; role: string;
  status: 'active' | 'paused'; open_tasks: number;
};

/** One `team` list: this project's people and its agents, in that order. */
export async function assignable(env: Env, p: Project): Promise<{ team: Array<TeamPerson | TeamAgent> }> {
  const open = await env.DB.prepare(
    `SELECT assignee_kind, assignee_user_id, assignee_agent_id, COUNT(*) AS n FROM scope_tasks
     WHERE scope_kind = 'project' AND project_id = ? AND status NOT IN ('done','cancelled') AND assignee_kind <> 'none'
     GROUP BY assignee_kind, assignee_user_id, assignee_agent_id`,
  ).bind(p.id).all<{ assignee_kind: string; assignee_user_id: number | null; assignee_agent_id: number | null; n: number }>();
  const personOpen = new Map<number, number>(), agentOpen = new Map<number, number>();
  for (const r of open.results ?? []) {
    if (r.assignee_kind === 'person' && r.assignee_user_id != null) personOpen.set(r.assignee_user_id, Number(r.n));
    if (r.assignee_kind === 'agent' && r.assignee_agent_id != null) agentOpen.set(r.assignee_agent_id, Number(r.n));
  }
  const people = await env.DB.prepare(
    `SELECT u.id, u.uid, u.name, u.role AS licence, pm.role AS team_role, pm.created_at AS since
       FROM project_members pm JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = ? AND pm.status = 'accepted' AND u.is_active = 1
     UNION
     SELECT u.id, u.uid, u.name, u.role, 'owner', NULL FROM users u
      WHERE u.role = 'founder' AND u.founder_id IS NOT NULL AND u.founder_id = ? AND u.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = ? AND pm.user_id = u.id AND pm.status = 'accepted')`,
  ).bind(p.id, p.founder_id ?? -1, p.id).all<{ id: number; uid: string; name: string | null; licence: string; team_role: string; since: string | null }>();
  const caps = new Map(((await env.DB.prepare('SELECT user_id, weekly_capacity_points FROM work_capacity WHERE project_id = ?').bind(p.id)
    .all<{ user_id: number; weekly_capacity_points: number }>()).results ?? []).map((r) => [Number(r.user_id), Number(r.weekly_capacity_points)]));
  const rank = (r: string) => (r === 'owner' ? 0 : r === 'cofounder' ? 1 : 2);
  const persons: TeamPerson[] = (people.results ?? [])
    .sort((a, b) => rank(a.team_role) - rank(b.team_role) || String(a.since ?? '').localeCompare(String(b.since ?? '')) || a.id - b.id)
    .map((r) => ({ kind: 'person', uid: r.uid, name: r.name, team_role: r.team_role, licence: r.licence, open_tasks: personOpen.get(r.id) ?? 0, capacity: caps.get(r.id) ?? null }));
  const agents = await env.DB.prepare(
    `SELECT id, uid, first_name, last_name, role_key, status FROM team_agents
      WHERE scope_kind = 'project' AND project_id = ? AND status IN ('active','paused') ORDER BY id`,
  ).bind(p.id).all<{ id: number; uid: string; first_name: string | null; last_name: string | null; role_key: string; status: 'active' | 'paused' }>();
  const bots: TeamAgent[] = (agents.results ?? []).map((a) => ({
    kind: 'agent', uid: a.uid, name: [a.first_name, a.last_name].filter(Boolean).join(' ') || null, role: a.role_key,
    status: a.status, open_tasks: agentOpen.get(a.id) ?? 0,
  }));
  return { team: [...persons, ...bots] };
}

/**
 * The removal's own batch flags the member's open tasks on this project. The
 * event goes first, so it is written only for rows the update then flags.
 */
export function seatEndStatements(env: Env, projectId: number, userId: number, actorUserId: number) {
  const where = `scope_kind = 'project' AND project_id = ? AND assignee_kind = 'person' AND assignee_user_id = ?
    AND status NOT IN ('done','cancelled') AND needs_reassignment = 0`;
  return [
    env.DB.prepare(`INSERT INTO scope_task_events (task_id, actor_user_id, kind, detail_json)
      SELECT id, ?, 'updated', ? FROM scope_tasks WHERE ${where}`)
      .bind(actorUserId, JSON.stringify({ needs_reassignment: true, reason: 'seat_ended' }), projectId, userId),
    env.DB.prepare(`UPDATE scope_tasks SET needs_reassignment = 1, updated_at = CURRENT_TIMESTAMP WHERE ${where}`).bind(projectId, userId),
  ];
}

export const MY_TASK_STATES = ['open', 'closed', 'all'] as const;
export const MY_TASK_DUES = ['overdue', 'today', 'week', 'none'] as const;
export const MY_TASKS_MAX = 500;
const ISO_DAY = (d: Date) => d.toISOString().slice(0, 10);

export type MyTasksQuery = { state?: string | null; project?: string | null; due?: string | null };

/**
 * Every project task assigned to the caller, grouped by project. A project the
 * caller no longer reads and is no longer on the Team of is left out, so a
 * task given to someone whose seat ended is the editors' to reassign, not
 * theirs to see.
 *
 * `compliance` is #3976's company tasks given to the caller, grouped by
 * company, on a company where they still hold a seat (`user_company_links`):
 * a seat that ended leaves the task to its admins, flagged
 * `needs_reassignment`, as a project's does. The same `state` and `due`
 * filters apply (done is closed); `project` narrows it to tasks naming that
 * project. HQ's read of every company is not a reason to list its tasks here.
 */
export async function myTasks(env: Env, user: User, q: MyTasksQuery, now = new Date()) {
  const state = q.state ?? 'open';
  if (!(MY_TASK_STATES as readonly string[]).includes(state)) throw new WorkRefusal(400, 'invalid_filter', 'state is open, closed or all.');
  const due = q.due ?? null;
  if (due !== null && !(MY_TASK_DUES as readonly string[]).includes(due)) throw new WorkRefusal(400, 'invalid_filter', 'due is overdue, today, week or none.');
  const project = q.project ?? null;
  if (project !== null && !/^[1-9][0-9]{0,15}$/.test(project)) throw new WorkRefusal(400, 'invalid_filter', 'project is a project id.');
  const today = ISO_DAY(now), week = ISO_DAY(new Date(now.getTime() + 7 * 86400000));
  const rows = await env.DB.prepare(
    `SELECT t.*, (SELECT COUNT(*) FROM scope_task_deps d JOIN scope_tasks b ON b.id = d.depends_on_task_id
        WHERE d.task_id = t.id AND NOT (b.status = 'done' AND (b.close_reason = 'completed' OR b.close_reason IS NULL))) AS open_blockers
       FROM scope_tasks t
      WHERE t.scope_kind = 'project' AND t.assignee_kind = 'person' AND t.assignee_user_id = ?
        AND (? = 'all' OR (? = 'open' AND t.status NOT IN ('done','cancelled')) OR (? = 'closed' AND t.status IN ('done','cancelled')))
        AND (? IS NULL OR t.project_id = ?)
        AND (? IS NULL
          OR (? = 'none' AND t.due_at IS NULL)
          OR (? = 'overdue' AND t.due_at IS NOT NULL AND substr(t.due_at, 1, 10) < ?)
          OR (? = 'today' AND substr(t.due_at, 1, 10) = ?)
          OR (? = 'week' AND t.due_at IS NOT NULL AND substr(t.due_at, 1, 10) BETWEEN ? AND ?))
      ORDER BY t.project_id, t.due_at IS NULL, t.due_at, t.task_number, t.id
      LIMIT ?`,
  ).bind(user.id, state, state, state, project, project ? Number(project) : null,
    due, due, due, today, due, today, due, today, week, MY_TASKS_MAX + 1)
    .all<Record<string, any>>();
  const all = rows.results ?? [];
  const has_more = all.length > MY_TASKS_MAX;
  const groups = new Map<number, { project: { id: number; name: string }; tasks: unknown[] }>();
  const allowed = new Map<number, boolean>();
  for (const t of all.slice(0, MY_TASKS_MAX)) {
    const pid = Number(t.project_id);
    if (!allowed.has(pid)) {
      const s = await loadScope(env, 'project', String(pid));
      const ok = !!s && s.kind === 'project' && ((await onTeam(env, s, user.id)) || (await canRead(env, s, user)));
      allowed.set(pid, ok);
      if (ok) groups.set(pid, { project: { id: pid, name: (s as Project).name }, tasks: [] });
    }
    if (!allowed.get(pid)) continue;
    groups.get(pid)!.tasks.push({
      uid: t.uid, task_number: t.task_number, title: t.title, type: t.type,
      column: columnOf(t as any), state: t.status === 'done' || t.status === 'cancelled' ? 'closed' : 'open',
      due_at: t.due_at, blocked: t.status === 'blocked' || Number(t.open_blockers) > 0,
      needs_reassignment: Number(t.needs_reassignment) === 1,
      link: `/projects/${pid}/work?item=${t.uid}`,
    });
  }
  const compliance = await myComplianceTasks(env, user, { state, due, project, today, week });
  return { projects: [...groups.values()], compliance: compliance.groups, has_more: has_more || compliance.has_more };
}

type ComplianceQuery = { state: string; due: string | null; project: string | null; today: string; week: string };
async function myComplianceTasks(env: Env, user: User, q: ComplianceQuery) {
  const rows = await env.DB.prepare(
    `SELECT e.uid, e.title, e.event_type, e.due_date, e.completion_status, e.needs_reassignment, e.project_id,
            c.uid AS company_uid, c.company_name
       FROM compliance_events e
       JOIN company_profiles c ON c.id = e.company_id
       JOIN user_company_links l ON l.company_id = e.company_id AND l.user_id = ?
      WHERE e.assignee_kind = 'person' AND e.assignee_user_id = ?
        AND (? = 'all' OR (? = 'open' AND e.completion_status <> 'completed') OR (? = 'closed' AND e.completion_status = 'completed'))
        AND (? IS NULL OR e.project_id = ?)
        AND (? IS NULL
          OR (? = 'none' AND e.due_date IS NULL)
          OR (? = 'overdue' AND e.due_date IS NOT NULL AND substr(e.due_date, 1, 10) < ?)
          OR (? = 'today' AND substr(e.due_date, 1, 10) = ?)
          OR (? = 'week' AND e.due_date IS NOT NULL AND substr(e.due_date, 1, 10) BETWEEN ? AND ?))
      ORDER BY e.company_id, e.due_date IS NULL, e.due_date, e.id
      LIMIT ?`,
  ).bind(user.id, user.id, q.state, q.state, q.state, q.project, q.project ? Number(q.project) : null,
    q.due, q.due, q.due, q.today, q.due, q.today, q.due, q.today, q.week, MY_TASKS_MAX + 1)
    .all<Record<string, any>>();
  const all = rows.results ?? [];
  const groups = new Map<string, { company: { uid: string; name: string | null }; tasks: unknown[] }>();
  for (const e of all.slice(0, MY_TASKS_MAX)) {
    const key = String(e.company_uid);
    if (!groups.has(key)) groups.set(key, { company: { uid: key, name: e.company_name ?? null }, tasks: [] });
    groups.get(key)!.tasks.push({
      uid: e.uid, title: e.title, type: e.event_type,
      state: e.completion_status === 'completed' ? 'closed' : 'open', due_at: e.due_date,
      needs_reassignment: Number(e.needs_reassignment) === 1, project_id: e.project_id ?? null,
      link: `/account/companies/${encodeURIComponent(key)}/settings/compliance`,
    });
  }
  return { groups: [...groups.values()], has_more: all.length > MY_TASKS_MAX };
}

/**
 * D1614 W4 (#3972) — a project's workload, per person and per agent and per
 * week, and a person's weekly capacity on it.
 *
 * WHICH WEEK. Weeks start Monday 00:00 UTC; the first is the current week. An
 * open task counts in the week of its time block (`scheduled_start`, migration
 * 202611022205), else of its due date. A task with neither is `unscheduled`,
 * listed once per assignee and in no week. Done and cancelled tasks never count.
 *
 * SUMS. `estimate_points` sums the estimates of the week's items; an item with
 * no estimate is counted in `unestimated`, never as 0 points.
 *
 * CAPACITY. A person's `weekly_capacity_points` (`work_capacity`), set in their
 * Team profile. Unset is `{ available: false, reason: 'Not recorded' }`,
 * never 0, and a person with no capacity recorded is never over it
 * (`over_capacity: null`). Agents have no points capacity: their caps are money
 * (D1496), so their `capacity` and `over_capacity` are null.
 *
 * AGENTS' SESSIONS. #3957 adds an agent's scheduled work sessions. They join
 * the weekly rows through `WORKLOAD_DEPS.agentSessions`, which answers nothing
 * until #3957 merges; the shape does not change when it does.
 *
 * A person is `{ uid, name }`; an agent `{ uid, name, role_key }`. Never an email.
 */
import type { Env } from '../../types';
import { personaOf } from './personas';

export const WEEKS_DEFAULT = 4;
export const WEEKS_MAX = 12;
export const NOT_RECORDED = 'Not recorded';

type Block<T> = { available: true; value: T } | { available: false; reason: string };
type Item = { uid: string; title: string; estimate_points: number | null; when: { kind: 'scheduled' | 'due'; at: string } | null };
type TaskRow = {
  uid: string; title: string; estimate_points: number | null; due_at: string | null; scheduled_start: string | null;
  assignee_kind: 'person' | 'agent'; assignee_user_id: number | null; assignee_agent_id: number | null;
};

/** #3957's seam: an agent's scheduled sessions in [from, to), as items. Nothing until #3957 merges. */
export const WORKLOAD_DEPS: { agentSessions: (env: Env, projectId: number, from: string, to: string) => Promise<Array<{ agent_id: number; item: Item }>> } = {
  agentSessions: async () => [],
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday 00:00 UTC of the week holding `now`. */
export function weekStart(now: Date): number {
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(d).getUTCDay() + 6) % 7; // Monday 0
  return d - dow * 86_400_000;
}

/** The week index (0-based) a time falls in, or null outside the range. */
function weekOf(at: string, start: number, weeks: number): number | null {
  const ms = Date.parse(`${at.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const i = Math.floor((ms - start) / (7 * 86_400_000));
  return i >= 0 && i < weeks ? i : null;
}

const sumOf = (items: Item[]) => items.reduce((n, i) => n + (i.estimate_points ?? 0), 0);
const round = (n: number) => Math.round(n * 1000) / 1000;

export function capacityBlock(points: number | null | undefined): Block<number> {
  return points == null ? { available: false, reason: NOT_RECORDED } : { available: true, value: Number(points) };
}

export async function projectWorkload(env: Env, projectId: number, weeks: number, now: Date) {
  const start = weekStart(now);
  const end = start + weeks * 7 * 86_400_000;
  const tasks = (await env.DB.prepare(
    `SELECT uid, title, estimate_points, due_at, scheduled_start, assignee_kind, assignee_user_id, assignee_agent_id
       FROM scope_tasks
      WHERE scope_kind = 'project' AND project_id = ? AND status NOT IN ('done', 'cancelled') AND assignee_kind IN ('person', 'agent')
      ORDER BY COALESCE(scheduled_start, due_at), id`,
  ).bind(projectId).all<TaskRow>()).results ?? [];
  const capacities = new Map(((await env.DB.prepare('SELECT user_id, weekly_capacity_points FROM work_capacity WHERE project_id = ?').bind(projectId)
    .all<{ user_id: number; weekly_capacity_points: number }>()).results ?? []).map((r) => [Number(r.user_id), Number(r.weekly_capacity_points)]));

  type Row = { weeks: Item[][]; unscheduled: Item[] };
  const blank = (): Row => ({ weeks: Array.from({ length: weeks }, () => []), unscheduled: [] });
  const people = new Map<number, Row>();
  const agents = new Map<number, Row>();
  for (const id of capacities.keys()) people.set(id, blank());
  for (const t of tasks) {
    const key = t.assignee_kind === 'person' ? t.assignee_user_id : t.assignee_agent_id;
    if (key == null) continue;
    const table = t.assignee_kind === 'person' ? people : agents;
    if (!table.has(key)) table.set(key, blank());
    const when = t.scheduled_start ? { kind: 'scheduled' as const, at: t.scheduled_start } : t.due_at ? { kind: 'due' as const, at: t.due_at } : null;
    const item: Item = { uid: t.uid, title: t.title, estimate_points: t.estimate_points == null ? null : Number(t.estimate_points), when };
    if (!when) { table.get(key)!.unscheduled.push(item); continue; }
    const w = weekOf(when.at, start, weeks);
    if (w != null) table.get(key)!.weeks[w].push(item);
  }
  for (const s of await WORKLOAD_DEPS.agentSessions(env, projectId, day(start), day(end))) {
    if (!agents.has(s.agent_id)) agents.set(s.agent_id, blank());
    const w = s.item.when ? weekOf(s.item.when.at, start, weeks) : null;
    if (w != null) agents.get(s.agent_id)!.weeks[w].push(s.item);
  }

  const weekRows = (r: Row, capacity: Block<number> | null) => r.weeks.map((items, i) => {
    const points = round(sumOf(items));
    return {
      week_start: day(start + i * 7 * 86_400_000),
      items, estimate_points: points, unestimated: items.filter((x) => x.estimate_points == null).length,
      over_capacity: capacity && capacity.available ? points > capacity.value : null,
    };
  });

  const personRows = [];
  for (const [id, r] of people) {
    const u = await env.DB.prepare('SELECT uid, name FROM users WHERE id = ?').bind(id).first<{ uid: string; name: string | null }>();
    if (!u) continue;
    const capacity = capacityBlock(capacities.get(id));
    personRows.push({ person: { uid: u.uid, name: u.name }, capacity, weeks: weekRows(r, capacity), unscheduled: r.unscheduled });
  }
  const agentRows = [];
  for (const [id, r] of agents) {
    const a = await env.DB.prepare('SELECT uid, role_key, first_name, last_name, persona_key FROM team_agents WHERE id = ?').bind(id)
      .first<{ uid: string; role_key: string; first_name: string | null; last_name: string | null; persona_key: string | null }>();
    if (!a) continue;
    const name = personaOf(a.persona_key)?.name ?? ([a.first_name, a.last_name].filter(Boolean).join(' ') || a.role_key);
    agentRows.push({ agent: { uid: a.uid, name, role_key: a.role_key }, capacity: null, weeks: weekRows(r, null), unscheduled: r.unscheduled });
  }
  personRows.sort((x, y) => String(x.person.name ?? '').localeCompare(String(y.person.name ?? '')));
  agentRows.sort((x, y) => x.agent.name.localeCompare(y.agent.name));
  return { weeks: Array.from({ length: weeks }, (_, i) => day(start + i * 7 * 86_400_000)), people: personRows, agents: agentRows };
}

/** Set or clear (null) a person's weekly capacity on a project. */
export async function setCapacity(env: Env, projectId: number, userId: number, points: number | null, by: number) {
  if (points == null) {
    await env.DB.prepare('DELETE FROM work_capacity WHERE project_id = ? AND user_id = ?').bind(projectId, userId).run();
    return capacityBlock(null);
  }
  await env.DB.prepare(
    `INSERT INTO work_capacity (project_id, user_id, weekly_capacity_points, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT (project_id, user_id) DO UPDATE SET weekly_capacity_points = excluded.weekly_capacity_points, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
  ).bind(projectId, userId, points, by).run();
  return capacityBlock(points);
}

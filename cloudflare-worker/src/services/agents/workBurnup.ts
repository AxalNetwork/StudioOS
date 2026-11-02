/**
 * D1614 W2 (#3970) — a project's burn-up, derived from `scope_task_events`.
 *
 * Projects only (owner revision, 2026-11-01): a company has no Kanban and
 * nothing rolls up to it. Nothing is stored: every read replays the
 * project's events, so the series cannot drift from the board.
 *
 * Each day, in the member's time zone (`user_settings.timezone`, else UTC),
 * is a snapshot taken at the end of that day:
 *   - `completed`: items closed as completed (status done);
 *   - `not_planned`, `duplicate`: items closed with that reason (cancelled);
 *   - `open`: every other item that exists;
 *   - `scope = completed + open`: the work still in the plan. An item closed
 *     as not planned or duplicate leaves the scope, and comes back if reopened;
 *   - `completed_by`: completed items by the assignee kind they had when
 *     they were completed (`person`, `agent`, or `none`).
 * A day before the project's first item is `{ day, available: false }`,
 * never zeros; a project with no item in the range answers
 * `{ available: false }`.
 *
 * Which events say what:
 *   - `created`: the item exists. W1's carries `column` (an item created in
 *     Done is completed); E1's carries `assignee_kind`.
 *   - `status` (`from`, `to`), and W1's `moved`/`updated` with `to_status`
 *     and `close_reason`: done is completed; cancelled is not planned unless
 *     the close reason says duplicate; anything else is open. A bare `status`
 *     to cancelled keeps a close reason already known for that item.
 *   - `assigned` (`assignee_kind`): who would be credited from then on. An
 *     item with no `assigned` event at all is credited to its current
 *     assignee kind.
 *
 * Bound SQL only. The read is bounded by the range's end; events before the
 * range start are read too, because they set each item's state on day one.
 */
import type { Env } from '../../types';
import { isValidTimeZone } from '../userSettings';
import { projectBoard, WorkRefusal } from './workBoard';
import type { Scope } from './teams';

type Project = Extract<Scope, { kind: 'project' }>;
type State = 'open' | 'completed' | 'not_planned' | 'duplicate';
type Kind = 'person' | 'agent' | 'none';

export const BURN_RANGE_DAYS = Object.freeze({ '2w': 14, '1m': 30, '3m': 90 } as const);
export const BURN_MAX_DAYS = 730;
export const BURN_TASK_CAP = 5000;
export const BURN_EVENT_CAP = 200_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type BurnPoint =
  | { day: string; available: false }
  | { day: string; scope: number; completed: number; open: number; not_planned: number; duplicate: number;
      completed_by: { person: number; agent: number; none: number } };
export type Burnup =
  | { available: false; range: { from: string; to: string; time_zone: string } | null }
  | { available: true; range: { from: string; to: string; time_zone: string }; series: BurnPoint[] };

// One formatter per zone: building one per event was most of the read's time.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (tz: string) => {
  let f = FORMATTERS.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); FORMATTERS.set(tz, f); }
  return f;
};

/** The local calendar day of a UTC instant in `tz`, as YYYY-MM-DD. */
export function localDay(utc: Date, tz: string): string {
  const p = formatterFor(tz).formatToParts(utc);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `created_at` as D1 writes it (`YYYY-MM-DD HH:MM:SS`, UTC), or an ISO string. */
export function utcOf(stamp: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(stamp) ? stamp : `${stamp.replace(' ', 'T')}Z`);
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const validDay = (v: string) => DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const bad = (message: string): never => { throw new WorkRefusal(400, 'invalid_range', message); };

export async function memberTimeZone(env: Env, userId: number): Promise<string> {
  try {
    const row = await env.DB.prepare('SELECT timezone FROM user_settings WHERE user_id = ?').bind(userId).first<{ timezone: string | null }>();
    const tz = row?.timezone?.trim();
    return tz && isValidTimeZone(tz) ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

type EventRow = { task_id: number; kind: string; detail_json: string | null; created_at: string };
type TaskRow = { id: number; status: string; close_reason: string | null; assignee_kind: Kind; created_at: string };

const parse = (s: string | null): Record<string, any> => {
  try { const v = s ? JSON.parse(s) : null; return v && typeof v === 'object' ? v : {}; } catch { return {}; }
};
function stateOf(status: unknown, reason: unknown): State | null {
  if (status === 'done') return 'completed';
  if (status === 'cancelled') return reason === 'duplicate' ? 'duplicate' : 'not_planned';
  if (typeof status === 'string') return 'open';
  return null;
}

export type BurnQuery = { range?: string | null; from?: string | null; to?: string | null; filter?: string | null };

export async function projectBurnup(env: Env, scope: Project, q: BurnQuery, tz: string, now = new Date()): Promise<Burnup> {
  const today = localDay(now, tz);
  let to = q.to ?? null, from = q.from ?? null;
  if ((from == null) !== (to == null)) bad('A custom range names both from and to.');
  if (to != null && !validDay(to)) bad('to is a day, such as 2026-11-30.');
  if (from != null && !validDay(from)) bad('from is a day, such as 2026-11-01.');
  const range = q.range ?? '2w';
  if (from == null && !(range in BURN_RANGE_DAYS) && range !== 'max') bad('The range is 2w, 1m, 3m or max, or from and to.');
  to ??= today;

  // Which items: every item of the project, or the ones the board filter keeps.
  let only: Set<number> | null = null;
  const filter = q.filter?.trim() ?? '';
  if (filter) {
    const board = await projectBoard(env, scope, filter);
    const uids = new Set(board.items.map((c: { uid: string }) => c.uid));
    const rows = await env.DB.prepare(`SELECT id, uid FROM scope_tasks WHERE scope_kind = 'project' AND project_id = ?`).bind(scope.id).all<{ id: number; uid: string }>();
    only = new Set((rows.results ?? []).filter((r) => uids.has(r.uid)).map((r) => r.id));
  }
  const tasks = (await env.DB.prepare(
    `SELECT id, status, close_reason, assignee_kind, created_at FROM scope_tasks
      WHERE scope_kind = 'project' AND project_id = ? ORDER BY id LIMIT ?`,
  ).bind(scope.id, BURN_TASK_CAP + 1).all<TaskRow>()).results ?? [];
  if (tasks.length > BURN_TASK_CAP) throw new WorkRefusal(413, 'burnup_too_large', 'This project has more items than one burn-up can read.');
  const byId = new Map(tasks.filter((t) => !only || only.has(t.id)).map((t) => [t.id, t]));

  // Bounded by the range's end: a UTC upper bound two days past `to` covers every
  // time zone; the local day of each event then decides which days it counts in.
  const upper = `${addDays(to, 2)} 00:00:00`;
  const events = (await env.DB.prepare(
    `SELECT e.task_id, e.kind, e.detail_json, e.created_at FROM scope_task_events e
       JOIN scope_tasks t ON t.id = e.task_id
      WHERE t.scope_kind = 'project' AND t.project_id = ? AND e.created_at < ?
      ORDER BY e.created_at, e.id LIMIT ?`,
  ).bind(scope.id, upper, BURN_EVENT_CAP + 1).all<EventRow>()).results ?? [];
  if (events.length > BURN_EVENT_CAP) throw new WorkRefusal(413, 'burnup_too_large', 'This project has more activity than one burn-up can read.');

  // Each item's first appearance, its transitions and its assignee changes, by local day.
  type Step = { day: string; at: number; task: number; created?: State; state?: State; kind?: Kind; keepReason?: boolean };
  const steps: Step[] = [];
  const seenCreated = new Set<number>();
  const hasAssigned = new Set(events.filter((e) => e.kind === 'assigned').map((e) => e.task_id));
  for (const e of events) {
    if (!byId.has(e.task_id)) continue;
    const when = utcOf(e.created_at);
    const day = localDay(when, tz);
    // A step after `to` is never applied: the sweep below stops at `to`.
    const d = parse(e.detail_json);
    const at = when.getTime();
    if (e.kind === 'created') {
      seenCreated.add(e.task_id);
      const initial: State = d.column === 'done' ? (stateOf(byId.get(e.task_id)!.status, byId.get(e.task_id)!.close_reason) ?? 'completed') : 'open';
      steps.push({ day, at, task: e.task_id, created: initial, kind: hasAssigned.has(e.task_id) ? (d.assignee_kind ?? 'none') : byId.get(e.task_id)!.assignee_kind });
    } else if (e.kind === 'status') {
      // A bare `status` carries no close reason: a cancellation keeps the reason its
      // companion `moved`/`updated` event already gave (W1 writes that one first).
      const s = stateOf(d.to, null);
      if (s) steps.push({ day, at, task: e.task_id, state: s, keepReason: s === 'not_planned' });
    } else if ((e.kind === 'moved' || e.kind === 'updated') && 'to_status' in d) {
      const s = stateOf(d.to_status, d.close_reason);
      if (s) steps.push({ day, at, task: e.task_id, state: s });
    } else if (e.kind === 'assigned' && ['person', 'agent', 'none'].includes(d.assignee_kind)) {
      steps.push({ day, at, task: e.task_id, kind: d.assignee_kind });
    }
  }
  // An item whose `created` event is missing (written before events were kept) exists from its own created_at.
  for (const t of byId.values()) {
    if (seenCreated.has(t.id)) continue;
    const when = utcOf(t.created_at);
    const day = localDay(when, tz);
    if (day > to) continue;
    steps.push({ day, at: when.getTime() - 1, task: t.id, created: 'open', kind: t.assignee_kind });
    steps.push({ day, at: when.getTime(), task: t.id, state: stateOf(t.status, t.close_reason) ?? 'open' });
  }
  steps.sort((a, b) => a.at - b.at);

  const firstDay = steps.find((s) => s.created)?.day ?? null;
  if (from == null) from = range === 'max' ? (firstDay ?? to) : addDays(to, -(BURN_RANGE_DAYS[range as keyof typeof BURN_RANGE_DAYS] - 1));
  if (from > to) bad('from is on or before to.');
  if (daysBetween(from, to) + 1 > BURN_MAX_DAYS) bad(`A burn-up covers at most ${BURN_MAX_DAYS} days.`);
  const rangeOut = { from, to, time_zone: tz };
  if (!firstDay || firstDay > to) return { available: false, range: rangeOut };

  // One sweep: apply each day's steps, then snapshot the end of that day.
  const state = new Map<number, State>();
  const kind = new Map<number, Kind>();
  const creditedTo = new Map<number, Kind>();
  const counts = { open: 0, completed: 0, not_planned: 0, duplicate: 0 };
  const by = { person: 0, agent: 0, none: 0 };
  const move = (task: number, next: State) => {
    const prev = state.get(task);
    if (prev === next) return;
    if (prev) counts[prev]--;
    if (prev === 'completed') { by[creditedTo.get(task)!]--; creditedTo.delete(task); }
    counts[next]++;
    if (next === 'completed') { const k = kind.get(task) ?? 'none'; by[k]++; creditedTo.set(task, k); }
    state.set(task, next);
  };
  const series: BurnPoint[] = [];
  let i = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    while (i < steps.length && steps[i].day <= day) {
      const s = steps[i++];
      if (s.kind) kind.set(s.task, s.kind);
      if (s.created && !state.has(s.task)) move(s.task, s.created);
      else if (s.state && state.has(s.task)) {
        const now = state.get(s.task);
        move(s.task, s.keepReason && (now === 'duplicate' || now === 'not_planned') ? now : s.state);
      }
    }
    if (!state.size) { series.push({ day, available: false }); continue; }
    series.push({ day, scope: counts.completed + counts.open, ...counts, completed_by: { ...by } });
  }
  return { available: true, range: rangeOut, series };
}

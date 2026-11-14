/**
 * D1529 (#3845, E1 of #3742) — a scope's goals (migration 727's `scope_goals`).
 *
 * A goal belongs to one company or one project. A project goal may roll up to
 * a goal of the company the project sits in (`parent_goal_id`), and may link
 * one of the project's OKRs (`okr_id`). The roll-up holds only while the
 * project is in that company: a project moved out (`POST /api/projects/:id/move`)
 * keeps the column, and the read answers `parent: null` until it moves back.
 *
 * `progress` is `{ done, total }` over the goal's tasks, cancelled ones left
 * out. `cost` is the sum of its tasks' costs, `{ available: false }` when any
 * is unknown (never 0 for unknown).
 *
 * Bound SQL only. Nothing here reads a prompt or writes one.
 */
import type { Env } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { scopeCols, type Scope, type Spend } from './teams';

export const LIFECYCLE_STAGES = ['idea', 'validate', 'build', 'launch', 'raise', 'grow'] as const;
export const GOAL_STATUSES = ['open', 'achieved', 'dropped'] as const;
const TITLE_MAX = 200, WHY_MAX = 2000, METRIC_MAX = 200;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type GoalRow = {
  id: number; uid: string; scope_kind: 'company' | 'project'; company_id: number | null; project_id: number | null;
  title: string; why: string | null; metric: string | null; target_date: string | null; stage: string | null;
  parent_goal_id: number | null; okr_id: number | null; status: string; priority: number;
  created_at: string; updated_at: string;
};

export type Refusal = { status: number; code: string; message: string };
const no = (status: number, code: string, message: string): Refusal => ({ status, code, message });
const invalid = (message: string) => no(400, 'invalid_goal', message);

/** A text field: trimmed, at most `max`, no control characters; null clears it. `undefined` = not sent. */
export function text(v: unknown, max: number, required = false): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null) return required ? { ok: false } : { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.trim();
  if (t.length > max || CONTROL.test(t) || (required && !t)) return { ok: false };
  return { ok: true, value: t || null };
}

const validDate = (v: string) => DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export type GoalWrite = {
  title?: string; why?: string | null; metric?: string | null; target_date?: string | null; stage?: string | null;
  parent_goal_id?: number | null; okr_id?: number | null; status?: string; priority?: number;
};

/**
 * Read a goal's body against its scope. `creating` requires a title. The
 * parent comes by uid and the OKR by id; both are resolved and checked here.
 */
export async function goalWrite(env: Env, s: Scope, b: Record<string, any>, creating: boolean): Promise<{ ok: true; write: GoalWrite } | { ok: false; refusal: Refusal }> {
  const w: GoalWrite = {};
  if (creating || 'title' in b) {
    const t = text(b.title, TITLE_MAX, true);
    if (!t.ok) return { ok: false, refusal: invalid(`A goal has a title of at most ${TITLE_MAX} characters.`) };
    w.title = t.value!;
  }
  for (const [k, max] of [['why', WHY_MAX], ['metric', METRIC_MAX]] as const) {
    if (!(k in b)) continue;
    const t = text(b[k], max);
    if (!t.ok) return { ok: false, refusal: invalid(`${k} is at most ${max} characters.`) };
    w[k] = t.value;
  }
  if ('target_date' in b) {
    if (b.target_date !== null && !(typeof b.target_date === 'string' && validDate(b.target_date))) {
      return { ok: false, refusal: invalid('The target date is a day, such as 2027-03-31.') };
    }
    w.target_date = b.target_date;
  }
  if ('stage' in b) {
    if (b.stage !== null && !(LIFECYCLE_STAGES as readonly string[]).includes(b.stage)) {
      return { ok: false, refusal: invalid(`The stage is one of ${LIFECYCLE_STAGES.join(', ')}.`) };
    }
    if (b.stage !== null && s.kind !== 'project') return { ok: false, refusal: invalid('Only a project goal has a stage.') };
    w.stage = b.stage;
  }
  if ('status' in b) {
    if (!(GOAL_STATUSES as readonly string[]).includes(b.status)) return { ok: false, refusal: invalid('A goal is open, achieved or dropped.') };
    w.status = b.status;
  }
  if ('priority' in b) {
    if (!Number.isSafeInteger(b.priority) || b.priority < 0 || b.priority > 1000) return { ok: false, refusal: invalid('The priority is a whole number from 0 to 1000.') };
    w.priority = b.priority;
  }
  if ('parent_goal_uid' in b) {
    if (b.parent_goal_uid === null) w.parent_goal_id = null;
    else {
      // Only a project in a company rolls up, and only to a goal of that company.
      const parent = typeof b.parent_goal_uid === 'string'
        ? await env.DB.prepare("SELECT id, company_id FROM scope_goals WHERE uid = ? AND scope_kind = 'company'").bind(b.parent_goal_uid).first<{ id: number; company_id: number }>()
        : null;
      if (s.kind !== 'project' || !s.company_id || !parent || parent.company_id !== s.company_id) {
        return { ok: false, refusal: no(422, 'parent_not_in_company', 'A project goal rolls up only to a goal of the company the project is in.') };
      }
      w.parent_goal_id = parent.id;
    }
  }
  if ('okr_id' in b) {
    if (b.okr_id === null) w.okr_id = null;
    else {
      const okr = Number.isSafeInteger(b.okr_id) && s.kind === 'project'
        ? await env.DB.prepare('SELECT id FROM roadmap_okrs WHERE id = ? AND project_id = ?').bind(b.okr_id, s.id).first<{ id: number }>()
        : null;
      if (!okr) return { ok: false, refusal: no(422, 'okr_not_in_project', 'A goal links only an OKR of its own project.') };
      w.okr_id = okr.id;
    }
  }
  return { ok: true, write: w };
}

export async function insertGoal(env: Env, s: Scope, w: GoalWrite, by: number): Promise<GoalRow> {
  const [companyId, projectId] = scopeCols(s);
  const uid = newUid();
  await env.DB.prepare(
    `INSERT INTO scope_goals (uid, scope_kind, company_id, project_id, title, why, metric, target_date, stage, parent_goal_id, okr_id, status, priority, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, s.kind, companyId, projectId, w.title!, w.why ?? null, w.metric ?? null, w.target_date ?? null, w.stage ?? null,
    w.parent_goal_id ?? null, w.okr_id ?? null, w.status ?? 'open', w.priority ?? 0, by).run();
  return (await goalByUid(env, uid))!;
}

export async function updateGoal(env: Env, g: GoalRow, w: GoalWrite): Promise<GoalRow> {
  const next = { ...g, ...w };
  await env.DB.prepare(
    `UPDATE scope_goals SET title = ?, why = ?, metric = ?, target_date = ?, stage = ?, parent_goal_id = ?, okr_id = ?, status = ?, priority = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(next.title, next.why, next.metric, next.target_date, next.stage, next.parent_goal_id, next.okr_id, next.status, next.priority, g.id).run();
  return (await goalByUid(env, g.uid))!;
}

export async function goalByUid(env: Env, uid: string): Promise<GoalRow | null> {
  if (!/^[a-f0-9]{32}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM scope_goals WHERE uid = ?').bind(uid).first<GoalRow>();
}

export async function goalsOf(env: Env, s: Scope): Promise<GoalRow[]> {
  const [companyId, projectId] = scopeCols(s);
  const r = await env.DB.prepare(
    `SELECT * FROM scope_goals WHERE scope_kind = ? AND IFNULL(company_id, 0) = ? AND IFNULL(project_id, 0) = ?
      ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'achieved' THEN 1 ELSE 2 END, priority DESC, id`,
  ).bind(s.kind, companyId ?? 0, projectId ?? 0).all<GoalRow>();
  return r.results ?? [];
}

/** The sum of known costs, or unknown when any is unknown. An empty list is a known 0. */
export function sumCosts(costs: Spend[]): Spend {
  let total = 0;
  for (const c of costs) {
    if (!c.available) return { available: false };
    total += c.value_microusd;
  }
  return { available: true, value_microusd: total };
}

/** The goal as the page reads it. `tasks` are the goal's tasks' status and cost. */
export async function goalDto(env: Env, s: Scope, g: GoalRow, tasks: { status: string; cost: Spend }[]) {
  let parent: { uid: string; title: string } | null = null;
  if (g.parent_goal_id) {
    const p = await env.DB.prepare("SELECT uid, title, company_id FROM scope_goals WHERE id = ? AND scope_kind = 'company'")
      .bind(g.parent_goal_id).first<{ uid: string; title: string; company_id: number }>();
    // The roll-up holds only while the project is in the parent's company.
    if (p && s.kind === 'project' && s.company_id === p.company_id) parent = { uid: p.uid, title: p.title };
  }
  const live = tasks.filter((t) => t.status !== 'cancelled');
  return {
    uid: g.uid, title: g.title, why: g.why, metric: g.metric, target_date: g.target_date, stage: g.stage,
    parent, okr_id: g.okr_id, status: g.status, priority: g.priority,
    progress: { done: live.filter((t) => t.status === 'done').length, total: live.length },
    cost: tasks.length ? sumCosts(tasks.map((t) => t.cost)) : { available: false } as Spend,
  };
}

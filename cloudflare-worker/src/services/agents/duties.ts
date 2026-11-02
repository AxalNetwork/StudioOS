/**
 * D1530 (#3849, E5 of #3742) — an agent's duties: a recurring task it is due
 * to draft (migration 728's `agent_duties`).
 *
 * THE TEMPLATES are the role templates' duties (`templates.ts`), keyed
 * `<role_key>.<duty key>`, for example `cfo.runway`. A duty's module and
 * option are the template's, and the agent's rule book must still allow both
 * (`agentFits`): a template of another role is 422 `template_not_in_role`.
 * One live duty per template per agent (409 `duty_exists`, the unique index).
 *
 * CLAIM BEFORE ACT. The sweep (`src/agents/sweep.ts`, every 5 minutes) reads
 * the active duties that are due and claims each with
 *   UPDATE agent_duties SET next_due_at = ?, last_claimed_at = ?
 *    WHERE id = ? AND next_due_at = ? AND status = 'active'
 * and only a claim that changed one row acts. Two sweeps, or two deployments,
 * reading the same due duty create one task between them.
 *
 * WHAT A CLAIM DOES, the slot having moved on either way:
 *   - the agent is not active (paused):       `skipped:agent_paused`, nothing runs;
 *   - the sponsor has no AI tokens left (Q2 A): `skipped:no_tokens`, nothing is queued;
 *   - otherwise a task (`kind = 'duty'`, `source_kind = 'duty'`, `source_ref` the
 *     duty's uid) assigned to the agent, and the sponsor is told. With
 *     AGENT_AUTONOMY `manual` (the default) nothing runs until a person
 *     presses Start; with `self_start` the scope's object is asked to admit it.
 * A sponsor's balance that cannot be read does not skip: creating a task
 * spends nothing, and the run itself still passes every spend check.
 *
 * MISSED SLOTS. The next slot is always the first one AFTER the claim's own
 * time, so a duty missed through an outage runs once and jumps to the next
 * future slot: no backlog storm.
 *
 * Bound SQL only. Codes in logs, never a title or a prompt.
 */
import type { Env } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { budgetAllows } from '../channels/voiceFailures';
import { agentFits, insertTask, type TaskRow } from './tasks';
import { scopeOfAgent, type AgentRow } from './teams';
import { TEMPLATES, type Duty } from './templates';
import type { Refusal } from './goals';

export const CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];
/** At most this many duties claimed in one sweep. */
export const DUTY_SWEEP_MAX = 60;
/** At most this many live duties per agent. */
export const DUTIES_PER_AGENT_MAX = 12;
const TITLE_MAX = 200;

export type DutyTemplate = { key: string; role_key: string; title: string; module: string; option: string; runs_per_month: number; cadence: Cadence };

/** The default cadence of a template, from how often it runs a month. */
const cadenceOf = (d: Duty): Cadence => (d.runs_per_month >= 20 ? 'daily' : d.runs_per_month >= 4 ? 'weekly' : 'monthly');

/** Every role's duty templates, `<role_key>.<duty key>`. */
export const DUTY_TEMPLATES: readonly DutyTemplate[] = Object.freeze(TEMPLATES.flatMap((t) => t.duties.map((d) => Object.freeze({
  key: `${t.role_key}.${d.key}`, role_key: t.role_key, title: d.label, module: d.module, option: d.option,
  runs_per_month: d.runs_per_month, cadence: cadenceOf(d),
}))));
export const dutyTemplateOf = (key: string): DutyTemplate | null => DUTY_TEMPLATES.find((t) => t.key === key) ?? null;

export type DutyRow = {
  id: number; uid: string; agent_id: number; template_key: string; title: string; module: string | null; option: string | null;
  cadence: Cadence; weekday: number | null; day_of_month: number | null; hour_utc: number; next_due_at: string;
  last_claimed_at: string | null; last_outcome: string | null; status: 'active' | 'paused' | 'removed';
  created_by: number | null; created_at: string; updated_at: string;
};

/** `YYYY-MM-DD HH:MM:SS`, UTC: the form every timestamp column here is compared in. */
export const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
export const fromSql = (s: string) => new Date(`${s.replace(' ', 'T')}Z`);

/**
 * The first slot strictly after `after`. Weekly: the weekday (0 = Sunday) at
 * the hour. Monthly: the day of the month, the month's last day when it has
 * fewer days. Daily: the hour.
 */
export function nextDue(d: Pick<DutyRow, 'cadence' | 'weekday' | 'day_of_month' | 'hour_utc'>, after: Date): Date {
  const at = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day, d.hour_utc, 0, 0));
  const y = after.getUTCFullYear(), m = after.getUTCMonth(), day = after.getUTCDate();
  if (d.cadence === 'daily') {
    const today = at(y, m, day);
    return today > after ? today : at(y, m, day + 1);
  }
  if (d.cadence === 'weekly') {
    const ahead = ((Number(d.weekday) - after.getUTCDay()) + 7) % 7;
    const slot = at(y, m, day + ahead);
    return slot > after ? slot : at(y, m, day + ahead + 7);
  }
  const inMonth = (yy: number, mm: number) => {
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return at(yy, mm, Math.min(Number(d.day_of_month ?? 1), last));
  };
  const slot = inMonth(y, m);
  return slot > after ? slot : inMonth(y, m + 1);
}

// ── Writes ──────────────────────────────────────────────────────────────────

const no = (status: number, code: string, message: string): Refusal => ({ status, code, message });
const int = (v: unknown, lo: number, hi: number): number | null => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null);

export type DutyInput = { template: unknown; cadence?: unknown; weekday?: unknown; day_of_month?: unknown; hour_utc?: unknown; title?: unknown };
type Schedule = Pick<DutyRow, 'cadence' | 'weekday' | 'day_of_month' | 'hour_utc'>;

/** The schedule a body asks for, over the template's defaults: Monday, the 1st, 08:00 UTC. */
function scheduleOf(b: Partial<DutyInput>, base: Schedule): { ok: true; s: Schedule } | { ok: false; refusal: Refusal } {
  const cadence = b.cadence === undefined ? base.cadence : (CADENCES as readonly unknown[]).includes(b.cadence) ? (b.cadence as Cadence) : null;
  if (!cadence) return { ok: false, refusal: no(400, 'invalid_duty', 'A duty runs daily, weekly or monthly.') };
  const hour = b.hour_utc === undefined ? base.hour_utc : int(b.hour_utc, 0, 23);
  if (hour == null) return { ok: false, refusal: no(400, 'invalid_duty', 'The hour is a whole number from 0 to 23, in UTC.') };
  let weekday: number | null = null, dom: number | null = null;
  if (cadence === 'weekly') {
    weekday = b.weekday === undefined ? base.weekday ?? 1 : int(b.weekday, 0, 6);
    if (weekday == null) return { ok: false, refusal: no(400, 'invalid_duty', 'The weekday is 0 (Sunday) to 6 (Saturday).') };
  }
  if (cadence === 'monthly') {
    dom = b.day_of_month === undefined ? base.day_of_month ?? 1 : int(b.day_of_month, 1, 31);
    if (dom == null) return { ok: false, refusal: no(400, 'invalid_duty', 'The day of the month is 1 to 31; a shorter month uses its last day.') };
  }
  return { ok: true, s: { cadence, weekday, day_of_month: dom, hour_utc: hour } };
}

/** Add a duty to an agent: its template must be the agent's role's, and still allowed by its rule book. */
export async function addDuty(env: Env, a: AgentRow, b: DutyInput, by: number, now = new Date()): Promise<{ ok: true; duty: DutyRow } | { ok: false; refusal: Refusal }> {
  const t = typeof b.template === 'string' ? dutyTemplateOf(b.template) : null;
  if (!t || t.role_key !== a.role_key) return { ok: false, refusal: no(422, 'template_not_in_role', 'That duty is not one of this agent’s role.') };
  const fits = await agentFits(env, a, t.module, t.option);
  if (fits) return { ok: false, refusal: no(422, 'template_not_in_role', 'This agent’s rule book no longer allows that duty’s module or option.') };
  const sched = scheduleOf(b, { cadence: t.cadence, weekday: 1, day_of_month: 1, hour_utc: 8 });
  if (!sched.ok) return sched;
  let title = t.title;
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > TITLE_MAX) return { ok: false, refusal: no(400, 'invalid_duty', `A duty's title is at most ${TITLE_MAX} characters.`) };
    title = b.title.trim();
  }
  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_duties WHERE agent_id = ? AND status <> 'removed'").bind(a.id).first<{ n: number }>();
  if (Number(live?.n ?? 0) >= DUTIES_PER_AGENT_MAX) return { ok: false, refusal: no(409, 'too_many_duties', `An agent has at most ${DUTIES_PER_AGENT_MAX} duties.`) };
  const uid = newUid();
  try {
    await env.DB.prepare(
      `INSERT INTO agent_duties (uid, agent_id, template_key, title, module, option, cadence, weekday, day_of_month, hour_utc, next_due_at, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).bind(uid, a.id, t.key, title, t.module, t.option, sched.s.cadence, sched.s.weekday, sched.s.day_of_month, sched.s.hour_utc,
      sqlTime(nextDue(sched.s, now)), by).run();
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) return { ok: false, refusal: no(409, 'duty_exists', 'This agent already has that duty.') };
    throw e;
  }
  return { ok: true, duty: (await dutyByUid(env, uid))! };
}

/** Change a duty's schedule, title or status (`active` or `paused`). The next slot is worked out again. */
export async function updateDuty(env: Env, d: DutyRow, b: Partial<DutyInput> & { status?: unknown }, now = new Date()): Promise<{ ok: true; duty: DutyRow } | { ok: false; refusal: Refusal }> {
  if (d.status === 'removed') return { ok: false, refusal: no(404, 'not_found', 'There is no such duty.') };
  const sched = scheduleOf(b, d);
  if (!sched.ok) return sched;
  let status = d.status;
  if (b.status !== undefined) {
    if (b.status !== 'active' && b.status !== 'paused') return { ok: false, refusal: no(400, 'invalid_duty', 'A duty is active or paused.') };
    status = b.status;
  }
  let title = d.title;
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > TITLE_MAX) return { ok: false, refusal: no(400, 'invalid_duty', `A duty's title is at most ${TITLE_MAX} characters.`) };
    title = b.title.trim();
  }
  await env.DB.prepare(
    `UPDATE agent_duties SET title = ?, cadence = ?, weekday = ?, day_of_month = ?, hour_utc = ?, next_due_at = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status <> 'removed'`,
  ).bind(title, sched.s.cadence, sched.s.weekday, sched.s.day_of_month, sched.s.hour_utc, sqlTime(nextDue(sched.s, now)), status, d.id).run();
  return { ok: true, duty: (await dutyByUid(env, d.uid))! };
}

export async function removeDuty(env: Env, d: DutyRow): Promise<void> {
  await env.DB.prepare("UPDATE agent_duties SET status = 'removed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status <> 'removed'").bind(d.id).run();
}

export async function dutyByUid(env: Env, uid: string): Promise<DutyRow | null> {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(uid)) return null;
  return env.DB.prepare('SELECT * FROM agent_duties WHERE uid = ?').bind(uid).first<DutyRow>();
}

export async function dutiesOf(env: Env, agentId: number): Promise<DutyRow[]> {
  return (await env.DB.prepare("SELECT * FROM agent_duties WHERE agent_id = ? AND status <> 'removed' ORDER BY id").bind(agentId).all<DutyRow>()).results ?? [];
}

/** How many runs a schedule makes in a month, for the estimate. */
export const runsPerMonth = (d: Pick<DutyRow, 'cadence'>) => (d.cadence === 'daily' ? 30 : d.cadence === 'weekly' ? 4 : 1);

// ── The sweep ───────────────────────────────────────────────────────────────

export type DutyDeps = {
  /** Whether the sponsor has AI tokens left; null when it cannot be read. */
  tokensLeft: (env: Env, userId: number) => Promise<boolean | null>;
  /** With `self_start`: ask the scope's object to admit the duty's task. */
  admit: ((env: Env, a: AgentRow, task: TaskRow) => Promise<void>) | null;
  /** Tell the sponsor a duty made a task. */
  tell: (env: Env, a: AgentRow, task: TaskRow) => Promise<void>;
};

export type ClaimOutcome = 'not_claimed' | 'task_created' | 'skipped:agent_paused' | 'skipped:no_tokens' | 'skipped:scope_gone';

/**
 * Claim one due duty and act on it. Returns `not_claimed` when another
 * sweep moved it first: then nothing at all is written.
 */
export async function claimDuty(env: Env, d: DutyRow, now: Date, deps: DutyDeps): Promise<{ outcome: ClaimOutcome; task?: TaskRow }> {
  const next = sqlTime(nextDue(d, now));
  const claimed = await env.DB.prepare(
    'UPDATE agent_duties SET next_due_at = ?, last_claimed_at = ? WHERE id = ? AND next_due_at = ? AND status = \'active\'',
  ).bind(next, sqlTime(now), d.id, d.next_due_at).run();
  if (Number(claimed.meta?.changes ?? 0) !== 1) return { outcome: 'not_claimed' };
  const record = async (outcome: ClaimOutcome) => {
    await env.DB.prepare('UPDATE agent_duties SET last_outcome = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(outcome, d.id).run();
    return outcome;
  };
  const a = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(d.agent_id).first<AgentRow>();
  if (!a || a.status !== 'active') return { outcome: await record('skipped:agent_paused') };
  const s = await scopeOfAgent(env, a);
  if (!s) return { outcome: await record('skipped:scope_gone') };
  if (await deps.tokensLeft(env, a.sponsor_user_id) === false) return { outcome: await record('skipped:no_tokens') };
  const task = await insertTask(env, s, {
    title: d.title.slice(0, TITLE_MAX), module: d.module, option: d.option, kind: 'duty',
    assignee_kind: 'agent', assignee_agent_id: a.id, status: 'open', source_kind: 'duty', source_ref: d.uid,
  }, a.sponsor_user_id);
  await record('task_created');
  try { await deps.tell(env, a, task); } catch { console.warn('[agents] duty_tell_failed'); }
  if (deps.admit) {
    try { await deps.admit(env, a, task); } catch { console.warn('[agents] duty_admit_failed'); }
  }
  return { outcome: 'task_created', task };
}

/** The due active duties of live agents, oldest first, at most `DUTY_SWEEP_MAX`. */
export async function dueDuties(env: Env, now: Date): Promise<DutyRow[]> {
  return (await env.DB.prepare(
    `SELECT d.* FROM agent_duties d JOIN team_agents a ON a.id = d.agent_id
      WHERE d.status = 'active' AND d.next_due_at <= ? AND a.status <> 'removed'
      ORDER BY d.next_due_at, d.id LIMIT ?`,
  ).bind(sqlTime(now), DUTY_SWEEP_MAX).all<DutyRow>()).results ?? [];
}

export async function sweepDuties(env: Env, now: Date, deps: DutyDeps): Promise<Record<ClaimOutcome, number>> {
  const out = { not_claimed: 0, task_created: 0, 'skipped:agent_paused': 0, 'skipped:no_tokens': 0, 'skipped:scope_gone': 0 } as Record<ClaimOutcome, number>;
  for (const d of await dueDuties(env, now)) {
    try { out[(await claimDuty(env, d, now, deps)).outcome] += 1; } catch { console.warn('[agents] duty_claim_failed'); }
  }
  return out;
}

export const defaultTokensLeft = (env: Env, userId: number) => budgetAllows(env, userId);

/** The duty as the routes answer it. A monthly estimate that cannot be read is `{ available: false }`, never 0. */
export function dutyDto(d: DutyRow, est: { available: false } | { available: true; value: number }) {
  return {
    uid: d.uid, template: d.template_key, title: d.title, module: d.module, option: d.option, cadence: d.cadence,
    weekday: d.weekday, day_of_month: d.day_of_month, hour_utc: d.hour_utc, next_due_at: d.next_due_at,
    last_outcome: d.last_outcome, status: d.status,
    est_month: est.available ? { available: true, value_microusd: est.value } : { available: false },
  };
}


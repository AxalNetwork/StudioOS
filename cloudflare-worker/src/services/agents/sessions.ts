/**
 * #3957 (D1613 §10, on D1530's E5 duties) — an AGENT WORK SESSION: one of an
 * agent's assigned skills, optionally on one record, with a short instruction,
 * once at a time or on a repeat. It is a row of `agent_duties` with
 * `kind = 'session'`, so E5's sweep claims it exactly as it claims a duty
 * (claim before act, skipped when paused or out of tokens) and the work comes
 * back as a task the engine runs into a proposal. Nothing is applied until a
 * named person accepts it.
 *
 *   validSession(...)   the body → a schedule, or the refusal the screen words:
 *                       skill_not_in_role (S1, 2026-11-02: the skill must be
 *                       ASSIGNED to the agent; the code is kept for the screen),
 *                       target_not_readable, run_at_past, over_cap, agent_paused.
 *   zonedNext(...)      the next slot after a time, in the member's zone, to the minute.
 *   sessionEstimate     per session, this month, the cap used and the cap, in cents;
 *                       a figure that cannot be read is null, never 0.
 *   sessionDto          state, proposals waiting, schedule, sponsor by name, last runs, `can`.
 *   sessionEvents       the calendar's `agent_session` items for a member.
 *
 * The instruction is untrusted: it is stored as typed and reaches the model only
 * inside the run's data wrapper (`loop.ts`, `sessionBlock`). It is never logged.
 * Bound SQL only.
 */
import type { Env, User } from '../../types';
import { newUid } from '../../routes/_t13t14t15_helpers';
import { ROLES, moduleOf, optionsIn } from './catalogue';
import { agentQuote } from './agentRun';
import { canManage, canRead, effectiveBook, monthSpend, scopeOfAgent, type AgentRow, type Scope } from './teams';
import { fromSql, sqlTime, type DutyRow } from './duties';
import type { Refusal } from './goals';

export const INSTRUCTION_MAX = 1000;
export const SESSIONS_PER_AGENT_MAX = 20;
export const TARGET_KINDS = ['module', 'deck', 'meeting', 'deal', 'document'] as const;
/** The record kinds a session can work on today: the ones whose read gate this file can check. */
export const CHECKED_TARGETS = ['module', 'deck'] as const;
/** The screen's weekday names; agent_duties stores 0 = Sunday … 6 = Saturday. */
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export type SessionRow = DutyRow & {
  kind: 'duty' | 'session'; minute_utc: number; zone: string | null; local_time: string | null; run_at: string | null;
  skill_id: number | null; skill_version: number | null; target_kind: string | null; target_id: string | null; instruction: string | null;
};
export type Schedule = {
  cadence: 'once' | 'daily' | 'weekly' | 'monthly'; run_at: string | null; zone: string;
  local_time: string | null; weekday: number | null; day_of_month: number | null;
};

const no = (status: number, code: string, message: string): Refusal => ({ status, code, message });

// ── Time, in the member's zone ──────────────────────────────────────────────

const zoneOk = (z: unknown): z is string => {
  if (typeof z !== 'string' || !z || z.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; }
};

/** The zone's offset from UTC at an instant, in minutes. */
function offsetMin(zone: string, at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((local - at.getTime()) / 60_000);
}
/** The UTC instant of a wall-clock time in a zone (the later of two in a fall-back hour; a skipped spring-forward time moves on). */
export function zonedInstant(zone: string, y: number, m: number, d: number, hh: number, mm: number): Date {
  const wall = Date.UTC(y, m, d, hh, mm);
  let t = wall - offsetMin(zone, new Date(wall)) * 60_000;
  t = wall - offsetMin(zone, new Date(t)) * 60_000;
  return new Date(t);
}
/** The wall-clock date in a zone at an instant. */
function localDate(zone: string, at: Date): { y: number; m: number; d: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day) };
}

/** The first slot strictly after `after`. A once session has none after its time. */
export function zonedNext(s: Pick<Schedule, 'cadence' | 'run_at' | 'zone' | 'local_time' | 'weekday' | 'day_of_month'>, after: Date): Date | null {
  if (s.cadence === 'once') {
    const at = s.run_at ? fromSql(s.run_at) : null;
    return at && at > after ? at : null;
  }
  const [hh, mm] = String(s.local_time ?? '08:00').split(':').map(Number);
  const start = localDate(s.zone, after);
  for (let i = 0; i <= 62; i += 1) {
    const day = new Date(Date.UTC(start.y, start.m, start.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth(), d = day.getUTCDate();
    if (s.cadence === 'weekly' && day.getUTCDay() !== s.weekday) continue;
    if (s.cadence === 'monthly') {
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      if (d !== Math.min(Number(s.day_of_month ?? 1), last)) continue;
    }
    const at = zonedInstant(s.zone, y, m, d, hh, mm);
    if (at > after) return at;
  }
  return null;
}

// ── The body ────────────────────────────────────────────────────────────────

/** The schedule a body asks for, or the first problem. `now` bounds a once session. */
export function scheduleOf(b: Record<string, unknown>, now: Date, base?: Partial<Schedule>): { ok: true; s: Schedule } | { ok: false; refusal: Refusal } {
  const cadence = b.cadence === undefined ? base?.cadence : b.cadence;
  if (!['once', 'daily', 'weekly', 'monthly'].includes(String(cadence))) return { ok: false, refusal: no(400, 'invalid_session', 'Choose once or a repeat: daily, weekly or monthly.') };
  const zone = b.zone === undefined || b.zone === null ? base?.zone ?? 'UTC' : b.zone;
  if (!zoneOk(zone)) return { ok: false, refusal: no(400, 'invalid_session', 'That time zone is not one we know.') };
  const s: Schedule = { cadence: cadence as Schedule['cadence'], run_at: null, zone, local_time: null, weekday: null, day_of_month: null };
  if (s.cadence === 'once') {
    const raw = b.run_at === undefined ? (base?.run_at ? `${base.run_at.replace(' ', 'T')}Z` : undefined) : b.run_at;
    const at = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw) ? new Date(raw) : null;
    if (!at || Number.isNaN(at.getTime())) return { ok: false, refusal: no(400, 'invalid_session', 'Choose a date and time.') };
    if (at <= now) return { ok: false, refusal: no(422, 'run_at_past', 'Choose a time in the future.') };
    if (at.getTime() - now.getTime() > 366 * 86_400_000) return { ok: false, refusal: no(400, 'invalid_session', 'Choose a time within the next year.') };
    s.run_at = sqlTime(at);
    return { ok: true, s };
  }
  const time = b.time === undefined ? base?.local_time : b.time;
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, refusal: no(400, 'invalid_session', 'Choose a time, as HH:MM.') };
  s.local_time = time;
  if (s.cadence === 'weekly') {
    const w = b.weekday === undefined ? (base?.weekday ?? null) : WEEKDAY_NAMES.indexOf(b.weekday as (typeof WEEKDAY_NAMES)[number]);
    if (!Number.isInteger(w) || (w as number) < 0) return { ok: false, refusal: no(400, 'invalid_session', 'Choose a day of the week.') };
    s.weekday = w as number;
  }
  if (s.cadence === 'monthly') {
    const d = b.day_of_month === undefined ? base?.day_of_month : b.day_of_month;
    if (!(Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 28)) return { ok: false, refusal: no(400, 'invalid_session', 'Choose a day from 1 to 28.') };
    s.day_of_month = d as number;
  }
  return { ok: true, s };
}

/** The agent's assigned skill by uid, at its pinned version; null when it is not assigned (or retired). */
export async function assignedSkill(env: Env, a: AgentRow, skillUid: unknown): Promise<{ id: number; uid: string; name: string; version: number; status: string } | null> {
  if (typeof skillUid !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(skillUid)) return null;
  try {
    return await env.DB.prepare(
      `SELECT s.id, s.uid, s.name, l.version, s.status FROM agent_skill_links l JOIN agent_skills s ON s.id = l.skill_id
        WHERE l.agent_id = ? AND s.uid = ?`,
    ).bind(a.id, skillUid).first<{ id: number; uid: string; name: string; version: number; status: string }>();
  } catch { return null; }
}

/** Where the session's task runs: the target module when it names one, else the first module of the agent's book that offers one of its options. */
export async function placeOf(env: Env, a: AgentRow, s: Scope, target: { kind: string; id: string } | null): Promise<{ module: string; option: string } | null> {
  const { rules } = await effectiveBook(env, s, a.role_key);
  const modules = target?.kind === 'module' ? [target.id] : rules.works_in;
  for (const m of modules) {
    if (!rules.works_in.includes(m)) continue;
    const option = optionsIn(m).find((o) => rules.may_propose.includes(o));
    if (option) return { module: m, option };
  }
  return null;
}

/** Whether the agent's sponsor may read the record. Only the kinds whose gate is checked here are accepted. */
export async function targetReadable(env: Env, a: AgentRow, s: Scope, target: { kind: string; id: string }): Promise<{ title: string; href: string | null } | null> {
  const sponsor = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').bind(a.sponsor_user_id).first<User>();
  if (!sponsor || !(await canRead(env, s, sponsor))) return null;
  if (target.kind === 'module') {
    const m = moduleOf(target.id);
    const { rules } = await effectiveBook(env, s, a.role_key);
    return m && rules.works_in.includes(m.key) ? { title: m.label, href: null } : null;
  }
  if (target.kind === 'deck') {
    if (!/^\d{1,12}$/.test(target.id)) return null;
    const projectIds = s.kind === 'project' ? [s.id]
      : ((await env.DB.prepare('SELECT id FROM projects WHERE company_id = ?').bind(s.id).all<{ id: number }>()).results ?? []).map((p) => Number(p.id));
    const deck = await env.DB.prepare('SELECT id, project_id, title FROM pitch_decks WHERE id = ?').bind(Number(target.id)).first<{ id: number; project_id: number; title: string | null }>();
    return deck && projectIds.includes(Number(deck.project_id)) ? { title: deck.title || 'Pitch deck', href: `/raise/pitch?deck=${deck.id}` } : null;
  }
  return null;
}

export type SessionInput = Record<string, unknown>;
export type CheckedSession = {
  skill: { id: number; uid: string; name: string; version: number };
  schedule: Schedule;
  target: { kind: string; id: string; title: string } | null;
  instruction: string | null;
  place: { module: string; option: string };
};

/** Every check a new or changed session passes, in the order the screen expects its refusals. */
export async function checkSession(env: Env, a: AgentRow, s: Scope, b: SessionInput, now: Date, base?: SessionRow): Promise<{ ok: true; c: CheckedSession } | { ok: false; refusal: Refusal }> {
  if (a.status !== 'active') return { ok: false, refusal: no(409, 'agent_paused', 'This agent is paused. Resume it in Team › Agents first.') };
  const skill = await assignedSkill(env, a, b.skill_id ?? (base ? (await env.DB.prepare('SELECT uid FROM agent_skills WHERE id = ?').bind(base.skill_id).first<{ uid: string }>())?.uid : undefined));
  if (!skill || skill.status === 'retired') return { ok: false, refusal: no(422, 'skill_not_in_role', 'That skill is not assigned to this agent.') };
  if (b.skill_version !== undefined && b.skill_version !== null && b.skill_version !== skill.version) {
    return { ok: false, refusal: no(422, 'skill_not_in_role', 'That version of the skill is not the one assigned to this agent.') };
  }
  let instruction: string | null = base?.instruction ?? null;
  if (b.instruction !== undefined) {
    if (b.instruction !== null && typeof b.instruction !== 'string') return { ok: false, refusal: no(400, 'invalid_session', 'The instruction is text.') };
    const t = typeof b.instruction === 'string' ? b.instruction.trim() : '';
    if (t.length > INSTRUCTION_MAX) return { ok: false, refusal: no(400, 'invalid_session', `Keep the instruction under ${INSTRUCTION_MAX.toLocaleString('en-US')} characters.`) };
    instruction = t || null;
  }
  let target: CheckedSession['target'] = null;
  const tk = b.target_kind === undefined ? base?.target_kind ?? null : b.target_kind;
  const ti = b.target_id === undefined ? base?.target_id ?? null : b.target_id;
  if (tk != null || ti != null) {
    if (!(TARGET_KINDS as readonly unknown[]).includes(tk) || typeof ti !== 'string' || !ti || ti.length > 100) {
      return { ok: false, refusal: no(400, 'invalid_session', 'Choose a meeting, a deal, a deck, a module or a document to work on.') };
    }
    const seen = await targetReadable(env, a, s, { kind: tk as string, id: ti });
    if (!seen) return { ok: false, refusal: no(422, 'target_not_readable', 'The sponsor cannot read that record, so the agent cannot work on it.') };
    target = { kind: tk as string, id: ti, title: seen.title };
  }
  const sched = scheduleOf(b, now, base ? sessionSchedule(base) : undefined);
  if (!sched.ok) return sched;
  const place = await placeOf(env, a, s, target);
  if (!place) return { ok: false, refusal: no(422, 'skill_not_in_role', 'This agent’s rule book has nowhere for that work to land.') };
  // The cap: what this session would spend this month must fit what the agent has left.
  const est = await sessionEstimate(env, a, place, sched.s, now, base?.uid ?? null);
  if (est.cap_reached || (est.month_cents != null && est.cap_left_cents != null && est.month_cents > est.cap_left_cents)) {
    return { ok: false, refusal: no(422, 'over_cap', 'This would go over the agent’s monthly cap. Lower the repeat or raise the cap in Team › Agents.') };
  }
  return { ok: true, c: { skill, schedule: sched.s, target, instruction, place } };
}

export const sessionSchedule = (r: SessionRow): Schedule => ({
  cadence: r.cadence as Schedule['cadence'], run_at: r.run_at, zone: r.zone ?? 'UTC', local_time: r.local_time ?? `${String(r.hour_utc).padStart(2, '0')}:${String(r.minute_utc ?? 0).padStart(2, '0')}`,
  weekday: r.weekday, day_of_month: r.day_of_month,
});

// ── Estimate ────────────────────────────────────────────────────────────────

const cents = (micro: number) => Math.ceil(micro / 10_000);

/** Runs left this calendar month (UTC) for a schedule, from `now`. */
export function runsLeftThisMonth(s: Schedule, now: Date): number {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  let n = 0;
  let at: Date | null = now;
  while (n < 40 && at) { at = zonedNext(s, at); if (!at || at >= end) break; n += 1; }
  return n;
}

export async function sessionEstimate(env: Env, a: AgentRow, place: { module: string; option: string }, s: Schedule, now: Date, exceptUid: string | null) {
  const spent = await monthSpend(env, a.id);
  // At or over the cap already: no quote is asked for (a quote at the cap pauses the agent, and an estimate changes nothing).
  const capReached = spent.available && spent.value_microusd >= a.monthly_cap_microusd;
  const q = capReached ? null : await agentQuote(env, { agent: a, module: place.module, option: place.option });
  const per = q && q.ok && q.quote.available ? q.quote.value_microusd : null;
  // The agent's other live sessions this month count against the cap too.
  let others = 0;
  if (per != null) {
    const rows = (await env.DB.prepare("SELECT * FROM agent_duties WHERE agent_id = ? AND kind = 'session' AND status = 'active' AND uid <> ?")
      .bind(a.id, exceptUid ?? '').all<SessionRow>()).results ?? [];
    for (const r of rows) others += runsLeftThisMonth(sessionSchedule(r), now) * per;
  }
  const month = per != null ? runsLeftThisMonth(s, now) * per : null;
  return {
    per_session_cents: per != null ? cents(per) : null,
    month_cents: month != null ? cents(month) : null,
    cap_used_cents: spent.available ? cents(spent.value_microusd) : null,
    cap_cents: cents(a.monthly_cap_microusd),
    cap_left_cents: spent.available ? cents(Math.max(0, a.monthly_cap_microusd - spent.value_microusd - others)) : null,
    cap_reached: capReached,
    run_hold_cents: per != null ? cents(per) : null,
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function addSession(env: Env, a: AgentRow, s: Scope, b: SessionInput, by: number, now = new Date()): Promise<{ ok: true; row: SessionRow } | { ok: false; refusal: Refusal }> {
  const checked = await checkSession(env, a, s, b, now);
  if (!checked.ok) return checked;
  const live = await env.DB.prepare("SELECT COUNT(*) AS n FROM agent_duties WHERE agent_id = ? AND kind = 'session' AND status IN ('active', 'paused')").bind(a.id).first<{ n: number }>();
  if (Number(live?.n ?? 0) >= SESSIONS_PER_AGENT_MAX) return { ok: false, refusal: no(409, 'too_many_sessions', `An agent has at most ${SESSIONS_PER_AGENT_MAX} scheduled sessions.`) };
  const c = checked.c;
  const next = zonedNext(c.schedule, now);
  if (!next) return { ok: false, refusal: no(422, 'run_at_past', 'Choose a time in the future.') };
  const uid = newUid();
  await env.DB.prepare(
    `INSERT INTO agent_duties (uid, agent_id, kind, template_key, title, module, option, cadence, weekday, day_of_month, hour_utc, minute_utc,
        zone, local_time, run_at, skill_id, skill_version, target_kind, target_id, instruction, next_due_at, status, created_by)
     VALUES (?, ?, 'session', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).bind(uid, a.id, (c.target ? `${c.skill.name} · ${c.target.title}` : c.skill.name).slice(0, 200), c.place.module, c.place.option,
    c.schedule.cadence, c.schedule.weekday, c.schedule.day_of_month, next.getUTCHours(), next.getUTCMinutes(),
    c.schedule.zone, c.schedule.local_time, c.schedule.run_at, c.skill.id, c.skill.version, c.target?.kind ?? null, c.target?.id ?? null,
    c.instruction, sqlTime(next), by).run();
  return { ok: true, row: (await sessionByUid(env, uid))! };
}

/** Reschedule, change the skill, target or instruction, or pause and resume. */
export async function updateSession(env: Env, r: SessionRow, a: AgentRow, s: Scope, b: SessionInput, now = new Date()): Promise<{ ok: true; row: SessionRow } | { ok: false; refusal: Refusal }> {
  if (r.status === 'removed') return { ok: false, refusal: no(404, 'not_found', 'There is no such session.') };
  let status = r.status;
  if (b.status !== undefined) {
    if (b.status !== 'active' && b.status !== 'paused') return { ok: false, refusal: no(400, 'invalid_session', 'A session is active or paused.') };
    status = b.status;
  }
  const onlyStatus = Object.keys(b).every((k) => k === 'status');
  if (onlyStatus) {
    if (r.status === 'done') return { ok: false, refusal: no(409, 'session_done', 'This session has already run.') };
    await env.DB.prepare("UPDATE agent_duties SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('active', 'paused')").bind(status, r.id).run();
    return { ok: true, row: (await sessionByUid(env, r.uid))! };
  }
  const checked = await checkSession(env, a, s, b, now, r);
  if (!checked.ok) return checked;
  const c = checked.c;
  const next = zonedNext(c.schedule, now);
  if (!next) return { ok: false, refusal: no(422, 'run_at_past', 'Choose a time in the future.') };
  // A once session that already ran is scheduled again by a new time: it is active again.
  if (r.status === 'done') status = 'active';
  await env.DB.prepare(
    `UPDATE agent_duties SET title = ?, module = ?, option = ?, cadence = ?, weekday = ?, day_of_month = ?, hour_utc = ?, minute_utc = ?, zone = ?, local_time = ?,
        run_at = ?, skill_id = ?, skill_version = ?, target_kind = ?, target_id = ?, instruction = ?, next_due_at = ?, status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status <> 'removed'`,
  ).bind((c.target ? `${c.skill.name} · ${c.target.title}` : c.skill.name).slice(0, 200), c.place.module, c.place.option, c.schedule.cadence,
    c.schedule.weekday, c.schedule.day_of_month, next.getUTCHours(), next.getUTCMinutes(), c.schedule.zone, c.schedule.local_time, c.schedule.run_at,
    c.skill.id, c.skill.version, c.target?.kind ?? null, c.target?.id ?? null, c.instruction, sqlTime(next), status, r.id).run();
  return { ok: true, row: (await sessionByUid(env, r.uid))! };
}

export async function sessionByUid(env: Env, uid: string): Promise<SessionRow | null> {
  if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(uid)) return null;
  return env.DB.prepare("SELECT * FROM agent_duties WHERE uid = ? AND kind = 'session'").bind(uid).first<SessionRow>();
}

// ── Reads ───────────────────────────────────────────────────────────────────

const SKIPS: Record<string, string> = {
  'skipped:agent_paused': 'agent_paused', 'skipped:no_tokens': 'out_of_tokens', 'skipped:skill_retired': 'skill_retired', 'skipped:tool_disconnected': 'tool_disconnected',
};

type RunLine = { task_id: number; created_at: string; run_uid: string | null; status: string | null; refusal: string | null; usage_log_id: number | null; waiting: number; proposals: number };

/** The tasks a session made, newest first, each with its latest run and its proposals. */
async function runsOf(env: Env, uid: string, limit = 10): Promise<RunLine[]> {
  return (await env.DB.prepare(
    `SELECT t.id AS task_id, t.created_at,
            (SELECT r.uid FROM agent_task_runs r WHERE r.task_id = t.id ORDER BY r.attempt DESC LIMIT 1) AS run_uid,
            (SELECT r.status FROM agent_task_runs r WHERE r.task_id = t.id ORDER BY r.attempt DESC LIMIT 1) AS status,
            (SELECT r.refusal FROM agent_task_runs r WHERE r.task_id = t.id ORDER BY r.attempt DESC LIMIT 1) AS refusal,
            (SELECT r.usage_log_id FROM agent_task_runs r WHERE r.task_id = t.id ORDER BY r.attempt DESC LIMIT 1) AS usage_log_id,
            (SELECT COUNT(*) FROM ai_rail_proposals p WHERE p.task_id = t.id AND p.status = 'proposed') AS waiting,
            (SELECT COUNT(*) FROM ai_rail_proposals p WHERE p.task_id = t.id) AS proposals
       FROM scope_tasks t WHERE t.source_kind = 'duty' AND t.source_ref = ? ORDER BY t.id DESC LIMIT ?`,
  ).bind(uid, limit).all<RunLine>()).results ?? [];
}

const runState = (l: RunLine | undefined): string | null => {
  if (!l) return null;
  if (!l.status) return 'scheduled';
  if (l.status === 'admitted' || l.status === 'running') return 'running';
  if (l.status === 'waiting_decision') return 'waiting';
  if (l.status === 'done') return 'done';
  if (l.status === 'cancelled') return 'cancelled';
  return 'skipped';
};

/** The state the calendar chip says. */
export function stateOf(r: Pick<SessionRow, 'status' | 'last_outcome'>, latest: RunLine | undefined): string {
  if (r.status === 'removed') return 'cancelled';
  const run = runState(latest);
  if (run === 'running' || run === 'waiting') return run;
  if (r.last_outcome && SKIPS[r.last_outcome]) return 'skipped';
  if (r.status === 'paused') return 'paused';
  if (r.status === 'done') return run === 'done' ? 'done' : run ?? 'done';
  return 'scheduled';
}

async function charged(env: Env, usageLogId: number | null): Promise<number | null> {
  if (!usageLogId) return null;
  try {
    const u = await env.DB.prepare('SELECT SUM(charged_microusd) AS c, SUM(CASE WHEN charged_microusd IS NULL THEN 1 ELSE 0 END) AS n FROM ai_usage_logs WHERE id = ? OR guard_for = ?')
      .bind(usageLogId, usageLogId).first<{ c: number | null; n: number }>();
    return u && Number(u.n) === 0 && u.c != null ? cents(Number(u.c)) : null;
  } catch { return null; }
}

export async function sessionDto(env: Env, r: SessionRow, a: AgentRow, s: Scope, viewer: User | null, now = new Date()) {
  const runs = await runsOf(env, r.uid);
  const latest = runs[0];
  const skill = r.skill_id ? await env.DB.prepare('SELECT uid, name FROM agent_skills WHERE id = ?').bind(r.skill_id).first<{ uid: string; name: string }>() : null;
  const sponsor = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(a.sponsor_user_id).first<{ name: string | null }>();
  const company = s.kind === 'company' ? s.name
    : s.company_id ? (await env.DB.prepare('SELECT company_name FROM company_profiles WHERE id = ?').bind(s.company_id).first<{ company_name: string }>())?.company_name ?? null : null;
  const target = r.target_kind && r.target_id ? await targetReadable(env, a, s, { kind: r.target_kind, id: r.target_id }) : null;
  const manage = !!viewer && (a.sponsor_user_id === viewer.id || await canManage(env, s, viewer));
  const sched = sessionSchedule(r);
  const skip = r.last_outcome && SKIPS[r.last_outcome] ? { reason: SKIPS[r.last_outcome], ...(SKIPS[r.last_outcome] === 'skill_retired' ? { replacement_version: null } : {}) } : null;
  const place = r.module && r.option ? { module: r.module, option: r.option } : null;
  const est = place && manage ? await sessionEstimate(env, a, place, sched, now, r.uid) : null;
  const lastRuns = [];
  for (const l of runs.slice(0, 5)) {
    // D1614 W6 (#3974, CAL10): the latest run's uid, so the session sheet opens W3's run sheet (GET /api/teams/runs/:uid); null before any run.
    lastRuns.push({ uid: l.run_uid ?? null, date: l.created_at.slice(0, 10), state: runState(l), proposals: Number(l.proposals), cost_cents: await charged(env, l.usage_log_id) });
  }
  const live = r.status === 'active' || r.status === 'paused' || r.status === 'done';
  return {
    uid: r.uid,
    state: stateOf(r, latest),
    proposals_waiting: runs.reduce((n, l) => n + Number(l.waiting), 0),
    agent: { uid: a.uid, name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.role_key, role_key: a.role_key },
    skill: skill ? { uid: skill.uid, name: skill.name, version: r.skill_version } : null,
    target: r.target_kind ? { kind: r.target_kind, id: r.target_id, title: target?.title ?? null, href: target?.href ?? null, kind_words: r.target_kind } : null,
    instruction: manage ? r.instruction : null,
    cadence: r.cadence,
    schedule: { cadence: r.cadence, run_at: r.run_at ? `${r.run_at.replace(' ', 'T')}Z` : null, time: sched.local_time, zone: sched.zone,
      weekday: r.weekday == null ? null : WEEKDAY_NAMES[r.weekday], day_of_month: r.day_of_month },
    next_at: r.status === 'active' ? `${r.next_due_at.replace(' ', 'T')}Z` : null,
    sponsor: { name: sponsor?.name ?? null },
    scope: s.kind === 'company' ? { kind: 'company', uid: s.uid } : { kind: 'project', id: s.id },
    last_runs: lastRuns,
    last_run_day: latest ? latest.created_at.slice(0, 10) : null,
    skip,
    can: { run_now: manage && live && a.status === 'active', reschedule: manage && r.status !== 'removed', pause: manage && r.status === 'active', cancel: manage && r.status !== 'removed' },
    can_manage: manage,
    company,
    run_hold_cents: est?.run_hold_cents ?? null,
  };
}

/** The agents a member may schedule: every live agent of a team they manage, by company then project. */
export async function schedulableAgents(env: Env, viewer: User) {
  const rows = (await env.DB.prepare(
    `SELECT a.* FROM team_agents a
       LEFT JOIN projects p ON a.scope_kind = 'project' AND p.id = a.project_id
      WHERE a.status <> 'removed' AND (
        (a.scope_kind = 'company' AND a.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?))
        OR (a.scope_kind = 'project' AND (p.founder_id = ? OR p.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?)))
      ) ORDER BY a.scope_kind, a.id LIMIT 200`,
  ).bind(viewer.id, viewer.founder_id ?? -1, viewer.id).all<AgentRow>()).results ?? [];
  const out = [];
  const scopes = new Map<string, { s: Scope | null; manage: boolean; company: string | null; project: string | null }>();
  for (const a of rows) {
    const key = `${a.scope_kind}:${a.company_id ?? a.project_id}`;
    if (!scopes.has(key)) {
      const s = await scopeOfAgent(env, a);
      const manage = !!s && await canManage(env, s, viewer);
      const companyId = s?.kind === 'company' ? s.id : s?.company_id ?? null;
      const company = companyId ? (await env.DB.prepare('SELECT company_name FROM company_profiles WHERE id = ?').bind(companyId).first<{ company_name: string }>())?.company_name ?? null : null;
      scopes.set(key, { s, manage, company, project: s?.kind === 'project' ? s.name : null });
    }
    const sc = scopes.get(key)!;
    if (!sc.s || !sc.manage) continue;
    const skills = await env.DB.prepare('SELECT COUNT(*) AS n FROM agent_skill_links WHERE agent_id = ?').bind(a.id).first<{ n: number }>().catch(() => null);
    let tools = 0;
    try { tools = (JSON.parse(a.tool_grants_json || '[]') as unknown[]).length; } catch { tools = 0; }
    out.push({
      uid: a.uid, name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.role_key, role_key: a.role_key,
      role_name: ROLES.find((r) => r.key === a.role_key)?.name ?? a.role_key,
      company_name: sc.company, project_name: sc.project, model: a.model_id, tools, skills: skills ? Number(skills.n) : null, status: a.status,
    });
  }
  return out;
}

// ── The calendar ────────────────────────────────────────────────────────────

/** A member's `agent_session` items in [from, to): each live session's slots in the range, and the past runs it made. */
export async function sessionEvents(env: Env, userId: number, from: string, to: string) {
  const viewer = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
  if (!viewer) return [];
  const rows = (await env.DB.prepare(
    `SELECT d.* FROM agent_duties d JOIN team_agents a ON a.id = d.agent_id
       LEFT JOIN projects p ON a.scope_kind = 'project' AND p.id = a.project_id
      WHERE d.kind = 'session' AND d.status <> 'removed' AND a.status <> 'removed' AND (
        (a.scope_kind = 'company' AND a.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?))
        OR (a.scope_kind = 'project' AND (p.founder_id = ? OR p.company_id IN (SELECT company_id FROM user_company_links WHERE user_id = ?)))
      ) ORDER BY d.id LIMIT 200`,
  ).bind(viewer.id, viewer.founder_id ?? -1, viewer.id).all<SessionRow>()).results ?? [];
  const lo = new Date(from), hi = new Date(to);
  const out: any[] = [];
  const seen = new Map<number, { a: AgentRow; s: Scope } | null>();
  for (const r of rows) {
    if (!seen.has(r.agent_id)) {
      const a = await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(r.agent_id).first<AgentRow>();
      const s = a ? await scopeOfAgent(env, a) : null;
      seen.set(r.agent_id, a && s && await canRead(env, s, viewer) ? { a, s } : null);
    }
    const got = seen.get(r.agent_id);
    if (!got) continue;
    const runs = await runsOf(env, r.uid, 50);
    const waiting = runs.reduce((n, l) => n + Number(l.waiting), 0);
    const base = (id: string, at: Date, state: string) => ({
      id, kind: 'agent_session' as const, source_id: r.id, source_uid: r.uid, title: r.title, start_at: at.toISOString(),
      end_at: new Date(at.getTime() + 30 * 60_000).toISOString(), status: state, location_kind: null, location_uri: null, organizer_email: null,
      attendees: [], notes: null, url: `/calendar?session=${encodeURIComponent(r.uid)}`, read_only: true as const,
      agent_session: { uid: r.uid, state, proposals_waiting: waiting, agent: [got.a.first_name, got.a.last_name].filter(Boolean).join(' ') || got.a.role_key },
    });
    // Past runs: each task the session made, at the time it was made.
    for (const l of runs) {
      const at = fromSql(l.created_at);
      if (at >= lo && at < hi) out.push(base(`agent-session:${r.uid}:${l.task_id}`, at, runState(l) ?? 'scheduled'));
    }
    // Upcoming slots, at most 40 per session.
    if (r.status === 'active') {
      let at: Date | null = fromSql(r.next_due_at);
      for (let n = 0; at && at < hi && n < 40; n += 1) {
        if (at >= lo) out.push(base(`agent-session:${r.uid}:${at.toISOString()}`, at, 'scheduled'));
        at = r.cadence === 'once' ? null : zonedNext(sessionSchedule(r), at);
      }
    }
  }
  return out;
}

/** For the routes: the session, its agent and scope, when the viewer may read them. */
export async function visibleSession(env: Env, uid: string, viewer: User): Promise<{ r: SessionRow; a: AgentRow; s: Scope } | null> {
  const r = await sessionByUid(env, uid);
  const a = r && await env.DB.prepare('SELECT * FROM team_agents WHERE id = ?').bind(r.agent_id).first<AgentRow>();
  const s = a && await scopeOfAgent(env, a);
  if (!r || !a || !s || !(await canRead(env, s, viewer))) return null;
  return { r, a, s };
}


/**
 * What a session's run reads, as DATA: the skill's name and its pinned
 * version's steps, the record it works on, and the member's instruction. The
 * loop wraps it in `<agent_data … trust="data">` with the untrusted notice; it
 * never reaches the prompt's own lines. Null for a task no session made.
 */
export async function sessionBlock(env: Env, task: { source_kind: string; source_ref: string | null }): Promise<Record<string, unknown> | null> {
  if (task.source_kind !== 'duty' || !task.source_ref) return null;
  const r = await sessionByUid(env, task.source_ref);
  if (!r) return null;
  const v = r.skill_id && r.skill_version
    ? await env.DB.prepare('SELECT name, steps_json FROM agent_skill_versions WHERE skill_id = ? AND version = ?').bind(r.skill_id, r.skill_version)
      .first<{ name: string; steps_json: string }>().catch(() => null)
    : null;
  let steps: unknown = [];
  try { steps = v ? JSON.parse(v.steps_json) : []; } catch { steps = []; }
  return {
    skill: v ? { name: v.name, version: r.skill_version, steps } : null,
    target: r.target_kind ? { kind: r.target_kind, id: r.target_id } : null,
    instruction: r.instruction,
  };
}

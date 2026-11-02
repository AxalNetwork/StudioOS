/**
 * #3959 — a member's own learning plan, at `/api/learning/plan` (migration 758).
 * Mounted before `learningRoutes`, so `plan` is never read as a course slug.
 *
 *   GET    /?from=&to=        the member's plan, each repeat expanded inside the
 *                             range (at most 92 days), with each subject's title,
 *                             page and whether Learning records it done
 *   POST   /                  plan a course, lesson, video, webinar, exercise,
 *                             exam or study block
 *   PATCH  /:uid              move, resize, change the repeat or reminder, skip
 *   DELETE /:uid              remove it
 *   POST   /:uid/done         mark it done
 *
 * RULES (#3959):
 *   - Only a subject the caller can see is planned (`canSeeLearning`); any other
 *     uid answers 404 `not_found`, the same as one that does not exist.
 *   - A webinar is planned at its own `starts_at`, never another time, and the
 *     member is registered through the same capacity-checked insert D560 uses.
 *   - An exam only reserves time: planning one never starts an attempt.
 *   - Done is automatic when Learning already records it (`recordedDone`);
 *     otherwise the member marks it.
 *   - Another member's plan is never read or written: every statement binds the
 *     caller's id, and a uid of another member's item is 404.
 */
import { Hono } from 'hono';
import type { Env, User } from '../types';
import { requireAuth, selectJwt } from '../auth';
import { refuse } from '../util/refusal';
import {
  PLAN_KINDS, REPEATS, occurrences, planRowsIn, planTitle, recordedDone, registerForWebinar, resolveSubject, weekdaysOf,
  type PlanKind, type PlanRow,
} from '../services/learningPlan';

const r = new Hono<{ Bindings: Env }>();
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 92;

const notFound = (c: any) => refuse(c, 404, { code: 'not_found', message: 'That learning item is not available to you.' });
const isoOrNull = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);

async function member(c: any): Promise<User | Response> {
  if ((await selectJwt(c))?.payload?.impersonated_by) return refuse(c, 403, { code: 'support_session_refused', message: 'A support session cannot change a member\'s learning plan.' });
  return await requireAuth(c) as User;
}

type Fields = {
  title_override: string | null; starts_at: string; duration_min: number; repeat: string; repeat_weekdays: string | null;
  repeat_until: string | null; remind_min_before: number | null; goal_json: string | null;
};

/** A body's fields, checked; `partial` for a PATCH. A refusal is `{ code, message }`. */
function fieldsOf(b: any, partial: boolean): { ok: Partial<Fields> } | { code: string; message: string } {
  const out: Partial<Fields> = {};
  if (b.title_override !== undefined) {
    if (b.title_override !== null && (typeof b.title_override !== 'string' || b.title_override.length > 200)) return { code: 'invalid_title', message: 'The title is at most 200 characters.' };
    out.title_override = b.title_override ? String(b.title_override).trim() || null : null;
  }
  if (b.starts_at !== undefined || !partial) {
    const at = isoOrNull(b.starts_at);
    if (!at) return { code: 'invalid_time', message: 'Choose when it starts.' };
    out.starts_at = at;
  }
  if (b.duration_min !== undefined || !partial) {
    const d = b.duration_min === undefined ? 30 : Number(b.duration_min);
    if (!Number.isInteger(d) || d < 5 || d > 480) return { code: 'invalid_duration', message: 'A duration is 5 to 480 minutes.' };
    out.duration_min = d;
  }
  if (b.repeat !== undefined || !partial) {
    const rep = b.repeat ?? 'none';
    if (!(REPEATS as readonly string[]).includes(rep)) return { code: 'invalid_repeat', message: 'Repeat is none, daily or weekly.' };
    out.repeat = rep;
  }
  if (b.repeat_weekdays !== undefined) {
    if (b.repeat_weekdays !== null && (!Array.isArray(b.repeat_weekdays) || weekdaysOf(b.repeat_weekdays).length !== b.repeat_weekdays.length)) return { code: 'invalid_repeat', message: 'Weekdays are 0 (Sunday) to 6.' };
    out.repeat_weekdays = b.repeat_weekdays ? JSON.stringify(weekdaysOf(b.repeat_weekdays)) : null;
  }
  if (b.repeat_until !== undefined) {
    if (b.repeat_until !== null && !(typeof b.repeat_until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.repeat_until))) return { code: 'invalid_repeat', message: 'Repeat until is a date, YYYY-MM-DD.' };
    out.repeat_until = b.repeat_until;
  }
  if (b.remind_min_before !== undefined) {
    const m = b.remind_min_before;
    if (m !== null && (!Number.isInteger(m) || m < 0 || m > 10080)) return { code: 'invalid_reminder', message: 'A reminder is 0 to 10,080 minutes before.' };
    out.remind_min_before = m;
  }
  if (b.goal !== undefined) {
    if (b.goal === null) out.goal_json = null;
    else {
      const g = b.goal;
      if (!g || typeof g !== 'object' || typeof g.text !== 'string' || !g.text.trim() || g.text.length > 200 || (g.target_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(g.target_date)))) {
        return { code: 'invalid_goal', message: 'A goal has its words (at most 200 characters) and, optionally, a target date.' };
      }
      out.goal_json = JSON.stringify({ text: g.text.trim(), target_date: g.target_date ?? null });
    }
  }
  return { ok: out };
}

/** One plan item as the member reads it. Never a table name, never another member. */
async function viewOf(env: Env, user: User, row: PlanRow, fromIso?: string, toIso?: string) {
  const subject = row.item_kind === 'study_block' ? null : await resolveSubject(env, user, row.item_kind, String(row.item_uid));
  const done = row.status === 'done' || await recordedDone(env, user.id, row.item_kind, subject);
  let goal: unknown = null;
  try { goal = row.goal_json ? JSON.parse(row.goal_json) : null; } catch { goal = null; }
  return {
    uid: row.uid, item_kind: row.item_kind, item_uid: row.item_uid, title: planTitle(row, subject),
    href: subject?.href ?? null, available: row.item_kind === 'study_block' || !!subject,
    starts_at: row.starts_at, duration_min: row.duration_min,
    repeat: row.repeat, repeat_weekdays: weekdaysOf(row.repeat_weekdays), repeat_until: row.repeat_until,
    remind_min_before: row.remind_min_before,
    status: done ? 'done' : row.status, done_recorded_by: row.status === 'done' ? 'member' : done ? 'learning' : null,
    goal,
    ...(fromIso && toIso ? { occurrences: occurrences(row, fromIso, toIso) } : {}),
  };
}

r.get('/', async (c) => {
  const user = await member(c); if (user instanceof Response) return user;
  const from = isoOrNull(c.req.query('from')) ?? new Date(Date.now() - 7 * DAY_MS).toISOString();
  const to = isoOrNull(c.req.query('to')) ?? new Date(Date.parse(from) + 35 * DAY_MS).toISOString();
  if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > MAX_RANGE_DAYS * DAY_MS) {
    return refuse(c, 400, { code: 'invalid_range', message: 'A range runs forward and is at most 92 days.' });
  }
  try {
    const rows = await planRowsIn(c.env, user.id, from, to);
    const items = [];
    for (const row of rows) {
      const v = await viewOf(c.env, user, row, from, to);
      if ((v as any).occurrences.length) items.push(v);
    }
    return c.json({ from, to, items });
  } catch (e) {
    return refuse(c, 503, { code: 'plan_unreadable', message: 'Your learning plan could not be read. Try again.', raw: e });
  }
});

r.post('/', async (c) => {
  const user = await member(c); if (user instanceof Response) return user;
  const b = await c.req.json().catch(() => null) as any;
  if (!b || typeof b !== 'object') return refuse(c, 400, { code: 'invalid_plan', message: 'Say what to plan and when.' });
  const kind = String(b.item_kind ?? '') as PlanKind;
  if (!(PLAN_KINDS as readonly string[]).includes(kind)) return refuse(c, 400, { code: 'invalid_kind', message: 'Plan a course, lesson, video, webinar, exercise, exam or a study block.' });
  let subject = null;
  if (kind !== 'study_block') {
    subject = await resolveSubject(c.env, user, kind, String(b.item_uid ?? ''));
    if (!subject) return notFound(c);
  }
  // A webinar is planned at its own time, and needs one.
  const body = kind === 'webinar' ? { ...b, starts_at: subject!.starts_at, repeat: 'none', repeat_weekdays: null, repeat_until: null,
    duration_min: subject!.ends_at && subject!.starts_at ? Math.max(5, Math.min(480, Math.round((Date.parse(subject!.ends_at) - Date.parse(subject!.starts_at)) / 60_000))) : (b.duration_min ?? 60) } : b;
  if (kind === 'webinar') {
    if (subject!.status !== 'published') return refuse(c, 409, { code: 'webinar_not_open', message: 'This webinar is not open for registration.' });
    if (!subject!.starts_at || Date.parse(subject!.starts_at) < Date.now()) return refuse(c, 409, { code: 'webinar_ended', message: 'This webinar has no upcoming time.' });
  }
  const f = fieldsOf(body, false);
  if ('code' in f) return refuse(c, 400, { code: f.code, message: f.message });
  if (kind === 'webinar' && !(await registerForWebinar(c.env, user.id, subject!))) return refuse(c, 409, { code: 'full', message: 'This webinar is full.' });
  if (kind === 'webinar') {
    const already = await c.env.DB.prepare(`SELECT * FROM learning_plan_items WHERE user_id = ? AND item_kind = 'webinar' AND item_uid = ?`).bind(user.id, subject!.uid).first<PlanRow>();
    if (already) return c.json({ item: await viewOf(c.env, user, already) });
  }
  const v = f.ok as Fields;
  const uid = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO learning_plan_items (uid, user_id, item_kind, item_uid, title_override, starts_at, duration_min, repeat, repeat_weekdays, repeat_until, remind_min_before, goal_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(uid, user.id, kind, subject?.uid ?? null, v.title_override ?? null, v.starts_at, v.duration_min, v.repeat,
    v.repeat_weekdays ?? null, v.repeat_until ?? null, v.remind_min_before ?? null, v.goal_json ?? null).run();
  const row = await c.env.DB.prepare('SELECT * FROM learning_plan_items WHERE uid = ? AND user_id = ?').bind(uid, user.id).first<PlanRow>();
  return c.json({ item: await viewOf(c.env, user, row!) }, 201);
});

async function ownRow(c: any, user: User): Promise<PlanRow | null> {
  return c.env.DB.prepare('SELECT * FROM learning_plan_items WHERE uid = ? AND user_id = ?').bind(c.req.param('uid'), user.id).first();
}

r.patch('/:uid', async (c) => {
  const user = await member(c); if (user instanceof Response) return user;
  const row = await ownRow(c, user); if (!row) return notFound(c);
  const b = await c.req.json().catch(() => null) as any;
  if (!b || typeof b !== 'object') return refuse(c, 400, { code: 'invalid_plan', message: 'Say what to change.' });
  if (row.item_kind === 'webinar' && (b.starts_at !== undefined || b.repeat !== undefined || b.duration_min !== undefined)) {
    return refuse(c, 409, { code: 'webinar_time_fixed', message: 'A webinar keeps its own time.' });
  }
  if (b.status !== undefined && !['planned', 'skipped'].includes(b.status)) return refuse(c, 400, { code: 'invalid_status', message: 'Set an item to planned or skipped; mark it done with Done.' });
  const f = fieldsOf(b, true);
  if ('code' in f) return refuse(c, 400, { code: f.code, message: f.message });
  const next = { ...row, ...f.ok, ...(b.status !== undefined ? { status: b.status } : {}) } as PlanRow;
  await c.env.DB.prepare(
    `UPDATE learning_plan_items SET title_override = ?, starts_at = ?, duration_min = ?, repeat = ?, repeat_weekdays = ?, repeat_until = ?,
       remind_min_before = ?, goal_json = ?, status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ).bind(next.title_override, next.starts_at, next.duration_min, next.repeat, next.repeat_weekdays, next.repeat_until,
    next.remind_min_before, next.goal_json, next.status, row.id, user.id).run();
  const fresh = await ownRow(c, user);
  return c.json({ item: await viewOf(c.env, user, fresh!) });
});

r.delete('/:uid', async (c) => {
  const user = await member(c); if (user instanceof Response) return user;
  const row = await ownRow(c, user); if (!row) return notFound(c);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM learning_plan_reminders WHERE item_id = ?').bind(row.id),
    c.env.DB.prepare('DELETE FROM learning_plan_items WHERE id = ? AND user_id = ?').bind(row.id, user.id),
  ]);
  return c.json({ removed: true });
});

r.post('/:uid/done', async (c) => {
  const user = await member(c); if (user instanceof Response) return user;
  const row = await ownRow(c, user); if (!row) return notFound(c);
  await c.env.DB.prepare(`UPDATE learning_plan_items SET status = 'done', done_at = COALESCE(done_at, datetime('now')), updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .bind(row.id, user.id).run();
  const fresh = await ownRow(c, user);
  return c.json({ item: await viewOf(c.env, user, fresh!) });
});

export default r;

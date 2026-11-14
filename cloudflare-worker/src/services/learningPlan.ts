/**
 * #3959 — a member's own learning plan (migration 758): Learning items
 * scheduled onto the member's calendar.
 *
 *   resolveSubject   the course, lesson, video, webinar, exercise or exam a plan
 *                    item names, gated by `canSeeLearning` (D557): a subject the
 *                    caller cannot see answers null, so the route says "not found"
 *   occurrences      an item's times inside a range: once, daily, or weekly on
 *                    chosen weekdays, never past `repeat_until`
 *   recordedDone     whether Learning already records it done: a completed course
 *                    or lesson (`learning_progress`), a submitted exercise, a
 *                    submitted exam attempt. Done is then automatic.
 *   learningEvents   the calendar's "Learning" source (`services/calendar.ts`):
 *                    plan occurrences and the webinars the member registered for
 *   sendPlanReminders the cron sweep: one `notify()` per item and occurrence
 *
 * AN EXAM ONLY RESERVES TIME. Planning one never starts an attempt and reads
 * none of its questions or answers (D559).
 */
import type { Env, User } from '../types';
import { canSeeLearning } from './learningAccess';
import { notify } from './notify';

export const PLAN_KINDS = ['course', 'lesson', 'video', 'webinar', 'exercise', 'exam', 'study_block'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];
export const REPEATS = ['none', 'daily', 'weekly'] as const;
export const PLAN_STATUSES = ['planned', 'done', 'skipped', 'missed'] as const;
/** The most occurrences one item answers for one range read. */
export const MAX_OCCURRENCES = 400;
const DAY_MS = 86_400_000;

export interface Subject {
  kind: Exclude<PlanKind, 'study_block'>;
  id: number;
  uid: string;
  title: string;
  /** The subject's own page on StudioOS. */
  href: string;
  /** A webinar's own time; null for everything else. */
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  capacity: number | null;
}

/**
 * The subject a plan item names, or null when the caller cannot see it (or it
 * does not exist): the two answer alike, as `routes/learning.ts` does.
 */
/**
 * Each kind's read, as literal SQL the schema guard can read
 * (`check-sqlite-columns`): the subject, plus `holder_uid`, the uid a program
 * holds for it (a lesson's course). Enrolment is `ENROLLED_SQL` below.
 */
const SUBJECT_SQL: Record<Exclude<PlanKind, 'study_block'>, string> = {
  course: `SELECT id, uid, title, status, visibility, slug, uid AS holder_uid
      FROM learning_courses WHERE uid = ?`,
  lesson: `SELECT l.id, l.uid, l.title, c.status, c.visibility, c.slug, c.uid AS holder_uid
      FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id JOIN learning_courses c ON c.id = m.course_id
      WHERE l.uid = ?`,
  video: `SELECT id, uid, title, status, visibility, uid AS holder_uid
      FROM learning_items WHERE uid = ? AND kind = 'video'`,
  // A webinar's "published" is D560's; canSeeLearning reads `published` only.
  webinar: `SELECT id, uid, title, status, visibility, starts_at, ends_at, capacity, uid AS holder_uid
      FROM learning_webinars WHERE uid = ?`,
  exercise: `SELECT id, uid, title, status, visibility, uid AS holder_uid
      FROM learning_exercises WHERE uid = ?`,
  exam: `SELECT id, uid, title, status, visibility, uid AS holder_uid
      FROM learning_exams WHERE uid = ?`,
};

/**
 * The program kind that holds each plan kind, and the lesson kinds through
 * which a course carries it: `enrolledSql`'s rule (D558, D1124), with every
 * value bound. A course is held directly only, so its lesson kinds match none.
 */
const HOLDER: Record<Exclude<PlanKind, 'study_block'>, { kind: string; lessons: [string, string] }> = {
  course: { kind: 'course', lessons: ['', ''] },
  lesson: { kind: 'course', lessons: ['', ''] },
  video: { kind: 'item', lessons: ['video', 'reading'] },
  webinar: { kind: 'webinar', lessons: ['webinar', 'webinar'] },
  exercise: { kind: 'exercise', lessons: ['exercise', 'exercise'] },
  exam: { kind: 'exam', lessons: ['exam', 'exam'] },
};

/** 1 when the caller is actively enrolled in a published program holding the subject, directly or through a course's lesson. */
const ENROLLED_SQL = `SELECT 1 AS enrolled FROM learning_program_contents pc
      JOIN learning_programs pp ON pp.id = pc.program_id AND pp.status = 'published'
      JOIN learning_enrollments pe ON pe.program_id = pc.program_id AND pe.status = 'active' AND pe.user_id = ?
     WHERE (pc.subject_kind = ? AND pc.subject_uid = ?)
        OR (pc.subject_kind = 'course' AND EXISTS (SELECT 1 FROM learning_courses hc
              JOIN learning_course_modules hm ON hm.course_id = hc.id
              JOIN learning_lessons hl ON hl.module_id = hm.id
             WHERE hc.uid = pc.subject_uid AND hl.ref_uid = ? AND hl.kind IN (?, ?)))
     LIMIT 1`;

const hrefFor = (kind: Exclude<PlanKind, 'study_block'>, row: any): string => {
  switch (kind) {
    case 'course': return `/learning/courses/${row.slug}`;
    case 'lesson': return `/learning/courses/${row.slug}/${row.uid}`;
    case 'video': return `/learning/videos/${row.uid}`;
    case 'webinar': return `/learning/webinars/${row.uid}`;
    case 'exercise': return `/learning/exercises/${row.uid}`;
    case 'exam': return `/learning/exams/${row.uid}`;
  }
};

export async function resolveSubject(env: Env, user: User, kind: PlanKind, uid: string): Promise<Subject | null> {
  if (kind === 'study_block' || !(kind in SUBJECT_SQL) || typeof uid !== 'string' || !uid || uid.length > 64) return null;
  const row: any = await env.DB.prepare(SUBJECT_SQL[kind]).bind(uid).first();
  if (row && row.visibility === 'program') {
    const h = HOLDER[kind];
    const hit = await env.DB.prepare(ENROLLED_SQL).bind(user.id, h.kind, row.holder_uid, row.holder_uid, ...h.lessons).first();
    row.enrolled = hit ? 1 : 0;
  }
  if (row) row.href = hrefFor(kind, row);
  if (!row || !canSeeLearning(user, row)) return null;
  return {
    kind, id: Number(row.id), uid: String(row.uid), title: String(row.title), href: String(row.href),
    starts_at: row.starts_at ?? null, ends_at: row.ends_at ?? null, status: String(row.status),
    capacity: row.capacity == null ? null : Number(row.capacity),
  };
}

export interface PlanRow {
  id: number; uid: string; user_id: number; item_kind: PlanKind; item_uid: string | null; title_override: string | null;
  starts_at: string; duration_min: number; repeat: 'none' | 'daily' | 'weekly'; repeat_weekdays: string | null; repeat_until: string | null;
  remind_min_before: number | null; status: string; done_at: string | null; goal_json: string | null; created_at: string; updated_at: string;
}

/** Weekdays as stored: a JSON array of 0 (Sunday) to 6, in UTC. Anything else is none. */
export function weekdaysOf(raw: unknown): number[] {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) as number[])].sort();
}

/**
 * An item's occurrences that start in [from, to): the start itself for `none`;
 * every day at the same time for `daily`; the chosen weekdays (or the start's
 * own weekday when none is chosen) for `weekly`. Never past `repeat_until`
 * (inclusive, by day) and never more than MAX_OCCURRENCES.
 */
export function occurrences(item: Pick<PlanRow, 'starts_at' | 'repeat' | 'repeat_weekdays' | 'repeat_until'>, fromIso: string, toIso: string): string[] {
  const start = Date.parse(item.starts_at);
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (![start, from, to].every(Number.isFinite) || to <= from) return [];
  if (item.repeat === 'none') return start >= from && start < to ? [new Date(start).toISOString()] : [];
  const untilDay = item.repeat_until && Number.isFinite(Date.parse(item.repeat_until)) ? Date.parse(item.repeat_until.slice(0, 10)) + DAY_MS : Infinity;
  const end = Math.min(to, untilDay);
  const days = item.repeat === 'weekly' ? (weekdaysOf(item.repeat_weekdays).length ? weekdaysOf(item.repeat_weekdays) : [new Date(start).getUTCDay()]) : null;
  const out: string[] = [];
  // The first candidate day: the start, or the first day at the start's time on or after `from`.
  let t = start >= from ? start : start + Math.ceil((from - start) / DAY_MS) * DAY_MS;
  for (; t < end && out.length < MAX_OCCURRENCES; t += DAY_MS) {
    if (t < start || t < from) continue;
    if (days && !days.includes(new Date(t).getUTCDay())) continue;
    out.push(new Date(t).toISOString());
  }
  return out;
}

/** Whether Learning already records this subject done for the member. */
export async function recordedDone(env: Env, userId: number, kind: PlanKind, subject: { uid: string; id: number } | null): Promise<boolean> {
  if (!subject || kind === 'study_block') return false;
  const db = env.DB;
  if (kind === 'course' || kind === 'lesson') {
    return !!(await db.prepare(`SELECT 1 FROM learning_progress WHERE user_id = ? AND subject_kind = ? AND subject_uid = ? AND status = 'completed'`)
      .bind(userId, kind, subject.uid).first());
  }
  if (kind === 'video') {
    return !!(await db.prepare(`SELECT 1 FROM learning_progress WHERE user_id = ? AND subject_kind = 'item' AND subject_uid = ? AND status = 'completed'`)
      .bind(userId, subject.uid).first());
  }
  if (kind === 'exercise') {
    return !!(await db.prepare('SELECT 1 FROM learning_exercise_submissions WHERE exercise_id = ? AND user_id = ?').bind(subject.id, userId).first());
  }
  if (kind === 'exam') {
    return !!(await db.prepare('SELECT 1 FROM learning_exam_attempts WHERE exam_id = ? AND user_id = ? AND submitted_at IS NOT NULL').bind(subject.id, userId).first());
  }
  if (kind === 'webinar') {
    return !!(await db.prepare('SELECT 1 FROM learning_webinar_registrations WHERE webinar_id = ? AND user_id = ? AND attended = 1').bind(subject.id, userId).first());
  }
  return false;
}

/**
 * The member's registration for a webinar, within capacity, through the same
 * one-statement insert D560's route uses. True when the member holds a seat
 * afterwards (new or already theirs); false when the webinar is full.
 */
export async function registerForWebinar(env: Env, userId: number, webinar: Subject): Promise<boolean> {
  await env.DB.prepare(
    `INSERT INTO learning_webinar_registrations (webinar_id, user_id, registered_at)
     SELECT ?, ?, ? WHERE ? IS NULL OR (SELECT COUNT(*) FROM learning_webinar_registrations WHERE webinar_id = ?) < ?
     ON CONFLICT (webinar_id, user_id) DO NOTHING`,
  ).bind(webinar.id, userId, new Date().toISOString(), webinar.capacity, webinar.id, webinar.capacity).run();
  return !!(await env.DB.prepare('SELECT 1 FROM learning_webinar_registrations WHERE webinar_id = ? AND user_id = ?').bind(webinar.id, userId).first());
}

/** The member's plan items that may have an occurrence in the range. */
export async function planRowsIn(env: Env, userId: number, fromIso: string, toIso: string): Promise<PlanRow[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM learning_plan_items WHERE user_id = ? AND starts_at < ?
       AND (repeat = 'none' AND starts_at >= ? OR repeat != 'none' AND (repeat_until IS NULL OR repeat_until >= ?))
     ORDER BY starts_at, id LIMIT 500`,
  ).bind(userId, toIso, fromIso, fromIso.slice(0, 10)).all<PlanRow>();
  return (rows.results || []) as PlanRow[];
}

/** A study block's words, or the subject's own title, or the override the member typed. */
export const planTitle = (row: PlanRow, subject: Subject | null) => row.title_override || subject?.title || (row.item_kind === 'study_block' ? 'Study block' : 'Learning');

/**
 * The calendar's "Learning" source: each plan occurrence in the range, and each
 * webinar the member registered for that no plan item already covers. A
 * subject the member can no longer see is left off; nothing names a table.
 */
export async function learningEvents(env: Env, userId: number, fromIso: string, toIso: string): Promise<any[]> {
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
  if (!user) return [];
  const out: any[] = [];
  const plannedWebinars = new Set<string>();
  for (const row of await planRowsIn(env, userId, fromIso, toIso)) {
    const subject = row.item_kind === 'study_block' ? null : await resolveSubject(env, user, row.item_kind, String(row.item_uid));
    if (row.item_kind !== 'study_block' && !subject) continue;
    if (row.item_kind === 'webinar' && row.item_uid) plannedWebinars.add(row.item_uid);
    for (const at of occurrences(row, fromIso, toIso)) {
      out.push({
        id: `learning:${row.uid}:${at}`, kind: 'learning', source_id: row.id, source_uid: row.uid,
        title: planTitle(row, subject), start_at: at, end_at: new Date(Date.parse(at) + row.duration_min * 60_000).toISOString(),
        status: row.status, location_kind: null, location_uri: null, organizer_email: null, attendees: [],
        notes: null, url: subject?.href ?? '/learning/plan', learning: { item_kind: row.item_kind, plan: true },
      });
    }
  }
  const regs = await env.DB.prepare(
    `SELECT w.id, w.uid, w.title, w.starts_at, w.ends_at, w.status FROM learning_webinar_registrations r JOIN learning_webinars w ON w.id = r.webinar_id
      WHERE r.user_id = ? AND w.starts_at >= ? AND w.starts_at < ? AND w.status = 'published'`,
  ).bind(userId, fromIso, toIso).all<any>();
  for (const w of regs.results || []) {
    if (plannedWebinars.has(w.uid)) continue;
    out.push({
      id: `learning-webinar:${w.uid}`, kind: 'learning', source_id: Number(w.id), source_uid: w.uid, title: w.title,
      start_at: w.starts_at, end_at: w.ends_at || new Date(Date.parse(w.starts_at) + 3_600_000).toISOString(),
      status: 'registered', location_kind: null, location_uri: null, organizer_email: null, attendees: [], notes: null,
      url: `/learning/webinars/${w.uid}`, learning: { item_kind: 'webinar', plan: false },
    });
  }
  return out;
}

/**
 * The reminder sweep (cron): for each planned item with a reminder, each
 * occurrence whose reminder time falls in (now - window, now] is sent once
 * through `notify()`, which applies the member's notification settings.
 */
export async function sendPlanReminders(env: Env, nowMs = Date.now(), windowMs = 5 * 60_000): Promise<number> {
  const horizon = new Date(nowMs + 7 * DAY_MS).toISOString();
  const rows = await env.DB.prepare(
    `SELECT * FROM learning_plan_items WHERE remind_min_before IS NOT NULL AND status = 'planned' AND starts_at < ?
       AND (repeat != 'none' OR starts_at >= ?) LIMIT 1000`,
  ).bind(horizon, new Date(nowMs - windowMs).toISOString()).all<PlanRow>();
  let sent = 0;
  for (const row of (rows.results || []) as PlanRow[]) {
    const lead = Number(row.remind_min_before) * 60_000;
    for (const at of occurrences(row, new Date(nowMs - windowMs + lead).toISOString(), new Date(nowMs + lead + 1).toISOString())) {
      const fireAt = Date.parse(at) - lead;
      if (fireAt > nowMs || fireAt <= nowMs - windowMs) continue;
      const claim = await env.DB.prepare('INSERT OR IGNORE INTO learning_plan_reminders (item_id, occurrence_at) VALUES (?, ?)').bind(row.id, at).run();
      if (!Number((claim as any)?.meta?.changes ?? 0)) continue;
      await notify(env, {
        userId: row.user_id, type: 'learning_plan_reminder', category: 'calendar',
        title: `Coming up: ${row.title_override || (row.item_kind === 'study_block' ? 'Study block' : 'your planned learning')}`,
        body: `Planned for ${at.slice(11, 16)} UTC.`, link: '/learning/plan',
      });
      sent += 1;
    }
  }
  return sent;
}

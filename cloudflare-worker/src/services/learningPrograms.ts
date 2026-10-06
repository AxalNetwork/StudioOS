/**
 * D558 (#1159) — Learning programs: the shape of a program, its contents, and
 * each enrolled learner's completion of each content item. Shared by the
 * member and assigned-admin routes (`routes/learning_programs.ts`) and the
 * Super Admin's (`routes/admin_learning_programs.ts`).
 *
 * A LEARNER IS A NAME AND A UID. No query here selects an email, and no
 * payload carries one: an assigned admin follows people's progress, and that
 * does not need their address.
 *
 * NOTHING STARTED IS NOT ZERO. A content item the learner never opened says
 * `not_started` (or `not_submitted`, `not_attempted`), and an exam with no
 * attempt has no best score (null), never 0%.
 */
import type { Env } from '../types';

export const PROGRAM_COLS = 'id, uid, name, region, description, enrolment, status, created_at, updated_at';
/** The same columns on a `learning_programs p` alias. */
export const P_COLS = PROGRAM_COLS.split(', ').map((x) => 'p.' + x).join(', ');

export type ProgramRow = {
  id: number; uid: string; name: string; region: string | null; description: string | null;
  enrolment: 'invite' | 'open'; status: 'draft' | 'published' | 'archived'; created_at: string; updated_at: string;
};

export type ContentRow = {
  subject_kind: 'course' | 'item' | 'exam' | 'exercise' | 'webinar'; subject_uid: string; position: number;
  /** Set when the rows span several programs (`enrolledContents`). */
  program_id?: number;
};

/** A program as the API shows it: never the numeric id. */
export function programView(p: ProgramRow) {
  return {
    uid: p.uid, name: p.name, region: p.region ?? null, description: p.description ?? null,
    enrolment: p.enrolment, status: p.status, created_at: p.created_at, updated_at: p.updated_at,
  };
}

export async function programContents(env: Env, programId: number): Promise<ContentRow[]> {
  const res = await env.DB.prepare(
    'SELECT subject_kind, subject_uid, position FROM learning_program_contents WHERE program_id = ? ORDER BY position, id',
  ).bind(programId).all<ContentRow>();
  return res.results || [];
}

const DESCRIBE: Record<string, string> = {
  course: 'SELECT uid, slug, title, status FROM learning_courses WHERE uid IN (SELECT value FROM json_each(?))',
  item: 'SELECT uid, kind, title, status FROM learning_items WHERE uid IN (SELECT value FROM json_each(?))',
  exam: 'SELECT uid, title, status FROM learning_exams WHERE uid IN (SELECT value FROM json_each(?))',
  exercise: 'SELECT uid, title, status FROM learning_exercises WHERE uid IN (SELECT value FROM json_each(?))',
};

/**
 * Each content item with its title and status from its own store; `missing`
 * when that row is gone. One query per kind of content, never one per item, so
 * the contents of many programs (#1251) are described in one round.
 */
export async function describeContents(env: Env, contents: ContentRow[]) {
  const rows = new Map<string, any>();
  await Promise.all(Object.keys(DESCRIBE).map(async (kind) => {
    const uids = [...new Set(contents.filter((x) => x.subject_kind === kind).map((x) => x.subject_uid))];
    if (!uids.length) return;
    const res = await env.DB.prepare(DESCRIBE[kind]).bind(JSON.stringify(uids)).all<any>();
    for (const row of res.results || []) rows.set(kind + '|' + row.uid, row);
  }));
  return contents.map((x) => {
    const row = rows.get(x.subject_kind + '|' + x.subject_uid);
    return {
      subject_kind: x.subject_kind, subject_uid: x.subject_uid, position: x.position,
      title: row?.title ?? null, status: row ? row.status : 'missing',
      href: !row ? null
        : x.subject_kind === 'course' ? `/learning/courses/${row.slug}`
        : x.subject_kind === 'item' ? `/learning/items/${row.uid}`
        : `/learning/${x.subject_kind}s/${row.uid}`,
    };
  });
}

/**
 * The contents of every published program `userId` is actively enrolled in,
 * in one query, each row carrying its `program_id` (#1251).
 */
export async function enrolledContents(env: Env, userId: number): Promise<ContentRow[]> {
  const res = await env.DB.prepare(
    `SELECT pc.program_id, pc.subject_kind, pc.subject_uid, pc.position
       FROM learning_program_contents pc
       JOIN learning_enrollments e ON e.program_id = pc.program_id AND e.user_id = ? AND e.status = 'active'
       JOIN learning_programs p ON p.id = pc.program_id AND p.status = 'published'
      ORDER BY pc.program_id, pc.position, pc.id`,
  ).bind(userId).all<ContentRow>();
  return res.results || [];
}

export type Learner = { user_id: number; uid: string; name: string | null; enrolled_at: string };

/**
 * One program's actively enrolled learners, or one of them (`userUid`). Name
 * and uid only.
 */
export async function programLearners(env: Env, programId: number, userUid?: string): Promise<Learner[]> {
  const res = await env.DB.prepare(
    `SELECT e.user_id, u.uid, COALESCE(u.display_name, u.name) AS name, e.enrolled_at
       FROM learning_enrollments e JOIN users u ON u.id = e.user_id
      WHERE e.program_id = ? AND e.status = 'active' AND (? IS NULL OR u.uid = ?)
      ORDER BY name COLLATE NOCASE, e.id`,
  ).bind(programId, userUid ?? null, userUid ?? null).all<Learner>();
  return res.results || [];
}

/**
 * Each learner's completion of each content item, read from
 * `learning_progress` (courses and items), the latest exercise submission and
 * the exam attempts (D559). Reads are scoped by the learners' ids and the
 * contents' courses, each bound as one JSON list, so a large program, or every
 * program a member is in (#1251), is still a fixed number of queries.
 */
export async function completionFor(env: Env, contents: ContentRow[], learners: Learner[]) {
  const ids = new Set(learners.map((l) => Number(l.user_id)));
  const who = JSON.stringify([...ids]);
  const courseUids = [...new Set(contents.filter((x) => x.subject_kind === 'course').map((x) => x.subject_uid))];
  const [progress, lessons, subs, attempts] = await Promise.all([
    env.DB.prepare(
      `SELECT user_id, subject_kind, subject_uid, status, percent, completed_at FROM learning_progress
        WHERE user_id IN (SELECT value FROM json_each(?))`,
    ).bind(who).all<any>(),
    env.DB.prepare(
      `SELECT c.uid AS course_uid, l.uid FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id
         JOIN learning_courses c ON c.id = m.course_id
        WHERE l.required = 1 AND c.uid IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(courseUids)).all<any>(),
    env.DB.prepare(
      `SELECT s.user_id, x.uid AS exercise_uid, s.status FROM learning_exercise_submissions s JOIN learning_exercises x ON x.id = s.exercise_id
        WHERE s.user_id IN (SELECT value FROM json_each(?)) ORDER BY s.id DESC`,
    ).bind(who).all<any>(),
    env.DB.prepare(
      `SELECT a.user_id, x.uid AS exam_uid, a.score_percent, a.passed, a.submitted_at FROM learning_exam_attempts a
         JOIN learning_exams x ON x.id = a.exam_id WHERE a.user_id IN (SELECT value FROM json_each(?))`,
    ).bind(who).all<any>(),
  ]);
  const key = (u: number, k: string, s: string) => `${u}|${k}|${s}`;
  const prog = new Map<string, any>();
  for (const p of progress.results || []) if (ids.has(Number(p.user_id))) prog.set(key(Number(p.user_id), p.subject_kind, p.subject_uid), p);
  const required = new Map<string, string[]>();
  for (const c of courseUids) required.set(c, []);
  for (const l of lessons.results || []) required.get(l.course_uid)?.push(l.uid);
  const latestSub = new Map<string, string>();
  for (const s of subs.results || []) {
    const k = key(Number(s.user_id), 'exercise', s.exercise_uid);
    if (!latestSub.has(k)) latestSub.set(k, s.status);
  }
  const exam = new Map<string, { best: number | null; passed: boolean; attempts: number }>();
  for (const a of attempts.results || []) {
    if (!a.submitted_at) continue;
    const k = key(Number(a.user_id), 'exam', a.exam_uid);
    const e = exam.get(k) ?? { best: null, passed: false, attempts: 0 };
    e.attempts += 1;
    if (a.score_percent !== null && a.score_percent !== undefined && (e.best === null || Number(a.score_percent) > e.best)) e.best = Number(a.score_percent);
    if (Number(a.passed) === 1) e.passed = true;
    exam.set(k, e);
  }

  const cell = (uid: number, x: ContentRow) => {
    const base = { subject_kind: x.subject_kind, subject_uid: x.subject_uid };
    if (x.subject_kind === 'course') {
      const req = required.get(x.subject_uid) ?? [];
      const done = req.filter((l) => prog.get(key(uid, 'lesson', l))?.status === 'completed').length;
      const own = prog.get(key(uid, 'course', x.subject_uid));
      const status = own?.status === 'completed' || (req.length > 0 && done === req.length) ? 'completed'
        : own || done > 0 ? 'in_progress' : 'not_started';
      // A course with no required lesson has no percentage.
      return { ...base, status, required: req.length, completed: done, percent: req.length ? Math.round((100 * done) / req.length) : null };
    }
    if (x.subject_kind === 'item') {
      const own = prog.get(key(uid, 'item', x.subject_uid));
      return { ...base, status: own?.status === 'completed' ? 'completed' : own ? 'in_progress' : 'not_started', percent: own?.percent ?? null };
    }
    if (x.subject_kind === 'exercise') {
      return { ...base, status: latestSub.get(key(uid, 'exercise', x.subject_uid)) ?? 'not_submitted' };
    }
    if (x.subject_kind === 'exam') {
      const e = exam.get(key(uid, 'exam', x.subject_uid));
      return { ...base, status: !e ? 'not_attempted' : e.passed ? 'passed' : 'not_passed', best_score_percent: e?.best ?? null, attempts: e?.attempts ?? 0 };
    }
    return { ...base, status: 'not_built' };
  };

  return learners.map((l) => ({
    uid: l.uid, name: l.name ?? null, enrolled_at: l.enrolled_at,
    completion: contents.map((x) => cell(Number(l.user_id), x)),
  }));
}

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
      // D954 §7: an item is a `video` or a `reading` (PG12d names the row); null for every other kind.
      kind: x.subject_kind === 'item' ? (row?.kind ?? null) : null,
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

/** A stored stamp as a sortable number: ISO or SQLite's own format, both UTC (D162). */
function stamp(v: unknown): number {
  const s = String(v ?? '');
  const t = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? t : -Infinity;
}

/** The latest of some stamps, as stored, or null when none is set. */
function latest(values: unknown[]): string | null {
  let best: string | null = null;
  for (const v of values) if (v && (best === null || stamp(v) > stamp(best))) best = String(v);
  return best;
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
 *
 * D954 §7 (PG12d): each cell also carries the date its status was reached — a
 * course or item's `completed_at` (a course done through its required lessons
 * takes the latest of theirs), an exam's first passing attempt's
 * `submitted_at`, an exercise's latest submission's `submitted_at` and
 * `reviewed_at` — and each learner carries `last_activity_at`, the latest
 * progress, submission or attempt over these contents only. Null when there is
 * none, never a made-up date.
 */
export async function completionFor(env: Env, contents: ContentRow[], learners: Learner[]) {
  const ids = new Set(learners.map((l) => Number(l.user_id)));
  const who = JSON.stringify([...ids]);
  const courseUids = [...new Set(contents.filter((x) => x.subject_kind === 'course').map((x) => x.subject_uid))];
  const [progress, lessons, subs, attempts] = await Promise.all([
    env.DB.prepare(
      `SELECT user_id, subject_kind, subject_uid, status, percent, completed_at, updated_at FROM learning_progress
        WHERE user_id IN (SELECT value FROM json_each(?))`,
    ).bind(who).all<any>(),
    env.DB.prepare(
      `SELECT c.uid AS course_uid, l.uid, l.required FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id
         JOIN learning_courses c ON c.id = m.course_id
        WHERE c.uid IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(courseUids)).all<any>(),
    env.DB.prepare(
      `SELECT s.user_id, x.uid AS exercise_uid, s.status, s.submitted_at, s.reviewed_at FROM learning_exercise_submissions s JOIN learning_exercises x ON x.id = s.exercise_id
        WHERE s.user_id IN (SELECT value FROM json_each(?)) ORDER BY s.id DESC`,
    ).bind(who).all<any>(),
    env.DB.prepare(
      `SELECT a.user_id, x.uid AS exam_uid, a.score_percent, a.passed, a.started_at, a.submitted_at FROM learning_exam_attempts a
         JOIN learning_exams x ON x.id = a.exam_id WHERE a.user_id IN (SELECT value FROM json_each(?))`,
    ).bind(who).all<any>(),
  ]);
  const key = (u: number, k: string, s: string) => `${u}|${k}|${s}`;
  const prog = new Map<string, any>();
  for (const p of progress.results || []) if (ids.has(Number(p.user_id))) prog.set(key(Number(p.user_id), p.subject_kind, p.subject_uid), p);
  const required = new Map<string, string[]>();
  const allLessons = new Set<string>();
  for (const c of courseUids) required.set(c, []);
  for (const l of lessons.results || []) {
    allLessons.add(l.uid);
    if (Number(l.required) === 1) required.get(l.course_uid)?.push(l.uid);
  }
  const latestSub = new Map<string, { status: string; submitted_at: string | null; reviewed_at: string | null }>();
  for (const s of subs.results || []) {
    const k = key(Number(s.user_id), 'exercise', s.exercise_uid);
    if (!latestSub.has(k)) latestSub.set(k, { status: s.status, submitted_at: s.submitted_at ?? null, reviewed_at: s.reviewed_at ?? null });
  }
  const exam = new Map<string, { best: number | null; passed: boolean; attempts: number; passed_at: string | null }>();
  for (const a of attempts.results || []) {
    if (!a.submitted_at) continue;
    const k = key(Number(a.user_id), 'exam', a.exam_uid);
    const e = exam.get(k) ?? { best: null, passed: false, attempts: 0, passed_at: null };
    e.attempts += 1;
    if (a.score_percent !== null && a.score_percent !== undefined && (e.best === null || Number(a.score_percent) > e.best)) e.best = Number(a.score_percent);
    if (Number(a.passed) === 1) {
      e.passed = true;
      if (!e.passed_at || stamp(a.submitted_at) < stamp(e.passed_at)) e.passed_at = a.submitted_at;
    }
    exam.set(k, e);
  }

  // What counts as activity on these contents: their items, courses and the
  // courses' lessons, their exercises and their exams. Nothing else the learner did.
  const inContents = new Set(contents.map((x) => `${x.subject_kind}|${x.subject_uid}`));
  const lastActivity = new Map<number, string>();
  const touch = (uid: number, at: unknown) => {
    if (!at) return;
    const prev = lastActivity.get(uid);
    if (!prev || stamp(at) > stamp(prev)) lastActivity.set(uid, String(at));
  };
  for (const p of progress.results || []) {
    const kind = String(p.subject_kind);
    if (inContents.has(`${kind}|${p.subject_uid}`) || (kind === 'lesson' && allLessons.has(p.subject_uid))) touch(Number(p.user_id), p.updated_at);
  }
  for (const s of subs.results || []) if (inContents.has(`exercise|${s.exercise_uid}`)) touch(Number(s.user_id), s.submitted_at);
  for (const a of attempts.results || []) if (inContents.has(`exam|${a.exam_uid}`)) touch(Number(a.user_id), a.submitted_at ?? a.started_at);

  const cell = (uid: number, x: ContentRow) => {
    const base = { subject_kind: x.subject_kind, subject_uid: x.subject_uid };
    if (x.subject_kind === 'course') {
      const req = required.get(x.subject_uid) ?? [];
      const done = req.filter((l) => prog.get(key(uid, 'lesson', l))?.status === 'completed').length;
      const own = prog.get(key(uid, 'course', x.subject_uid));
      const ownDone = own?.status === 'completed';
      const lessonsDone = req.length > 0 && done === req.length;
      const status = ownDone || lessonsDone ? 'completed'
        : own || done > 0 ? 'in_progress' : 'not_started';
      const completed_at = ownDone ? (own.completed_at ?? null)
        : lessonsDone ? latest(req.map((l) => prog.get(key(uid, 'lesson', l))?.completed_at)) : null;
      // A course with no required lesson has no percentage.
      return { ...base, status, required: req.length, completed: done, percent: req.length ? Math.round((100 * done) / req.length) : null, completed_at };
    }
    if (x.subject_kind === 'item') {
      const own = prog.get(key(uid, 'item', x.subject_uid));
      const doneIt = own?.status === 'completed';
      return { ...base, status: doneIt ? 'completed' : own ? 'in_progress' : 'not_started', percent: own?.percent ?? null, completed_at: doneIt ? (own.completed_at ?? null) : null };
    }
    if (x.subject_kind === 'exercise') {
      const sub = latestSub.get(key(uid, 'exercise', x.subject_uid));
      return { ...base, status: sub?.status ?? 'not_submitted', submitted_at: sub?.submitted_at ?? null, reviewed_at: sub?.reviewed_at ?? null };
    }
    if (x.subject_kind === 'exam') {
      const e = exam.get(key(uid, 'exam', x.subject_uid));
      return { ...base, status: !e ? 'not_attempted' : e.passed ? 'passed' : 'not_passed', best_score_percent: e?.best ?? null, attempts: e?.attempts ?? 0, passed_at: e?.passed_at ?? null };
    }
    return { ...base, status: 'not_built' };
  };

  return learners.map((l) => ({
    uid: l.uid, name: l.name ?? null, enrolled_at: l.enrolled_at,
    last_activity_at: lastActivity.get(Number(l.user_id)) ?? null,
    completion: contents.map((x) => cell(Number(l.user_id), x)),
  }));
}

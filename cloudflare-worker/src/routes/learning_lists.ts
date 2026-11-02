/**
 * #4180 (#3726 L5, D4180) — the Learning center's list reads: what the
 * integrated screens drew as "Not switched on yet". Mounted at /api/learning
 * by the route registry, beside `learning.ts` and `learning_assessment.ts`.
 *
 *   GET /exercises?limit&offset    lr2a: title, the course or programme that holds it, your status, updated
 *   GET /exams?limit&offset        lr2b: questions, time limit, pass mark, attempts left, your best score
 *   GET /me/submissions            lr12: your exercise submissions, newest first
 *   GET /me/attempts               lr12: your exam attempts, newest first
 *   GET /me/stats                  lr1: courses in progress, lessons completed this month,
 *                                  watch time this month, exams passed of exams sat
 *
 * VISIBILITY IS `canSeeLearning`. The lists are member lists: published only,
 * `open` or `program` content the caller is enrolled in (the SQL narrows with
 * the same predicate, so totals agree with the rows), and each row is passed
 * through `canSeeLearning` again. A draft or a programme item the caller is not
 * enrolled in never appears, the Super Admin's own list included. "Me" reads
 * bind the session's user id and nothing else: no other member's work, no
 * email, no reviewer.
 *
 * NOT RECORDED IS NULL, NEVER 0. A best score with no submitted attempt is
 * null ("Score not recorded"); watch time with no recorded position is null;
 * a figure whose store cannot be read is null.
 *
 * Bound SQL only.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import type { RouteMount } from '../util/routeRegistry';
import { requireAuth } from '../auth';
import { clampLimit, parseOffset } from '../util/pagination';
import { mapError } from './_t13t14t15_helpers';
import { canSeeLearning, enrolledSql } from '../services/learningAccess';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

async function auth(c: C): Promise<any | Response> {
  try { return await requireAuth(c); } catch (e) { return mapError(c, e); }
}

// Each `enrolledSql` binds the caller's id once.
const EX_ENROLLED = enrolledSql('exercise', 'x.uid');
const EXAM_ENROLLED = enrolledSql('exam', 'x.uid');
/** Published, and open or the caller's programme: binds the caller's id once. */
const memberSees = (enrolled: string) => `x.status = 'published' AND (x.visibility = 'open' OR (x.visibility = 'program' AND ${enrolled}))`;

/**
 * The course or programme a subject sits in, for the list's second column: a
 * published course that holds it as a lesson, else a published programme that
 * holds it directly. Binds nothing.
 */
const whereSql = (lessonKind: 'exercise' | 'exam') => `
  (SELECT c.title FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id
     JOIN learning_courses c ON c.id = m.course_id AND c.status = 'published' AND c.visibility = 'open'
    WHERE l.kind = '${lessonKind}' AND l.ref_uid = x.uid ORDER BY c.id LIMIT 1) AS course_title,
  (SELECT p.name FROM learning_program_contents pc JOIN learning_programs p ON p.id = pc.program_id AND p.status = 'published'
    WHERE pc.subject_kind = '${lessonKind}' AND pc.subject_uid = x.uid ORDER BY p.id LIMIT 1) AS program_title`;

const whereOf = (row: { course_title: string | null; program_title: string | null }) =>
  row.course_title ? { kind: 'course' as const, title: row.course_title }
    : row.program_title ? { kind: 'program' as const, title: row.program_title } : null;

const EXERCISES_SQL = `SELECT x.id, x.uid, x.title, x.submission_kind, x.status, x.visibility, x.updated_at, x.published_at,
    ${EX_ENROLLED} AS enrolled, ${whereSql('exercise')},
    (SELECT s.status FROM learning_exercise_submissions s WHERE s.exercise_id = x.id AND s.user_id = ? ORDER BY s.id DESC LIMIT 1) AS my_status,
    (SELECT s.submitted_at FROM learning_exercise_submissions s WHERE s.exercise_id = x.id AND s.user_id = ? ORDER BY s.id DESC LIMIT 1) AS my_submitted_at
  FROM learning_exercises x WHERE ${memberSees(EX_ENROLLED)}
  ORDER BY COALESCE(x.published_at, x.updated_at) DESC, x.id DESC LIMIT ? OFFSET ?`;
const EXERCISES_COUNT = `SELECT COUNT(*) AS n FROM learning_exercises x WHERE ${memberSees(EX_ENROLLED)}`;

r.get('/exercises', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const limit = clampLimit(c.req.query('limit'), 24, 100);
  const offset = parseOffset(c.req.query('offset'));
  try {
    const [rows, n] = await Promise.all([
      c.env.DB.prepare(EXERCISES_SQL).bind(user.id, user.id, user.id, user.id, limit, offset).all<any>(),
      c.env.DB.prepare(EXERCISES_COUNT).bind(user.id).first<{ n: number }>(),
    ]);
    const items = (rows.results || []).filter((x) => canSeeLearning(user, x)).map((x) => ({
      uid: x.uid, title: x.title, submission_kind: x.submission_kind, where: whereOf(x),
      // Your status: the latest submission's, or null when you have not submitted.
      status: x.my_status ?? null, submitted_at: x.my_submitted_at ?? null,
      updated_at: x.updated_at ?? null, href: `/learning/exercises/${x.uid}`,
    }));
    return c.json({ items, total: Number(n?.n ?? 0), limit, offset });
  } catch (e) { return mapError(c, e); }
});

const EXAMS_SQL = `SELECT x.id, x.uid, x.title, x.pass_mark_percent, x.time_limit_minutes, x.max_attempts, x.status, x.visibility, x.updated_at, x.published_at,
    ${EXAM_ENROLLED} AS enrolled, ${whereSql('exam')},
    (SELECT COUNT(*) FROM learning_exam_questions q WHERE q.exam_id = x.id) AS question_count,
    (SELECT COUNT(*) FROM learning_exam_attempts a WHERE a.exam_id = x.id AND a.user_id = ?) AS my_attempts,
    (SELECT MAX(a.score_percent) FROM learning_exam_attempts a WHERE a.exam_id = x.id AND a.user_id = ? AND a.submitted_at IS NOT NULL AND a.score_percent IS NOT NULL) AS my_best,
    (SELECT MAX(a.passed) FROM learning_exam_attempts a WHERE a.exam_id = x.id AND a.user_id = ? AND a.submitted_at IS NOT NULL) AS my_passed
  FROM learning_exams x WHERE ${memberSees(EXAM_ENROLLED)}
  ORDER BY COALESCE(x.published_at, x.updated_at) DESC, x.id DESC LIMIT ? OFFSET ?`;
const EXAMS_COUNT = `SELECT COUNT(*) AS n FROM learning_exams x WHERE ${memberSees(EXAM_ENROLLED)}`;

r.get('/exams', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const limit = clampLimit(c.req.query('limit'), 24, 100);
  const offset = parseOffset(c.req.query('offset'));
  try {
    const [rows, n] = await Promise.all([
      c.env.DB.prepare(EXAMS_SQL).bind(user.id, user.id, user.id, user.id, user.id, limit, offset).all<any>(),
      c.env.DB.prepare(EXAMS_COUNT).bind(user.id).first<{ n: number }>(),
    ]);
    const items = (rows.results || []).filter((x) => canSeeLearning(user, x)).map((x) => ({
      uid: x.uid, title: x.title, where: whereOf(x),
      question_count: Number(x.question_count ?? 0),
      time_limit_minutes: x.time_limit_minutes ?? null,
      pass_mark_percent: x.pass_mark_percent,
      // Null is unlimited, not zero left.
      attempts_left: x.max_attempts == null ? null : Math.max(0, Number(x.max_attempts) - Number(x.my_attempts ?? 0)),
      attempts_used: Number(x.my_attempts ?? 0),
      // Null until an attempt is submitted: "Score not recorded", never 0.
      best_score_percent: x.my_best == null ? null : Number(x.my_best),
      passed: x.my_passed == null ? null : Number(x.my_passed) === 1,
      updated_at: x.updated_at ?? null, href: `/learning/exams/${x.uid}`,
    }));
    return c.json({ items, total: Number(n?.n ?? 0), limit, offset });
  } catch (e) { return mapError(c, e); }
});

/** The caller's own rows; the subject's visibility binds the caller's id first. */
const MY_SUBMISSIONS_SQL = `SELECT s.uid, s.status, s.feedback, s.submitted_at, s.reviewed_at, x.uid AS exercise_uid, x.title AS exercise_title,
              x.status AS x_status, x.visibility AS x_visibility, ${EX_ENROLLED} AS enrolled
         FROM learning_exercise_submissions s JOIN learning_exercises x ON x.id = s.exercise_id
        WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 200`;
const MY_ATTEMPTS_SQL = `SELECT a.uid, a.started_at, a.submitted_at, a.score_percent, a.passed, a.timed_out, x.uid AS exam_uid, x.title AS exam_title,
              x.pass_mark_percent, x.status AS x_status, x.visibility AS x_visibility, ${EXAM_ENROLLED} AS enrolled
         FROM learning_exam_attempts a JOIN learning_exams x ON x.id = a.exam_id
        WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 200`;

r.get('/me/submissions', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  try {
    const rows = await c.env.DB.prepare(MY_SUBMISSIONS_SQL).bind(user.id, user.id).all<any>();
    const submissions = (rows.results || [])
      .filter((x) => canSeeLearning(user, { status: x.x_status, visibility: x.x_visibility, enrolled: x.enrolled }))
      .map((x) => ({
        uid: x.uid, status: x.status, feedback: x.feedback ?? null, submitted_at: x.submitted_at, reviewed_at: x.reviewed_at ?? null,
        exercise: { uid: x.exercise_uid, title: x.exercise_title, href: `/learning/exercises/${x.exercise_uid}` },
      }));
    return c.json({ submissions });
  } catch (e) { return mapError(c, e); }
});

r.get('/me/attempts', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  try {
    const rows = await c.env.DB.prepare(MY_ATTEMPTS_SQL).bind(user.id, user.id).all<any>();
    const attempts = (rows.results || [])
      .filter((x) => canSeeLearning(user, { status: x.x_status, visibility: x.x_visibility, enrolled: x.enrolled }))
      .map((x) => ({
        uid: x.uid, started_at: x.started_at, submitted_at: x.submitted_at ?? null,
        // An open attempt has no score yet: null, never 0.
        score_percent: x.submitted_at && x.score_percent != null ? Number(x.score_percent) : null,
        passed: x.submitted_at && x.passed != null ? Number(x.passed) === 1 : null,
        timed_out: Number(x.timed_out) === 1,
        exam: { uid: x.exam_uid, title: x.exam_title, pass_mark_percent: x.pass_mark_percent, href: `/learning/exams/${x.exam_uid}` },
      }));
    return c.json({ attempts });
  } catch (e) { return mapError(c, e); }
});

/** One figure; null when its store cannot be read. */
async function figure<T>(read: () => Promise<T>): Promise<T | null> {
  try { return await read(); } catch (e) { console.warn('[learning] stats figure unreadable', (e as Error)?.message); return null; }
}

/** The calendar month in UTC as `YYYY-MM`: progress timestamps are ISO, so the month is their first seven characters. */
export const monthOf = (now: Date) => now.toISOString().slice(0, 7);

r.get('/me/stats', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const month = monthOf(new Date());
  const DB = c.env.DB;
  const [courses, lessons, watch, exams] = await Promise.all([
    figure(async () => Number((await DB.prepare(
      `SELECT COUNT(*) AS n FROM learning_progress WHERE user_id = ? AND subject_kind = 'course' AND status = 'started'`,
    ).bind(user.id).first<{ n: number }>())?.n ?? 0)),
    figure(async () => Number((await DB.prepare(
      `SELECT COUNT(*) AS n FROM learning_progress WHERE user_id = ? AND subject_kind = 'lesson' AND status = 'completed'
          AND completed_at IS NOT NULL AND substr(completed_at, 1, 7) = ?`,
    ).bind(user.id, month).first<{ n: number }>())?.n ?? 0)),
    // Watch time: the positions D3726's player writes. No position recorded this month is null, never 0.
    figure(async () => {
      const w = await DB.prepare(
        `SELECT COUNT(position_seconds) AS recorded, SUM(position_seconds) AS seconds FROM learning_progress
          WHERE user_id = ? AND subject_kind IN ('item', 'lesson') AND position_seconds IS NOT NULL AND substr(updated_at, 1, 7) = ?`,
      ).bind(user.id, month).first<{ recorded: number; seconds: number | null }>();
      return Number(w?.recorded ?? 0) > 0 ? Number(w?.seconds ?? 0) : null;
    }),
    figure(async () => {
      const e = await DB.prepare(
        `SELECT COUNT(DISTINCT exam_id) AS sat, COUNT(DISTINCT CASE WHEN passed = 1 THEN exam_id END) AS passed
           FROM learning_exam_attempts WHERE user_id = ? AND submitted_at IS NOT NULL`,
      ).bind(user.id).first<{ sat: number; passed: number }>();
      return { passed: Number(e?.passed ?? 0), sat: Number(e?.sat ?? 0) };
    }),
  ]);
  return c.json({
    month,
    courses_in_progress: courses,
    lessons_completed_this_month: lessons,
    watch_seconds_this_month: watch,
    exams,
  });
});

export default r;

export const mount: RouteMount = { path: '/api/learning', router: r };

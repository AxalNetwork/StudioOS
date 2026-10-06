/**
 * D559 follow-up (#1249): an exercise or exam lesson completes itself.
 *
 * A video or reading lesson is completed by the member's own "Mark complete".
 * An exercise lesson is complete when a reviewer accepts the member's
 * submission, and an exam lesson when one of the member's attempts passes.
 * Nothing the member clicks can say either, so the Worker records it at the
 * moment it happens: `routes/admin_learning_assessment.ts` on an acceptance,
 * `routes/learning_assessment.ts` on a passing submit.
 *
 * WHAT IS WRITTEN, for that member only:
 *   - a `completed` lesson row on every lesson that names the exercise or exam
 *     (`kind` and `ref_uid`), in whichever courses hold it;
 *   - each of those courses' own row, with the same measure
 *     `GET /api/learning/courses/:slug` serves: completed required lessons over
 *     required lessons, rounded; `completed` at 100, else `started`; no percent
 *     when the course has no required lesson. It is what the page's own
 *     "Mark complete" writes (`learningReads.js` `markLessonComplete`).
 *
 * NEVER DOWNGRADED. Both writes use the progress route's upsert: a completed
 * row stays completed, keeps its first completion time, and a percent never
 * goes backwards. A second pass, or an acceptance after an earlier one,
 * changes nothing. "Needs work", a failed attempt and a timed-out attempt
 * never reach this function.
 */
import type { Env } from '../types';

export type AssessmentKind = 'exercise' | 'exam';

/** The progress route's upsert (routes/learning.ts `POST /progress`), shared so the rules cannot drift. */
export const PROGRESS_UPSERT =
  'INSERT INTO learning_progress (user_id, subject_kind, subject_uid, status, percent, position_seconds, started_at, completed_at, updated_at) '
  + 'VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?) '
  + 'ON CONFLICT (user_id, subject_kind, subject_uid) DO UPDATE SET '
  + "status = CASE WHEN learning_progress.status = 'completed' THEN 'completed' ELSE excluded.status END, "
  + 'percent = CASE WHEN excluded.percent IS NULL THEN learning_progress.percent '
  + 'WHEN learning_progress.percent IS NULL OR excluded.percent > learning_progress.percent THEN excluded.percent '
  + 'ELSE learning_progress.percent END, '
  + 'completed_at = COALESCE(learning_progress.completed_at, excluded.completed_at), '
  + 'updated_at = excluded.updated_at';

const LESSONS_NAMING =
  'SELECT l.uid AS lesson_uid, m.course_id AS course_id FROM learning_lessons l '
  + 'JOIN learning_course_modules m ON m.id = l.module_id '
  + 'WHERE l.kind = ? AND l.ref_uid = ?';

const COURSE_MEASURE =
  'SELECT c.uid AS course_uid, '
  + 'COUNT(l.id) AS required_count, '
  + "COALESCE(SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_count "
  + 'FROM learning_courses c '
  + 'LEFT JOIN learning_course_modules m ON m.course_id = c.id '
  + 'LEFT JOIN learning_lessons l ON l.module_id = m.id AND l.required = 1 '
  + "LEFT JOIN learning_progress p ON p.user_id = ? AND p.subject_kind = 'lesson' AND p.subject_uid = l.uid "
  + 'WHERE c.id = ? GROUP BY c.id';

/** The course's percent over required lessons, as `GET /courses/:slug` computes it; null with none. */
export function coursePercent(required: number, completed: number): number | null {
  return required > 0 ? Math.round((100 * completed) / required) : null;
}

export type CompletionResult = { lessons: number; courses: Array<{ uid: string; percent: number | null; status: 'started' | 'completed' }> };

/**
 * Record `userId` as having completed every lesson that names this exercise
 * or exam, and bring each holding course's row up to date. Every value is
 * bound. Returns what it wrote; throws if a read or write fails, so the caller
 * can say so rather than report nothing done.
 */
export async function completeAssessmentLessons(
  env: Env, userId: number, kind: AssessmentKind, refUid: string, at = new Date().toISOString(),
): Promise<CompletionResult> {
  const lessons = ((await env.DB.prepare(LESSONS_NAMING).bind(kind, refUid).all<{ lesson_uid: string; course_id: number }>()).results) || [];
  if (!lessons.length) return { lessons: 0, courses: [] };
  await env.DB.batch(lessons.map((l) => env.DB.prepare(PROGRESS_UPSERT)
    .bind(userId, 'lesson', l.lesson_uid, 'completed', null, at, at, at)));
  const courses: CompletionResult['courses'] = [];
  for (const courseId of [...new Set(lessons.map((l) => Number(l.course_id)))]) {
    const m = await env.DB.prepare(COURSE_MEASURE).bind(userId, courseId)
      .first<{ course_uid: string; required_count: number; completed_count: number }>();
    if (!m) continue;
    const percent = coursePercent(Number(m.required_count), Number(m.completed_count));
    const status = percent === 100 ? 'completed' : 'started';
    await env.DB.prepare(PROGRESS_UPSERT)
      .bind(userId, 'course', m.course_uid, status, percent, at, status === 'completed' ? at : null, at).run();
    courses.push({ uid: m.course_uid, percent, status });
  }
  return { lessons: lessons.length, courses };
}

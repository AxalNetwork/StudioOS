/**
 * D5356 (#5356): the lesson a learner resumes in each course they have under way, one rule for Continue learning
 * (`GET /api/learning/me`) and "Next for you" (`learningNext.ts`), so the two never name different lessons.
 *
 * THE RULE, per in-progress course:
 *   1. the learner's most recently updated lesson row there that is `started`, not completed;
 *   2. else the first required lesson, in outline order, the learner has not completed;
 *   3. else none, and the row keeps its course link.
 * A lesson is a candidate only while it still exists in that course, the course is published, and (for a video or
 * reading) the item it opens is published. A removed or unpublished lesson is never named, so a link is never dead:
 * the next rule answers, or the course page does.
 *
 * The saved position is the learner's own item row for the lesson's video or reading (D4646 writes it there); null
 * when none is recorded, or the lesson opens no item. Every statement is fixed and bound to the caller's own user id,
 * so another learner's rows are never read. Each read is bounded, as D4648 part 2 bounds `GET /me`.
 */
import type { Env } from '../types';

export type ResumeLesson = {
  lesson_uid: string;
  lesson_title: string;
  lesson_kind: string;
  /** The video or reading the lesson opens; null for an exercise, exam or webinar lesson. */
  item_uid: string | null;
  item_kind: 'video' | 'reading' | null;
  /** The learner's saved position in that item, in seconds; null when none is recorded. */
  position_seconds: number | null;
  /** Which rule chose it. */
  rule: 'last_started' | 'first_required';
};

/** How many candidate lesson rows each read takes, across every in-progress course. */
export const RESUME_READ = 2000;

type Row = {
  course_uid: string; lesson_uid: string; lesson_title: string; lesson_kind: string; ref_uid: string | null;
  item_kind: string | null; item_status: string | null; position_seconds: number | null; lesson_status: string | null;
};

// Both reads: the lesson's course is one of the caller's own in-progress course rows, and published. Binds, in order:
// the position's user, the lesson row's user, the course rows' user, the bound.
const LAST_STARTED = `SELECT c.uid AS course_uid, l.uid AS lesson_uid, l.title AS lesson_title, l.kind AS lesson_kind, l.ref_uid,
         i.kind AS item_kind, i.status AS item_status,
         (SELECT ip.position_seconds FROM learning_progress ip WHERE ip.user_id = ? AND ip.subject_kind = 'item' AND ip.subject_uid = i.uid) AS position_seconds,
         lp.status AS lesson_status
    FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id JOIN learning_courses c ON c.id = m.course_id
    LEFT JOIN learning_items i ON l.kind IN ('video', 'reading') AND i.uid = l.ref_uid
    JOIN learning_progress lp ON lp.user_id = ? AND lp.subject_kind = 'lesson' AND lp.subject_uid = l.uid AND lp.status = 'started'
   WHERE m.course_id IN (SELECT cr.id FROM learning_progress cp JOIN learning_courses cr ON cr.uid = cp.subject_uid
    WHERE cp.user_id = ? AND cp.subject_kind = 'course' AND cp.status = 'started' AND cr.status = 'published')
   ORDER BY lp.updated_at DESC, lp.id DESC LIMIT ?`;
const FIRST_REQUIRED = `SELECT c.uid AS course_uid, l.uid AS lesson_uid, l.title AS lesson_title, l.kind AS lesson_kind, l.ref_uid,
         i.kind AS item_kind, i.status AS item_status,
         (SELECT ip.position_seconds FROM learning_progress ip WHERE ip.user_id = ? AND ip.subject_kind = 'item' AND ip.subject_uid = i.uid) AS position_seconds,
         (SELECT rp.status FROM learning_progress rp WHERE rp.user_id = ? AND rp.subject_kind = 'lesson' AND rp.subject_uid = l.uid) AS lesson_status
    FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id JOIN learning_courses c ON c.id = m.course_id
    LEFT JOIN learning_items i ON l.kind IN ('video', 'reading') AND i.uid = l.ref_uid
   WHERE l.required = 1 AND m.course_id IN (SELECT cr.id FROM learning_progress cp JOIN learning_courses cr ON cr.uid = cp.subject_uid
    WHERE cp.user_id = ? AND cp.subject_kind = 'course' AND cp.status = 'started' AND cr.status = 'published')
   ORDER BY c.id, m.position, m.id, l.position, l.id LIMIT ?`;

/** A lesson that opens a video or reading needs that item published; any other lesson opens its own page. */
const openable = (r: Row) => (r.lesson_kind === 'video' || r.lesson_kind === 'reading') ? r.item_status === 'published' : true;
const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

function toResume(r: Row, rule: ResumeLesson['rule']): ResumeLesson {
  const item = r.item_kind === 'video' || r.item_kind === 'reading' ? r.item_kind : null;
  return {
    lesson_uid: r.lesson_uid, lesson_title: r.lesson_title, lesson_kind: r.lesson_kind,
    item_uid: item ? r.ref_uid : null, item_kind: item, position_seconds: item ? pos(r.position_seconds) : null, rule,
  };
}

/** The resume lesson for each of the caller's in-progress courses, keyed by course uid. A course with none is absent. */
export async function resumeLessons(env: Env, userId: number): Promise<Map<string, ResumeLesson>> {
  const [started, required] = await Promise.all([
    env.DB.prepare(LAST_STARTED).bind(userId, userId, userId, RESUME_READ).all<Row>(),
    env.DB.prepare(FIRST_REQUIRED).bind(userId, userId, userId, RESUME_READ).all<Row>(),
  ]);
  const out = new Map<string, ResumeLesson>();
  // Newest first: the first openable started lesson of a course wins.
  for (const r of started.results || []) if (!out.has(r.course_uid) && openable(r)) out.set(r.course_uid, toResume(r, 'last_started'));
  // Outline order: the first required, not completed, openable lesson of a course with no started one.
  for (const r of required.results || []) {
    if (out.has(r.course_uid) || r.lesson_status === 'completed' || !openable(r)) continue;
    out.set(r.course_uid, toResume(r, 'first_required'));
  }
  return out;
}

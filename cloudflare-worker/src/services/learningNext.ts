/**
 * #4650 (Learning audit 5/5, D4650) — the member's next learning action, by
 * explainable rules, with the reason it was chosen.
 *
 * THE RULES, in order; the first that finds something answers:
 *   1. `continue_course`: the course the member most recently worked on and
 *      has not completed, with its next required lesson not yet complete.
 *      Reason: "<n> of <m> required lessons complete."
 *   2. `program`: in the published programs the member is actively enrolled
 *      in, in program order, the first content not complete by D4643's
 *      definitions: a course or item not completed, an exam with no passing
 *      attempt, an exercise with no accepted submission. A webinar is not a
 *      next step here (it has its own time). Reason: "Next in <program>."
 *   3. `plan`: the member's next planned, upcoming, not-done plan item.
 *      Reason: "In your plan for <date>."
 * Nothing found is an empty state that says which of the three it checked,
 * never an invented suggestion.
 *
 * ELIGIBILITY FIRST. Every candidate is resolved through `resolveSubject`
 * (the plan's own visibility check, `canSeeLearning`), so a suggestion is
 * always something the member may open and plan. A candidate the member cannot
 * see is skipped, never shown.
 *
 * No model, no profile inference, no data about other members. Role, stage and
 * goal rules wait for the signals #3724 settles; they are not guessed here.
 */
import type { Env, User } from '../types';
import { resolveSubject, type PlanKind } from './learningPlan';
import { enrolledContents } from './learningPrograms';

export type NextRule = 'continue_course' | 'program' | 'plan';
export type NextAction = {
  rule: NextRule;
  kind: PlanKind;
  uid: string;
  title: string;
  href: string;
  reason: string;
  /** What "Add to my plan" plans; null when it is already the plan's own item. */
  plan: { kind: PlanKind; uid: string; title: string } | null;
};
export type NextAnswer = { next: NextAction | null; checked: NextRule[]; empty: string | null };

export const EMPTY_NEXT = 'Nothing is waiting: no course in progress, nothing left in your programs and nothing planned. Browse courses to start one.';

const date = (iso: string) => new Date(iso).toISOString().slice(0, 10);

async function continueCourse(env: Env, user: User): Promise<NextAction | null> {
  const started = (await env.DB.prepare(
    `SELECT subject_uid FROM learning_progress WHERE user_id = ? AND subject_kind = 'course' AND status = 'started'
      ORDER BY updated_at DESC, id DESC LIMIT 10`,
  ).bind(user.id).all<{ subject_uid: string }>()).results || [];
  for (const { subject_uid } of started) {
    const course = await resolveSubject(env, user, 'course', subject_uid);
    if (!course) continue;
    const lessons = (await env.DB.prepare(
      `SELECT l.uid, l.title, (SELECT status FROM learning_progress p WHERE p.user_id = ? AND p.subject_kind = 'lesson' AND p.subject_uid = l.uid) AS status
         FROM learning_lessons l JOIN learning_course_modules m ON m.id = l.module_id
        WHERE m.course_id = ? AND l.required = 1 ORDER BY m.position, m.id, l.position, l.id`,
    ).bind(user.id, course.id).all<{ uid: string; title: string; status: string | null }>()).results || [];
    if (!lessons.length) continue;
    const done = lessons.filter((l) => l.status === 'completed').length;
    const nextLesson = lessons.find((l) => l.status !== 'completed');
    if (!nextLesson) continue;
    const lesson = await resolveSubject(env, user, 'lesson', nextLesson.uid);
    if (!lesson) continue;
    return {
      rule: 'continue_course', kind: 'lesson', uid: lesson.uid, title: `${course.title}: ${lesson.title}`, href: lesson.href,
      reason: `${done} of ${lessons.length} required lessons complete.`,
      plan: { kind: 'lesson', uid: lesson.uid, title: lesson.title },
    };
  }
  return null;
}

/** Whether the member has completed a program content, by D4643's definitions. */
async function contentDone(env: Env, userId: number, kind: string, uid: string): Promise<boolean> {
  const db = env.DB;
  if (kind === 'course' || kind === 'item') {
    return !!(await db.prepare(`SELECT 1 FROM learning_progress WHERE user_id = ? AND subject_kind = ? AND subject_uid = ? AND status = 'completed'`).bind(userId, kind, uid).first());
  }
  if (kind === 'exam') {
    return !!(await db.prepare('SELECT 1 FROM learning_exam_attempts a JOIN learning_exams e ON e.id = a.exam_id WHERE e.uid = ? AND a.user_id = ? AND a.passed = 1').bind(uid, userId).first());
  }
  if (kind === 'exercise') {
    return !!(await db.prepare(`SELECT 1 FROM learning_exercise_submissions s JOIN learning_exercises x ON x.id = s.exercise_id WHERE x.uid = ? AND s.user_id = ? AND s.status = 'accepted'`).bind(uid, userId).first());
  }
  return true;
}

const PLANNABLE: Record<string, PlanKind | null> = { course: 'course', item: 'video', exam: 'exam', exercise: 'exercise', webinar: null };

async function program(env: Env, user: User): Promise<NextAction | null> {
  const contents = await enrolledContents(env, user.id);
  const names = new Map<number, string>();
  for (const x of contents) {
    const kind = PLANNABLE[x.subject_kind];
    if (!kind) continue;
    if (await contentDone(env, user.id, x.subject_kind, x.subject_uid)) continue;
    // A reading item is not plannable as a video; it is offered when it resolves as one, else skipped.
    const subject = await resolveSubject(env, user, kind, x.subject_uid);
    if (!subject) continue;
    if (!names.has(Number(x.program_id))) {
      const p = await env.DB.prepare('SELECT name FROM learning_programs WHERE id = ?').bind(x.program_id).first<{ name: string }>();
      names.set(Number(x.program_id), p?.name ?? 'your program');
    }
    return { rule: 'program', kind, uid: subject.uid, title: subject.title, href: subject.href, reason: `Next in ${names.get(Number(x.program_id))}.`, plan: { kind, uid: subject.uid, title: subject.title } };
  }
  return null;
}

async function plan(env: Env, user: User, nowIso: string): Promise<NextAction | null> {
  const rows = (await env.DB.prepare(
    `SELECT item_kind, item_uid, starts_at FROM learning_plan_items
      WHERE user_id = ? AND status = 'planned' AND item_kind <> 'study_block' AND item_uid IS NOT NULL AND starts_at >= ?
      ORDER BY starts_at, id LIMIT 10`,
  ).bind(user.id, nowIso).all<{ item_kind: PlanKind; item_uid: string; starts_at: string }>()).results || [];
  for (const r of rows) {
    const subject = await resolveSubject(env, user, r.item_kind, r.item_uid);
    if (!subject) continue;
    return { rule: 'plan', kind: r.item_kind, uid: subject.uid, title: subject.title, href: subject.href, reason: `In your plan for ${date(r.starts_at)}.`, plan: null };
  }
  return null;
}

/** The member's next learning action and why, or the empty state naming what was checked. */
export async function nextFor(env: Env, user: User, now = new Date()): Promise<NextAnswer> {
  const checked: NextRule[] = [];
  for (const [rule, find] of [
    ['continue_course', () => continueCourse(env, user)],
    ['program', () => program(env, user)],
    ['plan', () => plan(env, user, now.toISOString())],
  ] as const) {
    checked.push(rule);
    const hit = await find();
    if (hit) return { next: hit, checked, empty: null };
  }
  return { next: null, checked, empty: EMPTY_NEXT };
}

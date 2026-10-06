/**
 * D559 (#1160) — exercises and exams, member side. Mounted at /api/learning
 * beside `learning.ts`.
 *
 *   GET  /exercises/:uid                 the exercise and the caller's submissions
 *   POST /exercises/:uid/submissions     submit or resubmit (a new row each time)
 *   GET  /exams/:uid                     the intro: no question, no answer
 *   POST /exams/:uid/attempts            start, or resume the open attempt; the questions, no answers
 *   POST /exams/:uid/attempts/:attempt/submit   graded here, on the server
 *   GET  /exams/:uid/attempts            the caller's attempts; answers only if `reveal` allows
 *
 *   GET  /review/exercises/:uid/submissions   read-only, for whoever `canReadLearnerWork` admits
 *   GET  /review/exams/:uid/attempts
 *
 * NO ANSWER LEAKS: questions reach a member only through `memberQuestion`,
 * and correct answers only through `revealed`, after submission, when the
 * exam's `reveal` is `score_and_answers`.
 *
 * THE CLOCK IS THE SERVER'S. A timed attempt's deadline is `started_at` plus
 * the limit, with `SUBMIT_GRACE_SECONDS` for the request to arrive. A
 * submission after that is not graded: the attempt closes as timed out, scored
 * 0 and not passed. An open attempt whose deadline passed closes the same way
 * the next time the member starts or lists.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { refuse } from '../util/refusal';
import { mapError, newUid } from './_t13t14t15_helpers';
import { canSeeLearning, canReadLearnerWork, canReviewLearning, enrolledSql } from '../services/learningAccess';
import {
  deadlineMs, grade, memberQuestion, normaliseAnswers, revealed, shuffled, SUBMIT_GRACE_SECONDS, type StoredQuestion,
} from '../services/learningAssessment';

const r = new Hono<{ Bindings: Env }>();
type C = Context<{ Bindings: Env }>;

async function auth(c: C): Promise<any | Response> {
  try { return await requireAuth(c); } catch (e) { return mapError(c, e); }
}

const nowIso = () => new Date().toISOString();

// ---- exercises -----------------------------------------------------------------------

// `enrolled` (D558) binds the caller's id first, then the uid.
const EXERCISE_SQL = 'SELECT id, uid, title, instructions, submission_kind, checklist_json, visibility, status, published_at, '
  + enrolledSql('exercise', 'learning_exercises.uid') + ' AS enrolled FROM learning_exercises WHERE uid = ?';

function exerciseView(x: any) {
  let checklist: string[] | null = null;
  if (x.submission_kind === 'checklist') { try { checklist = JSON.parse(x.checklist_json || '[]'); } catch { checklist = []; } }
  return { uid: x.uid, title: x.title, instructions: x.instructions, submission_kind: x.submission_kind, checklist, status: x.status, published_at: x.published_at };
}

const SUBMISSION_COLS = 'uid, body, status, feedback, submitted_at, reviewed_at';

r.get('/exercises/:uid', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const ex = await c.env.DB.prepare(EXERCISE_SQL).bind(user.id, c.req.param('uid')).first<any>();
  if (!ex || !canSeeLearning(user, ex)) return refuse(c, 404, { code: 'not_found', message: 'No such exercise.' });
  const subs = await c.env.DB.prepare(
    'SELECT ' + SUBMISSION_COLS + ' FROM learning_exercise_submissions WHERE exercise_id = ? AND user_id = ? ORDER BY id DESC LIMIT 50',
  ).bind(ex.id, user.id).all<any>();
  return c.json({ exercise: exerciseView(ex), submissions: subs.results || [] });
});

r.post('/exercises/:uid/submissions', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const ex = await c.env.DB.prepare(EXERCISE_SQL).bind(user.id, c.req.param('uid')).first<any>();
  if (!ex || !canSeeLearning(user, ex)) return refuse(c, 404, { code: 'not_found', message: 'No such exercise.' });
  const b = await c.req.json().catch(() => ({} as any));
  let body: string;
  if (ex.submission_kind === 'checklist') {
    let items: string[] = [];
    try { items = JSON.parse(ex.checklist_json || '[]'); } catch { items = []; }
    const checked = Array.isArray(b?.checked) ? b.checked : null;
    if (!checked || !checked.every((i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < items.length)) {
      return refuse(c, 400, { code: 'bad_answer', message: 'checked lists the indexes of the checklist items done.' });
    }
    body = JSON.stringify([...new Set(checked as number[])].sort((x, y) => x - y));
  } else {
    const text = typeof b?.body === 'string' ? b.body.trim() : '';
    if (!text) return refuse(c, 400, { code: 'bad_answer', message: 'An answer needs some text.' });
    if (text.length > 50_000) return refuse(c, 400, { code: 'bad_answer', message: 'An answer is at most 50,000 characters.' });
    body = text;
  }
  const latest = await c.env.DB.prepare(
    'SELECT status FROM learning_exercise_submissions WHERE exercise_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
  ).bind(ex.id, user.id).first<{ status: string }>();
  if (latest?.status === 'accepted') {
    return refuse(c, 409, { code: 'already_accepted', message: 'This exercise was accepted; there is nothing to resubmit.' });
  }
  const uid = newUid();
  await c.env.DB.prepare(
    `INSERT INTO learning_exercise_submissions (uid, exercise_id, user_id, body, status, submitted_at) VALUES (?, ?, ?, ?, 'submitted', ?)`,
  ).bind(uid, ex.id, user.id, body, nowIso()).run();
  const row = await c.env.DB.prepare('SELECT ' + SUBMISSION_COLS + ' FROM learning_exercise_submissions WHERE uid = ?').bind(uid).first();
  return c.json({ submission: row }, 201);
});

// ---- exams ---------------------------------------------------------------------------

const EXAM_SQL = 'SELECT id, uid, title, intro, pass_mark_percent, time_limit_minutes, max_attempts, shuffle, reveal, visibility, status, published_at, '
  + enrolledSql('exam', 'learning_exams.uid') + ' AS enrolled FROM learning_exams WHERE uid = ?';
const QUESTIONS_SQL = 'SELECT uid, prompt, kind, options_json, correct_json, position FROM learning_exam_questions WHERE exam_id = ? ORDER BY position, id';

function examIntro(x: any, questionCount: number) {
  return {
    uid: x.uid, title: x.title, intro: x.intro, pass_mark_percent: x.pass_mark_percent,
    time_limit_minutes: x.time_limit_minutes, max_attempts: x.max_attempts, reveal: x.reveal,
    question_count: questionCount, status: x.status, published_at: x.published_at,
  };
}

/** Close every open attempt of this member on this exam whose clock has run out. */
async function closeExpired(env: Env, exam: any, userId: number) {
  if (!exam.time_limit_minutes) return;
  const open = await env.DB.prepare(
    'SELECT id, started_at FROM learning_exam_attempts WHERE exam_id = ? AND user_id = ? AND submitted_at IS NULL',
  ).bind(exam.id, userId).all<{ id: number; started_at: string }>();
  const now = Date.now();
  for (const a of open.results || []) {
    const dl = deadlineMs(a.started_at, exam.time_limit_minutes);
    if (dl !== null && now > dl + SUBMIT_GRACE_SECONDS * 1000) {
      await env.DB.prepare(
        `UPDATE learning_exam_attempts SET submitted_at = ?, score_percent = 0, passed = 0, timed_out = 1 WHERE id = ? AND submitted_at IS NULL`,
      ).bind(new Date(dl).toISOString(), a.id).run();
    }
  }
}

async function visibleExam(c: C, user: any): Promise<any | Response> {
  const exam = await c.env.DB.prepare(EXAM_SQL).bind(user.id, c.req.param('uid')).first<any>();
  if (!exam || !canSeeLearning(user, exam)) return refuse(c, 404, { code: 'not_found', message: 'No such exam.' });
  return exam;
}

r.get('/exams/:uid', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const exam = await visibleExam(c, user); if (exam instanceof Response) return exam;
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM learning_exam_questions WHERE exam_id = ?').bind(exam.id).first<{ n: number }>();
  return c.json({ exam: examIntro(exam, Number(n?.n ?? 0)) });
});

/** The questions of an attempt, in the order it was shown them, from the stored order. */
function inOrder(all: StoredQuestion[], orderJson: string): StoredQuestion[] {
  let order: string[] = [];
  try { order = JSON.parse(orderJson); } catch { order = []; }
  const byUid = new Map(all.map((q) => [q.uid, q]));
  return order.map((u) => byUid.get(u)).filter(Boolean) as StoredQuestion[];
}

r.post('/exams/:uid/attempts', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const exam = await visibleExam(c, user); if (exam instanceof Response) return exam;
  await closeExpired(c.env, exam, user.id);
  const all = ((await c.env.DB.prepare(QUESTIONS_SQL).bind(exam.id).all<StoredQuestion>()).results || []);
  if (!all.length) return refuse(c, 409, { code: 'no_questions', message: 'This exam has no questions yet.' });
  // An attempt already open is resumed, not doubled.
  let created = false;
  let attempt = await c.env.DB.prepare(
    'SELECT uid, started_at, question_order_json FROM learning_exam_attempts WHERE exam_id = ? AND user_id = ? AND submitted_at IS NULL ORDER BY id DESC LIMIT 1',
  ).bind(exam.id, user.id).first<any>();
  if (!attempt) {
    const order = JSON.stringify((Number(exam.shuffle) === 1 ? shuffled(all) : all).map((q) => q.uid));
    const uid = newUid();
    const started = nowIso();
    // The attempt limit is checked inside the insert, so two starts at once cannot both pass it.
    const ins = await c.env.DB.prepare(
      `INSERT INTO learning_exam_attempts (uid, exam_id, user_id, started_at, question_order_json)
       SELECT ?, ?, ?, ?, ? WHERE ? IS NULL OR (SELECT COUNT(*) FROM learning_exam_attempts WHERE exam_id = ? AND user_id = ?) < ?`,
    ).bind(uid, exam.id, user.id, started, order, exam.max_attempts, exam.id, user.id, exam.max_attempts).run();
    if (!Number(ins?.meta?.changes ?? 0)) {
      return refuse(c, 409, { code: 'no_attempts_left', message: `This exam allows ${exam.max_attempts} attempt${exam.max_attempts === 1 ? '' : 's'}, and all have been used.` });
    }
    attempt = { uid, started_at: started, question_order_json: order };
    created = true;
  }
  const dl = deadlineMs(attempt.started_at, exam.time_limit_minutes);
  return c.json({
    attempt: { uid: attempt.uid, started_at: attempt.started_at, deadline: dl === null ? null : new Date(dl).toISOString() },
    questions: inOrder(all, attempt.question_order_json).map(memberQuestion),
  }, created ? 201 : 200);
});

function attemptView(a: any, exam: any, questions: StoredQuestion[]) {
  const base = {
    uid: a.uid, started_at: a.started_at, submitted_at: a.submitted_at, score_percent: a.score_percent,
    passed: a.passed === null || a.passed === undefined ? null : Number(a.passed) === 1, timed_out: Number(a.timed_out) === 1,
  };
  // Answers and the correct ones only after submission, and only if the exam reveals them.
  if (!a.submitted_at || exam.reveal !== 'score_and_answers') return { ...base, answers_revealed: false };
  let answers: Record<string, number[]> = {};
  try { answers = a.answers_json ? JSON.parse(a.answers_json) : {}; } catch { answers = {}; }
  const shown = inOrder(questions, a.question_order_json);
  return { ...base, answers_revealed: true, answers, correct: revealed(shown) };
}

r.post('/exams/:uid/attempts/:attempt/submit', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const exam = await visibleExam(c, user); if (exam instanceof Response) return exam;
  const a = await c.env.DB.prepare(
    'SELECT id, uid, user_id, started_at, submitted_at, question_order_json, answers_json, score_percent, passed, timed_out FROM learning_exam_attempts WHERE uid = ? AND exam_id = ?',
  ).bind(c.req.param('attempt'), exam.id).first<any>();
  // Another member's attempt answers as if it did not exist.
  if (!a || Number(a.user_id) !== Number(user.id)) return refuse(c, 404, { code: 'not_found', message: 'No such attempt.' });
  if (a.submitted_at) return refuse(c, 409, { code: 'already_submitted', message: 'This attempt was already submitted.' });
  const all = ((await c.env.DB.prepare(QUESTIONS_SQL).bind(exam.id).all<StoredQuestion>()).results || []);
  const shown = inOrder(all, a.question_order_json);
  const dl = deadlineMs(a.started_at, exam.time_limit_minutes);
  const now = Date.now();
  if (dl !== null && now > dl + SUBMIT_GRACE_SECONDS * 1000) {
    await c.env.DB.prepare(
      `UPDATE learning_exam_attempts SET submitted_at = ?, score_percent = 0, passed = 0, timed_out = 1 WHERE id = ? AND submitted_at IS NULL`,
    ).bind(new Date(dl).toISOString(), a.id).run();
    return refuse(c, 409, { code: 'time_limit_passed', message: 'The time limit passed before this was submitted, so the attempt is closed unscored.' });
  }
  const answers = normaliseAnswers((await c.req.json().catch(() => ({} as any)))?.answers, shown);
  if (!answers) return refuse(c, 400, { code: 'bad_answers', message: 'answers maps each question uid to the option indexes chosen; a single-choice question takes one.' });
  const g = grade(shown, answers);
  const passed = g.score_percent >= Number(exam.pass_mark_percent) ? 1 : 0;
  const submitted = new Date(now).toISOString();
  const upd = await c.env.DB.prepare(
    `UPDATE learning_exam_attempts SET submitted_at = ?, answers_json = ?, score_percent = ?, passed = ? WHERE id = ? AND submitted_at IS NULL`,
  ).bind(submitted, JSON.stringify(answers), g.score_percent, passed, a.id).run();
  if (!Number(upd?.meta?.changes ?? 0)) return refuse(c, 409, { code: 'already_submitted', message: 'This attempt was already submitted.' });
  const after = { ...a, submitted_at: submitted, answers_json: JSON.stringify(answers), score_percent: g.score_percent, passed, timed_out: 0 };
  return c.json({ attempt: attemptView(after, exam, all), correct_count: g.correct, question_count: g.total });
});

const ATTEMPTS_COLS = 'uid, user_id, started_at, submitted_at, question_order_json, answers_json, score_percent, passed, timed_out';

r.get('/exams/:uid/attempts', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const exam = await visibleExam(c, user); if (exam instanceof Response) return exam;
  await closeExpired(c.env, exam, user.id);
  const [rows, all] = await Promise.all([
    c.env.DB.prepare('SELECT ' + ATTEMPTS_COLS + ' FROM learning_exam_attempts WHERE exam_id = ? AND user_id = ? ORDER BY id DESC').bind(exam.id, user.id).all<any>(),
    c.env.DB.prepare(QUESTIONS_SQL).bind(exam.id).all<StoredQuestion>(),
  ]);
  const used = (rows.results || []).length;
  return c.json({
    attempts: (rows.results || []).map((a) => attemptView(a, exam, all.results || [])),
    attempts_left: exam.max_attempts == null ? null : Math.max(0, Number(exam.max_attempts) - used),
  });
});

// ---- read-only review ----------------------------------------------------------------

/** Name and uid only: a learner's email is never served here. */
const LEARNER = 'COALESCE(u.display_name, u.name) AS learner_name, u.uid AS learner_uid';

r.get('/review/exercises/:uid/submissions', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const ex = await c.env.DB.prepare('SELECT id, uid, title FROM learning_exercises WHERE uid = ?').bind(c.req.param('uid')).first<any>();
  if (!ex) return refuse(c, 404, { code: 'not_found', message: 'No such exercise.' });
  if (!(await canReviewLearning(c.env, user, { kind: 'exercise', uid: ex.uid }))) {
    return refuse(c, 403, { code: 'not_assigned', message: 'You can read the work of learners in programs assigned to you.' });
  }
  const rows = await c.env.DB.prepare(
    'SELECT s.uid, s.user_id, s.body, s.status, s.feedback, s.submitted_at, s.reviewed_at, ' + LEARNER
    + ' FROM learning_exercise_submissions s LEFT JOIN users u ON u.id = s.user_id WHERE s.exercise_id = ? ORDER BY s.id DESC LIMIT 500',
  ).bind(ex.id).all<any>();
  const out = [];
  for (const s of rows.results || []) {
    if (await canReadLearnerWork(c.env, user, Number(s.user_id), { kind: 'exercise', uid: ex.uid })) {
      const { user_id: _u, ...rest } = s;
      out.push(rest);
    }
  }
  return c.json({ exercise: { uid: ex.uid, title: ex.title }, submissions: out });
});

r.get('/review/exams/:uid/attempts', async (c) => {
  const user = await auth(c); if (user instanceof Response) return user;
  const exam = await c.env.DB.prepare('SELECT id, uid, title, reveal FROM learning_exams WHERE uid = ?').bind(c.req.param('uid')).first<any>();
  if (!exam) return refuse(c, 404, { code: 'not_found', message: 'No such exam.' });
  if (!(await canReviewLearning(c.env, user, { kind: 'exam', uid: exam.uid }))) {
    return refuse(c, 403, { code: 'not_assigned', message: 'You can read the work of learners in programs assigned to you.' });
  }
  const rows = await c.env.DB.prepare(
    'SELECT a.uid, a.user_id, a.started_at, a.submitted_at, a.score_percent, a.passed, a.timed_out, ' + LEARNER
    + ' FROM learning_exam_attempts a LEFT JOIN users u ON u.id = a.user_id WHERE a.exam_id = ? ORDER BY a.id DESC LIMIT 500',
  ).bind(exam.id).all<any>();
  const out = [];
  for (const a of rows.results || []) {
    if (await canReadLearnerWork(c.env, user, Number(a.user_id), { kind: 'exam', uid: exam.uid })) {
      out.push({
        uid: a.uid, learner_name: a.learner_name, learner_uid: a.learner_uid, started_at: a.started_at, submitted_at: a.submitted_at,
        score_percent: a.score_percent, passed: a.passed === null ? null : Number(a.passed) === 1, timed_out: Number(a.timed_out) === 1,
      });
    }
  }
  return c.json({ exam: { uid: exam.uid, title: exam.title }, attempts: out });
});

export default r;

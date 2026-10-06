/**
 * Exercises and exams (D559, #1160): every call the Learning center makes for
 * them, through the methods D559 added to the two Learning clients. No client
 * method is added here.
 *
 *   learningApi.exercise         → GET  /api/learning/exercises/:uid
 *   learningApi.submitExercise   → POST /api/learning/exercises/:uid/submissions
 *   learningApi.exam             → GET  /api/learning/exams/:uid
 *   learningApi.startExam        → POST /api/learning/exams/:uid/attempts
 *   learningApi.submitExam       → POST /api/learning/exams/:uid/attempts/:attempt/submit
 *   learningApi.examAttempts     → GET  /api/learning/exams/:uid/attempts
 *   learningApi.reviewSubmissions, reviewAttempts → GET /api/learning/review/…
 *   adminLearningApi.*Exercise*, *Exam*, *Question*, reviewSubmission
 *                                → /api/admin/learning/… (the Super Admin's)
 *
 * NO ANSWER KEY ON A MEMBER'S PAGE. The member calls below use `learningApi`
 * alone. `adminLearningApi.getExam`, the one read that carries `correct`
 * before an attempt is submitted, is called only by the studio's
 * `readStudioExam`.
 *
 * A REPLY IN THE WRONG SHAPE IS A FAILED READ, as in `learningReads.js`. A
 * refusal is not caught here: the error `request()` throws carries the
 * route's own sentence, and the page shows it as it came. The one exception is
 * `orRefusal`, for the review, whose 403 is an answer ("not yours to read")
 * rather than a failure.
 */
import { learningApi } from '../../lib/api/learning.js';
import { adminLearningApi } from '../../lib/api/adminLearning.js';
import { examBody, exerciseBody, questionBody } from './assessmentModel';

const shapeError = (what) => new Error(`${what} came back in a shape this page cannot read.`);

function listOf(reply, key, what) {
  const list = reply?.[key];
  if (!Array.isArray(list)) throw shapeError(what);
  return list;
}

function rowOf(reply, key, what) {
  const row = reply?.[key];
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw shapeError(what);
  return row;
}

// ── The member ────────────────────────────────────────────────────────────

/** An exercise and the caller's own submissions, newest first. A 404 is "no such exercise". */
export async function readExercise(uid) {
  const reply = await learningApi.exercise(uid);
  return { exercise: rowOf(reply, 'exercise', 'The exercise'), submissions: listOf(reply, 'submissions', 'Your submissions') };
}

/** Submit or resubmit: `{ body }` or `{ checked }`. Resolves to the stored submission. */
export async function submitExerciseAnswer(uid, answer) {
  return rowOf(await learningApi.submitExercise(uid, answer), 'submission', 'Your submission');
}

/** An exam's intro: its rules and question count, never a question. */
export async function readExam(uid) {
  return { exam: rowOf(await learningApi.exam(uid), 'exam', 'The exam') };
}

/** The caller's attempts, newest first, and how many are left (`null` for no limit). */
export async function readExamAttempts(uid) {
  const reply = await learningApi.examAttempts(uid);
  const attempts = listOf(reply, 'attempts', 'Your attempts');
  const left = reply.attempts_left;
  if (left !== null && !Number.isFinite(Number(left))) throw shapeError('Your attempts');
  return { attempts, attemptsLeft: left === null ? null : Number(left) };
}

/** Start an attempt, or resume the open one: `{ uid, started_at, deadline, questions }`, no answer in it. */
export async function startExamAttempt(uid) {
  const reply = await learningApi.startExam(uid);
  return { ...rowOf(reply, 'attempt', 'The attempt'), questions: listOf(reply, 'questions', 'The questions') };
}

/** Submit an attempt's answers (`{ [questionUid]: [index, …] }`). Resolves to the graded attempt, with the counts. */
export async function submitExamAttempt(uid, attemptUid, answers) {
  const reply = await learningApi.submitExam(uid, attemptUid, answers);
  return {
    ...rowOf(reply, 'attempt', 'Your result'),
    correct_count: reply.correct_count ?? null,
    question_count: reply.question_count ?? null,
  };
}

// ── The read-only review (the Super Admin, and a program's assigned admin) ──

/** Every learner's submissions to one exercise, newest first: a name and a uid, never an email. */
export async function readSubmissionsReview(uid) {
  const reply = await learningApi.reviewSubmissions(uid);
  return { exercise: rowOf(reply, 'exercise', 'The submissions'), submissions: listOf(reply, 'submissions', 'The submissions') };
}

/** Every learner's attempts at one exam, newest first: the scores, never the answers. */
export async function readAttemptsReview(uid) {
  const reply = await learningApi.reviewAttempts(uid);
  return { exam: rowOf(reply, 'exam', 'The attempts'), attempts: listOf(reply, 'attempts', 'The attempts') };
}

/** A read whose 403 is an answer: `{ refused }` in the route's own words, so the page shows it rather than "could not be read". */
export function orRefusal(load) {
  return async () => {
    try {
      return await load();
    } catch (err) {
      if (err?.status === 403) return { refused: err.message || 'This is not yours to read.' };
      throw err;
    }
  };
}

// ── The studio (the Super Admin's) ────────────────────────────────────────

/** Every exercise, drafts and archived included, the newest edit first. */
export async function readStudioExercises() {
  return { rows: listOf(await adminLearningApi.listExercises(), 'exercises', 'The exercise list') };
}

/** Every exam, drafts and archived included, the newest edit first. */
export async function readStudioExams() {
  return { rows: listOf(await adminLearningApi.listExams(), 'exams', 'The exam list') };
}

export async function readStudioExercise(uid) {
  return { exercise: rowOf(await adminLearningApi.getExercise(uid), 'exercise', 'The exercise') };
}

/** The authoring tree: the exam, `attempt_count`, and its questions with their correct answers. */
export async function readStudioExam(uid) {
  return { exam: rowOf(await adminLearningApi.getExam(uid), 'exam', 'The exam') };
}

/** Create a draft (no `uid`) or save an exercise. Resolves to the stored row. */
export async function saveExercise({ uid, form }) {
  const reply = uid
    ? await adminLearningApi.updateExercise(uid, exerciseBody(form, false))
    : await adminLearningApi.createExercise(exerciseBody(form, true));
  return rowOf(reply, 'exercise', 'The exercise');
}

const EXERCISE_STATUS = {
  publish: (uid) => adminLearningApi.publishExercise(uid),
  unpublish: (uid) => adminLearningApi.unpublishExercise(uid),
  archive: (uid) => adminLearningApi.archiveExercise(uid),
};
/** Publish, unpublish or archive an exercise. Resolves to the stored row. */
export async function setExerciseStatus(uid, action) {
  return rowOf(await EXERCISE_STATUS[action](uid), 'exercise', 'The exercise');
}

/** Create a draft exam or save one. Throws on a number it cannot send, before anything is sent. Resolves to the tree. */
export async function saveExam({ uid, form }) {
  const body = examBody(form);
  const reply = uid ? await adminLearningApi.updateExam(uid, body) : await adminLearningApi.createExam(body);
  return rowOf(reply, 'exam', 'The exam');
}

const EXAM_STATUS = {
  publish: (uid) => adminLearningApi.publishExam(uid),
  unpublish: (uid) => adminLearningApi.unpublishExam(uid),
  archive: (uid) => adminLearningApi.archiveExam(uid),
};
/** Publish, unpublish or archive an exam. Resolves to the tree. */
export async function setExamStatus(uid, action) {
  return rowOf(await EXAM_STATUS[action](uid), 'exam', 'The exam');
}

/** Add a question. Resolves to the exam's tree. */
export async function addExamQuestion(examUid, form) {
  return rowOf(await adminLearningApi.addQuestion(examUid, questionBody(form)), 'exam', 'The exam');
}

/** Edit a question, restated whole. Resolves to the exam's tree. */
export async function updateExamQuestion(uid, form) {
  return rowOf(await adminLearningApi.updateQuestion(uid, questionBody(form)), 'exam', 'The exam');
}

export async function deleteExamQuestion(uid) {
  return rowOf(await adminLearningApi.deleteQuestion(uid), 'exam', 'The exam');
}

/** Mark a submission `accepted` or `needs_work`, with feedback. Resolves to `{ uid, status, feedback, reviewed_at }`. */
export async function markSubmission(uid, { status, feedback }) {
  return rowOf(await adminLearningApi.reviewSubmission(uid, { status, feedback }), 'submission', 'The review');
}

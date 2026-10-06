/**
 * D562 stage 3 — exercises and exams, wired to D559's routes (#1160): the
 * learner's exercise and exam pages, an exercise or exam lesson inside a
 * course, the studio's exercise editor and exam builder, and the read-only
 * review of learners' work.
 *
 * Every fixture is in the shape `routes/learning_assessment.ts` or
 * `routes/admin_learning_assessment.ts` sends, and the first test reads those
 * files to hold the fixtures to them. Reads and writes go through the real
 * client against a stubbed `fetch`, so the method, the path and the body are
 * the ones the page sends. The suite renders on the server with no DOM, so a
 * form's handler is checked through the pure function it calls and the
 * source line that calls it.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_assessments_d559.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import {
  FROZEN_LINE, answerIndexes, assessmentHref, assessmentRows, attemptSecondsLeft, checkedOf, courseContext, examForm,
  exerciseAnswer, exerciseForm, openAttemptOf, questionBody, questionForm, revealedAnswers, withAssessmentRows, withoutOption,
} from '../src/pages/learning/assessmentModel.js';
import {
  addExamQuestion, deleteExamQuestion, markSubmission, orRefusal, readAttemptsReview, readExam, readExamAttempts,
  readExercise, readStudioExam, readStudioExams, readStudioExercise, readStudioExercises, readSubmissionsReview,
  saveExam, saveExercise, setExamStatus, setExerciseStatus, startExamAttempt, submitExamAttempt,
  submitExerciseAnswer, updateExamQuestion,
} from '../src/pages/learning/assessmentReads.js';
import {
  AssessmentLesson, ExamPage, ExamView, ExercisePage, ExerciseView, NotPublished, StudioAssessment,
} from '../src/pages/learning/LearningAssessments.jsx';
import ExercisePanel from '../src/pages/learning/ExercisePanel.jsx';
import ExamFlow from '../src/pages/learning/ExamFlow.jsx';
import {
  AttemptsReview, QuestionForm, StudioExamBuilder, StudioExerciseEditor, SubmissionsReview,
} from '../src/pages/learning/StudioAssessmentEditors.jsx';
import StudioCourseBuilder, { LessonForm, refLabel } from '../src/pages/learning/StudioCourseBuilder.jsx';
import StudioContentTable from '../src/pages/learning/StudioContentTable.jsx';
import { studioRows } from '../src/pages/learning/studioActions.js';

process.env.TZ = 'UTC';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el, path = '/learning') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
// `&amp;` is decoded last, so an escaped entity is never read as the character it escapes.
const flat = (markup) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const text = (el, path) => flat(html(el, path));
function tagOf(markup, id) {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  return markup.slice(markup.lastIndexOf('<', at), markup.indexOf('>', at) + 1);
}
/** The markup from the opening tag of one test id's element to the next given marker, for reading one zone. */
const zone = (markup, id, until) => {
  const at = markup.indexOf(`data-testid="${id}"`);
  if (at < 0) return '';
  const end = until ? markup.indexOf(until, at + 1) : -1;
  return markup.slice(markup.lastIndexOf('<', at), end > at ? end : undefined);
};
/** A link's or a button's visible text, up to its own closing tag. */
const labelOf = (markup, id) => {
  const tag = tagOf(markup, id);
  if (!tag) return '';
  const name = tag.slice(1).split(/[\s>]/)[0];
  const at = markup.indexOf(tag) + tag.length;
  return flat(markup.slice(at, markup.indexOf(`</${name}>`, at))).trim();
};
const routed = (url, pattern, element) => renderToStaticMarkup(
  h(MemoryRouter, { initialEntries: [url] }, h(Routes, null, h(Route, { path: pattern, element }))),
);

// ── Fixtures, in the routes' own shapes ────────────────────────────────────

/** `GET /api/learning/exercises/:uid`: `exerciseView` and `SUBMISSION_COLS`, newest first. */
const EXERCISE_TEXT = {
  uid: 'e1', title: 'Write your one-liner', instructions: 'Say what you do in **one** sentence.', submission_kind: 'text',
  checklist: null, status: 'published', published_at: '2026-10-02T10:00:00.000Z',
};
const NEEDS_WORK = { uid: 's2', body: 'We help founders raise.', status: 'needs_work', feedback: 'Name the buyer.', submitted_at: '2026-10-03T10:00:00.000Z', reviewed_at: '2026-10-04T10:00:00.000Z' };
const FIRST_TRY = { uid: 's1', body: 'We do fintech.', status: 'needs_work', feedback: 'Too vague.', submitted_at: '2026-10-01T10:00:00.000Z', reviewed_at: '2026-10-02T10:00:00.000Z' };
const EXERCISE_REPLY = { exercise: EXERCISE_TEXT, submissions: [NEEDS_WORK, FIRST_TRY] };
const ITEMS = ['A data room', 'A cap table', 'A pitch deck'];
const EXERCISE_CHECK = {
  uid: 'e2', title: 'Before you raise', instructions: 'Tick what is done.', submission_kind: 'checklist', checklist: ITEMS,
  status: 'published', published_at: '2026-10-02T10:00:00.000Z',
};
const CHECK_SUBMITTED = { uid: 's9', body: '[0,2]', status: 'submitted', feedback: null, submitted_at: '2026-10-05T10:00:00.000Z', reviewed_at: null };
const CHECK_REPLY = { exercise: EXERCISE_CHECK, submissions: [CHECK_SUBMITTED] };

/** `GET /api/learning/exams/:uid`: `examIntro`, no question in it. */
const EXAM = {
  uid: 'x1', title: 'Seed basics check', intro: 'Two questions on pricing.', pass_mark_percent: 70, time_limit_minutes: 30,
  max_attempts: 3, reveal: 'score', question_count: 2, status: 'published', published_at: '2026-10-02T10:00:00.000Z',
};
/** `GET /api/learning/exams/:uid/attempts`: `attemptView` per attempt, and `attempts_left`. */
const ATTEMPTS_REPLY = {
  attempts: [
    { uid: 'a2', started_at: '2026-10-04T09:00:00.000Z', submitted_at: '2026-10-04T09:20:00.000Z', score_percent: 50, passed: false, timed_out: false, answers_revealed: false },
    { uid: 'a1', started_at: '2026-10-03T09:00:00.000Z', submitted_at: '2026-10-03T09:30:00.000Z', score_percent: 0, passed: false, timed_out: true, answers_revealed: false },
  ],
  attempts_left: 1,
};
/** `POST /api/learning/exams/:uid/attempts`: the deadline and the questions, in this attempt's order, no answer. */
const START_REPLY = {
  attempt: { uid: 'a3', started_at: '2026-10-06T10:00:00.000Z', deadline: '2026-10-06T10:30:00.000Z' },
  questions: [
    { uid: 'q2', prompt: 'Which of these dilute the founders?', kind: 'multiple', options: ['A SAFE', 'A grant', 'Options for staff'] },
    { uid: 'q1', prompt: 'What is a pre-money valuation?', kind: 'single', options: ['The value before the round', 'The value after it'] },
  ],
};
const GRADED = { uid: 'a3', started_at: '2026-10-06T10:00:00.000Z', submitted_at: '2026-10-06T10:12:00.000Z', score_percent: 50, passed: false, timed_out: false };
/** `POST …/submit` on a `score` exam, and on a `score_and_answers` one. */
const SUBMIT_REPLY = { attempt: { ...GRADED, answers_revealed: false }, correct_count: 1, question_count: 2 };
const SUBMIT_REVEALED = {
  attempt: { ...GRADED, answers_revealed: true, answers: { q2: [0], q1: [0] }, correct: { q2: [0, 2], q1: [0] } },
  correct_count: 1, question_count: 2,
};
/** The read-only review: a learner's name and uid, never an email; an exam's scores, never its answers. */
const REVIEW_SUBMISSIONS = {
  exercise: { uid: 'e2', title: 'Before you raise' },
  submissions: [
    { ...CHECK_SUBMITTED, learner_name: 'Ada Founder', learner_uid: 'u1' },
    { uid: 's8', body: '[1]', status: 'accepted', feedback: 'Good.', submitted_at: '2026-10-04T10:00:00.000Z', reviewed_at: '2026-10-05T11:00:00.000Z', learner_name: 'Ben Investor', learner_uid: 'u2' },
  ],
};
const REVIEW_ATTEMPTS = {
  exam: { uid: 'x1', title: 'Seed basics check' },
  attempts: [
    { uid: 'a9', learner_name: 'Ada Founder', learner_uid: 'u1', started_at: '2026-10-06T09:00:00.000Z', submitted_at: '2026-10-06T09:20:00.000Z', score_percent: 82, passed: true, timed_out: false },
    { uid: 'a8', learner_name: 'Ben Investor', learner_uid: 'u2', started_at: '2026-10-06T09:30:00.000Z', submitted_at: null, score_percent: null, passed: null, timed_out: false },
    { uid: 'a7', learner_name: null, learner_uid: 'u3', started_at: '2026-10-05T09:00:00.000Z', submitted_at: '2026-10-05T09:30:00.000Z', score_percent: 0, passed: false, timed_out: true },
  ],
};
/** The studio's lists: `EXERCISE_SELECT` rows, and `EXAM_SELECT` rows without `id`. */
const STUDIO_EXERCISES = [
  { uid: 'e1', title: 'Write your one-liner', instructions: 'Say what you do.', submission_kind: 'text', checklist_json: null, visibility: 'open', status: 'published', created_by: 1, created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-05T10:00:00.000Z', published_at: '2026-10-02T10:00:00.000Z' },
  { uid: 'e2', title: 'Before you raise', instructions: 'Tick what is done.', submission_kind: 'checklist', checklist_json: JSON.stringify(ITEMS), visibility: 'program', status: 'draft', created_by: 1, created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-06T10:00:00.000Z', published_at: null },
  { uid: 'e0', title: 'An archived exercise', instructions: null, submission_kind: 'text', checklist_json: null, visibility: 'open', status: 'archived', created_by: 1, created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-02T10:00:00.000Z', published_at: null },
];
const STUDIO_EXAMS = [
  { uid: 'x1', title: 'Seed basics check', intro: 'Two questions on pricing.', pass_mark_percent: 70, time_limit_minutes: 30, max_attempts: 3, shuffle: 0, reveal: 'score', visibility: 'open', status: 'published', created_by: 1, created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-04T10:00:00.000Z', published_at: '2026-10-02T10:00:00.000Z' },
  { uid: 'x0', title: 'An archived exam', intro: null, pass_mark_percent: 70, time_limit_minutes: null, max_attempts: null, shuffle: 0, reveal: 'score', visibility: 'open', status: 'archived', created_by: 1, created_at: '2026-09-01T10:00:00.000Z', updated_at: '2026-09-03T10:00:00.000Z', published_at: null },
];
/** `examTree`: the Super Admin's authoring read, the one place `correct` appears before a submission. */
const EXAM_TREE = {
  ...STUDIO_EXAMS[0],
  attempt_count: 0,
  questions: [
    { uid: 'q2', position: 1, prompt: 'Which of these dilute the founders?', kind: 'multiple', options: ['A SAFE', 'A grant', 'Options for staff'], correct: [0, 2] },
    { uid: 'q1', position: 0, prompt: 'What is a pre-money valuation?', kind: 'single', options: ['The value before the round', 'The value after it'], correct: [0] },
  ],
};
/** `GET /api/learning/courses/:slug`, with an exercise lesson naming e1. */
const COURSE_REPLY = {
  course: { uid: 'c1', slug: 'seed-basics', title: 'Seed basics', resources: [], status: 'published' },
  modules: [{ uid: 'm9', title: 'Practice', position: 0, lessons: [{ uid: 'l9', title: 'Write it', position: 0, kind: 'exercise', ref_uid: 'e1', required: true, progress: null }] }],
  progress: { required: 1, completed: 0, percent: 0 },
};

const REFUSAL = (code, message) => ({ error: code, message, detail: message });

/** The real client against a stubbed fetch: each call recorded, each reply taken in turn. */
async function withFetch(replies, run) {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const calls = [];
  const queue = [...replies];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ method: init.method || 'GET', path: String(url).replace(/^.*\/api/, ''), body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = queue.shift() ?? { status: 200, body: {} };
    const reply = next.status ? next : { status: 200, body: next };
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  try { await run(); } finally { globalThis.fetch = orig; }
  return calls;
}

// ── The routes' shapes ─────────────────────────────────────────────────────

test('the fixtures are what D559 sends, and the studio\'s frozen line is the route\'s own sentence', () => {
  const member = read('cloudflare-worker/src/routes/learning_assessment.ts');
  for (const key of [
    'return c.json({ exercise: exerciseView(ex), submissions: subs.results || [] });',
    "const SUBMISSION_COLS = 'uid, body, status, feedback, submitted_at, reviewed_at';",
    'return c.json({ submission: row }, 201);',
    'question_count: questionCount, status: x.status, published_at: x.published_at,',
    'attempt: { uid: attempt.uid, started_at: attempt.started_at, deadline:',
    'questions: inOrder(all, attempt.question_order_json).map(memberQuestion),',
    'return c.json({ attempt: attemptView(after, exam, all), correct_count: g.correct, question_count: g.total, lesson_progress });',
    "if (!a.submitted_at || exam.reveal !== 'score_and_answers') return { ...base, answers_revealed: false };",
    'return { ...base, answers_revealed: true, answers, correct: revealed(shown) };',
    'attempts_left: exam.max_attempts == null ? null : Math.max(0, Number(exam.max_attempts) - used),',
    'return c.json({ exercise: { uid: ex.uid, title: ex.title }, submissions: out });',
    'return c.json({ exam: { uid: exam.uid, title: exam.title }, attempts: out });',
  ]) assert.ok(member.includes(key), `learning_assessment.ts no longer sends ${key}`);
  // A member's question is an allow-list: never `correct_json`.
  assert.ok(read('cloudflare-worker/src/services/learningAssessment.ts').includes('return { uid: q.uid, prompt: q.prompt, kind: q.kind, options };'));
  const admin = read('cloudflare-worker/src/routes/admin_learning_assessment.ts');
  for (const key of [
    "const EXERCISE_SELECT = 'SELECT uid, title, instructions, submission_kind, checklist_json, visibility, status, created_by, created_at, updated_at, published_at FROM learning_exercises';",
    'return c.json({ exams: (res.results || []).map(({ id: _id, ...x }) => x) });',
    'attempt_count: Number(attempts?.n ?? 0),',
    'options: JSON.parse(q.options_json), correct: JSON.parse(q.correct_json),',
    "SELECT uid, status, feedback, reviewed_at FROM learning_exercise_submissions WHERE uid = ?",
  ]) assert.ok(admin.includes(key), `admin_learning_assessment.ts no longer sends ${key}`);
  // The studio says why the questions are fixed in the route's own words.
  const frozen = /const FROZEN = \{ code: 'exam_has_attempts', message: '([^']+)' \};/.exec(admin)?.[1];
  assert.equal(FROZEN_LINE, frozen);
  // D557's lesson check accepts an exercise or exam lesson naming one of its kind (D559).
  assert.ok(read('cloudflare-worker/src/routes/admin_learning.ts').includes('bad(\'bad_ref\', `An ${kind} lesson names an ${kind}.`);'));
});

// ── The member's reads and writes ──────────────────────────────────────────

test('the learner\'s reads and writes go out with the right method, path and body, and never to an /admin route', async () => {
  let exercise; let stored; let exam; let attempts; let started; let graded;
  const calls = await withFetch([
    EXERCISE_REPLY, { submission: { ...NEEDS_WORK, uid: 's3', status: 'submitted' } }, { submission: CHECK_SUBMITTED },
    { exam: EXAM }, ATTEMPTS_REPLY, START_REPLY, SUBMIT_REPLY,
  ], async () => {
    exercise = await readExercise('e1');
    stored = await submitExerciseAnswer('e1', exerciseAnswer('text', { text: '  We help founders raise.  ' }));
    await submitExerciseAnswer('e2', exerciseAnswer('checklist', { checked: [2, 0, 2] }));
    exam = await readExam('x1');
    attempts = await readExamAttempts('x1');
    started = await startExamAttempt('x1');
    graded = await submitExamAttempt('x1', started.uid, answerIndexes(started.questions, { q2: ['2', '0'], q1: ['0'] }));
  });
  assert.deepEqual(calls, [
    { method: 'GET', path: '/learning/exercises/e1', body: undefined },
    { method: 'POST', path: '/learning/exercises/e1/submissions', body: { body: 'We help founders raise.' } },
    { method: 'POST', path: '/learning/exercises/e2/submissions', body: { checked: [0, 2] } },
    { method: 'GET', path: '/learning/exams/x1', body: undefined },
    { method: 'GET', path: '/learning/exams/x1/attempts', body: undefined },
    { method: 'POST', path: '/learning/exams/x1/attempts', body: undefined },
    { method: 'POST', path: '/learning/exams/x1/attempts/a3/submit', body: { answers: { q2: [0, 2], q1: [0] } } },
  ]);
  assert.ok(calls.every((c) => c.path.startsWith('/learning/')), 'a learner\'s page called a Super Admin route');
  assert.deepEqual(exercise.submissions.map((s) => s.uid), ['s2', 's1']);
  assert.equal(stored.uid, 's3');
  assert.equal(exam.exam.question_count, 2);
  assert.deepEqual([attempts.attempts.length, attempts.attemptsLeft], [2, 1]);
  // The start: the deadline and the questions, in this attempt's order, with no answer anywhere.
  assert.equal(started.deadline, '2026-10-06T10:30:00.000Z');
  assert.deepEqual(started.questions.map((q) => q.uid), ['q2', 'q1']);
  assert.doesNotMatch(JSON.stringify(started), /correct/);
  assert.deepEqual([graded.score_percent, graded.correct_count, graded.question_count, graded.answers_revealed], [50, 1, 2, false]);
  // No limit is null, never a number.
  const unlimited = await withFetch([{ ...ATTEMPTS_REPLY, attempts_left: null }], async () => {
    assert.equal((await readExamAttempts('x1')).attemptsLeft, null);
  });
  assert.equal(unlimited.length, 1);
});

test('a reply in the wrong shape is unreadable, and a 404 keeps its status for "no such"', async () => {
  await withFetch([
    { exercise: EXERCISE_TEXT }, { attempts: [] }, { attempt: { uid: 'a3' } }, { submissions: [] }, { exam: EXAM },
    { status: 404, body: REFUSAL('not_found', 'No such exam.') },
  ], async () => {
    await assert.rejects(readExercise('e1'), /cannot read/);
    await assert.rejects(readExamAttempts('x1'), /cannot read/, 'a list without attempts_left was read as a count');
    await assert.rejects(startExamAttempt('x1'), /cannot read/);
    await assert.rejects(readSubmissionsReview('e2'), /cannot read/);
    await assert.rejects(readAttemptsReview('x1'), /cannot read/);
    await assert.rejects(readExam('gone'), (err) => err.status === 404 && err.message === 'No such exam.');
  });
});

test('a refusal reaches the page in the route\'s own words', async () => {
  const spent = 'This exam allows 3 attempts, and all have been used.';
  const accepted = 'This exercise was accepted; there is nothing to resubmit.';
  const late = 'The time limit passed before this was submitted, so the attempt is closed unscored.';
  const notYours = 'You can read the work of learners in programs assigned to you.';
  await withFetch([
    { status: 409, body: REFUSAL('no_attempts_left', spent) },
    { status: 409, body: REFUSAL('already_accepted', accepted) },
    { status: 409, body: REFUSAL('time_limit_passed', late) },
    { status: 403, body: REFUSAL('not_assigned', notYours) },
    { status: 500, body: REFUSAL('server_error', 'Something failed.') },
  ], async () => {
    await assert.rejects(startExamAttempt('x1'), (err) => err.message === spent && err.status === 409 && err.code === 'no_attempts_left');
    await assert.rejects(submitExerciseAnswer('e1', { body: 'x' }), (err) => err.message === accepted && err.code === 'already_accepted');
    await assert.rejects(submitExamAttempt('x1', 'a3', {}), (err) => err.message === late && err.code === 'time_limit_passed');
    // The review's 403 is an answer, not a failure; anything else still fails.
    assert.deepEqual(await orRefusal(() => readSubmissionsReview('e2'))(), { refused: notYours });
    await assert.rejects(orRefusal(() => readAttemptsReview('x1'))(), (err) => err.status === 500);
  });
  // And each is drawn as it came, beside what it refused.
  const exerciseError = html(h(ExerciseView, { state: { status: 'ready', ...EXERCISE_REPLY }, onSubmit: () => {}, error: accepted }));
  assert.match(tagOf(exerciseError, 'exercise-error'), /role="alert"/);
  assert.ok(flat(zone(exerciseError, 'exercise-error', '</p>')).includes(accepted));
  const examError = html(h(ExamView, { examState: { status: 'ready', exam: EXAM }, attemptsState: { status: 'ready', attempts: [], attemptsLeft: 0 }, onStart: () => {}, error: spent }));
  assert.ok(flat(zone(examError, 'exam-error', '</p>')).includes(spent));
  const refused = html(h(SubmissionsReview, { status: 'ready', refused: notYours }));
  assert.ok(flat(zone(refused, 'review-submissions-refused', '</p>')).includes(notYours));
  assert.doesNotMatch(refused, /learning-unreadable|learning-empty/, 'a refusal was drawn as a failure or as nothing submitted');
  assert.ok(flat(html(h(AttemptsReview, { status: 'ready', refused: notYours }))).includes(notYours));
});

// ── The studio's reads and writes ──────────────────────────────────────────

test('the studio\'s writes go out with the right method, path and body', async () => {
  const newChecklist = { title: 'Before you raise', instructions: 'Tick what is done.', submission_kind: 'checklist', checklist: ['A data room', '  ', 'A cap table '], visibility: 'program' };
  const editText = { ...exerciseForm(STUDIO_EXERCISES[0]), title: 'Write your one-liner, again' };
  const newExam = { title: 'Seed basics check', intro: 'Two questions.', pass_mark_percent: ' 80 ', time_limit_minutes: '', max_attempts: '2', shuffle: true, reveal: 'score_and_answers', visibility: 'open' };
  const blankMiddle = { prompt: 'Which is a priced round?', kind: 'single', options: ['A SAFE', ' ', 'Series A'], correct: [2] };
  const calls = await withFetch([
    { exercises: STUDIO_EXERCISES }, { exams: STUDIO_EXAMS }, { exercise: STUDIO_EXERCISES[1] }, { exam: EXAM_TREE },
    { exercise: STUDIO_EXERCISES[1] }, { exercise: STUDIO_EXERCISES[0] },
    { exercise: STUDIO_EXERCISES[0] }, { exercise: STUDIO_EXERCISES[0] }, { exercise: STUDIO_EXERCISES[0] },
    { exam: EXAM_TREE }, { exam: EXAM_TREE }, { exam: EXAM_TREE }, { exam: EXAM_TREE }, { exam: EXAM_TREE }, { exam: EXAM_TREE },
    { submission: { uid: 's9', status: 'needs_work', feedback: 'Add the deck.', reviewed_at: '2026-10-06T12:00:00.000Z' } },
  ], async () => {
    assert.equal((await readStudioExercises()).rows.length, 3);
    assert.equal((await readStudioExams()).rows.length, 2);
    await readStudioExercise('e2');
    assert.deepEqual((await readStudioExam('x1')).exam.questions[0].correct, [0, 2]);
    await saveExercise({ uid: null, form: newChecklist });
    await saveExercise({ uid: 'e1', form: editText });
    await setExerciseStatus('e1', 'publish');
    await setExerciseStatus('e1', 'unpublish');
    await setExerciseStatus('e1', 'archive');
    await saveExam({ uid: null, form: newExam });
    await saveExam({ uid: 'x1', form: examForm(EXAM_TREE) });
    await setExamStatus('x1', 'publish');
    await addExamQuestion('x1', blankMiddle);
    await updateExamQuestion('q2', questionForm(EXAM_TREE.questions[0]));
    await deleteExamQuestion('q2');
    await markSubmission('s9', { status: 'needs_work', feedback: 'Add the deck.' });
  });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), [
    'GET /admin/learning/exercises',
    'GET /admin/learning/exams',
    'GET /admin/learning/exercises/e2',
    'GET /admin/learning/exams/x1',
    'POST /admin/learning/exercises',
    'PATCH /admin/learning/exercises/e1',
    'POST /admin/learning/exercises/e1/publish',
    'POST /admin/learning/exercises/e1/unpublish',
    'POST /admin/learning/exercises/e1/archive',
    'POST /admin/learning/exams',
    'PATCH /admin/learning/exams/x1',
    'POST /admin/learning/exams/x1/publish',
    'POST /admin/learning/exams/x1/questions',
    'PATCH /admin/learning/questions/q2',
    'DELETE /admin/learning/questions/q2',
    'POST /admin/learning/submissions/s9/review',
  ]);
  const bodyOf = (i) => calls[i].body;
  // A new checklist: its kind, and its items with blank rows dropped.
  assert.deepEqual(bodyOf(4), { title: 'Before you raise', instructions: 'Tick what is done.', visibility: 'program', submission_kind: 'checklist', checklist: ['A data room', 'A cap table'] });
  // An edit sends no kind (the route keeps it) and a written answer no items.
  assert.deepEqual(bodyOf(5), { title: 'Write your one-liner, again', instructions: 'Say what you do.', visibility: 'open' });
  for (const i of [6, 7, 8, 11]) assert.equal(bodyOf(i), undefined, 'a status change sends no body');
  // An exam: whole numbers, an empty limit as null (no limit), and the reveal as chosen.
  assert.deepEqual(bodyOf(9), { title: 'Seed basics check', intro: 'Two questions.', pass_mark_percent: 80, time_limit_minutes: null, max_attempts: 2, shuffle: true, reveal: 'score_and_answers', visibility: 'open' });
  assert.deepEqual(bodyOf(10), { title: 'Seed basics check', intro: 'Two questions on pricing.', pass_mark_percent: 70, time_limit_minutes: 30, max_attempts: 3, shuffle: false, reveal: 'score', visibility: 'open' });
  // A question restated whole, a blank option dropped and the correct index moved with its option.
  assert.deepEqual(bodyOf(12), { prompt: 'Which is a priced round?', kind: 'single', options: ['A SAFE', 'Series A'], correct: [1] });
  assert.deepEqual(bodyOf(13), { prompt: 'Which of these dilute the founders?', kind: 'multiple', options: ['A SAFE', 'A grant', 'Options for staff'], correct: [0, 2] });
  assert.equal(bodyOf(14), undefined);
  assert.deepEqual(bodyOf(15), { status: 'needs_work', feedback: 'Add the deck.' });
});

test('a number the studio cannot send is refused before anything goes out', async () => {
  const base = examForm(EXAM_TREE);
  const sent = await withFetch([], async () => {
    await assert.rejects(saveExam({ uid: 'x1', form: { ...base, pass_mark_percent: '' } }), /The pass mark is a whole number from 0 to 100\./);
    await assert.rejects(saveExam({ uid: 'x1', form: { ...base, time_limit_minutes: 'soon' } }), /The time limit is a whole number of minutes, or empty for none\./);
    await assert.rejects(saveExam({ uid: 'x1', form: { ...base, max_attempts: '1.5' } }), /Attempts is a whole number, or empty for no limit\./);
  });
  assert.deepEqual(sent, [], 'an empty pass mark would have been stored as 0%');
});

// ── The exercise page ──────────────────────────────────────────────────────

test('an exercise: its instructions, the latest answer and its status, earlier answers kept, the feedback, and a resubmit', () => {
  const markup = html(h(ExerciseView, { state: { status: 'ready', ...EXERCISE_REPLY }, onSubmit: () => {} }));
  const out = flat(markup);
  assert.match(markup, /<strong>one<\/strong>/);
  assert.match(out, /Needs work Submitted 3 Oct 2026 · reviewed 4 Oct 2026/);
  // Resubmitting adds a row: the earlier answer is listed, not lost, and the latest is not listed twice.
  const history = zone(markup, 'exercise-history', '</ul>');
  assert.match(flat(history), /Needs work 1 Oct 2026/);
  assert.equal(history.split('<li').length - 1, 1);
  assert.match(out, /Resubmitting keeps your earlier answers\./);
  // The route sends no reviewer's name, and the page says so rather than inventing one.
  assert.match(out, /Reviewer not recorded · 4 Oct 2026 Name the buyer\./);
  assert.match(markup, />We help founders raise\.<\/textarea>/, 'a resubmission does not start from the answer that needs work');
  assert.doesNotMatch(tagOf(markup, 'button-exercise-submit'), /disabled=""/);
  assert.equal(labelOf(markup, 'button-exercise-submit'), 'Resubmit');
  // Accepted: nothing to resubmit.
  const done = html(h(ExerciseView, { state: { status: 'ready', exercise: EXERCISE_TEXT, submissions: [{ ...NEEDS_WORK, status: 'accepted' }] }, onSubmit: () => {} }));
  assert.match(done, /data-testid="exercise-accepted"/);
  assert.doesNotMatch(done, /form-exercise-answer|exercise-keeps/);
  // Never submitted: the form, and nothing claimed about a review.
  const fresh = html(h(ExerciseView, { state: { status: 'ready', exercise: EXERCISE_TEXT, submissions: [] }, onSubmit: () => {} }));
  assert.match(fresh, /data-testid="exercise-not-submitted"/);
  assert.doesNotMatch(fresh, /exercise-keeps/);
  // The read's states.
  assert.match(text(h(ExerciseView, { state: { status: 'missing', message: 'No such exercise.' } })), /No such exercise/);
  assert.match(html(h(ExerciseView, { state: { status: 'loading' } })), /learning-loading/);
  assert.match(text(h(ExerciseView, { state: { status: 'unreadable' }, onRetry: () => {} })), /The exercise could not be read\./);
});

test('a checklist exercise: its items to tick, a submitted checklist drawn as ticks, and the answer sent as indexes', () => {
  const markup = html(h(ExerciseView, { state: { status: 'ready', ...CHECK_REPLY }, onSubmit: () => {} }));
  const answer = flat(zone(markup, 'exercise-submitted-checklist', '</ul>'));
  assert.match(answer, /A data room \(done\) A cap table \(not done\) A pitch deck \(done\)/);
  assert.doesNotMatch(flat(markup), /\[0,2\]/, 'the stored indexes were drawn as text');
  // The form: one box per item, none ticked over an answer waiting on review.
  for (const i of [0, 1, 2]) assert.ok(tagOf(markup, `input-exercise-check-${i}`), `item ${i} has no box`);
  assert.doesNotMatch(tagOf(markup, 'input-exercise-check-0'), /checked=""/);
  assert.match(flat(zone(markup, 'text-exercise-count', '</span>')), /0 of 3 done/);
  assert.doesNotMatch(markup, /input-exercise-answer/, 'a checklist offered a text box');
  // The route takes any set of the items, none included, so the submit is live.
  assert.doesNotMatch(tagOf(markup, 'button-exercise-submit'), /disabled=""/);
  // Needs work: the form starts from what was ticked.
  const redo = html(h(ExercisePanel, { status: 'ready', exercise: EXERCISE_CHECK, submission: { ...CHECK_SUBMITTED, body: '[1]', status: 'needs_work' }, onSubmit: () => {} }));
  assert.match(tagOf(redo, 'input-exercise-check-1'), /checked=""/);
  assert.doesNotMatch(tagOf(redo, 'input-exercise-check-0'), /checked=""/);
  // What the form sends is the route's own body.
  assert.deepEqual(exerciseAnswer('checklist', { checked: [2, 0, 2] }), { checked: [0, 2] });
  assert.deepEqual(exerciseAnswer('text', { text: '  We help founders raise.  ' }), { body: 'We help founders raise.' });
  assert.match(codeOnly(read('frontend/src/pages/learning/ExercisePanel.jsx')),
    /if \(onSubmit && answerable\) onSubmit\(exerciseAnswer\(isChecklist \? 'checklist' : 'text', \{ text: draft, checked \}\)\);/);
  // A body is read as ticks only when it is the list the route stores.
  assert.deepEqual([checkedOf('[0,2]', 3), checkedOf('[1,1]', 3), checkedOf('We help', 3), checkedOf('[5]', 3), checkedOf('[0.5]')], [[0, 2], [1], null, null, null]);
});

// ── The exam page ──────────────────────────────────────────────────────────

const examState = { status: 'ready', exam: EXAM };
const attemptsState = (over = {}) => ({ status: 'ready', attempts: ATTEMPTS_REPLY.attempts, attemptsLeft: 1, ...over });

test('an exam\'s intro: its rules, the attempts left as the route counts them, earlier attempts, and an open one resumed', () => {
  const markup = html(h(ExamView, { examState, attemptsState: attemptsState(), onStart: () => {} }));
  const out = flat(markup);
  assert.match(markup, /data-step="intro"/);
  assert.match(out, /Questions 2 Time limit 30 min Pass mark 70% Attempts left 1/);
  const list = flat(zone(markup, 'exam-attempts', '</ul>'));
  assert.match(list, /50% Fail 4 Oct 2026/);
  assert.match(list, /0% Timed out 3 Oct 2026/);
  assert.equal(labelOf(markup, 'button-exam-start'), 'Start exam');
  assert.doesNotMatch(tagOf(markup, 'button-exam-start'), /disabled=""/);
  // None left: no start. The route's own count decides, not the list's length.
  const spent = html(h(ExamView, { examState, attemptsState: attemptsState({ attemptsLeft: 0 }), onStart: () => {} }));
  assert.equal(labelOf(spent, 'button-exam-start'), 'No attempts left');
  assert.match(tagOf(spent, 'button-exam-start'), /disabled=""/);
  // An attempt still open is resumed, even with none left to start.
  const open = { uid: 'a3', started_at: '2026-10-06T10:00:00.000Z', submitted_at: null, score_percent: null, passed: null, timed_out: false, answers_revealed: false };
  const resume = html(h(ExamView, { examState, attemptsState: attemptsState({ attempts: [open, ...ATTEMPTS_REPLY.attempts], attemptsLeft: 0 }), onStart: () => {} }));
  assert.equal(labelOf(resume, 'button-exam-start'), 'Resume exam');
  assert.doesNotMatch(tagOf(resume, 'button-exam-start'), /disabled=""/);
  assert.match(flat(zone(resume, 'exam-open-attempt', '</p>')), /You have an attempt open, started 6 Oct 2026\. Its clock has run since then\./);
  assert.match(flat(zone(resume, 'exam-attempts', '</ul>')), /Not submitted Open 6 Oct 2026/);
  // Open means started and never submitted: a row with no start is not one to resume.
  assert.equal(openAttemptOf([open, ...ATTEMPTS_REPLY.attempts]), open);
  assert.equal(openAttemptOf(ATTEMPTS_REPLY.attempts), null);
  assert.equal(openAttemptOf([{ uid: 'ax', submitted_at: null }]), null);
  // No limit is said in words, never as a number.
  const loose = text(h(ExamView, { examState: { status: 'ready', exam: { ...EXAM, time_limit_minutes: null, max_attempts: null } }, attemptsState: attemptsState({ attemptsLeft: null }), onStart: () => {} }));
  assert.match(loose, /Time limit No time limit Pass mark 70% Attempts left No limit/);
  assert.match(loose, /There is no time limit\./);
  // A limit the route did not send at all is not recorded, which is not the same as none.
  const bare = text(h(ExamFlow, { status: 'ready', exam: { uid: 'x9', title: 'Bare', question_count: 1, pass_mark_percent: 70 }, attempts: [] }));
  assert.match(bare, /Time limit Not recorded Pass mark 70% Attempts left Not recorded/);
  assert.doesNotMatch(bare, /No time limit|No limit|There is no time limit/);
  // The attempts read fails on its own: said so, and the start is still the route's to refuse.
  const unread = html(h(ExamView, { examState, attemptsState: { status: 'unreadable' }, onStart: () => {}, onRetryAttempts: () => {} }));
  assert.match(flat(unread), /Attempts left Could not be read/);
  assert.match(flat(unread), /Your attempts could not be read\. This is not a claim that you have none\./);
  assert.doesNotMatch(tagOf(unread, 'button-exam-start'), /disabled=""/);
  assert.match(flat(html(h(ExamView, { examState, attemptsState: { status: 'loading' }, onStart: () => {} }))), /Attempts left Reading…/);
  // A Super Admin opening a draft is told an attempt fixes its questions.
  assert.match(html(h(ExamView, { examState: { status: 'ready', exam: { ...EXAM, status: 'draft' } }, attemptsState: attemptsState(), onStart: () => {} })), /data-testid="exam-draft-note"/);
  assert.doesNotMatch(markup, /exam-draft-note/);
});

test('sitting an exam: the attempt\'s own order, the server\'s deadline, one question a screen, the choices sent as indexes', () => {
  const attempt = { ...START_REPLY.attempt, questions: START_REPLY.questions };
  const markup = html(h(ExamView, { examState, attemptsState: attemptsState(), attempt, now: Date.parse('2026-10-06T10:06:12Z'), onSubmit: () => {} }));
  assert.match(markup, /data-step="taking"/);
  assert.match(flat(markup), /Question 1 of 2 · 0 answered 23:48 Which of these dilute the founders\? Choose every answer that applies\./);
  assert.match(markup, /type="checkbox"/);
  assert.doesNotMatch(markup, /What is a pre-money valuation|type="radio"/, 'more than one question on the screen');
  assert.doesNotMatch(flat(markup), /Correct/, 'a correct answer while the attempt runs');
  // The clock is the server's: its deadline wins over the exam's limit, and null means untimed.
  const at = Date.parse('2026-10-06T10:06:12Z');
  const longer = html(h(ExamView, { examState: { status: 'ready', exam: { ...EXAM, time_limit_minutes: 60 } }, attemptsState: attemptsState(), attempt, now: at, onSubmit: () => {} }));
  assert.match(flat(zone(longer, 'text-exam-clock', '</span>')), /23:48/, 'the clock counted from the exam\'s limit, not the attempt\'s deadline');
  assert.equal(attemptSecondsLeft({ started_at: '2026-10-06T10:00:00Z', deadline: '2026-10-06T10:30:00Z' }, { time_limit_minutes: 60 }, at), 1428);
  assert.equal(attemptSecondsLeft({ started_at: '2026-10-06T10:00:00Z', deadline: null }, { time_limit_minutes: 30 }, at), null);
  assert.equal(attemptSecondsLeft({ started_at: '2026-10-06T10:00:00Z', deadline: '2026-10-06T10:30:00Z' }, EXAM, Date.parse('2026-10-06T10:31:00Z')), 0);
  // One question left to answer on the last screen: the submit, and what an unanswered one counts as.
  const last = html(h(ExamView, { examState, attemptsState: attemptsState(), attempt: { ...attempt, questions: [START_REPLY.questions[1]] }, now: at, onSubmit: () => {} }));
  assert.match(last, /data-testid="button-exam-submit"/);
  assert.match(flat(zone(last, 'text-exam-unanswered', '</span>')), /1 unanswered: an unanswered question counts as wrong\./);
  // What goes to the route: each answered question's options as their indexes; an unanswered one left out.
  assert.deepEqual(answerIndexes(START_REPLY.questions, { q2: ['2', '0'], q1: [] }), { q2: [0, 2] });
  assert.deepEqual(answerIndexes([{ uid: 'q', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] }], { q: ['b'] }), { q: [1] });
  const flow = codeOnly(read('frontend/src/pages/learning/ExamFlow.jsx'));
  assert.match(flow, /const send = \(\) => \{ if \(onSubmit\) onSubmit\(answerIndexes\(questions, answers\)\); \};/);
  // When the server's clock runs out, what is chosen is sent, once, inside the route's grace.
  assert.match(flow, /if \(left === 0 && onSubmit && !busy && !autoSent\.current\) \{\s*autoSent\.current = true;\s*send\(\);/);
  // A new attempt starts with nothing chosen: the screen is keyed by the attempt.
  assert.match(flow, /<ExamTaking key=\{attempt\.uid \|\| 'attempt'\}/);
});

test('the result: the route\'s score and outcome, and the correct answers only when the route reveals them', () => {
  const questions = START_REPLY.questions;
  const hidden = { ...SUBMIT_REPLY.attempt, correct_count: 1, question_count: 2, questions };
  const markup = html(h(ExamView, { examState, attemptsState: attemptsState(), result: hidden, onStart: () => {} }));
  const out = flat(markup);
  assert.match(markup, /data-step="result"/);
  assert.match(out, /50% Fail Pass mark 70% · 1 of 2 correct · submitted 6 Oct 2026/);
  assert.match(flat(zone(markup, 'exam-answers-hidden', '</p>')), /Correct answers: hidden\. This exam does not reveal them\./);
  assert.doesNotMatch(out, /Options for staff|The value before the round/, 'an option was drawn on a result that reveals nothing');
  // Earlier attempts, this one left out; another try while the route counts one left.
  assert.match(flat(zone(markup, 'exam-attempts', '</ul>')), /50% Fail 4 Oct 2026 0% Timed out 3 Oct 2026/);
  assert.ok(tagOf(markup, 'button-exam-retry'));
  assert.doesNotMatch(html(h(ExamView, { examState, attemptsState: attemptsState({ attemptsLeft: 0 }), result: hidden, onStart: () => {} })), /button-exam-retry/);
  assert.doesNotMatch(html(h(ExamView, { examState, attemptsState: { status: 'loading' }, result: hidden, onStart: () => {} })), /button-exam-retry/);
  // A revealing exam: each question, what was chosen, what was right.
  const revealing = { status: 'ready', exam: { ...EXAM, reveal: 'score_and_answers' } };
  const shown = { ...SUBMIT_REVEALED.attempt, correct_count: 1, question_count: 2, questions };
  const answers = flat(zone(html(h(ExamView, { examState: revealing, attemptsState: attemptsState(), result: shown })), 'exam-answers', '</ol>'));
  assert.match(answers, /Which of these dilute the founders\? Your answer: A SAFE Correct: A SAFE, Options for staff/);
  assert.match(answers, /What is a pre-money valuation\? Your answer: The value before the round Correct: The value before the round/);
  assert.deepEqual(revealedAnswers(revealing.exam, shown).map((r) => r.right), [false, true]);
  // Both must say so: the route's flag and the exam's reveal.
  assert.equal(revealedAnswers(revealing.exam, { ...shown, answers_revealed: false }), null);
  assert.equal(revealedAnswers(EXAM, shown), null);
  const unsent = flat(html(h(ExamView, { examState: revealing, attemptsState: attemptsState(), result: { ...shown, answers_revealed: false } })));
  assert.match(unsent, /Correct answers: not sent for this attempt\./);
  assert.doesNotMatch(unsent, /Options for staff/);
  // A timed-out attempt says so; a score the route did not send is said to be missing, never 0%.
  assert.match(text(h(ExamView, { examState, attemptsState: attemptsState(), result: { ...hidden, score_percent: 0, timed_out: true } })), /0% Timed out/);
  const unscored = html(h(ExamView, { examState, attemptsState: attemptsState(), result: { ...hidden, score_percent: null, passed: null } }));
  assert.match(flat(unscored), /Score not recorded Pass mark 70%/);
  // The score and its pill, up to the line under them: no number and no outcome invented.
  assert.doesNotMatch(flat(zone(unscored, 'text-exam-score', '</div>')), /%|NaN|Fail|Pass/);
  // The attempt just submitted is the result, not one of the earlier attempts.
  const listed = html(h(ExamView, { examState, attemptsState: attemptsState({ attempts: [{ ...GRADED, answers_revealed: false }, ...ATTEMPTS_REPLY.attempts] }), result: hidden }));
  assert.doesNotMatch(flat(zone(listed, 'exam-attempts', '</ul>')), /6 Oct 2026/);
  // The page keeps the questions it showed, for the reveal.
  assert.match(codeOnly(read('frontend/src/pages/learning/LearningAssessments.jsx')), /setResult\(\{ \.\.\.graded, questions: sitting\.questions \}\);/);
});

test('the exam page\'s states: loading, unreadable, no such exam', () => {
  assert.match(html(h(ExamView, { examState: { status: 'loading' }, attemptsState: { status: 'loading' } })), /learning-loading/);
  assert.match(text(h(ExamView, { examState: { status: 'unreadable' }, attemptsState: { status: 'ready', attempts: [], attemptsLeft: 3 }, onRetryExam: () => {} })),
    /The exam could not be read\. This is not a claim that you have no attempts\./);
  assert.match(text(h(ExamView, { examState: { status: 'missing', message: 'No such exam.' }, attemptsState: { status: 'missing' } })), /No such exam/);
});

test('the pages: a header from the read, the rail, and the course they were opened from', () => {
  const plain = routed('/learning/exercises/e1', '/learning/exercises/:slug', h(ExercisePage, { uid: 'e1' }));
  assert.match(plain, /data-testid="learning-exercise"/);
  assert.match(flat(plain), /Worker AI · Learning/);
  assert.match(tagOf(plain, 'link-learning-back'), /href="\/learning"/);
  assert.match(plain, /learning-loading/);
  const fromCourse = routed('/learning/exams/x1?course=seed-basics', '/learning/exams/:slug', h(ExamPage, { uid: 'x1' }));
  assert.match(fromCourse, /data-testid="learning-exam"/);
  assert.match(tagOf(fromCourse, 'link-learning-back'), /href="\/learning\/courses\/seed-basics"/);
  // Once the course is read: its title, and the module of the lesson naming this one.
  const ready = { status: 'ready', ...COURSE_REPLY };
  assert.deepEqual(courseContext(ready, 'exercise', 'e1', 'seed-basics'), { back: { to: '/learning/courses/seed-basics', label: 'Seed basics' }, sub: 'Part of Seed basics · Practice' });
  assert.deepEqual(courseContext(ready, 'exam', 'e1', 'seed-basics').sub, undefined, 'a lesson of another kind was taken for this one');
  assert.deepEqual(courseContext({ status: 'loading' }, 'exercise', 'e1', 'seed-basics'), { back: { to: '/learning/courses/seed-basics', label: 'Course' }, sub: undefined });
  assert.deepEqual(courseContext(ready, 'exercise', 'e1', ''), { back: { to: '/learning', label: 'Learning' }, sub: undefined });
  // A draft or archived one, which only the Super Admin can open, is marked in the header.
  assert.equal(text(h(NotPublished, { row: { ...EXERCISE_TEXT, status: 'draft' } })).trim(), 'Draft · members cannot open it');
  assert.equal(text(h(NotPublished, { row: { ...EXAM, status: 'archived' } })).trim(), 'Archived · members cannot open it');
  assert.equal(html(h(NotPublished, { row: EXAM })), '');
  assert.equal(html(h(NotPublished, { row: null })), '');
});

// ── An exercise or exam lesson ─────────────────────────────────────────────

test('an exercise or exam lesson opens what it names, carrying its course', () => {
  const lesson = COURSE_REPLY.modules[0].lessons[0];
  const exercise = html(h(AssessmentLesson, { lesson, slug: 'seed-basics' }));
  assert.match(tagOf(exercise, 'link-lesson-assessment'), /href="\/learning\/exercises\/e1\?course=seed-basics"/);
  assert.equal(labelOf(exercise, 'link-lesson-assessment'), 'Open the exercise');
  assert.match(exercise, /data-testid="lesson-elsewhere"/);
  const exam = html(h(AssessmentLesson, { lesson: { ...lesson, kind: 'exam', ref_uid: 'x1', title: 'Check yourself' }, slug: 'seed-basics' }));
  assert.match(tagOf(exam, 'link-lesson-assessment'), /href="\/learning\/exams\/x1\?course=seed-basics"/);
  assert.equal(labelOf(exam, 'link-lesson-assessment'), 'Open the exam');
  const nothing = html(h(AssessmentLesson, { lesson: { ...lesson, ref_uid: '' }, slug: 'seed-basics' }));
  assert.doesNotMatch(nothing, /link-lesson-assessment/);
  assert.match(flat(nothing), /This lesson names no exercise\./);
  assert.equal(assessmentHref('exam', 'x 1', 'seed basics'), '/learning/exams/x%201?course=seed%20basics');
  assert.equal(assessmentHref('exercise', 'e1'), '/learning/exercises/e1');
  assert.equal(assessmentHref('video', 'v1', 'seed-basics'), null);
});

// ── The course builder ─────────────────────────────────────────────────────

test('the course builder: an exercise or exam lesson chooses among the studio\'s own, archived left out, and says what it opens', () => {
  // A new lesson may be any of the five kinds D557 and D559 accept.
  const kinds = zone(html(h(LessonForm, { items: [], exercises: STUDIO_EXERCISES, exams: STUDIO_EXAMS, onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Add lesson' })), 'select-lesson-kind', '</select>');
  assert.match(kinds, /<option value="exercise">Exercise<\/option><option value="exam">Exam<\/option>/);
  assert.doesNotMatch(kinds, /disabled/);
  const exerciseLesson = { uid: 'l9', kind: 'exercise', title: 'Write it', ref_uid: 'e1', required: true };
  const form = html(h(LessonForm, { lesson: exerciseLesson, items: [], exercises: STUDIO_EXERCISES, exams: STUDIO_EXAMS, onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Save lesson' }));
  const choices = zone(form, 'select-lesson-ref', '</select>');
  assert.match(choices, /<option value="e1" selected="">Write your one-liner<\/option>/);
  assert.match(choices, /<option value="e2">Before you raise \(draft\)<\/option>/);
  assert.doesNotMatch(choices, /value="e0"|value="x1"/, 'an archived exercise, or an exam, offered for an exercise lesson');
  assert.match(flat(form), /Exercise Choose one/);
  assert.match(flat(form), /Members open a draft exercise only once it is published\./);
  // D559 (#1249): the Worker completes such a lesson itself, and the builder says when, for each kind.
  assert.equal(flat(zone(form, 'text-lesson-assessment-progress', '</p>')).trim(), 'It completes for a member when a reviewer accepts their answer.');
  const examForm = html(h(LessonForm, { lesson: { ...exerciseLesson, kind: 'exam', ref_uid: 'x1' }, items: [], exercises: STUDIO_EXERCISES, exams: STUDIO_EXAMS, onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Save lesson' }));
  assert.equal(flat(zone(examForm, 'text-lesson-assessment-progress', '</p>')).trim(), 'It completes for a member when they pass the exam.');
  assert.doesNotMatch(flat(form) + flat(examForm), /Nothing marks|below 100%/);
  assert.doesNotMatch(html(h(LessonForm, { items: [], onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Add lesson' })), /text-lesson-assessment-progress/);
  const examChoices = zone(html(h(LessonForm, { lesson: { ...exerciseLesson, kind: 'exam', ref_uid: 'x1' }, items: [], exercises: STUDIO_EXERCISES, exams: STUDIO_EXAMS, onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Save lesson' })), 'select-lesson-ref', '</select>');
  assert.match(examChoices, /<option value="x1" selected="">Seed basics check<\/option>/);
  assert.doesNotMatch(examChoices, /value="x0"|value="e1"/);
  // An archived one already chosen stays chosen.
  assert.match(html(h(LessonForm, { lesson: { ...exerciseLesson, ref_uid: 'e0' }, items: [], exercises: STUDIO_EXERCISES, exams: [], onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Save lesson' })),
    /<option value="e0" selected="">An archived exercise \(archived\)<\/option>/);
  // What a lesson opens, in words.
  assert.equal(refLabel(exerciseLesson, [], STUDIO_EXERCISES, STUDIO_EXAMS), 'the exercise “Write your one-liner”');
  assert.equal(refLabel({ kind: 'exam', ref_uid: 'x9' }, [], STUDIO_EXERCISES, STUDIO_EXAMS), 'exam x9');
  const tree = {
    uid: 'c1', slug: 'seed-basics', title: 'Seed basics', status: 'draft', visibility: 'open', resources: [],
    modules: [{ uid: 'm9', title: 'Practice', position: 0, lessons: [exerciseLesson, { uid: 'l10', kind: 'exam', title: 'Check yourself', ref_uid: 'x1', required: false, position: 1 }] }],
  };
  const builder = flat(html(h(StudioCourseBuilder, { course: tree, items: [], exercises: STUDIO_EXERCISES, exams: STUDIO_EXAMS, handlers: {} })));
  assert.match(builder, /Exercise Write it opens the exercise “Write your one-liner”/);
  assert.match(builder, /Exam Check yourself opens the exam “Seed basics check” Optional/);
});

// ── The studio's editors ───────────────────────────────────────────────────

test('the exercise editor: a written answer or a checklist, the kind set once, the actions its status allows', () => {
  const fresh = html(h(StudioExerciseEditor, { exercise: null, onSave: () => {}, onStatus: () => {} }));
  assert.match(fresh, /data-testid="select-exercise-kind"/);
  assert.doesNotMatch(fresh, /studio-status-actions/);
  assert.equal(labelOf(fresh, 'button-exercise-save'), 'Create draft');
  // A stored checklist draft: its kind said, not offered; its items; publish offered.
  const draft = html(h(StudioExerciseEditor, { exercise: STUDIO_EXERCISES[1], onSave: () => {}, onStatus: () => {} }));
  assert.doesNotMatch(draft, /select-exercise-kind/, 'the edit route would ignore a new kind');
  assert.match(flat(zone(draft, 'text-exercise-kind', '</p>')), /A checklist · set when the exercise was created/);
  const items = zone(draft, 'studio-exercise-checklist', '</fieldset>');
  for (const item of ITEMS) assert.ok(items.includes(`value="${item}"`), `the checklist item "${item}" is not drawn`);
  assert.match(draft, /button-studio-publish/);
  assert.doesNotMatch(draft, /button-studio-unpublish/);
  assert.match(draft, /<option value="program" selected="">/);
  // A published written answer: no items, unpublish and archive.
  const published = html(h(StudioExerciseEditor, { exercise: STUDIO_EXERCISES[0], onSave: () => {}, onStatus: () => {}, error: 'An exercise needs a title.' }));
  assert.doesNotMatch(published, /studio-exercise-checklist/);
  assert.doesNotMatch(published, /button-studio-publish/);
  assert.match(published, /button-studio-archive/);
  assert.ok(flat(zone(published, 'studio-error', '</p>')).includes('An exercise needs a title.'));
  assert.deepEqual(exerciseForm(STUDIO_EXERCISES[1]).checklist, ITEMS);
  assert.deepEqual(exerciseForm(null), { title: '', instructions: '', submission_kind: 'text', checklist: [''], visibility: 'open' });
});

test('the exam builder: the rules, each question with its correct answer, and the questions fixed after a first attempt', () => {
  const fresh = html(h(StudioExamBuilder, { exam: null, handlers: {} }));
  assert.match(tagOf(fresh, 'input-exam-pass'), /value="70"/, 'a new exam does not start at the route\'s default pass mark');
  assert.doesNotMatch(fresh, /studio-exam-questions|studio-status-actions/);
  const markup = html(h(StudioExamBuilder, { exam: EXAM_TREE, handlers: {} }));
  assert.match(tagOf(markup, 'input-exam-limit'), /value="30"/);
  assert.match(tagOf(markup, 'input-exam-attempts'), /value="3"/);
  assert.match(zone(markup, 'select-exam-reveal', '</select>'), /<option value="score" selected="">The score only<\/option>/);
  const questions = flat(zone(markup, 'studio-exam-questions'));
  // In stored order (position), each with its kind and its correct options.
  assert.match(questions, /Question 1 · Single choice · correct: A Edit Delete What is a pre-money valuation\? A\. The value before the round B\. The value after it/);
  assert.match(questions, /Question 2 · Multiple choice · correct: A, C Edit Delete Which of these dilute the founders\? A\. A SAFE B\. A grant C\. Options for staff/);
  assert.match(markup, /data-testid="button-add-question"/);
  assert.doesNotMatch(markup, /studio-exam-frozen/);
  // Started once: every question write is the route's to refuse, so none is offered, and the route's sentence says why.
  const frozen = html(h(StudioExamBuilder, { exam: { ...EXAM_TREE, attempt_count: 2 }, handlers: {} }));
  assert.ok(flat(zone(frozen, 'studio-exam-frozen', '</p>')).includes(`${FROZEN_LINE} (2 attempts started.)`), 'the frozen exam does not say why, with its count');
  assert.doesNotMatch(frozen, /button-add-question|button-delete-question-/);
  assert.doesNotMatch(flat(zone(frozen, 'studio-exam-questions')), /\bEdit\b/);
  // A refusal is shown beside what it refused.
  const refused = html(h(StudioExamBuilder, { exam: EXAM_TREE, handlers: {}, error: { where: 'questions', message: 'A single-choice question has exactly one correct option.' } }));
  assert.ok(flat(zone(refused, 'studio-questions-error', '</p>')).includes('A single-choice question has exactly one correct option.'));
  assert.doesNotMatch(refused, /data-testid="studio-error"/);
  const fieldsRefused = html(h(StudioExamBuilder, { exam: EXAM_TREE, handlers: {}, error: { where: 'fields', message: 'pass_mark_percent is a whole number from 0 to 100.' } }));
  assert.ok(flat(zone(fieldsRefused, 'studio-error', '</p>')).includes('pass_mark_percent is a whole number from 0 to 100.'));
  assert.doesNotMatch(fieldsRefused, /studio-questions-error/, 'a refusal of the exam\'s fields was shown beside its questions');
  // The question form: the right box per option, the correct ones ticked.
  const form = html(h(QuestionForm, { question: EXAM_TREE.questions[0], onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Save question' }));
  assert.match(tagOf(form, 'input-question-correct-0'), /type="checkbox"[^>]*checked=""|checked=""[^>]*type="checkbox"/);
  assert.doesNotMatch(tagOf(form, 'input-question-correct-1'), /checked=""/);
  assert.match(tagOf(form, 'input-question-option-2'), /value="Options for staff"/);
  // A new question: single choice, and the two options the route asks for at least.
  const blank = html(h(QuestionForm, { onSubmit: () => {}, onCancel: () => {}, submitLabel: 'Add question' }));
  assert.match(tagOf(blank, 'input-question-correct-0'), /type="radio"/);
  assert.ok(tagOf(blank, 'input-question-option-1'));
  assert.equal(tagOf(blank, 'input-question-option-2'), '');
  // Removing an option moves the correct answer with the options it points at.
  assert.deepEqual(withoutOption({ prompt: 'p', kind: 'multiple', options: ['A', 'B', 'C'], correct: [0, 2] }, 1), { prompt: 'p', kind: 'multiple', options: ['A', 'C'], correct: [0, 1] });
  assert.deepEqual(examForm(EXAM_TREE), { title: 'Seed basics check', intro: 'Two questions on pricing.', pass_mark_percent: '70', time_limit_minutes: '30', max_attempts: '3', shuffle: false, reveal: 'score', visibility: 'open' });
  assert.deepEqual(questionBody({ prompt: 'p', kind: 'multiple', options: ['', 'B', 'C'], correct: [0, 2] }), { prompt: 'p', kind: 'multiple', options: ['B', 'C'], correct: [1] });
});

test('the studio\'s editor for one exercise or exam, at its address: a new draft draws at once, a stored one is read first', () => {
  assert.match(html(h(StudioAssessment, { kind: 'exercise', uid: null }), '/learning/studio?new=exercise'), /data-testid="studio-exercise-editor"/);
  assert.match(html(h(StudioAssessment, { kind: 'exam', uid: null }), '/learning/studio?new=exam'), /data-testid="studio-exam-builder"/);
  const stored = html(h(StudioAssessment, { kind: 'exam', uid: 'x1' }), '/learning/studio?exam=x1');
  assert.match(stored, /learning-loading/);
  assert.doesNotMatch(stored, /studio-exam-builder/, 'an editor drawn before its exam was read');
  // A created draft opens at its own address, with the studio's "Draft created."
  const src = codeOnly(read('frontend/src/pages/learning/LearningAssessments.jsx'));
  assert.match(src, /navigate\(`\/learning\/studio\?\$\{kind\}=\$\{encodeURIComponent\(row\.uid\)\}`, \{ state: \{ notice: 'Draft created\.' \} \}\);/);
});

// ── The review ─────────────────────────────────────────────────────────────

test('the review: learners by name only, each answer drawn, Accept and Needs work only where the Super Admin may mark', () => {
  const props = { status: 'ready', submissions: REVIEW_SUBMISSIONS.submissions, kind: 'checklist', checklist: ITEMS };
  const markup = html(h(SubmissionsReview, { ...props, onReview: () => {} }));
  const waiting = zone(markup, 'review-submission-s9', 'data-testid="review-submission-s8"');
  assert.match(flat(waiting), /Ada Founder Submitted submitted 5 Oct 2026/);
  assert.match(waiting, /aria-label="Done"[^]*A data room[^]*aria-label="Not done"[^]*A cap table[^]*aria-label="Done"[^]*A pitch deck/);
  assert.match(waiting, /data-testid="button-review-accept-s9"/);
  assert.match(waiting, /data-testid="button-review-needs-work-s9"/);
  // An accepted one is reviewed already: its feedback, no mark.
  const reviewed = zone(markup, 'review-submission-s8');
  assert.match(flat(reviewed), /Ben Investor Accepted submitted 4 Oct 2026 · reviewed 5 Oct 2026/);
  assert.match(flat(reviewed), /Feedback: Good\./);
  assert.doesNotMatch(reviewed, /review-mark-/);
  assert.doesNotMatch(markup, /@/, 'an email reached the review');
  // An assigned admin reads; only the Super Admin marks.
  assert.doesNotMatch(html(h(SubmissionsReview, props)), /review-mark-/);
  // A refusal on one row is shown on that row, and not on another waiting beside it.
  const two = [...props.submissions, { ...CHECK_SUBMITTED, uid: 's7', learner_name: 'Cy Partner', learner_uid: 'u4' }];
  const failed = html(h(SubmissionsReview, { ...props, submissions: two, onReview: () => {}, error: { at: 's9', message: 'Needs work says what needs work: feedback is required.' } }));
  assert.ok(flat(zone(failed, 'review-error-s9', '</p>')).includes('Needs work says what needs work: feedback is required.'));
  assert.ok(tagOf(failed, 'review-mark-s7'));
  assert.equal(tagOf(failed, 'review-error-s7'), '', 'a refusal on one submission was shown on another');
  // Without the exercise's items: which were ticked, by number; without its kind: the text as stored.
  assert.match(text(h(SubmissionsReview, { ...props, checklist: null })), /Items 1, 3 checked\./);
  assert.match(text(h(SubmissionsReview, { status: 'ready', submissions: [REVIEW_SUBMISSIONS.submissions[0]] })), /\[0,2\]/);
  // The states.
  assert.match(html(h(SubmissionsReview, { status: 'loading' })), /learning-loading/);
  assert.match(text(h(SubmissionsReview, { status: 'unreadable', onRetry: () => {} })), /The submissions could not be read\. This is not a claim that nobody has submitted\./);
  assert.match(text(h(SubmissionsReview, { status: 'ready', submissions: [] })), /No submission yet/);
});

test('the exam review: each learner\'s attempts, scores and outcomes, never an answer', () => {
  const markup = html(h(AttemptsReview, { status: 'ready', attempts: REVIEW_ATTEMPTS.attempts }));
  assert.match(flat(zone(markup, 'review-attempt-a9', 'data-testid="review-attempt-a8"')), /Ada Founder started 6 Oct 2026 · submitted 6 Oct 2026 82% Pass/);
  const open = flat(zone(markup, 'review-attempt-a8', 'data-testid="review-attempt-a7"'));
  assert.match(open, /Ben Investor started 6 Oct 2026 Open/);
  assert.doesNotMatch(open, /%|Score/, 'an open attempt was given a score, or a missing one');
  assert.match(flat(zone(markup, 'review-attempt-a7', '</li>')), /Learner not recorded started 5 Oct 2026 · submitted 5 Oct 2026 0% Timed out/);
  assert.match(flat(markup), /Scores only: this read never carries a learner’s answers\./);
  assert.match(text(h(AttemptsReview, { status: 'unreadable', onRetry: () => {} })), /The attempts could not be read\. This is not a claim that nobody has sat this exam\./);
  assert.match(text(h(AttemptsReview, { status: 'ready', attempts: [] })), /No attempt yet/);
});

// ── The studio's table ─────────────────────────────────────────────────────

test('the studio\'s table: exercises and exams as rows opening their editors, merged by the newest edit', () => {
  const rows = assessmentRows(STUDIO_EXERCISES, STUDIO_EXAMS);
  assert.deepEqual(rows.map((r) => [r.kind, r.uid, r.href]), [
    ['exercise', 'e1', '/learning/studio?exercise=e1'],
    ['exercise', 'e2', '/learning/studio?exercise=e2'],
    ['exercise', 'e0', '/learning/studio?exercise=e0'],
    ['exam', 'x1', '/learning/studio?exam=x1'],
    ['exam', 'x0', '/learning/studio?exam=x0'],
  ]);
  assert.ok(rows.every((r) => r.programs === null), 'programs read as "None" though neither list says');
  const items = [{ uid: 'v-yt', kind: 'video', title: 'What a seed round is', status: 'published', visibility: 'open', updated_at: '2026-10-05T12:00:00.000Z' }];
  const merged = withAssessmentRows(studioRows(items, []), STUDIO_EXERCISES, STUDIO_EXAMS);
  assert.deepEqual(merged.map((r) => r.uid), ['e2', 'v-yt', 'e1', 'x1', 'x0', 'e0']);
  const table = flat(html(h(StudioContentTable, { status: 'ready', rows: merged }), '/learning/studio'));
  assert.match(table, /Exercise Before you raise Draft Program Not recorded 6 Oct 2026/);
  assert.match(table, /Exam Seed basics check Published Open Not recorded 4 Oct 2026/);
});

// ── The rules every Learning file keeps ────────────────────────────────────

const NEW_FILES = ['assessmentModel.js', 'assessmentReads.js', 'LearningAssessments.jsx', 'StudioAssessmentEditors.jsx', 'ExercisePanel.jsx', 'ExamFlow.jsx'];

test('the app\'s own styling, one file calling the client, and no client method added', () => {
  for (const f of NEW_FILES) {
    const src = codeOnly(read(`frontend/src/pages/learning/${f}`));
    assert.doesNotMatch(src, /fontFamily|font-family|Space Grotesk|Roboto Mono|font-mono/, `${f} sets a font`);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/, `${f} carries a canvas colour`);
    for (const m of src.matchAll(/style=\{\{([^}]*)\}\}/g)) assert.match(m[1], /^\s*width:/, `${f} styles something inline other than a bar's width`);
    if (f !== 'assessmentReads.js') assert.doesNotMatch(src, /lib\/api(\/\w+(\.js)?)?'/, `${f} reads the client directly`);
  }
  const reads = codeOnly(read('frontend/src/pages/learning/assessmentReads.js'));
  assert.match(reads, /import \{ learningApi \} from '\.\.\/\.\.\/lib\/api\/learning\.js';/);
  assert.match(reads, /import \{ adminLearningApi \} from '\.\.\/\.\.\/lib\/api\/adminLearning\.js';/);
  // One literal pattern for both clients (never a RegExp built from a variable).
  const calls = [...reads.matchAll(/\b(learningApi|adminLearningApi)\.(\w+)\(/g)];
  for (const [client, file] of [['learningApi', 'learning.js'], ['adminLearningApi', 'adminLearning.js']]) {
    const declared = read(`frontend/src/lib/api/${file}`);
    const called = new Set(calls.filter((m) => m[1] === client).map((m) => m[2]));
    assert.ok(called.size > 0, `no ${client} method is called`);
    for (const method of called) assert.ok(declared.includes(`  ${method}: (`), `${client}.${method} is not a method ${file} declares`);
  }
  // No answer key on a member's page: the member calls are learningApi's alone, and the
  // authoring read that carries `correct` is the studio's only.
  const raw = read('frontend/src/pages/learning/assessmentReads.js');
  const member = codeOnly(raw.slice(raw.indexOf('// ── The member'), raw.indexOf('// ── The studio')));
  assert.match(member, /learningApi\.startExam\(/);
  assert.doesNotMatch(member, /adminLearningApi\./);
  assert.equal(reads.split('adminLearningApi.getExam(').length - 1, 1);
  assert.match(reads, /export async function readStudioExam\(uid\) \{\s*return \{ exam: rowOf\(await adminLearningApi\.getExam\(uid\)/);
});

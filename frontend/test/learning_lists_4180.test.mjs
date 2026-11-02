// #4180 (#3726 L5, D4180) — the Learning list reads on the page: the Exercises
// and Exams tabs, My learning's exercises and exam results, the transcript
// line, and the "Your progress" figures. Not recorded is never 0.
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_lists_4180.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  LEARNING_TABS, catalogRow, clockLabel, examRow, exerciseRow, myAttemptRows, mySubmissionRows, statsTiles, transcriptLine,
} from '../src/pages/learning/learningModel.js';
import { AssessmentList } from '../src/pages/learning/LearningHome.jsx';

const h = React.createElement;
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (m) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the Exercises and Exams tabs are live, and nothing still says no route lists them', () => {
  assert.deepEqual(LEARNING_TABS.filter((t) => !t.live), []);
  const model = read('frontend/src/pages/learning/learningModel.js');
  assert.doesNotMatch(model, /UNLISTED|TAB_NOT_LIVE|No route lists/);
});

test('exercise and exam rows: your status, the course or programme, attempts left, and a best score never invented', () => {
  const ex = exerciseRow({ uid: 'ex-1', title: 'Write your one-liner', where: { kind: 'program', title: 'Lagos cohort' }, status: 'accepted', updated_at: '2026-10-04' });
  assert.equal(ex.where, 'Programme · Lagos cohort');
  assert.equal(ex.status, 'accepted');
  assert.equal(ex.href, '/learning/exercises/ex-1');
  assert.equal(exerciseRow({ uid: 'x', status: null }).status, null, 'not started');
  const exam = examRow({ uid: 'e-1', title: 'Term sheets', question_count: 2, time_limit_minutes: 20, pass_mark_percent: 70, attempts_left: 1, best_score_percent: 80 });
  assert.deepEqual([exam.questions, exam.limit, exam.passMark, exam.attemptsLeft, exam.best], [2, '20 min', '70% to pass', '1 attempt left', '80%']);
  const fresh = examRow({ uid: 'e-2', title: 'Cap tables', question_count: 0, time_limit_minutes: null, attempts_left: null, best_score_percent: null });
  // Mutation checked: read a null best score as 0 → "0%" and this fails.
  assert.equal(fresh.best, null, 'no submitted attempt: not recorded, never 0%');
  assert.equal(fresh.limit, 'Untimed');
  assert.equal(fresh.attemptsLeft, 'Unlimited attempts');
});

test('AssessmentList draws the rows, "Score not recorded" for an unsat exam, and a failed read as unreadable, never empty', () => {
  const rows = [examRow({ uid: 'e-1', title: 'Term sheets', question_count: 2, attempts_left: 1, best_score_percent: 80 }), examRow({ uid: 'e-2', title: 'Cap tables', question_count: 3 })];
  const ready = text(html(h(AssessmentList, { state: { status: 'ready', rows, total: 2, offset: 0 }, kind: 'exam' })));
  assert.match(ready, /Term sheets .*2 questions .*1 attempt left .*Your best 80%/);
  assert.match(ready, /Cap tables .*Score not recorded/);
  assert.doesNotMatch(ready, /(^|[^0-9])0%/, 'no invented 0%');
  const failed = html(h(AssessmentList, { state: { status: 'unreadable' }, kind: 'exercise', onRetry: () => {} }));
  assert.match(failed, /learning-unreadable/);
  assert.match(text(failed), /This is not a claim that there are no exercises\./);
  const empty = text(html(h(AssessmentList, { state: { status: 'ready', rows: [], total: 0, offset: 0 }, kind: 'exercise' })));
  assert.match(empty, /No exercises published yet/);
});

test('My learning: one row per exercise (the latest status) and per exam (the best submitted score)', () => {
  const subs = mySubmissionRows([
    { uid: 's2', status: 'accepted', exercise: { uid: 'ex-1', title: 'One-liner' } },
    { uid: 's1', status: 'needs_work', exercise: { uid: 'ex-1', title: 'One-liner' } },
    { uid: 's3', status: 'submitted', exercise: { uid: 'ex-2', title: 'ICP' } },
  ]);
  assert.deepEqual(subs.map((s) => [s.exercise_uid, s.status]), [['ex-1', 'accepted'], ['ex-2', 'submitted']]);
  const atts = myAttemptRows([
    { uid: 'a3', score_percent: null, passed: null, exam: { uid: 'e-1', title: 'Term sheets' } },
    { uid: 'a2', score_percent: 80, passed: true, exam: { uid: 'e-1', title: 'Term sheets' } },
    { uid: 'a1', score_percent: 50, passed: false, exam: { uid: 'e-1', title: 'Term sheets' } },
    { uid: 'a4', score_percent: null, passed: null, exam: { uid: 'e-2', title: 'Cap tables' } },
  ]);
  // Mutation checked: keep the first attempt instead of the best → the open attempt's null wins and this fails.
  assert.deepEqual(atts.map((a) => [a.exam_uid, a.score_percent]), [['e-1', 80], ['e-2', null]]);
});

test('the transcript line and the progress figures: a time or figure not recorded is said so, never 0', () => {
  assert.equal(clockLabel(252), '04:12');
  assert.equal(clockLabel(3723), '1:02:03');
  assert.equal(clockLabel(null), null);
  assert.equal(transcriptLine({ in: 'transcript', snippet: 'we cover churn', at_seconds: 252 }), 'Found in a transcript “we cover churn” at 04:12');
  assert.equal(transcriptLine({ in: 'transcript', snippet: 'churn', at_seconds: null }), 'Found in a transcript “churn”');
  assert.equal(transcriptLine(null), null);
  assert.equal(catalogRow({ kind: 'video', id: 'v1', title: 'Pricing', match: { in: 'transcript', snippet: 'churn', at_seconds: 60 } }).found, 'Found in a transcript “churn” at 01:00');
  const tiles = statsTiles({ courses_in_progress: 0, lessons_completed_this_month: 3, watch_seconds_this_month: null, exams: { passed: 1, sat: 2 } });
  // Mutation checked: draw a null watch time as 0 → "0" and this fails.
  assert.deepEqual(tiles.map((t) => t.value), ['0', '3', 'Not recorded', '1 of 2']);
  assert.deepEqual(statsTiles(null).map((t) => t.value), ['Not recorded', 'Not recorded', 'Not recorded', 'Not recorded']);
});

test('the client: five methods on the list routes, and the reads that use them', () => {
  const client = read('frontend/src/lib/api/learning.js');
  for (const path of ['/learning/exercises', '/learning/exams', '/learning/me/submissions', '/learning/me/attempts', '/learning/me/stats']) {
    assert.ok(client.includes(path), path);
  }
  const reads = read('frontend/src/pages/learning/learningReads.js');
  for (const r of ['readExercises', 'readExams', 'readMySubmissions', 'readMyAttempts']) assert.match(reads, new RegExp(`export async function ${r}\\(`));
  assert.match(read('frontend/src/pages/learning/LearningWired.jsx'), /useLearningRead\(readMySubmissions/);
});

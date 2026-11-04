/** #4476: LR11 review and reveal-safe results, exercised with real React state. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import { reviewRows, reviewLine, perQuestionResults } from '../src/pages/learning/assessmentModel.js';
import ExamFlow from '../src/pages/learning/ExamFlow.jsx';

const questions = [
  { uid: 'q1', prompt: 'First question', kind: 'single', options: ['A', 'B'], position: 0 },
  { uid: 'q2', prompt: 'Second question', kind: 'multiple', options: ['C', 'D'], position: 1 },
];
const exam = { title: 'Check', reveal: 'score_and_answers', pass_mark_percent: 70, max_attempts: 3, time_limit_minutes: 20 };
const attempt = { uid: 'a', deadline: '2026-11-04T12:20:00Z', questions };
const now = Date.parse('2026-11-04T12:10:00Z');
const base = { status: 'ready', exam, attempt, now };
const walk = n => [n, ...(n.childNodes || []).flatMap(walk)];
const props = n => Object.entries(n || {}).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
async function mount(over = {}) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  let current = { ...base, ...over };
  const render = async patch => { current = { ...current, ...patch }; await act(async () => root.render(React.createElement(ExamFlow, current))); };
  await render({});
  const node = id => walk(container).find(n => props(n)['data-testid'] === id);
  return { container, node, render,
    click: async id => { const n = node(id); assert.ok(Boolean(n), id); await act(async () => props(n).onClick()); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('review rows reflect all questions and lines include both eight and zero answered', () => {
  assert.deepEqual(reviewRows(questions, { q1: ['0'], q2: [] }), [
    { n: 1, uid: 'q1', text: 'First question', answered: true },
    { n: 2, uid: 'q2', text: 'Second question', answered: false },
  ]);
  assert.equal(reviewLine(8, 10), '8 of 10 answered. Unanswered questions count as wrong.');
  assert.equal(reviewLine(0, 10), '0 of 10 answered. Unanswered questions count as wrong.');
});

test('per-question results require revealed answers and exact multiple-choice sets', () => {
  const result = { questions, answers_revealed: true, answers: { q1: [0], q2: [0] }, correct: { q1: [0], q2: [0, 1] } };
  assert.equal(perQuestionResults({ ...result, answers_revealed: false }), null);
  assert.equal(perQuestionResults({ ...result, answers_revealed: undefined }), null);
  assert.deepEqual(perQuestionResults(result), [{ n: 1, right: true }, { n: 2, right: false }]);
  assert.deepEqual(perQuestionResults({ ...result, answers: { q1: [], q2: [1, 0] } }), [{ n: 1, right: false }, { n: 2, right: true }]);
});

test('review renders every question, Edit returns to it, and Submit sends once', async () => {
  const calls = [];
  const m = await mount({ onSubmit: answers => calls.push(answers) });
  try {
    await act(async () => props(walk(m.container).find(n => n.tagName === 'INPUT')).onChange());
    await m.click('button-exam-next');
    await m.click('button-exam-review');
    assert.ok(Boolean(m.node('exam-review')));
    assert.equal(walk(m.container).filter(n => /^button-exam-edit-/.test(props(n)['data-testid'] || '')).length, questions.length);
    await m.click('button-exam-edit-q1');
    assert.equal(props(m.node('exam-question')).children, 'First question');
    await m.click('button-exam-next');
    await m.click('button-exam-review');
    await m.click('button-exam-questions');
    assert.equal(props(m.node('exam-question')).children, 'Second question');
    await m.click('button-exam-review');
    await m.click('button-exam-submit');
    await m.click('button-exam-submit');
    assert.deepEqual(calls, [{ q1: [0] }]);
  } finally { await m.close(); }
});

test('the clock keeps running through review and timeout submits only once', async () => {
  const calls = [];
  const m = await mount({ onSubmit: answers => calls.push(answers) });
  try {
    await m.click('button-exam-next'); await m.click('button-exam-review');
    await m.render({ now: Date.parse(attempt.deadline) });
    await m.render({ now: Date.parse(attempt.deadline) + 1000 });
    assert.deepEqual(calls, [{}]);
    await m.click('button-exam-submit');
    assert.equal(calls.length, 1);
  } finally { await m.close(); }
});

test('results show all attempts and missing scores honestly, with reveal-safe question pills', () => {
  const result = { uid: 'a', questions, submitted_at: '2026-11-04T12:15:00Z', score_percent: 50, passed: false,
    answers_revealed: true, answers: { q1: [0], q2: [0] }, correct: { q1: [0], q2: [0, 1] } };
  const render = over => renderToStaticMarkup(React.createElement(ExamFlow, { ...base, attempt: null, attemptsLeft: 0,
    result, attempts: [{ uid: 'old', submitted_at: '2026-11-03T12:00:00Z', score_percent: null, passed: null }], ...over }));
  const shown = render({});
  assert.match(shown, /Right and wrong, per question/);
  assert.match(shown, /Your attempts/);
  assert.match(shown, /Score not recorded/);
  assert.match(shown, />Right</);
  assert.match(shown, />Wrong</);
  assert.match(shown, /No attempts left/);
  assert.doesNotMatch(shown, /button-exam-retry/);
  assert.doesNotMatch(render({ exam: { ...exam, reveal: 'score' } }), /Right and wrong, per question/);
  assert.doesNotMatch(render({ result: { ...result, answers_revealed: false } }), /Right and wrong, per question/);
  assert.match(render({ result: { ...result, timed_out: true } }), /Time is up\. Your answers are being submitted as they stand\./);
});


test('timeout refusal uses the route message and unreadable errors hide network text', () => {
  const message = 'The time limit passed before this was submitted, so the attempt is closed unscored.';
  const render = over => renderToStaticMarkup(React.createElement(ExamFlow, { ...base, attempt: null, ...over }));
  assert.match(render({ error: message, errorCode: 'time_limit_passed' }), /role="status" data-testid="exam-error">The time limit passed before this was submitted, so the attempt is closed unscored\./);
  const unreadable = render({ error: 'private transport exception', errorUnreadable: true });
  assert.match(unreadable, /learning-unreadable/);
  assert.doesNotMatch(unreadable, /private transport exception/);
});

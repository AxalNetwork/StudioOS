/**
 * #4650 part 3 (D4650) — the member's explanations and the studio's editor.
 *
 *   1. `revealedAnswers` carries each question's explanation and revision links,
 *      and nothing when the route revealed nothing;
 *   2. the result draws them beside the revealed answer: a Learning path as an
 *      in-app link, any other in a new tab; a score-only result draws none;
 *   3. the studio's explanation form reads a question and sends it back cleaned.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/learning_explanations_4650.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ExamView } from '../src/pages/learning/LearningAssessments.jsx';
import { explanationBody, explanationForm, revealedAnswers } from '../src/pages/learning/assessmentModel.js';

const EXAM = {
  uid: 'x1', title: 'Seed basics check', intro: 'Two questions.', pass_mark_percent: 70, time_limit_minutes: 30,
  max_attempts: 3, reveal: 'score_and_answers', question_count: 2, status: 'published', published_at: '2026-10-02T10:00:00.000Z',
};
const QUESTIONS = [
  { uid: 'q1', prompt: 'Who leads the round?', kind: 'single', options: ['The founder', 'The lead investor'] },
  { uid: 'q2', prompt: 'Is weather a term?', kind: 'single', options: ['Yes', 'No'] },
];
const WHY = 'The lead investor sets the terms; the others follow.';
const REVEALED = {
  uid: 'a3', started_at: '2026-10-06T10:00:00.000Z', submitted_at: '2026-10-06T10:12:00.000Z', score_percent: 50, passed: false, timed_out: false,
  answers_revealed: true, answers: { q1: [0], q2: [1] }, correct: { q1: [1], q2: [1] },
  explanations: { q1: { explanation: WHY, revision: [{ title: 'Term sheets, lesson 2', url: '/learning/courses/seed/term-sheets' }, { title: 'A worked example', url: 'https://example.com/term-sheet' }] } },
  correct_count: 1, question_count: 2, questions: QUESTIONS,
};
const html = (result, exam = EXAM) => renderToStaticMarkup(h(MemoryRouter, null,
  h(ExamView, { examState: { status: 'ready', exam }, attemptsState: { status: 'ready', attempts: [], attemptsLeft: 1 }, result })));

test('1. revealedAnswers carries the explanation and links, and nothing when nothing was revealed', () => {
  // Mutation checked: the explanation read from the wrong key → null on q1.
  const rows = revealedAnswers(EXAM, REVEALED);
  assert.equal(rows[0].explanation, WHY);
  assert.deepEqual(rows[0].revision.map((l) => l.url), ['/learning/courses/seed/term-sheets', 'https://example.com/term-sheet']);
  assert.deepEqual([rows[1].explanation, rows[1].revision], [null, []]);
  assert.equal(revealedAnswers(EXAM, { ...REVEALED, answers_revealed: false }), null);
});

test('2. the result draws them beside the revealed answer, and a score-only result draws none', () => {
  // Mutation checked: every link drawn as an external <a> → the in-app link check fails.
  const markup = html(REVEALED);
  assert.match(markup, new RegExp(`data-testid="exam-explanation-q1"[^>]*>${WHY.replace(/[;]/g, '.')}<`));
  assert.match(markup, /<a [^>]*href="\/learning\/courses\/seed\/term-sheets"[^>]*>Term sheets, lesson 2<\/a>/);
  assert.doesNotMatch(markup, /href="\/learning\/courses\/seed\/term-sheets"[^>]*target="_blank"/, 'a Learning path stays in the app');
  assert.match(markup, /<a href="https:\/\/example\.com\/term-sheet" target="_blank" rel="noopener noreferrer"[^>]*>A worked example<\/a>/);
  assert.doesNotMatch(markup, /exam-explanation-q2/, 'a question with no explanation draws none');
  assert.match(markup, />No certificate</);
  const hidden = html({ ...REVEALED, answers_revealed: false, answers: undefined, correct: undefined, explanations: undefined }, { ...EXAM, reveal: 'score' });
  assert.doesNotMatch(hidden, /exam-explanation|exam-revision/);
});

test('3. the studio form reads a question and sends it back cleaned', () => {
  // Mutation checked: blank link rows kept → the body carries an empty link.
  const form = explanationForm({ explanation: WHY, revision: [{ title: 'A', url: '/learning/courses/a' }] });
  form.revision.push({ title: ' ', url: '' });
  form.explanation = `  ${WHY}  `;
  assert.deepEqual(explanationBody(form), { explanation: WHY, revision: [{ title: 'A', url: '/learning/courses/a' }] });
  assert.deepEqual(explanationBody(explanationForm({})), { explanation: null, revision: [] });
});

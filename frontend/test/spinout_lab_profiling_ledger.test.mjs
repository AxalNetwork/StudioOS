/**
 * Lab Profiling binds Eadwyn's question ledger — D350.
 *
 * Four canvas elements had no source on this page and were drawn as something
 * else: "Questions answered 54 / 79" became a skills-rated count, per-module
 * progress did not exist, "Next best questions" was a list of rating gaps, and
 * "Last answered" became last activity. The store for all four is the advisor
 * conversation ledger, already served read-only by /advisor/progress, /queue
 * and /answered. These tests pin three properties:
 *
 *   * THE READS ARE THE READ-ONLY ONES. `/advisor/next-question` can pin a
 *     question onto the conversation — a write, from a page that only looks.
 *   * A REFUSAL IS NOT A FAILURE, AND NEITHER IS AN EMPTY LIST. A 423 prints the
 *     Worker's own sentence; anything else is Unreadable with a retry; a store
 *     with nothing for this account says so with its reason.
 *   * THE CANVAS'S SAMPLE DATA NEVER SHIPS. "54 / 79" and its quoted question
 *     are fixtures, not facts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import {
  PROFILING_FOCUS,
  ledgerRead,
  questionsAnswered,
  profilingModules,
  nextQuestions,
  lastAnswered,
} from '../src/lib/profilingLedger.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(raw('frontend/src/pages/SpinoutLabProfilingPage.jsx'));
const LIB = codeOnly(raw('frontend/src/lib/profilingLedger.js'));
const ADVISOR = raw('cloudflare-worker/src/routes/advisor.ts');
const FIT_BANK = raw('cloudflare-worker/src/services/advisor/banks/fitShared.ts');
const CANVAS = raw('design/canvases/out-of-scope/Profiling.dc.html');

const refusedErr = (status, message) => Object.assign(new Error(message), { status });

// ---------------------------------------------------------------------------
// ledgerRead — the three ways a read ends
// ---------------------------------------------------------------------------
test('a 423 is a refusal carrying the Worker’s own sentence', async () => {
  const r = await ledgerRead(Promise.reject(refusedErr(423, 'Eadwyn is paused on your account.')));
  assert.deepEqual(r, { state: 'refused', message: 'Eadwyn is paused on your account.' });
});

test('a 500 or a network error is a failed read, never a refusal', async () => {
  assert.deepEqual(await ledgerRead(Promise.reject(refusedErr(500, 'D1_ERROR: no such table'))), { state: 'failed' });
  assert.deepEqual(await ledgerRead(Promise.reject(new TypeError('Failed to fetch'))), { state: 'failed' });
});

test('the refusal branch is on the status, never on the text', () => {
  assert.match(LIB, /e\?\.status === 423/);
  assert.doesNotMatch(LIB, /message\s*\.\s*(includes|match|startsWith|indexOf)\s*\(/,
    'a refusal must not be recognised by what its sentence says');
});

// ---------------------------------------------------------------------------
// The four views
// ---------------------------------------------------------------------------
const ok = (data) => ({ state: 'ok', data });
const PROGRESS = ok({
  profiling: {
    applicable: true, total: 23, answered: 9, percent: 39, complete: false,
    sections: [
      { key: 'skills', label: 'Skills', total: 5, answered: 5, percent: 100, confident: true },
      { key: 'work_values', label: 'Work values', total: 4, answered: 1, percent: 25, confident: false },
    ],
  },
});

test('Questions answered reads the ledger’s own count and denominator', () => {
  assert.deepEqual(questionsAnswered(PROGRESS), { state: 'ok', answered: 9, total: 23, percent: 39, complete: false });
});

test('a role with no profiling bank is Not recorded with its reason, never 0 / 0', () => {
  const v = questionsAnswered(ok({ profiling: { applicable: false, total: 0, answered: 0, sections: [] } }));
  assert.equal(v.state, 'unrecorded');
  assert.ok(v.reason && v.reason.length > 10, 'an absence carries its reason');
  assert.equal(profilingModules(ok({ profiling: { applicable: false } })).state, 'unrecorded');
});

test('a count the ledger did not send is Not recorded, not zero', () => {
  const v = questionsAnswered(ok({ profiling: { applicable: true, sections: [] } }));
  assert.equal(v.state, 'unrecorded');
});

test('refused and failed pass through every view unchanged', () => {
  const refused = { state: 'refused', message: 'Paused.' };
  for (const fn of [questionsAnswered, profilingModules, nextQuestions, lastAnswered]) {
    assert.deepEqual(fn(refused), { state: 'refused', message: 'Paused.' }, fn.name);
    assert.deepEqual(fn({ state: 'failed' }), { state: 'failed' }, fn.name);
  }
});

test('module rows carry the confident flag the ledger computed', () => {
  const v = profilingModules(PROGRESS);
  assert.equal(v.state, 'ok');
  assert.deepEqual(v.rows.map((r) => [r.key, r.answered, r.total, r.confident]), [
    ['skills', 5, 5, true],
    ['work_values', 1, 4, false],
  ]);
});

test('next questions keep the queue’s rank, head first, de-duplicated, capped', () => {
  const v = nextQuestions(ok({
    // The head is NOT repeated in the queue, so dropping it cannot be masked
    // by the queue supplying the same id; `b` is repeated to prove the dedupe.
    next_question: { id: 'fit.founder.h', prompt: 'H?', importance: 'high' },
    queue: [
      { id: 'fit.founder.b', prompt: 'B?' },
      { id: 'fit.founder.b', prompt: 'B again?' },
      { id: 'fit.founder.c', prompt: '   ' },
      { id: 'fit.founder.d', prompt: 'D?' },
      { id: 'fit.founder.e', prompt: 'E?' },
    ],
  }));
  assert.equal(v.state, 'ok');
  assert.deepEqual(v.rows.map((r) => r.id), ['fit.founder.h', 'fit.founder.b', 'fit.founder.d']);
});

test('an empty queue is "complete" only when the ledger says so', () => {
  assert.equal(nextQuestions(ok({ next_question: null, queue: [], complete: true })).state, 'complete');
  assert.equal(nextQuestions(ok({ next_question: null, queue: [] })).state, 'empty');
});

test('last answered is the head of /answered, newest first', () => {
  const v = lastAnswered(ok({ answered: [
    { question_id: 'fit.founder.x', label: 'What makes a moat?', completed_at: '2026-09-20T10:00:00Z' },
    { question_id: 'fit.founder.y', label: 'Older', completed_at: '2026-09-01T10:00:00Z' },
  ] }));
  assert.deepEqual(v, { state: 'ok', label: 'What makes a moat?', at: '2026-09-20T10:00:00Z' });
  assert.equal(lastAnswered(ok({ answered: [] })).state, 'none');
});

// ---------------------------------------------------------------------------
// The page reads the read-only routes, focused on the profiling bank
// ---------------------------------------------------------------------------
test('the page reads progress, queue and answered — and never next-question', () => {
  assert.match(PAGE, /ledgerRead\(api\.advisor\.progress\(\)\)/);
  assert.match(PAGE, /ledgerRead\(api\.advisor\.queue\(PROFILING_FOCUS\)\)/);
  assert.match(PAGE, /ledgerRead\(api\.advisor\.answered\(\)\)/);
  assert.doesNotMatch(PAGE, /advisor\.nextQuestion\b|\/advisor\/next-question/,
    '/next-question pins a question — a write from a read-only report');
});

test('the queue focus is the section every fit.* question carries', () => {
  assert.equal(PROFILING_FOCUS, 'FIT');
  assert.match(FIT_BANK, /section: 'FIT'/, 'buildFitBank no longer stamps FIT — the focus would empty the queue');
});

test('/queue stays a read-only peek on the Worker', () => {
  const q = ADVISOR.slice(ADVISOR.indexOf("advisor.get('/queue'"));
  const body = q.slice(0, q.indexOf('\n});'));
  assert.ok(body.length > 100, '/queue handler not found');
  assert.doesNotMatch(body, /markAsked\s*\(|\.run\(\)/, '/queue must not write');
});

test('the fields the view reads are the fields /progress emits', () => {
  const p = ADVISOR.slice(ADVISOR.indexOf("advisor.get('/progress'"));
  const body = p.slice(0, p.indexOf('\n});'));
  for (const field of ['applicable:', 'answered:', 'percent:', 'complete:', 'sections:', 'confident:']) {
    assert.ok(body.includes(field), `/progress no longer emits ${field}`);
  }
});

test('every ledger view on the page renders its absence through LedgerAbsence with a retry', () => {
  for (const view of ['qAnswered', 'modules', 'queued', 'lastAns']) {
    assert.match(PAGE, new RegExp(`<LedgerAbsence\\s+view=\\{${view}\\}[\\s\\S]{0,200}?onRetry=\\{loadLedger\\}`),
      `${view}'s refusal / failure is not drawn`);
  }
  assert.match(PAGE, /<Unreadable what=\{what\} claim=\{claim\} onRetry=\{onRetry\} \/>/);
});

// ---------------------------------------------------------------------------
// Artboard contract — the canvas's elements, and none of its fixtures
// ---------------------------------------------------------------------------
test('the canvas draws the four ledger elements the page claims', () => {
  const kpis = CANVAS.slice(CANVAS.indexOf('const completionKpis'), CANVAS.indexOf('const readyColor'));
  assert.match(kpis, /label:'Questions answered'/);
  const lower = CANVAS.slice(CANVAS.indexOf('ASSESSMENT PROGRESS + NEXT QUESTIONS'), CANVAS.indexOf('Open Studio'));
  assert.match(lower, /Assessment progress/);
  assert.match(lower, /Next best questions · answer in Studio/);
  assert.match(lower, /Last answered: "\{\{ lastAnswered \}\}"/);

  assert.match(PAGE, /data-testid="kpi-questions-answered"/);
  assert.match(PAGE, /\{qAnswered\.answered\} \/ \{qAnswered\.total\}/);
  assert.match(PAGE, /data-testid="ledger-modules"/);
  assert.match(PAGE, /Next best questions · answer in Studio/);
  assert.match(PAGE, /Last answered: “\{lastAns\.label\}”/);
});

test('none of the canvas’s sample ledger data is rendered', () => {
  for (const fixture of ['54 / 79', '12 open Qs', 'What makes a defensible moat', 'Answer 4', 'How do you approach a fundraise']) {
    assert.ok(CANVAS.includes(fixture), `fixture ${fixture} left the canvas — re-aim this test`);
    assert.ok(!PAGE.includes(fixture), `the page renders the canvas fixture "${fixture}"`);
  }
});

test('Leadership and Working style render Not recorded, never a bar at zero', () => {
  assert.match(PAGE, /\{ cat: 'Leadership style', unmodelled: true \}/);
  assert.match(PAGE, /\{ cat: 'Working style', unmodelled: true \}/);
  assert.match(PAGE, /\{!row\.unmodelled && <Bar /);
});

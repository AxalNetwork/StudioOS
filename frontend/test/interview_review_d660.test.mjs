/**
 * D660 part 2 (#1473) — the review step's components, on #1494's response
 * shapes (fixtures in `_interview_review_fixtures.mjs`). Nothing here is mounted
 * or calls the API.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_review_d660.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import InterviewReview, {
  PlacementsPanel, ComparePanel, AskPanel, StructureReceipt, groupByModule, placementText, refusalKind, spanLabel,
} from '../src/pages/founder/InterviewReview.jsx';
import * as F from './_interview_review_fixtures.mjs';

const html = (el) => renderToStaticMarkup(el);
const txt = (el) => renderedText(html(el));

test('placements are grouped by Validate module, from the latest run, each with its quote', () => {
  const groups = groupByModule(F.PLACEMENTS_ONE_RUN);
  assert.deepEqual(groups.map((g) => g.label), ['Problem discovery', 'Customer research', 'Experiments', 'Market intelligence']);
  const shuffled = { runs: [{ run_id: 'r', model: 'm', placements: [F.RUN_A[3], F.RUN_A[2], F.RUN_A[0]] }] };
  assert.deepEqual(groupByModule(shuffled).map((g) => g.module), ['problem_discovery', 'experiments', 'market_intelligence'], 'the canvas order, whatever order the run stored');
  assert.deepEqual(groupByModule(F.PLACEMENTS_TWO_RUNS).map((g) => g.module), ['problem_discovery', 'demand_signals'], 'the latest run, not every run');
  const out = html(React.createElement(PlacementsPanel, { read: F.PLACEMENTS_ONE_RUN }));
  const t = renderedText(out);
  assert.match(t, /“reconciling two systems” · Severe/);
  assert.match(t, /We lose a full day every week reconciling the two systems\. · 0:12–0:19/);
  assert.match(out, /data-testid="module-problem_discovery"/);
  // Each card can be accepted, edited or discarded…
  assert.doesNotMatch(/<button[^>]*data-testid="placement-accept-1"[^>]*>/.exec(out)[0], /disabled=""/);
  assert.match(out, /data-testid="placement-edit-toggle-1"/);
  assert.match(out, /data-testid="placement-discard-1"/);
  // …except a kind with no store, which says so and cannot be accepted.
  assert.match(/<button[^>]*data-testid="placement-accept-4"[^>]*>/.exec(out)[0], /disabled=""/);
  assert.match(t, /Not recorded: Market intelligence has no store for this yet, so it stays proposed\./);
  assert.doesNotMatch(out, /data-testid="placement-no-store-5"/);
});

test('structuring running, and no placements, are each their own state', () => {
  assert.match(txt(React.createElement(PlacementsPanel, { read: F.PLACEMENTS_ONE_RUN, running: true })), /Eadwyn is reading the transcript/);
  assert.doesNotMatch(html(React.createElement(PlacementsPanel, { read: F.PLACEMENTS_ONE_RUN, running: true })), /placement-1/);
  const none = html(React.createElement(PlacementsPanel, { read: F.PLACEMENTS_NONE, onStructure: () => {} }));
  assert.match(none, /data-testid="placements-none"/);
  assert.match(renderedText(none), /No placements yet/);
});

test('a placement whose module write is refused shows the writer\'s words and stays proposed', () => {
  const out = html(React.createElement(PlacementsPanel, { read: F.PLACEMENTS_ONE_RUN, errors: { 5: F.WRITER_REFUSED_ERROR } }));
  assert.equal(refusalKind(F.WRITER_REFUSED_ERROR), 'writer_refused');
  assert.match(out, /data-testid="placement-error-5"/);
  assert.match(renderedText(out), /That competitor is already on the list under another name\. It is still proposed\./);
  assert.doesNotMatch(out, /data-testid="placement-error-1"/);
  assert.match(out, /data-testid="placement-5" data-status="pending"/);
});

test('an ask with no citation shows the refusal, never an answer; a cited answer shows each passage', () => {
  const refused = html(React.createElement(AskPanel, { error: F.ASK_NO_CITATION_ERROR, result: F.ASK_OK }));
  assert.equal(refusalKind(F.ASK_NO_CITATION_ERROR), 'no_citation');
  assert.match(refused, /data-testid="ask-no-citation"/);
  assert.doesNotMatch(refused, /data-testid="ask-answer"/);
  assert.doesNotMatch(renderedText(refused), /by hand every Friday/);
  const ok = html(React.createElement(AskPanel, { result: F.ASK_OK }));
  assert.match(renderedText(ok), /They reconcile the two systems by hand every Friday\./);
  assert.equal((ok.match(/data-testid="ask-cite"/g) || []).length, 1);
  assert.match(renderedText(ok), /0:12–0:19/);
  // An "ok" answer that somehow carries no cites is still not shown as fact.
  assert.doesNotMatch(html(React.createElement(AskPanel, { result: { ...F.ASK_OK, cites: [] } })), /data-testid="ask-answer"/);
});

test('the budget refusal (D640) is its own state, in the budget\'s words, wherever a model runs', () => {
  assert.equal(refusalKind(F.BUDGET_ERROR), 'budget');
  const run = txt(React.createElement(PlacementsPanel, { read: F.PLACEMENTS_NONE, runError: F.BUDGET_ERROR }));
  assert.match(run, /You have used today’s AI allowance\. It resets at midnight UTC\. Nothing was run and nothing was stored\./);
  assert.match(html(React.createElement(AskPanel, { error: F.BUDGET_ERROR })), /data-testid="budget-refused"/);
  assert.match(html(React.createElement(PlacementsPanel, { read: F.PLACEMENTS_ONE_RUN, errors: { 1: F.BUDGET_ERROR } })), /data-testid="budget-refused"/);
  assert.equal(refusalKind({ status: 503, data: { refusal: 'model_not_offered' } }), 'error');
});

test('each refusal the Worker sends, at #1470\'s status codes, is classified by its refusal and not its status', () => {
  // Structure and Ask answer 402 for a spent budget, 400 for a model not
  // offered and 503 when no model is reached (#1471). The page reads `refusal`.
  const cases = [
    [402, 'budget_user_day', 'budget'], [402, 'budget_user_month', 'budget'], [402, 'budget_review', 'budget'],
    [400, 'model_not_offered', 'error'], [503, 'all_models_failed', 'error'], [503, null, 'error'],
    // The old 503 for a budget still reads as a budget: the status never decided.
    [503, 'budget_user_day', 'budget'],
  ];
  for (const [status, refusal, kind] of cases) {
    assert.equal(refusalKind({ status, data: { ok: false, refusal } }), kind, `${status} ${refusal} read as the wrong kind`);
  }
});

test('compare lays two runs side by side by module, naming each model; one run asks for a second', () => {
  const out = html(React.createElement(ComparePanel, { read: F.PLACEMENTS_TWO_RUNS }));
  const t = renderedText(out);
  assert.match(t, /@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast/);
  assert.match(t, /@cf\/meta\/llama-3\.1-8b-instruct-fp8-fast/);
  assert.match(out, /data-testid="compare-demand_signals"/);
  assert.match(renderedText(html(React.createElement(ComparePanel, { read: { ...F.PLACEMENTS_TWO_RUNS, compare: { ...F.PLACEMENTS_TWO_RUNS.compare, modules: [F.PLACEMENTS_TWO_RUNS.compare.modules[4]] } } }))), /Nothing placed.*Would pay · up to \$200 a month/);
  assert.match(html(React.createElement(ComparePanel, { read: F.PLACEMENTS_ONE_RUN })), /data-testid="compare-none"/);
});

test('the structuring receipt lists only its own steps, with model, fallback, cost and time', () => {
  const out = txt(React.createElement(StructureReceipt, { items: F.RECEIPT_ITEMS }));
  assert.doesNotMatch(out, /whisper/, 'speech-to-text lines belong to the session receipt');
  assert.match(out, /Structured · @cf\/meta\/llama-3\.3-70b-instruct-fp8-fast · 2026-10-09 19:20:00\$0\.0021/);
  assert.match(out, /Re-structured · @cf\/meta\/llama-3\.1-8b-instruct-fp8 \(fallback for @cf\/meta\/llama-3\.1-8b-instruct-fp8-fast\)/);
  assert.match(out, /Asked · .* refused \(budget_user_day\)/);
  assert.match(txt(React.createElement(StructureReceipt, { items: [F.RECEIPT_ITEMS[0]] })), /Not recorded/);
  assert.match(txt(React.createElement(StructureReceipt, { items: null })), /Unreadable/);
});

test('light by default, dark on request; every payload kind reads as words', () => {
  assert.match(html(React.createElement(InterviewReview, { read: F.PLACEMENTS_ONE_RUN })), /data-theme="light"/);
  const dark = html(React.createElement(InterviewReview, { theme: 'dark', read: F.PLACEMENTS_ONE_RUN }));
  assert.match(dark, /data-theme="dark" class="dark"/);
  assert.equal(placementText(F.RUN_B[1]), 'Would pay · up to $200 a month');
  assert.equal(placementText(F.RUN_A[2]), 'Supports H4 · Ops teams reconcile weekly through Manual reconciliation · Pattern');
  assert.equal(placementText({ ...F.RUN_A[0], edited_payload: { phrase: 'x', severity: 'mild' } }), '“x” · Mild', 'an edit wins over what the model said');
  assert.match(placementText({ kind: 'nope', payload: {} }), /^Unreadable/);
  assert.equal(spanLabel(null, 5), 'Span not recorded');
});

test('nothing calls the API yet, and Eadwyn\'s copy never calls itself an advisor', () => {
  const src = readFileSync('frontend/src/pages/founder/InterviewReview.jsx', 'utf8');
  assert.doesNotMatch(src, /from '\.\.\/\.\.\/lib\/api/);
  assert.doesNotMatch(src, /\brequest\(/);
  const copy = txt(React.createElement(InterviewReview, { read: F.PLACEMENTS_ONE_RUN, receiptItems: F.RECEIPT_ITEMS, ask: { result: F.ASK_OK } }));
  assert.doesNotMatch(copy, /advis|recommend|fiduciar/i);
});

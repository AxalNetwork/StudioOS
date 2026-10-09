/**
 * D660 part 3 (#1473) — the review step, mounted on #1494's routes.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/interview_review_mount_d660.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { makeReviewActions, REVIEW_INITIAL } from '../src/pages/founder/InterviewSessionPage.jsx';
import { ComparePanel, STRUCTURE_MODELS, nextStructureModel } from '../src/pages/founder/InterviewReview.jsx';
import * as F from './_interview_review_fixtures.mjs';

/** A state holder with the same updater shape as useState's setter. */
function holder() {
  let st = { ...REVIEW_INITIAL };
  const seen = [];
  return { set: (fn) => { st = fn(st); seen.push(st); }, get: () => st, seen };
}

function fakeApi(over = {}) {
  const calls = [];
  const api = {
    placements: async (id) => { calls.push(['placements', id]); return F.PLACEMENTS_ONE_RUN; },
    structure: async (id, model) => { calls.push(['structure', id, model]); return F.STRUCTURED; },
    accept: async (pid, payload) => { calls.push(['accept', pid, payload]); return { ok: true }; },
    discard: async (pid) => { calls.push(['discard', pid]); return { ok: true }; },
    ask: async (id, q) => { calls.push(['ask', id, q]); return F.ASK_OK; },
    ...over,
  };
  return { api, calls };
}

test('structure runs, shows running, then reads the placements again; a budget refusal is kept as the error', async () => {
  const h = holder(); let spent = 0;
  const { api, calls } = fakeApi();
  const a = makeReviewActions({ api, sessionId: 7, set: h.set, onSpent: () => { spent += 1; } });
  await a.structure('@cf/meta/llama-3.1-8b-instruct-fp8-fast');
  assert.deepEqual(calls, [['structure', 7, '@cf/meta/llama-3.1-8b-instruct-fp8-fast'], ['placements', 7]]);
  assert.equal(h.seen[0].running, true, 'running is shown while the model works');
  assert.equal(h.get().running, false);
  assert.deepEqual(h.get().read, F.PLACEMENTS_ONE_RUN);
  assert.equal(spent, 1, 'the receipt is read again after a run');

  const h2 = holder();
  const refused = fakeApi({ structure: async () => { throw F.BUDGET_ERROR; } });
  await makeReviewActions({ api: refused.api, sessionId: 7, set: h2.set }).structure();
  assert.equal(h2.get().runError, F.BUDGET_ERROR);
  assert.equal(h2.get().running, false);
  assert.equal(refused.calls.length, 0, 'nothing is re-read after a refused run');
});

test('accept sends the edit, re-reads; a refused write is kept on that placement only', async () => {
  const h = holder();
  const { api, calls } = fakeApi();
  const a = makeReviewActions({ api, sessionId: 7, set: h.set });
  await a.accept(1, { phrase: 'x', severity: 'mild' });
  assert.deepEqual(calls, [['accept', 1, { phrase: 'x', severity: 'mild' }], ['placements', 7]]);
  assert.equal(h.get().busyId, null);

  const h2 = holder();
  const bad = fakeApi({ accept: async () => { throw F.WRITER_REFUSED_ERROR; } });
  await makeReviewActions({ api: bad.api, sessionId: 7, set: h2.set }).accept(5);
  assert.equal(h2.get().errors[5], F.WRITER_REFUSED_ERROR);
  assert.equal(h2.get().errors[1], undefined);
  assert.equal(bad.calls.filter((c) => c[0] === 'placements').length, 0);

  const h3 = holder();
  const d = fakeApi();
  await makeReviewActions({ api: d.api, sessionId: 7, set: h3.set }).discard(4);
  assert.deepEqual(d.calls, [['discard', 4], ['placements', 7]]);
});

test('ask keeps a cited answer, and a no-citation refusal replaces any earlier answer', async () => {
  const h = holder();
  const ok = fakeApi();
  const a = makeReviewActions({ api: ok.api, sessionId: 7, set: h.set });
  await a.ask('How often?');
  assert.deepEqual(ok.calls, [['ask', 7, 'How often?']]);
  assert.equal(h.get().ask.result, F.ASK_OK);
  const failing = makeReviewActions({ api: fakeApi({ ask: async () => { throw F.ASK_NO_CITATION_ERROR; } }).api, sessionId: 7, set: h.set });
  await failing.ask('Anything else?');
  assert.equal(h.get().ask.result, null, 'the earlier answer is not left showing beside a refusal');
  assert.equal(h.get().ask.error, F.ASK_NO_CITATION_ERROR);
});

test('an unreadable placements read is null, never an empty list', async () => {
  const h = holder();
  await makeReviewActions({ api: fakeApi({ placements: async () => { throw new Error('x'); } }).api, sessionId: 7, set: h.set }).reload();
  assert.equal(h.get().read, null);
});

test('the structuring models are the router\'s alternates, and a second run uses the other one', () => {
  const router = readFileSync('cloudflare-worker/src/services/aiRouter.ts', 'utf8');
  const mid = /const MID_LLAMA\s*=\s*'([^']+)'/.exec(router)[1];
  const block = /structure_interview:\s*\{[\s\S]*?alternates:\s*\[([^\]]+)\]/.exec(router)[1];
  const alternates = block.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (x === 'MID_LLAMA' ? mid : x.replace(/'/g, '')));
  assert.deepEqual(STRUCTURE_MODELS, alternates);
  assert.equal(nextStructureModel(F.PLACEMENTS_ONE_RUN), '@cf/meta/llama-3.1-8b-instruct-fp8-fast');
  assert.equal(nextStructureModel(F.PLACEMENTS_TWO_RUNS), '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  const one = renderToStaticMarkup(React.createElement(ComparePanel, { read: F.PLACEMENTS_ONE_RUN, onRestructure: () => {} }));
  assert.match(renderedText(one), /Structure again with @cf\/meta\/llama-3\.1-8b-instruct-fp8-fast/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(ComparePanel, { read: F.PLACEMENTS_NONE, onRestructure: () => {} })), /button-restructure/);
});

test('the session page mounts the review step once transcribed, and the client calls the merged routes', () => {
  const page = readFileSync('frontend/src/pages/founder/InterviewSessionPage.jsx', 'utf8');
  assert.match(page, /\['transcribed', 'structured', 'reviewed'\]\.includes\(session\.status\) && \(\s*<section data-testid="session-review"/);
  const client = readFileSync('frontend/src/lib/api/interviewSessions.js', 'utf8');
  for (const path of ['/placements`', '/structure`', '/ask`', '/accept`', '/discard`']) assert.ok(client.includes(path), path);
});

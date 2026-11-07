/**
 * D4706 (#4706) — the shared mutation-outcome model, the Deploy step's next
 * actions, and the licence page wiring that shows them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/mutation_outcome_d4706.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  OUTCOMES, describeOutcome, outcomeFromError, outcomeOfError, outcomeOfResult, outcomeRole,
} from '../src/lib/mutationOutcome.js';
import { deployActions, noticeForCheck, noticeForRetry, attemptLine } from '../src/pages/admin/licenceDeploymentModel.js';
import OutcomeNotice from '../src/components/OutcomeNotice.jsx';
import { AttemptSummary } from '../src/pages/admin/LicenceDeploymentAttempts.jsx';
import { adminDeploymentAttemptsApi } from '../src/lib/api/adminDeploymentAttempts.js';
import { renderedText } from './_renderedText.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const err = (props) => Object.assign(new Error(props.message || 'x'), props);

test('the five outcomes', () => {
  assert.deepEqual(OUTCOMES, ['pending', 'committed', 'refused', 'partial', 'unknown']);
});

test('no answer is UNKNOWN, never refused: a timeout, a dropped connection, a gateway error', () => {
  assert.equal(outcomeOfError(err({ code: 'timeout', message: 'Request timed out' })), 'unknown');
  assert.equal(outcomeOfError(new TypeError('Failed to fetch')), 'unknown');
  assert.equal(outcomeOfError(err({ status: 504, code: 'outcome_unknown' })), 'unknown');
  assert.equal(outcomeOfError(err({ status: 503 })), 'unknown');
  assert.equal(outcomeOfError(err({ status: 502 })), 'unknown', 'a bare 502 is the edge, not the route');
  assert.equal(outcomeOfError(null), 'unknown');
});

test('an answer that says no is REFUSED, with the server sentence kept', () => {
  assert.equal(outcomeOfError(err({ status: 409, code: 'not_failed' })), 'refused');
  assert.equal(outcomeOfError(err({ status: 502, code: 'dispatch_failed' })), 'refused', 'the route spoke: it is a refusal');
  assert.equal(outcomeOfError(err({ status: 400 })), 'refused');
  const n = outcomeFromError(err({ status: 409, message: 'Attempt 2 is requested, not failed.' }));
  assert.deepEqual(n, { outcome: 'refused', message: 'Attempt 2 is requested, not failed.' });
});

test('a partial flag reads as partial, on success or failure', () => {
  assert.equal(outcomeOfError(err({ status: 409, data: { partial: true } })), 'partial');
  assert.equal(outcomeOfResult({ partial: true }), 'partial');
  assert.equal(outcomeOfResult({ ok: true }), 'committed');
});

test('an unknown outcome always says to check before trying again', () => {
  const t = outcomeFromError(err({ code: 'timeout', message: 'Request timed out after 30s' }));
  assert.equal(t.outcome, 'unknown');
  assert.match(t.message, /may or may not have been done/);
  assert.match(t.message, /Check its status before trying again/);
  const w = outcomeFromError(err({ status: 504, code: 'outcome_unknown', message: 'GitHub did not say.' }));
  assert.match(w.message, /^GitHub did not say\. /, 'the Worker sentence is kept and the next step added');
  assert.equal(describeOutcome('committed', { fallback: 'Seats saved.' }).message, 'Seats saved.');
});

test('a refusal and an unknown are announced; the rest are polite', () => {
  assert.equal(outcomeRole('refused'), 'alert');
  assert.equal(outcomeRole('unknown'), 'alert');
  assert.equal(outcomeRole('committed'), 'status');
  assert.equal(outcomeRole('partial'), 'status');
  const html = renderToStaticMarkup(h(OutcomeNotice, { notice: { outcome: 'unknown', message: 'No answer.' } }));
  assert.match(html, /role="alert"/);
  assert.match(html, /data-outcome="unknown"/);
  assert.match(renderedText(html), /Outcome unknown/);
  assert.equal(renderToStaticMarkup(h(OutcomeNotice, { notice: null })), '');
});

// ── the Deploy step ────────────────────────────────────────────────────────

const failedView = { status: 'failed', phase: 'refused', retryable: true, reconcilable: false, do_jurisdiction: 'eu', current_attempt: 1 };
const unknownView = { status: 'requested', phase: 'unknown', retryable: false, reconcilable: true, do_jurisdiction: 'eu', current_attempt: 1 };

test('a failed attempt offers Retry; an open one offers only a status check, and polls', () => {
  assert.deepEqual(deployActions(failedView), { canRetry: true, canCheck: false, poll: false, needsDoJurisdiction: false });
  assert.deepEqual(deployActions(unknownView), { canRetry: false, canCheck: true, poll: true, needsDoJurisdiction: false });
  assert.deepEqual(deployActions({ ...failedView, do_jurisdiction: null }).needsDoJurisdiction, true);
  assert.deepEqual(deployActions(null), { canRetry: false, canCheck: false, poll: false, needsDoJurisdiction: false });
  const linked = { status: 'linked', phase: 'committed', retryable: false, reconcilable: false };
  assert.equal(deployActions(linked).poll, false, 'a settled deployment is not polled');
});

test('a run that succeeded reads PARTIAL — the branch is up, HQ is not linked yet', () => {
  const n = noticeForCheck('succeeded', { status_note: 'The provisioning run succeeded.' });
  assert.equal(n.outcome, 'partial');
  assert.equal(noticeForCheck('failed', { last_failure: { failure_note: 'run ended failure' } }).outcome, 'refused');
  assert.equal(noticeForCheck('running', { current_attempt: 2 }).outcome, 'pending');
  assert.equal(noticeForCheck('settled', {}), null);
});

test('a replayed retry says nothing was sent again', () => {
  const n = noticeForRetry({ replayed: true, attempt: 2 });
  assert.equal(n.outcome, 'committed');
  assert.match(n.message, /nothing was sent again/);
  assert.equal(noticeForRetry({ attempt: 2, note: 'GitHub accepted the request.' }).outcome, 'pending');
  assert.equal(attemptLine({ attempt_no: 3, status: 'failed' }), 'Attempt 3 · failed');
});

test('the attempt summary shows the current attempt, the last failure with its reason, and the last success', () => {
  const html = renderToStaticMarkup(h(AttemptSummary, { view: {
    current_attempt: 2,
    current_attempt_row: { attempt_no: 2, status: 'dispatched', run_url: 'https://github.com/x/y/actions/runs/9' },
    last_failure: { attempt_no: 1, status: 'failed', failure_note: 'GitHub refused the dispatch (403).', settled_at: '2026-11-06T10:00:00Z' },
    last_success: null,
  } }));
  const text = renderedText(html);
  assert.match(text, /Attempt 2 · dispatched/);
  assert.match(text, /Attempt 1/);
  assert.match(text, /GitHub refused the dispatch \(403\)\./);
  assert.match(text, /None yet/);
  assert.match(html, /href="https:\/\/github.com\/x\/y\/actions\/runs\/9"/);
});

test('the client reaches the three Worker routes, and a retry always names its attempt', async () => {
  const store = new Map();
  globalThis.localStorage ??= {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
  };
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await adminDeploymentAttemptsApi.deployment('lic fr');
    await adminDeploymentAttemptsApi.retry('lic_fr', 3, { principal_email: 'p@x.example', expected_attempt: 99 });
    await adminDeploymentAttemptsApi.reconcile('lic_fr');
  } finally { globalThis.fetch = real; }
  assert.match(seen[0].url, /\/api\/admin\/licences\/lic%20fr\/deployment$/);
  assert.match(seen[1].url, /\/api\/admin\/licences\/lic_fr\/deploy\/retry$/);
  assert.equal(seen[1].method, 'POST');
  assert.equal(seen[1].body.expected_attempt, 3, 'the named attempt wins over anything in data');
  assert.match(seen[2].url, /\/api\/admin\/licences\/lic_fr\/deploy\/reconcile$/);
  assert.equal(seen[2].method, 'POST');
  const worker = read('cloudflare-worker/src/routes/admin_deployments.ts');
  for (const route of ["r.get('/licences/:uid/deployment'", "r.post('/licences/:uid/deploy/retry'", "r.post('/licences/:uid/deploy/reconcile'"]) {
    assert.ok(worker.includes(route), route);
  }
});

test('no licence save or lifecycle action fails silently any more', () => {
  const page = read('frontend/src/pages/admin/AdminLicences.jsx');
  // The three handlers that only reported to telemetry before D4706.
  assert.doesNotMatch(page, /catch \(e\) \{ reportError\('licence_(seats|terms|action)_failed', e\); \}/);
  for (const id of ['licence-seats-outcome', 'licence-terms-outcome', 'licence-action-outcome', 'deploy-outcome']) {
    assert.match(page, new RegExp(`testId="${id}"`), id);
  }
  // An unknown lifecycle outcome re-reads the licence before offering anything again.
  assert.match(page, /if \(outcomeOfError\(e\) === 'unknown'\) refresh\(\);/);
  // A deploy's failure re-reads the registry so its attempt and next step show.
  assert.match(page, /finally \{\n\s+setBusy\(false\);\n\s+load\(\);/);
  assert.match(page, /<LicenceDeploymentAttempts licence=\{licence\} initialEmail=\{email\}/);
});

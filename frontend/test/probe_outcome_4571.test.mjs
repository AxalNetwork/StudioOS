/**
 * #4571 R2-09 — a sign-in probe files every run under one outcome, and a check
 * it never ran is never a pass.
 *
 * The audited insert-probe run was challenged at the edge before its insert and
 * send checks ran. That is a monitor coverage gap, not evidence that sign-in
 * works or is broken, and the outcome must say so: EDGE_CHALLENGED, never a
 * pass and never "no row was written".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROBE_OUTCOMES, probeOutcome } from '../../scripts/lib/probeOutcome.mjs';
import { describeRefusal, insertOutcome, verdicts } from '../../scripts/check-magic-link-insert.mjs';
import { liveOutcome, verdicts as liveVerdicts } from '../../scripts/check-magic-link-live.mjs';

const EDGE = describeRefusal({ status: 403, headers: { 'content-type': 'text/html; charset=UTF-8', 'cf-ray': 'synthetic-ray' }, body: '<html>Just a moment...</html>' });
const WORKER = describeRefusal({ status: 403, headers: { 'content-type': 'application/json' }, body: '{"error":"forbidden"}' });
const OPAQUE = describeRefusal({ status: 403, headers: {}, body: '' });
const budgets = { startBudgetMs: 5000, sendBudgetMs: 180_000 };

test('the six outcomes, and VERIFIED_END_TO_END is the mailbox probe\'s alone', () => {
  assert.deepEqual([...PROBE_OUTCOMES], ['EDGE_CHALLENGED', 'APPLICATION_REFUSED', 'REFUSED_UNATTRIBUTED', 'APPLICATION_FAILED', 'ACCEPTED_NOT_VERIFIED', 'VERIFIED_END_TO_END']);
  const allPass = verdicts({ ...budgets, startMs: 100, startStatus: 202, refusal: null, rowFound: true, rowMs: 10, sendRow: { status: 'sent' }, sendMs: 900 });
  assert.equal(allPass.ok, true);
  assert.equal(insertOutcome({ startStatus: 202, refusal: null, result: allPass }), 'ACCEPTED_NOT_VERIFIED',
    'the insert probe sees Gmail accept the mail; it never sees the inbox or a session');
});

test('a refusal is filed by who refused, and its downstream checks are skipped, never passed', () => {
  // Mutation checked: probeOutcome treating a skipped row as passed (an edge refusal reported as accepted).
  for (const [refusal, want] of [[EDGE, 'EDGE_CHALLENGED'], [WORKER, 'APPLICATION_REFUSED'], [OPAQUE, 'REFUSED_UNATTRIBUTED']]) {
    const r = verdicts({ ...budgets, startMs: 160, startStatus: 403, refusal, rowFound: false, rowMs: NaN, sendRow: null, sendMs: NaN });
    assert.equal(r.ok, false);
    assert.deepEqual(r.rows.filter((x) => x.skipped).map((x) => x.key), ['token_row_written', 'mail_send_recorded']);
    assert.equal(insertOutcome({ startStatus: 403, refusal, result: r }), want);
    assert.equal(liveOutcome({ startStatus: 403, refusal, rows: [] }), want);
  }
  assert.equal(probeOutcome({ startStatus: 429, refusal: null, rows: [], endToEnd: false }), 'APPLICATION_REFUSED', 'its own rate limit is the Worker refusing');
});

test('accepted then failed, or never answered, is APPLICATION_FAILED; an empty or skipped list never passes', () => {
  const noRow = verdicts({ ...budgets, startMs: 100, startStatus: 202, refusal: null, rowFound: false, rowMs: NaN, sendRow: null, sendMs: NaN });
  assert.equal(insertOutcome({ startStatus: 202, refusal: null, result: noRow }), 'APPLICATION_FAILED');
  assert.equal(probeOutcome({ startStatus: undefined, refusal: null, rows: [{ ok: true }], endToEnd: true }), 'APPLICATION_FAILED', 'no answer is not an acceptance');
  assert.equal(probeOutcome({ startStatus: 202, refusal: null, rows: [], endToEnd: true }), 'APPLICATION_FAILED', 'no checks is not a pass');
  assert.equal(probeOutcome({ startStatus: 202, refusal: null, rows: [{ ok: true }, { ok: true, skipped: true }], endToEnd: true }), 'APPLICATION_FAILED');
});

test('the mailbox probe says VERIFIED_END_TO_END only when the link arrived and completed a sign-in', () => {
  const ran = (signedIn) => liveVerdicts({ startMs: 100, mailMs: 20_000, signedIn, startBudgetMs: 5000, mailBudgetMs: 300_000 });
  assert.equal(liveOutcome({ startStatus: 202, refusal: null, rows: ran(true).rows }), 'VERIFIED_END_TO_END');
  assert.equal(liveOutcome({ startStatus: 202, refusal: null, rows: ran(false).rows }), 'APPLICATION_FAILED');
});

test('both probes print the outcome on every exit path that ran a request', () => {
  // Mutation checked: the insert probe's refusal path printing no outcome.
  const insert = readFileSync(new URL('../../scripts/check-magic-link-insert.mjs', import.meta.url), 'utf8');
  const live = readFileSync(new URL('../../scripts/check-magic-link-live.mjs', import.meta.url), 'utf8');
  assert.match(insert, /function report\([^)]*\{ startStatus, refusal \}\) \{[\s\S]{0,300}outcome: \$\{insertOutcome\(/, 'the one printer prints the outcome');
  assert.equal((insert.match(/\}\), \{ startStatus, refusal \}\);|report\(result, \{ startStatus, refusal \}\);/g) || []).length, 2, 'both report calls pass what the outcome needs');
  assert.match(insert, /outcome: \$\{probeOutcome\(\{ startStatus: 429/, 'the rate-limit exit');
  assert.match(live, /outcome: \$\{liveOutcome\(\{ startStatus: 429/, 'the rate-limit exit');
  assert.match(live, /if \(startStatus !== 202\) \{[\s\S]{0,400}outcome: \$\{liveOutcome/, 'a refusal ends the run, with its outcome');
  assert.match(live, /outcome: \$\{liveOutcome\(\{ startStatus, refusal, rows \}\)\}/, 'the full run');
});

/**
 * Investor Pipeline stage-bucketing contract.
 *
 * The Screening / Commit / Transactions pages slice the single live deal source
 * (`GET /api/pipeline/active`) into three stages. These are real unit tests of
 * the pure predicates in src/pages/pipeline/bucketing.js.
 *
 * The key regression this guards: a deal that has a historical `latest_gate`
 * but whose CURRENT stage is no longer the decision gate must NOT be classified
 * as Commit — prod `/pipeline/active` always returns the latest historical gate
 * row, so keying Commit off `latest_gate` would wrongly pin such deals to the
 * committee page and distort its stat cards.
 *
 * Run with:  node --test frontend/test/pipeline_bucketing.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isScreeningDeal, isCommitDeal, isTransactionDeal, prettyStage, avg,
} from '../src/pages/pipeline/bucketing.js';

// Every deal lands in exactly one bucket.
function bucketOf(d) {
  const buckets = [
    isScreeningDeal(d) && 'screening',
    isCommitDeal(d) && 'commit',
    isTransactionDeal(d) && 'transaction',
  ].filter(Boolean);
  assert.equal(buckets.length, 1, `deal must be in exactly one bucket, got: ${buckets.join(',') || 'none'}`);
  return buckets[0];
}

test('decision_gate stage → Commit', () => {
  assert.equal(bucketOf({ pipeline_stage: 'decision_gate', project_status: 'intake' }), 'commit');
});

test('historical latest_gate but non-committee stage → NOT Commit', () => {
  // Deal went to IC, was sent back to iterate. latest_gate persists in the
  // /active payload; current stage is what matters.
  const d = { pipeline_stage: 'iterate', project_status: 'intake', latest_gate: { final_decision: 'failed' } };
  assert.equal(isCommitDeal(d), false);
  assert.equal(bucketOf(d), 'screening');
});

test('spinout_ready stage → Transactions', () => {
  assert.equal(bucketOf({ pipeline_stage: 'spinout_ready', project_status: 'intake' }), 'transaction');
});

test('spinout status → Transactions even with a gate history', () => {
  const d = { pipeline_stage: 'iterate', project_status: 'spinout', latest_gate: { final_decision: 'passed' } };
  assert.equal(bucketOf(d), 'transaction');
});

test('unrecognized / dev free-text stage defaults to Screening', () => {
  assert.equal(bucketOf({ pipeline_stage: 'seed', project_status: 'intake' }), 'screening');
  assert.equal(bucketOf({ pipeline_stage: 'idea', project_status: 'intake' }), 'screening');
  assert.equal(bucketOf({ pipeline_stage: null, project_status: null }), 'screening');
});

test('Transactions takes precedence over Commit', () => {
  // A deal at the gate that is also flagged spinout should not double-count.
  const d = { pipeline_stage: 'decision_gate', project_status: 'spinout' };
  assert.equal(bucketOf(d), 'transaction');
});

test('prettyStage maps studio stages and humanizes unknowns', () => {
  assert.equal(prettyStage('decision_gate'), 'Investment Committee');
  assert.equal(prettyStage('spinout_ready'), 'Spin-out Ready');
  assert.equal(prettyStage('seed'), 'Seed');
  assert.equal(prettyStage(null), '—');
});

test('avg ignores nulls and returns null when nothing is scored', () => {
  assert.equal(avg([80, null, 90]), 85);
  assert.equal(avg([null, undefined]), null);
  assert.equal(avg([]), null);
});

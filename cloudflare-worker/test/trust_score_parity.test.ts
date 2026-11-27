/**
 * The trust score is computed twice, and this is what stops the two drifting.
 *
 * The worker needs it because it writes the monthly snapshot to
 * `trust_score_snapshots` (migration 243), and a history the caller can set
 * is not a history. The frontend needs it because the ring renders without
 * waiting for a round trip. Production code never imports across the
 * `frontend/src` ↔ `cloudflare-worker/src` line in this repo, so the rule
 * genuinely exists twice — and a test is the only thing holding them equal.
 *
 * Both are imported and RUN here, over the same fixtures. Asserting that the
 * two source files merely look alike would pass the day someone edits one of
 * them into agreement with itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { trustScoreOf } from '../src/services/trust.ts';
import { computeTrustScore } from '../../frontend/src/lib/trustCenter.js';

const ob = (required: number, status: string) => ({ required, status });

/** Every shape the two implementations could disagree about. */
const CASES: Array<{ name: string; rows: any[] }> = [
  { name: 'no obligations at all', rows: [] },
  { name: 'only optional rows', rows: [ob(0, 'pending'), ob(0, 'satisfied')] },
  { name: 'one required, satisfied', rows: [ob(1, 'satisfied')] },
  { name: 'one required, pending', rows: [ob(1, 'pending')] },
  { name: 'one required, waived counts as settled', rows: [ob(1, 'waived')] },
  { name: 'one required, expired does not', rows: [ob(1, 'expired')] },
  { name: 'one required, in_review does not', rows: [ob(1, 'in_review')] },
  { name: 'two of three required settled (rounds)', rows: [ob(1, 'satisfied'), ob(1, 'waived'), ob(1, 'pending')] },
  { name: 'one of three (rounds to 33)', rows: [ob(1, 'satisfied'), ob(1, 'pending'), ob(1, 'pending')] },
  { name: 'optional rows never dilute', rows: [ob(1, 'satisfied'), ob(0, 'pending'), ob(0, 'pending')] },
  { name: 'seven required, three settled', rows: [
    ob(1, 'satisfied'), ob(1, 'satisfied'), ob(1, 'waived'),
    ob(1, 'pending'), ob(1, 'pending'), ob(1, 'expired'), ob(1, 'in_review'),
  ] },
  // `required` arrives from D1 as 0/1 integers and from the client as the
  // same — but a truthy non-1 must not change the answer on one side only.
  { name: 'required as a truthy non-one', rows: [{ required: 2, status: 'satisfied' }, { required: 1, status: 'pending' }] },
];

test('both implementations agree on every fixture', () => {
  for (const { name, rows } of CASES) {
    const worker = trustScoreOf(rows);
    const client = computeTrustScore(rows);
    assert.equal(
      worker, client,
      `"${name}": worker says ${worker}, frontend says ${client} — the two copies have drifted`,
    );
  }
});

test('no required obligations scores 100, not 0, on both sides', () => {
  // A role with nothing asked of it has nothing outstanding. Zero would read
  // as total failure for someone who has done nothing wrong, and the two
  // implementations must not disagree about which it is.
  assert.equal(trustScoreOf([]), 100);
  assert.equal(computeTrustScore([]), 100);
  assert.equal(trustScoreOf([ob(0, 'pending')]), 100);
  assert.equal(computeTrustScore([ob(0, 'pending')]), 100);
});

test('the score is always a whole number in 0..100', () => {
  for (const { name, rows } of CASES) {
    const n = trustScoreOf(rows);
    assert.ok(Number.isInteger(n), `"${name}" produced ${n}, which is not an integer`);
    assert.ok(n >= 0 && n <= 100, `"${name}" produced ${n}, outside 0..100`);
    // Migration 243's CHECK constraint refuses anything else, so a score
    // outside this range would fail the snapshot INSERT rather than render.
  }
});

test('a satisfied obligation cannot lower the score', () => {
  // Monotonicity, checked rather than assumed: settling one more required
  // item must never move the number down on either side.
  let rows = [ob(1, 'pending'), ob(1, 'pending'), ob(1, 'pending')];
  let last = trustScoreOf(rows);
  for (let i = 0; i < rows.length; i++) {
    rows = rows.map((r, j) => (j <= i ? ob(1, 'satisfied') : r));
    const next = trustScoreOf(rows);
    assert.ok(next >= last, `settling item ${i} moved the score ${last} → ${next}`);
    assert.equal(next, computeTrustScore(rows));
    last = next;
  }
  assert.equal(last, 100);
});

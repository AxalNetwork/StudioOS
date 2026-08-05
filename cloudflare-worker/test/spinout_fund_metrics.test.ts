/**
 * Unit tests for services/spinoutFundMetrics.ts — the pure aggregation logic
 * behind GET /api/spinout-lab/fund-metrics (LP & Investor Workspace live
 * program + raise figures).
 *
 * Run with:
 *   node --experimental-strip-types --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/spinout_fund_metrics.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  median,
  summarizeGraduates,
  summarizeLpRows,
} from '../src/services/spinoutFundMetrics.ts';

// ---------------------------------------------------------------- median

test('median: empty list is null', () => {
  assert.equal(median([]), null);
});

test('median: odd and even lengths, unsorted input', () => {
  assert.equal(median([300_000, 50_000, 150_000]), 150_000);
  assert.equal(median([100_000, 400_000]), 250_000);
});

// ---------------------------------------------------- summarizeGraduates

const grad = (
  user_id: number,
  started: string | null,
  completed: string | null,
  funding: number | null = null,
) => ({ user_id, started_at: started, completed_at: completed, total_funding: funding });

test('summarizeGraduates: an empty set is a live zero, still available', () => {
  // `available: false` is reserved for the wire handler's catch (query
  // failed) — a genuine zero-graduate program is a fact, not an outage.
  const s = summarizeGraduates([]);
  assert.deepEqual(s, { available: true, graduates: 0, on_time_pct: null, alumni_raised: null });
});

test('summarizeGraduates: dedupes users, counts on-time within the sprint window', () => {
  const s = summarizeGraduates([
    grad(1, '2026-01-01 00:00:00', '2026-01-20 00:00:00', 500_000), // on time (day 20)
    grad(1, '2026-01-01 00:00:00', '2026-01-20 00:00:00', 999_999), // dup project row — ignored
    grad(2, '2026-01-01 00:00:00', '2026-02-15 00:00:00'),          // late (day 45)
  ], 28);
  assert.equal(s.available, true);
  assert.equal(s.graduates, 2);
  assert.equal(s.on_time_pct, 50);
  assert.equal(s.alumni_raised, 500_000);
});

test('summarizeGraduates: missing start dates are excluded from the pct, not counted late', () => {
  const s = summarizeGraduates([
    grad(1, null, '2026-01-20 00:00:00'),
    grad(2, '2026-01-01 00:00:00', '2026-01-10 00:00:00'),
  ], 28);
  assert.equal(s.graduates, 2);
  assert.equal(s.on_time_pct, 100); // only user 2 is measurable

  // No measurable graduate at all → null, never 0 (a data gap is not a 0% program).
  const none = summarizeGraduates([grad(1, null, '2026-01-20 00:00:00')], 28);
  assert.equal(none.on_time_pct, null);
});

test('summarizeGraduates: the 28-day boundary itself is on time', () => {
  const s = summarizeGraduates([
    grad(1, '2026-01-01 00:00:00', '2026-01-29 00:00:00'), // exactly 28 days
  ], 28);
  assert.equal(s.on_time_pct, 100);
});

// ------------------------------------------------------- summarizeLpRows

test('summarizeLpRows: splits committed (lpa_signed) from soft-circled', () => {
  const s = summarizeLpRows([
    { commitment_amount: 250_000, lpa_signed: 1 },
    { commitment_amount: 100_000, lpa_signed: 1 },
    { commitment_amount: 150_000, lpa_signed: 0 },
    { commitment_amount: 0, lpa_signed: 1 },      // no ticket — counted as an LP row only
    { commitment_amount: null, lpa_signed: null },
  ]);
  assert.equal(s.committed, 350_000);
  assert.equal(s.soft_circled, 150_000);
  assert.equal(s.lp_count, 5);
  assert.equal(s.median_commitment, 150_000);
});

test('summarizeLpRows: empty fund yields zeros and a null median', () => {
  assert.deepEqual(summarizeLpRows([]), {
    committed: 0, soft_circled: 0, lp_count: 0, median_commitment: null,
  });
});

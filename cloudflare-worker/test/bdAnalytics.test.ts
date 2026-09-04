/**
 * Build queue #122 — BD pipeline analytics tests.
 *
 * The win-rate denominator is the whole point of this module, so most
 * of these tests are about who is EXCLUDED from it. A partner quotes
 * this number to prospects; counting open quotes as losses punishes a
 * full pipeline, and counting withdrawals as losses understates real
 * conversion.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/bdAnalytics.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analysePipeline, weightedPipeline, analyseDelivery, analyseByShape, analyseByQuarter,
  DEFAULT_STAGE_WEIGHTS, type QuoteRow,
} from '../src/services/bdAnalytics.ts';

const QUOTES: QuoteRow[] = [
  { status: 'accepted', amount: 20_000, created_at: '2026-01-01', decided_at: '2026-01-11' },
  { status: 'accepted', amount: 30_000, created_at: '2026-02-01', decided_at: '2026-02-21' },
  { status: 'rejected', amount: 15_000, created_at: '2026-03-01', decided_at: '2026-03-16' },
  { status: 'submitted', amount: 25_000, created_at: '2026-08-01' },
  { status: 'submitted', amount: 40_000, created_at: '2026-08-10' },
  { status: 'withdrawn', amount: 10_000, created_at: '2026-04-01', decided_at: '2026-04-05' },
];

test('win rate counts only DECIDED quotes', () => {
  const p = analysePipeline(QUOTES);
  // 2 accepted of 3 decided = 66.7%. Not 2/6 (33%), not 2/5 (40%).
  assert.equal(p.win_rate_pct, 66.7);
  assert.equal(p.accepted, 2);
  assert.equal(p.rejected, 1);
});

test('open quotes are excluded — a full pipeline is not a losing streak', () => {
  const p = analysePipeline(QUOTES);
  assert.equal(p.pending, 2);
  assert.match(p.win_rate_basis, /undecided quote is not a loss/i);
});

test('withdrawn quotes are excluded — walking away is not losing', () => {
  const p = analysePipeline(QUOTES);
  assert.equal(p.withdrawn, 1);
  assert.match(p.win_rate_basis, /withdrawing is not losing/i);
  // Proof: adding a withdrawal must not move the win rate.
  const withExtra = analysePipeline([...QUOTES, { status: 'withdrawn', amount: 99_000 }]);
  assert.equal(withExtra.win_rate_pct, p.win_rate_pct);
});

test('win rate is null, not zero, before anything is decided', () => {
  const p = analysePipeline([{ status: 'submitted', amount: 10_000 }]);
  assert.equal(p.win_rate_pct, null, 'zero would read as "never wins"');
  assert.match(p.win_rate_basis, /no win rate to report/i);
});

test('values split correctly between open and won', () => {
  const p = analysePipeline(QUOTES);
  assert.equal(p.won_value, 50_000, 'accepted only');
  assert.equal(p.open_value, 65_000, 'both submitted quotes');
  assert.equal(p.average_deal_size, 25_000);
});

test('cycle time is the MEDIAN so one stalled deal cannot skew it', () => {
  const p = analysePipeline(QUOTES);
  // Decided cycles: 10, 20, 15 days → median 15.
  assert.equal(p.median_cycle_days, 15);
  const skewed = analysePipeline([
    ...QUOTES,
    { status: 'rejected', amount: 1, created_at: '2026-01-01', decided_at: '2027-01-01' },
  ]);
  assert.ok(skewed.median_cycle_days! < 30, 'a 365-day outlier must not dominate');
});

test('cycle time ignores quotes with missing or reversed dates', () => {
  const p = analysePipeline([
    { status: 'accepted', amount: 1, created_at: '2026-01-01' },
    { status: 'accepted', amount: 1, created_at: '2026-03-01', decided_at: '2026-01-01' },
  ]);
  assert.equal(p.median_cycle_days, null);
});

test('analysePipeline is safe on empty and malformed input', () => {
  const p = analysePipeline([]);
  assert.equal(p.win_rate_pct, null);
  assert.equal(p.quote_count, 0);
  const junk = analysePipeline([{ status: 'nonsense', amount: NaN as unknown as number }]);
  assert.equal(junk.accepted, 0);
  assert.equal(junk.open_value, 0);
});

// ---------- weighted forecast ----------

test('weighted pipeline applies stage probabilities to OPEN quotes only', () => {
  const w = weightedPipeline(QUOTES);
  // Both quotes are 'submitted' at weight 0.3 → 65,000 × 0.3 = 19,500.
  assert.equal(w.weighted_value, 19_500);
  assert.equal(w.unweighted_value, 65_000);
});

test('won deals are NOT added to the forecast', () => {
  const w = weightedPipeline(QUOTES);
  const stages = w.by_stage.map(s => s.stage);
  assert.ok(!stages.includes('accepted'), 'booked revenue would be double-counted');
  assert.match(w.note, /double-counted/i);
});

test('weights are clamped into 0..1 rather than trusted', () => {
  const w = weightedPipeline(
    [{ status: 'submitted', amount: 10_000 }],
    { ...DEFAULT_STAGE_WEIGHTS, submitted: 5 },
  );
  assert.equal(w.weighted_value, 10_000, 'a 5 must cap at 1.0, not multiply by five');
});

test('an unknown stage weight contributes zero rather than NaN', () => {
  const w = weightedPipeline([{ status: 'submitted', amount: 10_000 }], {});
  assert.equal(w.weighted_value, 0);
  assert.ok(Number.isFinite(w.weighted_value));
});

// ---------- delivery ----------

test('completion rate excludes work still in flight', () => {
  const d = analyseDelivery([
    { status: 'delivered', amount: 20_000 },
    { status: 'delivered', amount: 10_000 },
    { status: 'cancelled', amount: 5_000 },
    { status: 'in_progress', amount: 15_000 },
    { status: 'accepted', amount: 8_000 },
  ]);
  assert.equal(d.completion_rate_pct, 66.7, '2 delivered of 3 closed');
  assert.equal(d.active, 2, 'accepted + in_progress');
  assert.equal(d.active_value, 23_000);
  assert.equal(d.delivered_value, 30_000);
});

test('completion rate is null before anything closes', () => {
  const d = analyseDelivery([{ status: 'in_progress', amount: 1_000 }]);
  assert.equal(d.completion_rate_pct, null);
  assert.equal(d.active, 1);
});

test('analyseDelivery is safe on empty input', () => {
  const d = analyseDelivery([]);
  assert.equal(d.completion_rate_pct, null);
  assert.equal(d.active, 0);
  assert.equal(d.delivered_value, 0);
});

test('the pending status matches the live schema vocabulary', () => {
  // quotes.status is submitted|accepted|rejected|withdrawn
  // (sql/t13_t14_t15.sql:354). An engine keyed on 'open'/'in_review'
  // silently reports an empty pipeline against real data, which is why
  // this is pinned rather than left to a comment.
  const p = analysePipeline([{ status: 'submitted', amount: 5_000 }]);
  assert.equal(p.pending, 1);
  assert.equal(p.open_value, 5_000);
  const wrong = analysePipeline([{ status: 'open', amount: 5_000 }]);
  assert.equal(wrong.pending, 0, "'open' is not a quote status in this schema");
});

// ---------- the two breakdowns the Pipeline canvas asks for ----------

const SHAPED: QuoteRow[] = [
  { status: 'accepted', amount: 20_000, created_at: '2026-01-01', decided_at: '2026-01-11', shape: 'brand' },
  { status: 'rejected', amount: 15_000, created_at: '2026-01-05', decided_at: '2026-01-25', shape: 'brand' },
  { status: 'submitted', amount: 9_000, created_at: '2026-08-01', shape: 'brand' },
  { status: 'accepted', amount: 50_000, created_at: '2026-04-01', decided_at: '2026-04-06', shape: 'engineering' },
  // Two rows that must NOT be folded into a real category.
  { status: 'submitted', amount: 4_000, created_at: '2026-08-02', shape: null },
  { status: 'rejected', amount: 6_000, created_at: '2026-05-01', decided_at: '2026-05-11', shape: '  ' },
];

test('by shape uses the same decided-only denominator as the headline rate', () => {
  const rows = analyseByShape(SHAPED);
  const brand = rows.find((r) => r.shape === 'brand')!;
  // 1 won of 2 decided. NOT 1 of 3 — the open quote is excluded here for the
  // same reason it is excluded from the headline win rate.
  assert.equal(brand.win_rate_pct, 50);
  assert.equal(brand.quote_count, 3);
  assert.equal(brand.pending, 1);
  assert.equal(brand.open_value, 9_000);
  assert.equal(brand.won_value, 20_000);
  // Median of 10 and 20 days.
  assert.equal(brand.median_cycle_days, 15);
});

test('a shape with nothing decided reports a null win rate, never 0%', () => {
  const rows = analyseByShape([
    { status: 'submitted', amount: 1_000, created_at: '2026-08-01', shape: 'design' },
    { status: 'withdrawn', amount: 2_000, created_at: '2026-08-02', decided_at: '2026-08-09', shape: 'design' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].win_rate_pct, null, '0% would claim a loss that never happened');
  assert.equal(rows[0].median_cycle_days, null);
});

test('an absent or blank shape is its own bucket, not folded into a real one', () => {
  const rows = analyseByShape(SHAPED);
  const unrecorded = rows.find((r) => r.shape === null);
  assert.ok(unrecorded, 'a quote whose need row is unreadable still has to be counted');
  assert.equal(unrecorded!.quote_count, 2, 'null and whitespace are the same unrecorded bucket');
  assert.equal(rows.filter((r) => r.shape === null).length, 1);
  // And the headline totals are unaffected: the LEFT join keeps every quote.
  assert.equal(rows.reduce((a, r) => a + r.quote_count, 0), SHAPED.length);
});

test('shapes come back in a stable order — count first, then name, unrecorded last', () => {
  const rows = analyseByShape(SHAPED);
  assert.deepEqual(rows.map((r) => r.shape), ['brand', null, 'engineering']);
  // Same input twice must not reorder.
  assert.deepEqual(analyseByShape(SHAPED).map((r) => r.shape), rows.map((r) => r.shape));
  // On a TIE the named categories come first and the unrecorded bucket last,
  // so a table never opens with a row headed "Not recorded" while a real
  // category of the same size sits below it. Alphabetical among the named
  // ones, so the order is a property of the data and not of insertion.
  const tied = analyseByShape([
    { status: 'accepted', amount: 1, created_at: '2026-01-01', decided_at: '2026-01-02', shape: null },
    { status: 'accepted', amount: 1, created_at: '2026-01-01', decided_at: '2026-01-02', shape: 'ops' },
    { status: 'accepted', amount: 1, created_at: '2026-01-01', decided_at: '2026-01-02', shape: 'brand' },
  ]);
  assert.deepEqual(tied.map((r) => r.shape), ['brand', 'ops', null]);
});

test('a quarter is the quarter the DECISION landed in, not the one the quote was sent in', () => {
  const rows = analyseByQuarter([
    { status: 'rejected', amount: 10_000, created_at: '2026-03-02', decided_at: '2026-07-15' },
    { status: 'accepted', amount: 40_000, created_at: '2026-07-01', decided_at: '2026-07-20' },
  ]);
  assert.equal(rows.length, 1, 'both decisions landed in Q3 even though one was sent in Q1');
  assert.equal(rows[0].quarter, '2026-Q3');
  assert.equal(rows[0].decided, 2);
  assert.equal(rows[0].win_rate_pct, 50);
  assert.equal(rows[0].won_value, 40_000);
});

test('by quarter excludes open and withdrawn quotes, and orders chronologically', () => {
  const rows = analyseByQuarter([
    { status: 'accepted', amount: 5_000, created_at: '2025-11-01', decided_at: '2025-12-05' },
    { status: 'submitted', amount: 9_000, created_at: '2026-08-01' },
    { status: 'withdrawn', amount: 7_000, created_at: '2026-01-02', decided_at: '2026-02-02' },
    { status: 'rejected', amount: 3_000, created_at: '2026-04-01', decided_at: '2026-05-09' },
  ]);
  assert.deepEqual(rows.map((r) => r.quarter), ['2025-Q4', '2026-Q2']);
  assert.equal(rows[0].win_rate_pct, 100);
  assert.equal(rows[1].win_rate_pct, 0, 'a real loss IS 0% — that is different from nothing decided');
});

test('both breakdowns are safe on empty input and on unparseable dates', () => {
  assert.deepEqual(analyseByShape([]), []);
  assert.deepEqual(analyseByQuarter([]), []);
  assert.deepEqual(analyseByQuarter([{ status: 'accepted', amount: 1, decided_at: 'not a date' }]), []);
  const noShape = analyseByShape([{ status: 'accepted', amount: 1 }]);
  assert.equal(noShape[0].shape, null);
});

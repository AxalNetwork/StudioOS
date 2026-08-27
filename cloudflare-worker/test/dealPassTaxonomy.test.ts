/**
 * Deal Flow — the pass taxonomy and the analytics built on it.
 *
 * The failure this file exists to catch is not a crash. It is a plausible
 * number: a conversion rate computed from a board snapshot, a pass breakdown
 * whose percentages quietly exclude the passes nobody categorised, a "0%" where
 * the honest answer is "nothing entered this stage". Each of those renders
 * perfectly and is wrong, and a fund reads them to decide what to fund.
 *
 * Pure functions — no D1, no auth. The clock is injected where it matters.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/dealPassTaxonomy.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PASS_TAXONOMY, PASS_REASON_KEYS, isPassReason, passReasonLabel,
  passReasonRevisit, PASS_REASON_UNRECORDED, PASS_REASON_UNRECORDED_LABEL,
} from '../src/services/dealPassTaxonomy.ts';
import {
  buildPassBreakdown, buildStageFunnel, pctOrNull, DEAL_METRIC_UNAVAILABLE,
} from '../src/services/dealAnalytics.ts';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

// ---------- the vocabulary ----------

test('the taxonomy is closed — no free text, no "other" escape hatch', () => {
  // An "other" bucket collects the majority of real passes within a quarter,
  // and then the aggregate says nothing. That is the whole failure mode.
  for (const r of PASS_TAXONOMY) {
    assert.doesNotMatch(r.key, /other|misc|general/i, `"${r.key}" is an escape hatch`);
    assert.ok(r.label && r.hint, `${r.key} needs a label and a hint`);
  }
  assert.equal(new Set(PASS_REASON_KEYS).size, PASS_REASON_KEYS.length, 'keys must be unique');
});

test('reason matching is exact — case and whitespace variants are rejected', () => {
  // 'Valuation' and 'valuation' becoming two buckets is precisely the silent
  // corruption the CHECK constraint and this predicate exist to prevent.
  assert.equal(isPassReason('valuation'), true);
  for (const bad of ['Valuation', 'VALUATION', ' valuation', 'valuation ', 'val', '',
                     null, undefined, 0, 1, {}, [], 'other', 'unrecorded']) {
    assert.equal(isPassReason(bad as any), false, `${JSON.stringify(bad)} must not pass`);
  }
});

test('an unknown reason labels as unrecorded rather than echoing the input', () => {
  assert.equal(passReasonLabel('valuation'), 'Valuation');
  assert.equal(passReasonLabel('nonsense'), PASS_REASON_UNRECORDED_LABEL);
  assert.equal(passReasonLabel(null), PASS_REASON_UNRECORDED_LABEL);
  // A revisit promise may only exist where the fund actually re-queries.
  assert.ok(passReasonRevisit('early'));
  assert.ok(passReasonRevisit('valuation'));
  assert.equal(passReasonRevisit('team'), null);
});

test('the CHECK constraint and the taxonomy list the same reasons', () => {
  // If they drift, a reason the UI offers is rejected by D1 at write time —
  // an error the operator sees only after composing the pass.
  const sql = read('cloudflare-worker/sql/migrations/176_deal_pass_taxonomy.sql');
  const m = sql.match(/pass_reason IN \(([^)]*)\)/);
  assert.ok(m, 'migration must constrain pass_reason');
  const inCheck = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(inCheck, [...PASS_REASON_KEYS].sort());
});

// ---------- percentages ----------

test('0 of 0 is not 0% — it is no answer', () => {
  // Rendering 0% puts a confident number where there is no data.
  assert.equal(pctOrNull(0, 0), null);
  assert.equal(pctOrNull(5, 0), null);
  assert.equal(pctOrNull(0, 4), 0);
  assert.equal(pctOrNull(1, 3), 33.3);
  assert.equal(pctOrNull(4, 4), 100);
});

// ---------- the pass breakdown ----------

test('uncategorised passes are their own bucket, never redistributed or dropped', () => {
  const { total, buckets, unrecorded } = buildPassBreakdown([
    { pass_reason: 'valuation', count: 3 },
    { pass_reason: 'team', count: 1 },
    { pass_reason: null, count: 6 },      // legacy rows from before 176
  ]);
  assert.equal(total, 10, 'the denominator must include the uncategorised passes');
  assert.equal(unrecorded, 6);
  const val = buckets.find((b) => b.reason === 'valuation')!;
  // 3/10, NOT 3/4 — excluding the unknowns would make 'valuation' look like
  // 75% of the fund's passes when it is 30%.
  assert.equal(val.pct, 30);
  const un = buckets.find((b) => b.reason === PASS_REASON_UNRECORDED)!;
  assert.ok(un, 'an unrecorded bucket must be visible when non-empty');
  assert.equal(un.count, 6);
});

test('an off-taxonomy value in the column counts as unrecorded, not as itself', () => {
  // Defence in depth: if a row ever gets past the CHECK, it must not invent a
  // sixth bucket in the chart.
  const { buckets, unrecorded } = buildPassBreakdown([{ pass_reason: 'vibes', count: 2 }]);
  assert.equal(unrecorded, 2);
  assert.equal(buckets.some((b) => b.reason === 'vibes'), false);
});

test('every taxonomy reason appears even at zero, and only real gaps add a bucket', () => {
  const { buckets, total } = buildPassBreakdown([{ pass_reason: 'team', count: 2 }]);
  assert.equal(total, 2);
  for (const r of PASS_TAXONOMY) {
    assert.ok(buckets.some((b) => b.reason === r.key), `${r.key} must be listed`);
  }
  // "We have never passed on valuation" is a finding; omitting the row hides it.
  assert.equal(buckets.find((b) => b.reason === 'valuation')!.count, 0);
  // No gap in the data means no unrecorded row.
  assert.equal(buckets.some((b) => b.reason === PASS_REASON_UNRECORDED), false);
});

test('an empty fund reports no passes rather than a chart of zeroes with percentages', () => {
  const { total, buckets } = buildPassBreakdown([]);
  assert.equal(total, 0);
  for (const b of buckets) assert.equal(b.pct, null, `${b.reason} must have no percentage`);
});

// ---------- the stage funnel ----------

const STAGES = ['applied', 'scored', 'active', 'funded'];
const ev = (deal_id: number, from: string | null, to: string, kind: string, days: number | null = null) =>
  ({ deal_id, from_stage: from, to_stage: to, kind, days_in_from: days, created_at: '2026-08-01 00:00:00' });

test('conversion counts deals that ENTERED a stage, not deals standing in it', () => {
  // Three deals entered 'scored'; two advanced out. A board snapshot would
  // report the one still sitting there and call it a 100% stage.
  const rows = buildStageFunnel(STAGES, [
    ev(1, 'applied', 'scored', 'advance', 4),
    ev(2, 'applied', 'scored', 'advance', 6),
    ev(3, 'applied', 'scored', 'advance', 9),
    ev(1, 'scored', 'active', 'advance', 10),
    ev(2, 'scored', 'active', 'advance', 20),
  ] as any);
  const scored = rows.find((r) => r.stage === 'scored')!;
  assert.equal(scored.entered, 3);
  assert.equal(scored.advanced, 2);
  assert.equal(scored.conversion, 66.7);
  assert.equal(scored.avg_days, 15, 'mean of the recorded 10 and 20 days');
});

test('a deal counted once no matter how many times it re-enters a stage', () => {
  const rows = buildStageFunnel(STAGES, [
    ev(1, 'applied', 'scored', 'advance', 3),
    ev(1, 'scored', 'applied', 'set', 5),     // sent back
    ev(1, 'applied', 'scored', 'advance', 2), // and forward again
  ] as any);
  assert.equal(rows.find((r) => r.stage === 'scored')!.entered, 1,
    'one deal bouncing must not read as two deals of volume');
});

test('a pass is not a conversion', () => {
  const rows = buildStageFunnel(STAGES, [
    ev(1, 'applied', 'scored', 'advance', 2),
    ev(1, 'scored', 'rejected', 'pass', 8),
  ] as any);
  const scored = rows.find((r) => r.stage === 'scored')!;
  assert.equal(scored.entered, 1);
  assert.equal(scored.advanced, 0, 'leaving by being passed is the opposite of advancing');
  assert.equal(scored.conversion, 0);
  assert.equal(scored.avg_days, 8, 'but the time it spent there is still real');
});

test('a backwards status write is not credited as progress', () => {
  const rows = buildStageFunnel(STAGES, [
    ev(1, 'applied', 'active', 'set', 1),     // forward — counts
    ev(2, 'applied', 'scored', 'advance', 1),
    ev(2, 'scored', 'applied', 'set', 1),     // backward — must not count
  ] as any);
  assert.equal(rows.find((r) => r.stage === 'applied')!.advanced, 1);
  assert.equal(rows.find((r) => r.stage === 'scored')!.advanced, 0);
});

test('conversion can never exceed 100% on a deal that predates recording', () => {
  // This deal was already sitting in 'scored' when the table started, so its
  // entry was never recorded. Crediting the advance would give 1/0.
  const rows = buildStageFunnel(STAGES, [ev(9, 'scored', 'active', 'advance', 40)] as any);
  const scored = rows.find((r) => r.stage === 'scored')!;
  assert.equal(scored.entered, 0);
  assert.equal(scored.advanced, 0);
  assert.equal(scored.conversion, null, 'no cohort means no rate, not an infinite one');
  assert.equal(scored.avg_days, 40, 'the duration was measured and is reportable');
});

test('a stage nobody has moved through reports null, not zero', () => {
  const rows = buildStageFunnel(STAGES, [] as any);
  for (const r of rows) {
    assert.equal(r.entered, 0);
    assert.equal(r.conversion, null, `${r.stage} conversion must be unknown, not 0%`);
    assert.equal(r.avg_days, null, `${r.stage} duration must be unknown, not 0 days`);
  }
});

// ---------- the refusals ----------

test('the source-quality table is refused in words, not silently omitted', () => {
  // The canvas asks for source · seen · IC · sheets · yield. Deals record no
  // source, no IC decision and no term sheet — three invented columns.
  const why = DEAL_METRIC_UNAVAILABLE.source_quality;
  assert.match(why, /no source field/i);
  assert.match(why, /IC decision record/i);
  assert.match(why, /term-sheet/i);
  assert.match(DEAL_METRIC_UNAVAILABLE.stage_history, /first recorded move/i);
});

/**
 * A target is read against a snapshot, and there are THREE answers, not two.
 *
 * `metric_targets` shipped in migration 173 and had no reader and no writer
 * anywhere for twenty-one migrations — the orphan-table shape migration 215's
 * header names by example. Task #194 gave it both ends, and these are the two
 * judgements the page makes that a passing route cannot prove:
 *
 *   · WHICH WAY IS GOOD. Migration 173 stores `direction` for exactly one
 *     reason, in its own words: without it "the UI cannot tell whether being
 *     over the number is good news, and would colour a burn overage green".
 *     The store knows; the comparison has to use it.
 *
 *   · MET, BEHIND, AND NOT MEASURED. A target on a metric the latest snapshot
 *     does not carry is NOT a miss. `met: false` there would tell a founder
 *     they are behind on a number nobody recorded — absent read as empty, which
 *     is the failure `zoneFilterBuilder.js` opens its own docblock with.
 *
 * Source-text assertions live in `founder_grow_a5_contract.test.mjs`; this file
 * runs the function.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { readTarget } from '../src/lib/metricTargets.js';
import { FOUNDER_ZONE_FILTERS } from '../src/workspaces/founderZoneFilters.js';
import { founderZoneFilters } from '../src/workspaces/founderZoneFilters.js';

const target = (key, value, direction) => ({ metric_key: key, target_value: value, direction });

test('higher-is-better is met at or above the number', () => {
  assert.equal(readTarget(target('mrr', 1000, 'up'), { mrr: 1200 }).met, true);
  assert.equal(readTarget(target('mrr', 1000, 'up'), { mrr: 1000 }).met, true, 'exactly on plan is not a miss');
  assert.equal(readTarget(target('mrr', 1000, 'up'), { mrr: 999 }).met, false);
});

test('lower-is-better is met at or below the number, so a burn overage is never green', () => {
  // The case migration 173's comment is about. With `direction` ignored, 90000
  // against a 50000 burn plan would read as met — a founder burning 80% more
  // than planned, told they are on track.
  assert.equal(readTarget(target('net_burn', 50000, 'down'), { net_burn: 90000 }).met, false);
  assert.equal(readTarget(target('net_burn', 50000, 'down'), { net_burn: 50000 }).met, true);
  assert.equal(readTarget(target('net_burn', 50000, 'down'), { net_burn: 41000 }).met, true);
  // And the same number read both ways gives opposite answers, which is the
  // proof that the direction is doing the work rather than sitting unused.
  const value = { cac: 700 };
  assert.equal(readTarget(target('cac', 500, 'down'), value).met, false);
  assert.equal(readTarget(target('cac', 500, 'up'), value).met, true);
});

test('a metric the snapshot does not carry is not measured, and is not behind', () => {
  for (const latest of [null, undefined, {}, { mrr: null }, { mrr: '' }, { mrr: 'n/a' }, { arr: 5 }]) {
    const out = readTarget(target('mrr', 1000, 'up'), latest);
    assert.equal(out.met, null, `${JSON.stringify(latest)} produced a verdict rather than "not measured"`);
    assert.equal(out.actual, null);
  }
  // Zero IS measured — a churn of 0% against a target of 0% is met, and treating
  // it as "no reading" would hide the one month the plan was actually hit.
  const zero = readTarget(target('monthly_churn_pct', 0, 'down'), { monthly_churn_pct: 0 });
  assert.equal(zero.actual, 0);
  assert.equal(zero.met, true);
});

test('the target it read is the target it returns, unchanged', () => {
  // `readTarget` spreads the row so the table can print the label and the key it
  // was given. Dropping either would make a row the founder set unidentifiable.
  const row = { metric_key: 'arr', target_value: 90, direction: 'up', label: 'Board plan', id: 7 };
  const out = readTarget(row, { arr: 91 });
  for (const [k, v] of Object.entries(row)) assert.equal(out[k], v, `readTarget dropped ${k}`);
});

test('the Targets chip is live, and its count comes from the page', () => {
  const row = FOUNDER_ZONE_FILTERS['grow/focus'].find((r) => r.canvas === 'Targets');
  assert.ok(row, 'grow/focus no longer declares the Targets chip the artboard draws');
  assert.equal(row.key, 'targets', 'the chip is not live, so the store it now has is unreachable');
  assert.ok(!row.unbuilt, 'the chip still refuses, and `metric_targets` has both ends');
  const shown = (counts) => founderZoneFilters('grow/focus', { value: 'targets', counts })
    .find((i) => i.active);
  assert.equal(shown({ targets: 3 }).label, 'Targets 3');
  // No count and a zero count both read as the plain word rather than "Targets 0".
  assert.equal(shown({}).label, 'Targets');
  assert.equal(shown({ targets: 0 }).label, 'Targets');
  assert.ok(typeof shown({}).onSelect === 'function', 'a live chip must be selectable');
});

test('the Targets view exports no snapshot rows under a Targets heading', () => {
  // The export takes `selectedRows`, and the Targets view is a different table
  // — one row per plan number, not a slice of the snapshot log. Returning the
  // log's rows here would write a snapshot CSV while the reader is looking at
  // targets, under a filename naming the zone they are on.
  const src = codeOnly(readFileSync(resolve(process.cwd(), 'frontend/src/pages/founder/FounderGrowFocus.jsx'), 'utf8'));
  assert.match(src, /if \(view === 'targets'\) return \[\];/,
    'the Targets view falls through to the snapshot slice, so its export writes the wrong rows');
});

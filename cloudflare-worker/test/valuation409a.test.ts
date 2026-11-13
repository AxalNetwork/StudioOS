/**
 * Build queue #120 — 409A safe-harbour tests.
 *
 * The rule that matters: the presumption lasts 12 months OR until a
 * material event, whichever comes FIRST. A day-counting implementation
 * that ignores events would pass a naive test suite and mislead a
 * founder into granting options with no safe harbour behind them, so
 * the event cases are pinned hardest here.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/valuation409a.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  safeHarbourStatus,
  triggerChecklist,
  commonToPreferredRatio,
  SAFE_HARBOUR_DAYS,
  type Valuation409A,
  type MaterialEvent,
} from '../src/services/valuation409a.ts';

const VAL: Valuation409A = {
  valuation_date: '2026-01-15',
  fmv_per_share: 1.2,
  provider: 'Example Appraisal LLC',
  method: 'obm',
};

test('a fresh valuation is valid with days remaining', () => {
  const s = safeHarbourStatus(VAL, [], '2026-02-15');
  assert.equal(s.state, 'valid');
  assert.equal(s.expires_on, '2027-01-15');
  assert.ok(s.days_remaining! > 300);
  assert.equal(s.invalidated_by, null);
});

test('inside the final 60 days the state is expiring, not valid', () => {
  const s = safeHarbourStatus(VAL, [], '2026-12-01');
  assert.equal(s.state, 'expiring');
  assert.ok(s.days_remaining! > 0 && s.days_remaining! <= 60);
  assert.match(s.reason, /start it now/i);
});

test('after twelve months the presumption has lapsed', () => {
  const s = safeHarbourStatus(VAL, [], '2027-03-01');
  assert.equal(s.state, 'expired');
  assert.equal(s.days_remaining, 0, 'clamped at zero, never negative');
  assert.match(s.reason, /no safe harbour/i);
});

test('the window is exactly 365 days from the valuation date', () => {
  const dayBefore = safeHarbourStatus(VAL, [], '2027-01-14');
  assert.equal(dayBefore.state, 'expiring');
  assert.equal(dayBefore.days_remaining, 1);
  const onExpiry = safeHarbourStatus(VAL, [], '2027-01-15');
  assert.equal(onExpiry.state, 'expired');
  assert.equal(onExpiry.days_remaining, 0);
  assert.equal(SAFE_HARBOUR_DAYS, 365);
});

test('a material event ends the safe harbour early, whatever the calendar says', () => {
  // Only a month old — a day-counting implementation would call this valid.
  const events: MaterialEvent[] = [{ kind: 'priced_round', occurred_on: '2026-02-01' }];
  const s = safeHarbourStatus(VAL, events, '2026-02-15');
  assert.equal(s.state, 'invalidated', 'events outrank remaining days');
  assert.equal(s.invalidated_by?.kind, 'priced_round');
  assert.ok(s.days_remaining! > 300, 'days are still reported, they just no longer govern');
  assert.match(s.reason, /priced financing round/);
});

test('events BEFORE the valuation date are ignored — the appraiser priced them in', () => {
  const events: MaterialEvent[] = [{ kind: 'priced_round', occurred_on: '2025-11-01' }];
  const s = safeHarbourStatus(VAL, events, '2026-02-15');
  assert.equal(s.state, 'valid');
  assert.equal(s.invalidated_by, null);
});

test('a future-dated event does not retroactively invalidate today', () => {
  const events: MaterialEvent[] = [{ kind: 'material_change', occurred_on: '2026-06-01' }];
  const s = safeHarbourStatus(VAL, events, '2026-03-01');
  assert.equal(s.state, 'valid', 'the event has not happened yet as of the as-of date');
});

test('the earliest qualifying event is the one that breaks the harbour', () => {
  const events: MaterialEvent[] = [
    { kind: 'secondary_transaction', occurred_on: '2026-05-01' },
    { kind: 'priced_round', occurred_on: '2026-03-01' },
  ];
  const s = safeHarbourStatus(VAL, events, '2026-08-01');
  assert.equal(s.invalidated_by?.kind, 'priced_round');
  assert.equal(s.invalidated_by?.occurred_on, '2026-03-01');
});

test('no valuation is reported as none, not as expired', () => {
  const s = safeHarbourStatus(null, [], '2026-08-01');
  assert.equal(s.state, 'none');
  assert.equal(s.days_remaining, null, 'null, not 0 — there is nothing to count down');
  assert.equal(s.expires_on, null);
  assert.match(s.reason, /no safe harbour/i);
});

test('a malformed valuation date is treated as no valuation', () => {
  const s = safeHarbourStatus({ ...VAL, valuation_date: 'whenever' }, [], '2026-08-01');
  assert.equal(s.state, 'none');
});

// ---------- trigger checklist ----------

test('triggerChecklist reports every trigger, fired or not', () => {
  const rows = triggerChecklist(VAL, [{ kind: 'priced_round', occurred_on: '2026-03-01' }], '2026-08-01');
  assert.equal(rows.length, 5, 'the full checklist is always shown');
  const priced = rows.find(r => r.kind === 'priced_round')!;
  assert.equal(priced.fired, true);
  assert.equal(priced.occurred_on, '2026-03-01');
  const secondary = rows.find(r => r.kind === 'secondary_transaction')!;
  assert.equal(secondary.fired, false);
  assert.equal(secondary.occurred_on, null);
  assert.match(secondary.note, /Nothing recorded/);
});

test('triggerChecklist ignores events predating the valuation', () => {
  const rows = triggerChecklist(VAL, [{ kind: 'priced_round', occurred_on: '2025-06-01' }], '2026-08-01');
  assert.equal(rows.find(r => r.kind === 'priced_round')!.fired, false);
});

test('triggerChecklist reports the most recent firing of each kind', () => {
  const rows = triggerChecklist(VAL, [
    { kind: 'material_change', occurred_on: '2026-03-01' },
    { kind: 'material_change', occurred_on: '2026-06-01' },
  ], '2026-08-01');
  assert.equal(rows.find(r => r.kind === 'material_change')!.occurred_on, '2026-06-01');
});

// ---------- common:preferred sanity check ----------

test('commonToPreferredRatio flags the customary band', () => {
  assert.equal(commonToPreferredRatio(1.2, 4.0)!.flag, 'customary'); // 30%
  assert.equal(commonToPreferredRatio(0.2, 4.0)!.flag, 'low');       // 5%
  assert.equal(commonToPreferredRatio(3.0, 4.0)!.flag, 'high');      // 75%
});

test('commonToPreferredRatio returns null rather than a fake ratio', () => {
  assert.equal(commonToPreferredRatio(1.2, null), null);
  assert.equal(commonToPreferredRatio(null, 4.0), null);
  assert.equal(commonToPreferredRatio(1.2, 0), null, 'no divide-by-zero Infinity');
});

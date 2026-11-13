/**
 * Build queue #120 — post-money SAFE and note conversion tests.
 *
 * The defining property of a post-money SAFE is that the holder's
 * ownership is LOCKED at amount/cap regardless of what other SAFEs do.
 * That is the invariant these tests exist to protect: if a refactor
 * turns post-money into pre-money math, ownership starts drifting with
 * every other SAFE on the stack and a founder signs terms they did not
 * model.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/safeConversion.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  convertInstruments,
  accruedInterest,
  needsExtendedConversion,
  type ConvertibleIn,
} from '../src/services/safeConversion.ts';

const SHARES_PRE = 10_000_000;
const PPS = 2.0; // $20M pre / 10M shares

// ---------- pre-money (legacy parity) ----------

test('a pre-money SAFE prices off pre-conversion shares', () => {
  const r = convertInstruments(
    [{ name: 'Angel', amount: 1_000_000, cap: 5_000_000 }],
    SHARES_PRE, PPS,
  );
  // cap / sharesPre = 5M / 10M = $0.50 → 2,000,000 shares.
  assert.equal(r.holders[0].price_per_share, 0.5);
  assert.equal(r.holders[0].shares, 2_000_000);
  assert.equal(r.holders[0].binding, 'cap');
  assert.equal(r.holders[0].basis, 'pre_money');
});

test('a discount binds when it beats the cap', () => {
  const r = convertInstruments(
    [{ name: 'Angel', amount: 1_000_000, cap: 100_000_000, discount: 0.2 }],
    SHARES_PRE, PPS,
  );
  // cap price = 100M/10M = $10; discount price = 2.0 * 0.8 = $1.60.
  assert.equal(r.holders[0].price_per_share, 1.6);
  assert.equal(r.holders[0].binding, 'discount');
});

test('pre-money SAFEs dilute each other — ownership is NOT fixed', () => {
  const one = convertInstruments(
    [{ name: 'A', amount: 1_000_000, cap: 5_000_000 }], SHARES_PRE, PPS,
  );
  const two = convertInstruments(
    [
      { name: 'A', amount: 1_000_000, cap: 5_000_000 },
      { name: 'B', amount: 1_000_000, cap: 5_000_000 },
    ], SHARES_PRE, PPS,
  );
  // A gets the same SHARES either way (price depends only on sharesPre),
  // but its ownership falls once B converts. That is the pre-money bargain.
  assert.equal(one.holders[0].shares, two.holders[0].shares);
  const ownOne = one.holders[0].shares / one.shares_after_conversion;
  const ownTwo = two.holders[0].shares / two.shares_after_conversion;
  assert.ok(ownTwo < ownOne, 'a second pre-money SAFE dilutes the first');
});

// ---------- post-money: the ownership lock ----------

test('a post-money SAFE owns exactly amount/cap after conversion', () => {
  const r = convertInstruments(
    [{ name: 'Fund', amount: 2_000_000, cap: 20_000_000, basis: 'post_money' }],
    SHARES_PRE, PPS,
  );
  const ownership = r.holders[0].shares / r.shares_after_conversion;
  assert.ok(Math.abs(ownership - 0.10) < 1e-6, `expected 10%, got ${(ownership * 100).toFixed(4)}%`);
  assert.equal(r.post_money_fraction, 0.1);
});

test('post-money ownership is INVARIANT to other SAFEs on the stack', () => {
  const alone = convertInstruments(
    [{ name: 'Fund', amount: 2_000_000, cap: 20_000_000, basis: 'post_money' }],
    SHARES_PRE, PPS,
  );
  const crowded = convertInstruments(
    [
      { name: 'Fund', amount: 2_000_000, cap: 20_000_000, basis: 'post_money' },
      { name: 'Other', amount: 3_000_000, cap: 20_000_000, basis: 'post_money' },
      { name: 'Angel', amount: 500_000, cap: 8_000_000 }, // a pre-money SAFE too
    ],
    SHARES_PRE, PPS,
  );
  const own = (r: typeof alone, name: string) =>
    r.holders.find(h => h.name === name)!.shares / r.shares_after_conversion;
  assert.ok(
    Math.abs(own(alone, 'Fund') - own(crowded, 'Fund')) < 1e-6,
    'the whole point of post-money: 10% is 10% no matter who else converts',
  );
  assert.ok(Math.abs(own(crowded, 'Fund') - 0.10) < 1e-6);
  assert.ok(Math.abs(own(crowded, 'Other') - 0.15) < 1e-6, '3M/20M = 15%');
});

test('post-money SAFEs dilute the FOUNDERS, not each other', () => {
  const r = convertInstruments(
    [
      { name: 'A', amount: 2_000_000, cap: 20_000_000, basis: 'post_money' },
      { name: 'B', amount: 2_000_000, cap: 20_000_000, basis: 'post_money' },
    ],
    SHARES_PRE, PPS,
  );
  // 10% + 10% to SAFEs → founders keep 80% → T = 10M / 0.8 = 12.5M.
  assert.equal(r.shares_after_conversion, 12_500_000);
  const founderShare = SHARES_PRE / r.shares_after_conversion;
  assert.ok(Math.abs(founderShare - 0.8) < 1e-6);
});

test('a post-money SAFE takes its discount when that beats the cap', () => {
  const r = convertInstruments(
    [{ name: 'Fund', amount: 1_000_000, cap: 500_000_000, discount: 0.2, basis: 'post_money' }],
    SHARES_PRE, PPS,
  );
  assert.equal(r.holders[0].binding, 'discount');
  assert.equal(r.holders[0].price_per_share, 1.6);
  assert.equal(r.post_money_fraction, 0, 'discount-bound SAFEs claim no fixed ownership slice');
});

test('a mixed cap-bound and discount-bound post-money stack resolves', () => {
  const r = convertInstruments(
    [
      { name: 'Capped', amount: 2_000_000, cap: 20_000_000, basis: 'post_money' },
      { name: 'Discounted', amount: 1_000_000, cap: 900_000_000, discount: 0.25, basis: 'post_money' },
    ],
    SHARES_PRE, PPS,
  );
  const capped = r.holders.find(h => h.name === 'Capped')!;
  const disc = r.holders.find(h => h.name === 'Discounted')!;
  assert.equal(capped.binding, 'cap');
  assert.equal(disc.binding, 'discount');
  assert.equal(disc.price_per_share, 1.5, '2.0 × 0.75');
  // The capped holder still lands on exactly 10% of the final total.
  const ownership = capped.shares / r.shares_after_conversion;
  assert.ok(Math.abs(ownership - 0.10) < 1e-6, `expected 10%, got ${(ownership * 100).toFixed(4)}%`);
});

test('over-subscribed caps are flagged, never silently rescaled', () => {
  const r = convertInstruments(
    [
      { name: 'A', amount: 6_000_000, cap: 10_000_000, basis: 'post_money' },
      { name: 'B', amount: 6_000_000, cap: 10_000_000, basis: 'post_money' },
    ],
    SHARES_PRE, PPS,
  );
  assert.equal(r.over_subscribed, true, '60% + 60% cannot both be honoured');
  assert.ok(r.post_money_fraction >= 1);
  assert.ok(r.warnings.some(w => /cannot all be honoured/i.test(w)));
  assert.ok(Number.isFinite(r.shares_after_conversion), 'no Infinity or NaN escapes');
});

// ---------- convertible notes ----------

test('accruedInterest computes simple interest over the term', () => {
  // $1M at 8% for exactly one year.
  assert.equal(accruedInterest(1_000_000, 0.08, '2025-01-01', '2026-01-01'), 80_000);
});

test('accruedInterest returns zero rather than a negative or fabricated accrual', () => {
  assert.equal(accruedInterest(1_000_000, 0.08, '2026-01-01', '2025-01-01'), 0, 'backwards term');
  assert.equal(accruedInterest(1_000_000, 0.08, null, '2026-01-01'), 0, 'no issue date');
  assert.equal(accruedInterest(1_000_000, 0, '2025-01-01', '2026-01-01'), 0, 'no rate');
  assert.equal(accruedInterest(0, 0.08, '2025-01-01', '2026-01-01'), 0, 'no principal');
});

test('a note converts on principal PLUS accrued interest', () => {
  const notes: ConvertibleIn[] = [{
    name: 'Bridge', amount: 1_000_000, cap: 5_000_000,
    instrument: 'note', interest_rate: 0.08, issue_date: '2025-01-01',
  }];
  const r = convertInstruments(notes, SHARES_PRE, PPS, '2026-01-01');
  const h = r.holders[0];
  assert.equal(h.accrued_interest, 80_000);
  assert.equal(h.converting_amount, 1_080_000);
  // At the $0.50 cap price that is 2,160,000 shares, not 2,000,000.
  assert.equal(h.shares, 2_160_000);
  assert.equal(h.instrument, 'note');
});

test('a note with no conversion date accrues nothing rather than guessing', () => {
  const r = convertInstruments(
    [{ name: 'Bridge', amount: 1_000_000, cap: 5_000_000, instrument: 'note', interest_rate: 0.08, issue_date: '2025-01-01' }],
    SHARES_PRE, PPS,
  );
  assert.equal(r.holders[0].accrued_interest, 0);
  assert.equal(r.holders[0].shares, 2_000_000);
});

test('a post-money note holds its ownership target on the grossed-up amount', () => {
  const r = convertInstruments(
    [{
      name: 'Bridge', amount: 2_000_000, cap: 20_000_000, basis: 'post_money',
      instrument: 'note', interest_rate: 0.10, issue_date: '2025-01-01',
    }],
    SHARES_PRE, PPS, '2026-01-01',
  );
  const h = r.holders[0];
  assert.equal(h.accrued_interest, 200_000);
  // Ownership target uses the converting balance: 2.2M / 20M = 11%.
  const ownership = h.shares / r.shares_after_conversion;
  assert.ok(Math.abs(ownership - 0.11) < 1e-6, `expected 11%, got ${(ownership * 100).toFixed(4)}%`);
});

// ---------- guards ----------

test('an instrument with neither cap nor discount is skipped with a warning', () => {
  const r = convertInstruments([{ name: 'Vague', amount: 500_000 }], SHARES_PRE, PPS);
  assert.equal(r.holders.length, 0);
  assert.ok(r.warnings.some(w => /no cap and no discount/i.test(w)));
});

test('an empty stack returns the pre-conversion share count unchanged', () => {
  const r = convertInstruments([], SHARES_PRE, PPS);
  assert.equal(r.holders.length, 0);
  assert.equal(r.shares_after_conversion, SHARES_PRE);
  assert.equal(r.over_subscribed, false);
});

test('needsExtendedConversion gates the legacy path correctly', () => {
  assert.equal(needsExtendedConversion([{ name: 'A', amount: 1, cap: 1 }]), false,
    'plain pre-money SAFEs must keep using the legacy inline path');
  assert.equal(needsExtendedConversion([{ name: 'A', amount: 1, cap: 1, basis: 'pre_money' }]), false);
  assert.equal(needsExtendedConversion([{ name: 'A', amount: 1, cap: 1, basis: 'post_money' }]), true);
  assert.equal(needsExtendedConversion([{ name: 'A', amount: 1, cap: 1, instrument: 'note' }]), true);
  assert.equal(needsExtendedConversion([]), false);
  assert.equal(needsExtendedConversion(undefined), false);
});

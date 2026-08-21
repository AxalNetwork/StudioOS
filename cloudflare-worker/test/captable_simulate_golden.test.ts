/**
 * Golden test for the cap-table simulation engine (services/captable.ts).
 *
 * captable.ts declares a byte-identical-output contract with the FastAPI
 * port (`backend/app/services/captable.py`) so saved `result_json`
 * blobs and CSV exports stay stable — but until now NO test exercised
 * `simulate()` at all. The existing captable tests cover access control
 * and persistence, not the math.
 *
 * This file pins the legacy pre-money path with exact expected numbers.
 * It was added alongside build queue #120, which routes post-money
 * SAFEs and notes to services/safeConversion.ts: the guard that keeps
 * plain pre-money scenarios on the original inline code is only
 * trustworthy if something fails when it stops working.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/captable_simulate_golden.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulate, validateInputs, toCsv, type Inputs } from '../src/services/captable.ts';

/** Two founders, a 10% pool, one capped SAFE, one priced round. */
const LEGACY: Inputs = {
  founders: [
    { name: 'Ada', shares: 6_000_000 },
    { name: 'Grace', shares: 4_000_000 },
  ],
  option_pool_pct: 10,
  safes: [{ name: 'Angel', amount: 1_000_000, cap: 8_000_000, discount: 0.2 }],
  rounds: [{ name: 'Seed', pre_money: 12_000_000, investment: 3_000_000 }],
  exit_value: 50_000_000,
};

function ok(r: ReturnType<typeof simulate>) {
  assert.ok(!('errors' in r && r.errors), `simulate returned errors: ${JSON.stringify((r as any).errors)}`);
  return r as Exclude<typeof r, { errors: string[] }>;
}

test('founding cap table: pool is grossed up off founder shares', () => {
  const r = ok(simulate(LEGACY));
  const founding = r.founding!;
  // 10M founder shares, 10% target → 10M * 0.1 / 0.9 = 1,111,111.
  const pool = founding.find(h => h.type === 'option_pool')!;
  assert.equal(pool.shares, 1_111_111);
  const total = founding.reduce((s, h) => s + h.shares, 0);
  assert.equal(total, 11_111_111);
  assert.equal(founding.find(h => h.holder === 'Ada')!.pct, 54);
  assert.equal(pool.pct, 10);
});

test('pre-money SAFE converts at cap / shares_pre, not at the round price', () => {
  const r = ok(simulate(LEGACY));
  const seed = r.rounds[0];
  // sharesPre = 11,111,111. cap price = 8M / 11,111,111 = $0.72.
  // discount price = (12M / 11,111,111) * 0.8 = $0.864. Cap binds.
  const angel = seed.ledger.find(h => h.holder === 'Angel')!;
  assert.equal(angel.shares, 1_388_889);
  assert.equal(angel.type, 'safe');
  assert.ok(seed.events.some(e => /binding: cap/.test(e)), 'the cap must bind, not the discount');
});

test('round price, share counts and post-money are pinned', () => {
  const r = ok(simulate(LEGACY));
  const seed = r.rounds[0];
  assert.equal(seed.shares_pre, 11_111_111);
  assert.equal(seed.price_per_share, 1.08);
  assert.equal(seed.post_money, 15_000_000);
  // 3M at $1.08 = 2,777,778 shares.
  const investors = seed.ledger.find(h => h.holder === 'Seed Investors')!;
  assert.equal(investors.shares, 2_777_778);
  assert.equal(investors.type, 'preferred');
  assert.equal(seed.shares_post, 11_111_111 + 1_388_889 + 2_777_778);
});

test('ownership percentages sum to 100 after the round', () => {
  const r = ok(simulate(LEGACY));
  const total = r.rounds[0].ledger.reduce((s, h) => s + (h.pct || 0), 0);
  assert.ok(Math.abs(total - 100) < 0.01, `expected ~100, got ${total}`);
});

test('founder dilution series tracks every founder through every round', () => {
  const r = ok(simulate(LEGACY));
  assert.equal(r.founder_dilution.length, 2);
  const ada = r.founder_dilution.find(f => f.founder === 'Ada')!;
  assert.equal(ada.series[0].round, 'Founding');
  assert.equal(ada.series[0].pct, 54);
  const afterSeed = ada.series[ada.series.length - 1];
  assert.ok(afterSeed.pct < 54, 'the round must dilute the founders');
  assert.equal(afterSeed.shares, 6_000_000, 'dilution changes pct, never founder share count');
});

test('waterfall pays 1x non-participating preferences before common', () => {
  const r = ok(simulate(LEGACY));
  const w = r.waterfall!;
  assert.equal(w.exit_value, 50_000_000);
  const paid = w.totals.total_distributed;
  assert.ok(Math.abs(paid - 50_000_000) < 1, `the exit must distribute fully, got ${paid}`);
  // At a $50M exit everyone is better off converting, so no preference
  // cash is taken — this pins the non-participating comparison.
  assert.equal(w.totals.preference_paid, 0);
});

test('a low exit pays preferences instead of converting', () => {
  const r = ok(simulate({ ...LEGACY, exit_value: 3_000_000 }));
  const w = r.waterfall!;
  assert.ok(w.totals.preference_paid > 0, 'below the conversion threshold, preferences bind');
  assert.ok(w.totals.total_distributed <= 3_000_001);
});

test('totals and CSV export stay in the documented shape', () => {
  const r = ok(simulate(LEGACY));
  assert.equal(r.totals.rounds_completed, 1);
  assert.equal(r.totals.shares_outstanding, 15_277_778);
  const csv = toCsv(r);
  assert.match(csv.split('\n')[0], /not a 409A valuation/, 'the disclaimer header is part of the contract');
  assert.match(csv, /Angel/);
  assert.match(csv, /Seed Investors/);
});

test('validateInputs rejects the documented bad inputs', () => {
  assert.ok(validateInputs({ founders: [] }).some(e => /at least one founder/i.test(e)));
  assert.ok(validateInputs({
    founders: [{ name: 'A', shares: 1 }], option_pool_pct: 90,
  }).some(e => /option pool/i.test(e)));
  assert.ok(validateInputs({
    founders: [{ name: 'A', shares: 1 }],
    safes: [{ name: 'S', amount: 100 }],
  }).some(e => /cap or a discount/i.test(e)));
  assert.equal(validateInputs(LEGACY).length, 0, 'the golden scenario itself must be valid');
});

test('a plain pre-money scenario does NOT take the extended path', () => {
  // The extended path labels its events with the basis; the legacy path
  // never does. This is the guard that protects the byte-identical
  // contract, so assert on it directly.
  const r = ok(simulate(LEGACY));
  const evts = r.rounds[0].events.join('\n');
  assert.ok(/SAFE 'Angel' converted: /.test(evts));
  assert.ok(!/pre-money\)/.test(evts), 'legacy events carry no basis label');
});

test('adding a post-money SAFE switches to the extended path', () => {
  const r = ok(simulate({
    ...LEGACY,
    safes: [{ name: 'Fund', amount: 2_000_000, cap: 20_000_000, basis: 'post_money' }],
  }));
  const seed = r.rounds[0];
  assert.ok(seed.events.some(e => /post-money\)/.test(e)), 'extended events label the basis');
  // The post-money holder owns amount/cap of the post-conversion table.
  const fund = seed.ledger.find(h => h.holder === 'Fund')!;
  const postConversion = seed.shares_pre + fund.shares;
  assert.ok(Math.abs(fund.shares / postConversion - 0.10) < 1e-4,
    `expected 10% of the post-conversion table, got ${(fund.shares / postConversion * 100).toFixed(4)}%`);
});

test('a note carries its accrued interest into the liquidation preference', () => {
  const r = ok(simulate({
    ...LEGACY,
    safes: [{
      name: 'Bridge', amount: 1_000_000, cap: 8_000_000,
      instrument: 'note', interest_rate: 0.08, issue_date: '2025-01-01',
    }],
    rounds: [{ name: 'Seed', pre_money: 12_000_000, investment: 3_000_000, conversion_date: '2026-01-01' }],
  }));
  const prefs = r.rounds[0].round_meta.safe_preferences;
  assert.equal(prefs.Bridge, 1_080_000, 'preference follows the money in, interest included');
});

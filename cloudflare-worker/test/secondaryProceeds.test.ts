/**
 * Build queue #123 — secondary proceeds + ROFR tests.
 *
 * Two properties carry real money and real contractual risk:
 *   1. carry is charged on the GAIN, never on gross — charging on gross
 *      takes a cut of the seller's own returned capital;
 *   2. `clear_to_transfer` defaults to FALSE while a ROFR notice is
 *      live — defaulting the other way would let the UI green-light a
 *      sale that breaches the shareholders' agreement.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/secondaryProceeds.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeNetProceeds, rofrStatus } from '../src/services/secondaryProceeds.ts';

// ---------- proceeds ----------

test('a clean sale with no fees nets the gross', () => {
  const r = computeNetProceeds({ gross: 100_000 });
  assert.equal(r.net, 100_000);
  assert.equal(r.lines.length, 1);
  assert.equal(r.net_ratio, 1);
});

test('the waterfall applies transfer fee, flat fees, then carry on the gain', () => {
  const r = computeNetProceeds({
    gross: 100_000, costBasis: 40_000,
    transferFeePct: 0.02, flatFees: 1_500, carryPct: 0.20,
  });
  // 100,000 − 2,000 − 1,500 − (20% of the 60,000 gain = 12,000) = 84,500.
  assert.equal(r.gain, 60_000);
  assert.equal(r.net, 84_500);
  assert.deepEqual(r.lines.map(l => l.key), ['gross', 'transfer_fee', 'flat_fees', 'carry']);
  assert.equal(r.multiple, 2.1125, 'net over original basis');
});

test('carry is charged on the GAIN, never on gross', () => {
  const r = computeNetProceeds({ gross: 100_000, costBasis: 90_000, carryPct: 0.20 });
  // 20% of the 10,000 gain = 2,000. Charging on gross would be 20,000.
  const carry = r.lines.find(l => l.key === 'carry')!;
  assert.equal(carry.amount, -2_000);
  assert.equal(r.net, 98_000);
});

test('no carry is charged on a loss', () => {
  const r = computeNetProceeds({ gross: 50_000, costBasis: 80_000, carryPct: 0.20 });
  assert.equal(r.gain, -30_000);
  assert.equal(r.lines.find(l => l.key === 'carry'), undefined);
  assert.equal(r.net, 50_000);
});

test('carry is SKIPPED and explained when no cost basis is on file', () => {
  const r = computeNetProceeds({ gross: 100_000, carryPct: 0.20 });
  assert.equal(r.lines.find(l => l.key === 'carry'), undefined, 'never fall back to carry on gross');
  assert.ok(r.warnings.some(w => /no cost basis/i.test(w)));
  assert.equal(r.gain, null);
  assert.equal(r.multiple, null);
});

test('a percentage passed as a whole number is rejected, not applied as 2000%', () => {
  const r = computeNetProceeds({ gross: 100_000, transferFeePct: 2 });
  assert.equal(r.net, 100_000, 'a 2 must not be read as 200%');
  assert.ok(r.warnings.some(w => /whole number/i.test(w)));
});

test('deductions never drive proceeds negative', () => {
  const r = computeNetProceeds({ gross: 10_000, flatFees: 25_000 });
  assert.equal(r.net, 0, 'a wire cannot be negative');
  assert.ok(r.warnings.some(w => /exceeded the remaining balance/i.test(w)));
});

test('withholding applies to the gain and is labelled as withholding', () => {
  const r = computeNetProceeds({ gross: 100_000, costBasis: 50_000, withholdingPct: 0.15 });
  const w = r.lines.find(l => l.key === 'withholding')!;
  assert.equal(w.amount, -7_500, '15% of the 50,000 gain');
  assert.match(w.note!, /not a final tax figure/i);
});

test('every line reports a running balance the seller can follow', () => {
  const r = computeNetProceeds({ gross: 100_000, costBasis: 40_000, transferFeePct: 0.02, carryPct: 0.20 });
  let running = 0;
  for (const l of r.lines) {
    running = l.key === 'gross' ? l.amount : running + l.amount;
    assert.equal(l.balance, Math.round(running * 100) / 100, `balance drifts at ${l.key}`);
  }
  assert.equal(r.net, r.lines[r.lines.length - 1].balance);
});

test('computeNetProceeds is safe on a zero or malformed gross', () => {
  assert.equal(computeNetProceeds({ gross: 0 }).net, 0);
  assert.equal(computeNetProceeds({ gross: 0 }).net_ratio, null, 'no divide-by-zero ratio');
  assert.equal(computeNetProceeds({ gross: NaN as unknown as number }).net, 0);
});

// ---------- ROFR ----------

const TODAY = '2026-08-21';

test('no notice served means the seller is NOT clear to transfer', () => {
  const s = rofrStatus({ shares_offered: 10_000 }, TODAY);
  assert.equal(s.state, 'not_started');
  assert.equal(s.clear_to_transfer, false, 'the default must never green-light a sale');
  assert.equal(s.transferable_shares, 0);
});

test('a live notice blocks transfer until the window closes', () => {
  const s = rofrStatus({ notice_date: '2026-08-15', window_days: 30, shares_offered: 10_000 }, TODAY);
  assert.equal(s.state, 'notice_served');
  assert.equal(s.clear_to_transfer, false);
  assert.equal(s.deadline, '2026-09-14');
  assert.equal(s.days_remaining, 24);
  assert.match(s.summary, /No transfer may complete before then/);
});

test('an expired window with no election frees the whole block', () => {
  const s = rofrStatus({ notice_date: '2026-06-01', window_days: 30, shares_offered: 10_000 }, TODAY);
  assert.equal(s.state, 'expired');
  assert.equal(s.clear_to_transfer, true);
  assert.equal(s.transferable_shares, 10_000);
  assert.equal(s.days_remaining, 0);
});

test('a written waiver frees the block immediately', () => {
  const s = rofrStatus({ shares_offered: 10_000, waived: true }, TODAY);
  assert.equal(s.state, 'waived');
  assert.equal(s.clear_to_transfer, true);
  assert.equal(s.transferable_shares, 10_000);
});

test('full exercise leaves nothing for the outside buyer', () => {
  const s = rofrStatus({
    notice_date: '2026-08-01', window_days: 30, shares_offered: 10_000, company_elected: 10_000,
  }, TODAY);
  assert.equal(s.state, 'company_exercised');
  assert.equal(s.transferable_shares, 0);
  assert.equal(s.clear_to_transfer, false);
});

test('investors exercising in full is distinguished from the company doing so', () => {
  const s = rofrStatus({
    notice_date: '2026-08-01', window_days: 30, shares_offered: 10_000, investors_elected: 10_000,
  }, TODAY);
  assert.equal(s.state, 'investors_exercised');
});

test('partial exercise releases only the unclaimed remainder', () => {
  const s = rofrStatus({
    notice_date: '2026-08-01', window_days: 30, shares_offered: 10_000,
    company_elected: 3_000, investors_elected: 2_000,
  }, TODAY);
  assert.equal(s.state, 'partially_exercised');
  assert.equal(s.claimed_shares, 5_000);
  assert.equal(s.transferable_shares, 5_000);
  assert.equal(s.clear_to_transfer, false, 'still inside the window');
});

test('partial exercise clears to transfer once the window has closed', () => {
  const s = rofrStatus({
    notice_date: '2026-06-01', window_days: 30, shares_offered: 10_000, company_elected: 4_000,
  }, TODAY);
  assert.equal(s.transferable_shares, 6_000);
  assert.equal(s.clear_to_transfer, true);
});

test('over-election is clamped to the shares actually offered', () => {
  const s = rofrStatus({
    notice_date: '2026-08-01', window_days: 30, shares_offered: 10_000,
    company_elected: 8_000, investors_elected: 8_000,
  }, TODAY);
  assert.equal(s.claimed_shares, 10_000, 'cannot claim more than was offered');
  assert.equal(s.transferable_shares, 0);
});

test('a malformed notice date is treated as no notice, not as expired', () => {
  const s = rofrStatus({ notice_date: 'whenever', shares_offered: 10_000 }, TODAY);
  assert.equal(s.state, 'not_started');
  assert.equal(s.clear_to_transfer, false);
});

/**
 * D709 (#1774) — the management-fee calculator, exact to the cent at 200 bps.
 * Every figure is synthetic. The calculator is pure, so no database is built.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fund_fee_calc_d709.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateOffset, catchUp, computePeriod, lineFee, quarterWindow, roundHalfEven, segmentsOf, FEE_CALC_SENTENCES,
  type FeeTerms, type FeeLpInput, type PeriodInputs,
} from '../src/services/fundFeeCalc.ts';
import { feeForPeriod } from '../src/services/fundLedger.ts';

const terms = (over: Partial<FeeTerms> = {}): FeeTerms => ({
  id: 1, annual_bps: 200, basis_after: 'net_invested', offset_bps: 10000,
  fee_start_date: '2026-11-16', investment_period_end: '2031-11-15', effective_from: '2026-11-16', ...over,
});
const lp = (id: number, dollars: number, admitted: string | null = '2026-11-16', prior = false): FeeLpInput =>
  ({ id, commitment_amount: dollars, status: 'committed', admitted_on: admitted, admission_id: id * 10, has_prior_line: prior });
const period = (over: Partial<PeriodInputs>): PeriodInputs => ({
  quarter: '2027Q1', today: '2027-03-31', terms: [terms()], lps: [], netInvested: [], offsets: [], previous: null, ...over,
});
const fee = (cents: number, days: number) => {
  const r = lineFee({ bps: 200, commitmentCents: cents, segments: { committedDays: days, investedDays: 0 }, basisAfter: 'net_invested' });
  assert.ok(typeof r !== 'string', String(r));
  return r.feeCents;
};

test('1: a full quarter, $1,000,000 for 2026Q4 (92 days), is 504,110 cents', () => {
  const w = quarterWindow('2026Q4', '2026-10-01')!;
  assert.deepEqual(w, { start: '2026-10-01', end: '2026-12-31', days: 92 });
  assert.equal(fee(100_000_000, w.days), 504_110);
  const r = computePeriod(period({ quarter: '2026Q4', today: '2026-10-01', terms: [terms({ fee_start_date: '2026-10-01', effective_from: '2026-10-01' })], lps: [lp(1, 1_000_000, '2026-10-01')] }));
  assert.deepEqual(r.refusals, []);
  assert.equal(r.lines[0].gross_fee_cents, 504_110);
});

test('2: the first partial quarter from a 2026-11-16 fee start, $500,000 over 46 days, is 126,027', () => {
  assert.deepEqual(quarterWindow('2026Q4', '2026-11-16'), { start: '2026-11-16', end: '2026-12-31', days: 46 });
  const r = computePeriod(period({ quarter: '2026Q4', today: '2026-11-16', lps: [lp(1, 500_000)] }));
  assert.deepEqual(r.lines.map(l => [l.committed_days, l.gross_fee_cents, l.catch_up_cents]), [[46, 126_027, 0]]);
  assert.equal(quarterWindow('2026Q3', '2026-11-16'), null, 'a quarter before the fee start bills nothing');
});

test('3: catch-up for an LP admitted 2027-02-10, first billed in 2027Q2: 136 days, 186,301; the quarter 124,658', () => {
  const c = catchUp({ terms: [terms()], feeStart: '2026-11-16', windowStart: '2027-04-01', commitmentCents: 25_000_000 });
  assert.deepEqual(c, { days: 136, cents: 186_301 });
  const r = computePeriod(period({ quarter: '2027Q2', today: '2027-03-25', lps: [lp(1, 250_000, '2027-02-10'), lp(2, 1_000_000, '2026-11-16', true)] }));
  assert.deepEqual(r.refusals, []);
  const late = r.lines.find(l => l.limited_partner_id === 1)!;
  assert.deepEqual([late.committed_days, late.gross_fee_cents, late.catch_up_days, late.catch_up_cents, late.net_fee_cents], [91, 124_658, 136, 186_301, 310_959]);
  assert.equal(r.lines.find(l => l.limited_partner_id === 2)!.catch_up_cents, 0, 'an LP billed before owes no catch-up');
  // Billable means admitted on or before the earlier of the quarter's last day and today.
  const early = computePeriod(period({ quarter: '2027Q1', today: '2027-01-05', lps: [lp(1, 250_000, '2027-02-10'), lp(2, 1_000_000)] }));
  assert.deepEqual(early.lines.map(l => l.limited_partner_id), [2]);
});

test('4: a rounding tie rounds half to even, where D628 rounds half up', () => {
  const w = quarterWindow('2026Q4', '2026-10-20')!;
  assert.equal(w.days, 73);
  assert.equal(fee(100_000_125, 73), 400_000);
  assert.equal(feeForPeriod(100_000_125, 200, '2026-10-20', '2026-12-31'), 400_001, 'D628 keeps half up');
  assert.equal(fee(100_000_375, 73), 400_002);
  assert.equal(feeForPeriod(100_000_375, 200, '2026-10-20', '2026-12-31'), 400_002);
  assert.equal(roundHalfEven(5n, 2n), 2n);
  assert.equal(roundHalfEven(7n, 2n), 4n);
  assert.equal(roundHalfEven(11n, 4n), 3n);
});

test('5: a quarter across the investment-period end is 46 committed plus 46 invested days, rounded once: 403,288', () => {
  assert.deepEqual(segmentsOf('2031-10-01', '2031-12-31', '2031-11-15'), { committedDays: 46, investedDays: 46 });
  const lps = [lp(1, 1_000_000, '2026-11-16', true), lp(2, 9_000_000, '2026-11-16', true)];
  const r = computePeriod(period({ quarter: '2031Q4', today: '2031-10-01', lps,
    netInvested: [{ id: 7, as_of: '2031-11-16', net_invested_cents: 600_000_000 }, { id: 8, as_of: '2031-12-01', net_invested_cents: 1 }] }));
  assert.deepEqual(r.refusals, []);
  const ten = r.lines.find(l => l.limited_partner_id === 1)!;
  assert.deepEqual([ten.committed_days, ten.invested_days, ten.invested_share_cents, ten.gross_fee_cents], [46, 46, 60_000_000, 403_288]);
  assert.equal(r.net_invested_id, 7, 'the latest record on or before the segment\'s first day');
  // Rounded once: $1,001.11 alone, with $500.55 net invested. Each segment rounded apart is 252 + 126; the one sum is 379.
  const once = computePeriod(period({ quarter: '2031Q4', today: '2031-10-01', lps: [lp(1, 1001.11, '2026-11-16', true)],
    netInvested: [{ id: 9, as_of: '2031-11-01', net_invested_cents: 50_055 }] }));
  assert.equal(once.lines[0].gross_fee_cents, 379);
  const missing = computePeriod(period({ quarter: '2031Q4', today: '2031-10-01', lps }));
  assert.deepEqual(missing.refusals, [FEE_CALC_SENTENCES.noNetInvested]);
  assert.deepEqual(missing.lines, []);
  const committed = computePeriod(period({ quarter: '2031Q4', today: '2031-10-01', lps, terms: [terms({ basis_after: 'committed' })] }));
  assert.equal(committed.lines.find(l => l.limited_partner_id === 1)!.gross_fee_cents, fee(100_000_000, 92), 'after it, on commitments when the terms say so');
});

test('6: a $10,000 offset at 100% nets two LPs to 0 in 2027Q1 and carries 260,274 into 2027Q2', () => {
  const lps = [lp(1, 1_000_000), lp(2, 500_000)];
  const q1 = computePeriod(period({ quarter: '2027Q1', today: '2027-01-01', lps: lps.map(l => ({ ...l, has_prior_line: true })),
    offsets: [{ id: 3, amount_cents: 1_000_000, received_on: '2026-12-05' }], previous: { id: 9, carried_cents: 0 } }));
  assert.deepEqual(q1.refusals, []);
  assert.deepEqual(q1.lines.map(l => [l.gross_fee_cents, l.offset_cents, l.net_fee_cents]), [[493_151, 493_151, 0], [246_575, 246_575, 0]]);
  assert.deepEqual([q1.totals.offset_pool_cents, q1.totals.applied_cents, q1.totals.carried_cents, q1.totals.net_cents], [1_000_000, 739_726, 260_274, 0]);
  assert.deepEqual(q1.inputs.offset_ids, [3]);
  const q2 = computePeriod(period({ quarter: '2027Q2', today: '2027-04-01', lps: lps.map(l => ({ ...l, has_prior_line: true })),
    offsets: [], previous: { id: 10, carried_cents: q1.totals.carried_cents } }));
  assert.deepEqual(q2.lines.map(l => [l.gross_fee_cents, l.offset_cents, l.net_fee_cents]), [[498_630, 173_516, 325_114], [249_315, 86_758, 162_557]]);
  assert.equal(q2.totals.carried_cents, 0);
  // An offset counts only in a window that starts after it was received.
  const same = computePeriod(period({ quarter: '2027Q1', today: '2027-01-01', lps, offsets: [{ id: 4, amount_cents: 100, received_on: '2027-01-01' }] }));
  assert.deepEqual(same.inputs.offset_ids, []);
  assert.equal(same.totals.offset_pool_cents, 0);
  const half = computePeriod(period({ quarter: '2027Q1', today: '2027-01-01', lps, terms: [terms({ offset_bps: 5000 })], offsets: [{ id: 5, amount_cents: 3, received_on: '2026-12-05' }] }));
  assert.equal(half.totals.offset_pool_cents, 2, '3 × 50% is 1.5, rounded half to even');
});

test('refusals: a catch-up across the investment-period end or a terms change, a missing admission, an unsafe amount', () => {
  const acrossEnd = catchUp({ terms: [terms({ investment_period_end: '2027-01-15' })], feeStart: '2026-11-16', windowStart: '2027-04-01', commitmentCents: 100 });
  assert.equal(acrossEnd, FEE_CALC_SENTENCES.catchUpAcrossEnd);
  const acrossTerms = catchUp({ terms: [terms(), terms({ id: 2, annual_bps: 150, effective_from: '2027-01-01' })], feeStart: '2026-11-16', windowStart: '2027-04-01', commitmentCents: 100 });
  assert.equal(acrossTerms, FEE_CALC_SENTENCES.catchUpAcrossTerms);
  const viaPeriod = computePeriod(period({ quarter: '2027Q2', today: '2027-04-01', terms: [terms(), terms({ id: 2, effective_from: '2027-01-01' })], lps: [lp(1, 1000, '2027-02-01')] }));
  assert.deepEqual(viaPeriod.refusals, [FEE_CALC_SENTENCES.catchUpAcrossTerms]);
  const noDate = computePeriod(period({ lps: [lp(1, 1000, null), lp(2, 1000)] }));
  assert.deepEqual(noDate.refusals, [FEE_CALC_SENTENCES.noAdmission]);
  assert.deepEqual(noDate.lines, [], 'a refusal leaves no lines');
  const huge = computePeriod(period({ lps: [lp(1, 9e17, '2026-11-16', true)] }));
  assert.deepEqual(huge.refusals, [FEE_CALC_SENTENCES.unsafe]);
  assert.deepEqual(computePeriod(period({ terms: [] })).refusals, [FEE_CALC_SENTENCES.noTerms]);
  assert.deepEqual(computePeriod(period({ quarter: '2026Q5' })).refusals, [FEE_CALC_SENTENCES.badQuarter]);
  assert.deepEqual(computePeriod(period({ quarter: '2026Q3' })).refusals, [FEE_CALC_SENTENCES.beforeStart]);
  // A withdrawn LP, or one with no commitment, is not billed and blocks nothing.
  const skipped = computePeriod(period({ lps: [{ ...lp(1, 1000, null), status: 'withdrawn' }, lp(2, 0, null), lp(3, 1000, '2026-11-16', true)] }));
  assert.deepEqual([skipped.refusals, skipped.lines.map(l => l.limited_partner_id)], [[], [3]]);
  // A quarter is billed under the version in force on its window's first day.
  const changed = computePeriod(period({ quarter: '2027Q2', today: '2027-04-01', terms: [terms(), terms({ id: 2, annual_bps: 100, effective_from: '2027-04-01' })], lps: [lp(1, 1_000_000, '2026-11-16', true)] }));
  assert.deepEqual([changed.terms_id, changed.lines[0].gross_fee_cents], [2, 249_315]);
  const later = computePeriod(period({ quarter: '2027Q2', today: '2027-04-01', terms: [terms(), terms({ id: 2, annual_bps: 100, effective_from: '2027-04-01' }), terms({ id: 3, annual_bps: 50, effective_from: '2027-07-01' })], lps: [lp(1, 1_000_000, '2026-11-16', true)] }));
  assert.equal(later.terms_id, 2, 'a version that takes effect after the window does not bill it');
});

test('allocation sums to the amount applied, the residual to the largest line, lowest id on a tie', () => {
  assert.deepEqual([...allocateOffset(2, [{ id: 1, base: 1 }, { id: 2, base: 1 }, { id: 3, base: 1 }])], [[1, 1], [2, 1], [3, 0]]);
  assert.deepEqual([...allocateOffset(10, [{ id: 5, base: 3 }, { id: 2, base: 7 }])], [[5, 3], [2, 7]]);
  const big = allocateOffset(101, [{ id: 1, base: 100 }, { id: 2, base: 200 }, { id: 3, base: 50 }]);
  assert.equal([...big.values()].reduce((a, b) => a + b, 0), 101);
  assert.deepEqual([...big], [[1, 28], [2, 59], [3, 14]], 'floors 28, 57 and 14; the two-cent residual goes to the largest line');
  // A residual the largest line has no room for goes to the next line in that order.
  assert.deepEqual([...allocateOffset(5, [{ id: 1, base: 2 }, { id: 2, base: 2 }, { id: 3, base: 1 }])], [[1, 2], [2, 2], [3, 1]]);
  assert.deepEqual([...allocateOffset(3, [{ id: 1, base: 1 }, { id: 2, base: 3 }, { id: 3, base: 1 }])], [[1, 0], [2, 3], [3, 0]]);
  assert.deepEqual([...allocateOffset(0, [{ id: 1, base: 5 }])], [[1, 0]]);
  assert.throws(() => allocateOffset(6, [{ id: 1, base: 5 }]));
});

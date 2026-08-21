/**
 * Build queue #125 — portfolio performance engine tests.
 *
 * Pins DPI/RVPI/TVPI/MOIC and the XIRR solver against worked examples so
 * a refactor can't silently change what LPs are shown. Pure functions —
 * no D1, no auth, no clock (every case passes its own as-of date).
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/portfolioMetrics.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  xirr,
  computeFundMetrics,
  rollUpPosition,
  currentPeriod,
  daysSince,
  type CashFlow,
} from '../src/services/portfolioMetrics.ts';

// ---------- XIRR ----------

test('xirr solves a simple one-year double', () => {
  // 1000 out, 2000 back exactly one year later → 100%.
  const r = xirr([
    { date: '2024-01-01', amount: -1000 },
    { date: '2025-01-01', amount: 2000 },
  ]);
  assert.ok(r !== null);
  assert.ok(Math.abs(r! - 1.0) < 0.005, `expected ~1.0, got ${r}`);
});

test('xirr solves a flat return as zero', () => {
  const r = xirr([
    { date: '2024-01-01', amount: -1000 },
    { date: '2026-01-01', amount: 1000 },
  ]);
  assert.ok(r !== null);
  assert.ok(Math.abs(r!) < 0.001, `expected ~0, got ${r}`);
});

test('xirr handles a loss', () => {
  // Half the money back after a year → -50%.
  const r = xirr([
    { date: '2024-01-01', amount: -1000 },
    { date: '2025-01-01', amount: 500 },
  ]);
  assert.ok(r !== null);
  assert.ok(Math.abs(r! - -0.5) < 0.005, `expected ~-0.5, got ${r}`);
});

test('xirr handles irregular multi-flow schedules', () => {
  // Two calls, one distribution, one terminal value. Verified by
  // checking the NPV at the returned rate is ~0.
  const flows = [
    { date: '2024-01-01', amount: -500 },
    { date: '2024-07-01', amount: -500 },
    { date: '2025-06-01', amount: 300 },
    { date: '2026-01-01', amount: 1400 },
  ];
  const r = xirr(flows);
  assert.ok(r !== null);
  const t0 = Date.parse(flows[0].date);
  const npv = flows.reduce((acc, f) => {
    const years = (Date.parse(f.date) - t0) / 86400000 / 365;
    return acc + f.amount / Math.pow(1 + r!, years);
  }, 0);
  assert.ok(Math.abs(npv) < 0.01, `NPV at solved rate should be ~0, got ${npv}`);
});

test('xirr returns null rather than inventing a rate', () => {
  assert.equal(xirr([]), null, 'empty series');
  assert.equal(xirr([{ date: '2024-01-01', amount: -1000 }]), null, 'single flow');
  assert.equal(xirr([
    { date: '2024-01-01', amount: -1000 },
    { date: '2025-01-01', amount: -500 },
  ]), null, 'all outflows — no sign change');
  assert.equal(xirr([
    { date: 'not-a-date', amount: -1000 },
    { date: 'also-bad', amount: 2000 },
  ]), null, 'unparseable dates');
});

// ---------- fund metrics ----------

const FLOWS: CashFlow[] = [
  { date: '2024-01-15', amount: 1000000, kind: 'contribution' },
  { date: '2024-09-01', amount: 500000, kind: 'contribution' },
  { date: '2025-11-01', amount: 300000, kind: 'distribution' },
];

test('computeFundMetrics derives the ILPA ratios', () => {
  const m = computeFundMetrics(FLOWS, 2700000, '2026-01-01');
  assert.equal(m.paid_in, 1500000);
  assert.equal(m.distributed, 300000);
  assert.equal(m.nav, 2700000);
  assert.equal(m.total_value, 3000000);
  assert.equal(m.dpi, 0.2);      // 300k / 1.5M
  assert.equal(m.rvpi, 1.8);     // 2.7M / 1.5M
  assert.equal(m.tvpi, 2);       // 3.0M / 1.5M
  assert.equal(m.moic, 2);
  assert.equal(m.basis, 'gross');
  assert.equal(m.flow_count, 3);
  assert.equal(m.first_flow_date, '2024-01-15');
  assert.equal(m.as_of, '2026-01-01');
  assert.ok(m.irr !== null && m.irr > 0, 'a 2× book should return a positive IRR');
});

test('TVPI always equals DPI + RVPI', () => {
  const m = computeFundMetrics(FLOWS, 2700000, '2026-01-01');
  assert.ok(Math.abs((m.dpi! + m.rvpi!) - m.tvpi!) < 1e-9);
});

test('computeFundMetrics is null-safe before any capital is deployed', () => {
  const m = computeFundMetrics([], 0, '2026-01-01');
  assert.equal(m.paid_in, 0);
  assert.equal(m.dpi, null, 'ratios are null, never 0/0 → NaN or a fake zero');
  assert.equal(m.rvpi, null);
  assert.equal(m.tvpi, null);
  assert.equal(m.irr, null);
  assert.equal(m.flow_count, 0);
  assert.equal(m.first_flow_date, null);
});

test('computeFundMetrics reports a total write-off honestly', () => {
  const m = computeFundMetrics(
    [{ date: '2024-01-01', amount: 1000000, kind: 'contribution' }],
    0,
    '2026-01-01',
  );
  assert.equal(m.tvpi, 0, 'no value left → TVPI 0, not null');
  assert.equal(m.dpi, 0);
  assert.equal(m.nav, 0);
  assert.equal(m.irr, null, 'no inflow at all → no solvable rate');
});

test('computeFundMetrics ignores malformed and non-positive flows', () => {
  const m = computeFundMetrics([
    ...FLOWS,
    { date: 'garbage', amount: 999999, kind: 'contribution' },
    { date: '2025-01-01', amount: 0, kind: 'contribution' },
    { date: '2025-01-01', amount: -50, kind: 'distribution' },
  ], 2700000, '2026-01-01');
  assert.equal(m.flow_count, 3, 'only the three valid flows count');
  assert.equal(m.paid_in, 1500000);
});

test('computeFundMetrics is deterministic — it never reads the clock', () => {
  const a = computeFundMetrics(FLOWS, 2700000, '2026-01-01');
  const b = computeFundMetrics(FLOWS, 2700000, '2026-01-01');
  assert.deepEqual(a, b);
  const later = computeFundMetrics(FLOWS, 2700000, '2027-01-01');
  assert.ok(later.irr! < a.irr!, 'same value reached later is a lower IRR');
});

// ---------- position rollup ----------

test('rollUpPosition carries an unmarked position at cost', () => {
  const p = rollUpPosition(600000, null);
  assert.equal(p.invested, 600000);
  assert.equal(p.fmv, 600000, 'no mark → carry at cost, never an invented step-up');
  assert.equal(p.multiple, 1);
  assert.equal(p.unmarked, true);
  assert.equal(p.marked_down, false);
});

test('rollUpPosition flags a markdown', () => {
  const p = rollUpPosition(600000, 340000);
  assert.equal(p.fmv, 340000);
  assert.ok(Math.abs(p.multiple! - 0.5667) < 0.001);
  assert.equal(p.marked_down, true);
  assert.equal(p.unmarked, false);
});

test('rollUpPosition treats a zero mark as a real write-off', () => {
  const p = rollUpPosition(250000, 0);
  assert.equal(p.fmv, 0);
  assert.equal(p.multiple, 0);
  assert.equal(p.marked_down, true);
  assert.equal(p.unmarked, false, 'zero is a mark, not the absence of one');
});

test('rollUpPosition survives a zero-cost position', () => {
  const p = rollUpPosition(0, 100000);
  assert.equal(p.multiple, null, 'no cost basis → no multiple, not Infinity');
});

// ---------- cadence helpers ----------

test('currentPeriod formats monthly and quarterly periods', () => {
  assert.equal(currentPeriod('monthly', '2026-08-21'), '2026-08');
  assert.equal(currentPeriod('quarterly', '2026-08-21'), '2026-Q3');
  assert.equal(currentPeriod('quarterly', '2026-01-05'), '2026-Q1');
  assert.equal(currentPeriod('quarterly', '2026-04-01'), '2026-Q2');
  assert.equal(currentPeriod('quarterly', '2026-12-31'), '2026-Q4');
  assert.equal(currentPeriod('monthly', 'nope'), null);
});

test('daysSince measures report staleness', () => {
  assert.equal(daysSince('2026-08-01', '2026-08-21'), 20);
  assert.equal(daysSince(null, '2026-08-21'), null, 'never reported → null, not 0');
  assert.equal(daysSince('2026-09-01', '2026-08-21'), 0, 'future dates clamp to 0');
});

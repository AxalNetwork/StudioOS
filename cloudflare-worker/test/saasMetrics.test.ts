/**
 * Build queue #121 — derived SaaS metrics tests.
 *
 * These numbers end up in investor updates and board packs, so the
 * tests focus on the cases where a naive implementation produces a
 * confident wrong answer rather than a blank: growth from zero,
 * burn multiple while shrinking, compounding churn, and payback with
 * no margin basis.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/saasMetrics.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  growthPct, cmgrPct, ltvCac, cacPaybackMonths, burnMultiple, ruleOf40,
  annualRetentionPct, summarise, sparkline, sortSeries,
  type Snapshot,
} from '../src/services/saasMetrics.ts';

const SERIES: Snapshot[] = [
  { snapshot_date: '2026-03-01', mrr: 10_000, active_users: 100, cac: 500, ltv: 1_500, monthly_churn_pct: 4 },
  { snapshot_date: '2026-04-01', mrr: 12_000, active_users: 118, cac: 480, ltv: 1_600, monthly_churn_pct: 3.5 },
  { snapshot_date: '2026-05-01', mrr: 15_000, active_users: 140, cac: 450, ltv: 1_800, monthly_churn_pct: 3 },
];

// ---------- growth ----------

test('growthPct computes period-over-period growth', () => {
  assert.equal(growthPct(15_000, 12_000), 25);
  assert.equal(growthPct(9_000, 12_000), -25, 'declines are real negatives');
});

test('growth FROM ZERO is null, not infinity and not 100%', () => {
  assert.equal(growthPct(10_000, 0), null);
});

test('growthPct is null on missing or negative bases', () => {
  assert.equal(growthPct(10_000, null), null);
  assert.equal(growthPct(null, 10_000), null);
  assert.equal(growthPct(10_000, -500), null, 'a negative base makes the ratio meaningless');
});

test('cmgrPct compounds across the series, not across row count', () => {
  // 10k → 15k over TWO periods → sqrt(1.5) - 1 ≈ 22.47%.
  const c = cmgrPct(SERIES);
  assert.ok(c !== null);
  assert.ok(Math.abs(c! - 22.47) < 0.05, `expected ~22.47, got ${c}`);
});

test('cmgrPct needs two positive points', () => {
  assert.equal(cmgrPct([SERIES[0]]), null);
  assert.equal(cmgrPct([]), null);
  assert.equal(cmgrPct([
    { snapshot_date: '2026-01-01', mrr: 0 },
    { snapshot_date: '2026-02-01', mrr: 5_000 },
  ]), null, 'cannot compound from zero');
});

// ---------- unit economics ----------

test('ltvCac returns the bare ratio investors quote', () => {
  assert.equal(ltvCac(1_500, 500), 3);
  assert.equal(ltvCac(1_800, 450), 4);
});

test('ltvCac is null rather than infinite when CAC is zero', () => {
  assert.equal(ltvCac(1_500, 0), null, 'an infinite LTV:CAC is a data problem, not a triumph');
  assert.equal(ltvCac(1_500, null), null);
  assert.equal(ltvCac(null, 500), null);
});

test('cacPaybackMonths divides CAC by monthly gross profit per account', () => {
  // $500 CAC, $100 ARPA, 80% margin → 500 / 80 = 6.3 months.
  assert.equal(cacPaybackMonths(500, 100, 0.8), 6.3);
});

test('cacPaybackMonths on a revenue basis when no margin is given', () => {
  assert.equal(cacPaybackMonths(500, 100), 5, 'defaults to margin 1.0 — flattering, hence documented');
});

test('cacPaybackMonths is null without positive ARPA or margin', () => {
  assert.equal(cacPaybackMonths(500, 0, 0.8), null);
  assert.equal(cacPaybackMonths(500, 100, 0), null);
  assert.equal(cacPaybackMonths(null, 100, 0.8), null);
});

// ---------- burn multiple ----------

test('burnMultiple divides net burn by net new ARR', () => {
  assert.equal(burnMultiple(1_000_000, 500_000), 2);
  assert.equal(burnMultiple(400_000, 800_000), 0.5, 'under 1.0 is exceptional');
});

test('burnMultiple is NOT MEANINGFUL while shrinking — never a flattering number', () => {
  // The trap: -200k net new ARR with 1M burn would compute to -5,
  // which sorts as "better" than 2 in any naive ranking.
  assert.equal(burnMultiple(1_000_000, -200_000), null);
  assert.equal(burnMultiple(1_000_000, 0), null);
});

test('burnMultiple is zero when cash-flow positive while growing', () => {
  assert.equal(burnMultiple(-50_000, 500_000), 0);
  assert.equal(burnMultiple(0, 500_000), 0);
});

// ---------- rule of 40 / retention ----------

test('ruleOf40 sums growth and margin percentages', () => {
  assert.equal(ruleOf40(60, -15), 45);
  assert.equal(ruleOf40(20, 5), 25);
  assert.equal(ruleOf40(30, null), null);
});

test('annualRetentionPct COMPOUNDS monthly churn', () => {
  // 5%/month is ~54% annual retention, not 40%.
  const r = annualRetentionPct(5);
  assert.ok(r !== null);
  assert.ok(Math.abs(r! - 54.0) < 0.2, `expected ~54%, got ${r}`);
  assert.equal(annualRetentionPct(0), 100);
});

test('annualRetentionPct rejects impossible churn rates', () => {
  assert.equal(annualRetentionPct(100), null);
  assert.equal(annualRetentionPct(-5), null);
  assert.equal(annualRetentionPct(null), null);
});

// ---------- summary ----------

test('summarise rolls the series into the KPI board', () => {
  const s = summarise(SERIES);
  assert.equal(s.as_of, '2026-05-01');
  assert.equal(s.mrr, 15_000);
  assert.equal(s.arr, 180_000, 'ARR derived as 12x MRR when not stored');
  assert.equal(s.mrr_growth_pct, 25);
  assert.equal(s.active_users, 140);
  assert.equal(s.ltv_cac, 4);
  assert.equal(s.snapshot_count, 3);
});

test('summarise prefers a stored ARR over the 12x identity', () => {
  const s = summarise([{ snapshot_date: '2026-05-01', mrr: 15_000, arr: 200_000 }]);
  assert.equal(s.arr, 200_000);
});

test('summarise EXPLAINS every metric it could not compute', () => {
  const s = summarise([{ snapshot_date: '2026-05-01', mrr: 15_000 }]);
  assert.equal(s.mrr_growth_pct, null);
  const reasons = Object.fromEntries(s.unavailable.map(u => [u.metric, u.reason]));
  assert.match(reasons.mrr_growth_pct, /two snapshots/i, 'a blank metric must say what it needs');
  assert.match(reasons.ltv_cac, /LTV and a CAC/i);
  assert.match(reasons.cac_payback_months, /CAC/i);
  assert.ok(s.unavailable.length >= 3);
});

test('summarise is safe on an empty series', () => {
  const s = summarise([]);
  assert.equal(s.as_of, null);
  assert.equal(s.mrr, null);
  assert.equal(s.snapshot_count, 0);
  assert.ok(Array.isArray(s.unavailable));
});

test('summarise sorts by date rather than trusting input order', () => {
  const shuffled = [SERIES[2], SERIES[0], SERIES[1]];
  const s = summarise(shuffled);
  assert.equal(s.as_of, '2026-05-01');
  assert.equal(s.mrr_growth_pct, 25, 'growth is against April, not whatever came second in the array');
});

test('sortSeries drops malformed dates instead of throwing', () => {
  const s = sortSeries([{ snapshot_date: 'sometime', mrr: 1 }, ...SERIES]);
  assert.equal(s.length, 3);
});

// ---------- sparkline ----------

test('sparkline keeps gaps as null rather than interpolating', () => {
  const pts = sparkline([
    { snapshot_date: '2026-03-01', mrr: 10_000 },
    { snapshot_date: '2026-04-01', mrr: null },
    { snapshot_date: '2026-05-01', mrr: 15_000 },
  ]);
  assert.deepEqual(pts.map(p => p.value), [10_000, null, 15_000],
    'a month nobody reported must render as a gap, not a straight line through it');
});

test('sparkline can read any numeric field', () => {
  assert.deepEqual(sparkline(SERIES, 'active_users').map(p => p.value), [100, 118, 140]);
});

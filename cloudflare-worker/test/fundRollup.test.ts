/**
 * Fund analytics rollup — the honesty rules, pinned.
 *
 * /funds/performance and /funds/accounting used to render a fixture that
 * invented NAV, IRR, TVPI, RVPI and DPI for four funds that do not exist.
 * These tests exist so the replacement can never quietly grow a number the
 * schema cannot support: a metric with no source must come back null, and a
 * null must never be softened into a zero on its way to an LP.
 *
 * Pure functions — no D1, no auth, no clock.
 *
 * Run via the strip-types loader:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/fundRollup.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rollUpFundRow,
  totalFundRollups,
  dollarsToCents,
  ratioOrNull,
  FUND_METRIC_UNAVAILABLE,
  type FundRollupRow,
} from '../src/services/fundRollup.ts';

const row = (over: Partial<FundRollupRow> = {}): FundRollupRow => ({
  id: 1,
  name: 'Fund I',
  vintage_year: 2021,
  status: 'active',
  total_commitment: 0,
  fund_size_cents: 0,
  deployed_capital: 0,
  lp_rows: 0,
  called_dollars: 0,
  distributed_cents: 0,
  management_fee: 0.02,
  carried_interest: 0.20,
  ...over,
});

// ---------- what must never be invented ----------

test('NAV, RVPI, TVPI and IRR are null on every fund, however rich the row', () => {
  // A fund with money moving through every column it HAS still cannot
  // produce the four metrics that need a valuation or a dated contribution.
  const f = rollUpFundRow(row({
    total_commitment: 45_000_000, deployed_capital: 40_100_000,
    called_dollars: 42_750_000, distributed_cents: 60_705_000_00, lp_rows: 31,
  }));
  assert.equal(f.nav_cents, null, 'no fund-level marks exist');
  assert.equal(f.rvpi, null, 'RVPI needs NAV');
  assert.equal(f.tvpi, null, 'TVPI needs NAV');
  assert.equal(f.irr, null, 'IRR needs dated contributions');
});

test('every refusal states its reason, so the UI can say why rather than just blank', () => {
  for (const k of ['nav_cents', 'rvpi', 'tvpi', 'irr', 'fee_accrual', 'expenses'] as const) {
    const reason = FUND_METRIC_UNAVAILABLE[k];
    assert.ok(reason && reason.length > 12, `${k} must carry a real explanation`);
  }
});

// ---------- what IS real ----------

test('DPI is distributions over called capital, and null when nothing was called', () => {
  const f = rollUpFundRow(row({ called_dollars: 1_000_000, distributed_cents: 420_000_00 }));
  assert.equal(f.dpi, 0.42);
  // A fund that has called nothing has no DPI. Not 0 — 0 claims a real result.
  assert.equal(rollUpFundRow(row({ distributed_cents: 500_00 })).dpi, null);
  assert.equal(ratioOrNull(5, 0), null);
});

test('committed prefers the cents column and falls back to legacy dollars', () => {
  assert.equal(rollUpFundRow(row({ fund_size_cents: 85_000_000_00, total_commitment: 1 })).committed_cents,
    85_000_000_00, 'fund_size_cents wins once set');
  assert.equal(rollUpFundRow(row({ fund_size_cents: 0, total_commitment: 45_000_000 })).committed_cents,
    45_000_000_00, 'pre-v2 funds still report their commitment');
});

test('legacy dollar columns cross the boundary as integer cents', () => {
  assert.equal(dollarsToCents(1234.56), 123456);
  // Float dollars must not leak a fractional cent into the response.
  assert.equal(Number.isInteger(dollarsToCents(0.1 + 0.2)), true);
  assert.equal(dollarsToCents(null), 0);
  assert.equal(dollarsToCents('nonsense'), 0);
});

test('a zero fee is a real term; a missing column is not', () => {
  // A no-fee vehicle genuinely charges 0.0%. Collapsing that to null would
  // tell an LP the terms are unknown when they are known and favourable.
  assert.equal(rollUpFundRow(row({ management_fee: 0, carried_interest: 0 })).management_fee, 0);
  assert.equal(rollUpFundRow(row({ management_fee: 0 })).carried_interest, 0.2);
  assert.equal(rollUpFundRow(row({ management_fee: null })).management_fee, null);
});

test('rates are reported but accruals are refused, each with a reason', () => {
  const f = rollUpFundRow(row({ management_fee: 0.02 }));
  assert.equal(f.management_fee, 0.02, 'the contracted rate is a real term');
  // What is NOT real is how much has accrued — there is no ledger for it.
  assert.ok(FUND_METRIC_UNAVAILABLE.fee_accrual.length > 12);
  assert.ok(FUND_METRIC_UNAVAILABLE.expenses.length > 12);
});

// ---------- the family rollup ----------

test('blended DPI weights by capital, not by fund count', () => {
  // A tiny fund returning 4x must not drag the family DPI up to ~2.0.
  const small = rollUpFundRow(row({ id: 1, called_dollars: 2_000_000, distributed_cents: 8_000_000_00 }));
  const large = rollUpFundRow(row({ id: 2, called_dollars: 200_000_000, distributed_cents: 20_000_000_00 }));
  assert.equal(small.dpi, 4);
  assert.equal(large.dpi, 0.1);
  const t = totalFundRollups([small, large]);
  // 28m distributed / 202m called = 0.1386, not the 2.05 mean of the two.
  assert.equal(t.dpi, 0.1386);
  assert.notEqual(t.dpi, (small.dpi! + large.dpi!) / 2);
});

test('an empty family reports no funds and no ratios, not zeros', () => {
  const t = totalFundRollups([]);
  assert.equal(t.fund_count, 0);
  assert.equal(t.committed_cents, 0, 'a sum over nothing is genuinely 0');
  assert.equal(t.dpi, null, 'but a ratio over nothing is unknown, not 0');
  assert.equal(t.nav_cents, null);
  assert.equal(t.irr, null);
});

test('totals sum the cents columns exactly, with no float drift', () => {
  const items = [
    rollUpFundRow(row({ id: 1, total_commitment: 0.1, called_dollars: 0.1 })),
    rollUpFundRow(row({ id: 2, total_commitment: 0.2, called_dollars: 0.2 })),
  ];
  const t = totalFundRollups(items);
  assert.equal(t.committed_cents, 30, '10c + 20c = 30c, not 30.000000000000004');
  assert.equal(t.lp_count, 0);
});

/**
 * D5373 part 2 — the wire form and the commission chart read and write a minor-unit count at the currency's own decimals,
 * not a fixed 100: a JPY wire of 5,000 was written as 500,000 yen; a JPY commission chart plotted 1/100th of the figure
 * beside a table that said the right one. (The cap-table models moved in D5497, which owns their conversions.)
 *
 * Every case runs JPY (no minor unit), KWD (three) and EUR (two, the unchanged rows), plus USD and a currency the layer
 * does not list. Mutation-checked both ways: each function with its old `/ 100` or `* 100` body put back fails the JPY and
 * KWD cases and leaves EUR and USD green (they are byte-for-byte what they were); with the new code all of them pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { wireCents } from '../src/pages/deal/dealAudienceModel.js';
import { commissionChart } from '../src/pages/admin/programs/referralPartnersModel.js';

test('a wire is recorded in the deal currency\'s own minor units', () => {
  assert.equal(wireCents({ amount: 5000 }, 'JPY'), 5000, '5,000 yen is 5,000, not 500,000');
  assert.equal(wireCents({ amount: 12.345 }, 'KWD'), 12345);
  assert.equal(wireCents({ amount: 200000 }, 'EUR'), 20000000);
  assert.equal(wireCents({ amount: 200000 }, 'USD'), 20000000);
  assert.equal(wireCents({ amount: 200000 }), 20000000, 'no currency is USD, as before');
  assert.equal(wireCents({ amount: 12.345 }), 1235, 'the existing USD rounding is unchanged');
  assert.equal(wireCents({ amount: 5000 }, 'XYZ'), null, 'a currency we cannot price in is not guessed');
  assert.equal(wireCents({ amount: 0 }, 'JPY'), null);
  assert.equal(wireCents({ amount: null }, 'JPY'), null);
});

const SERIES = (code, accrued, paid) => ({ status: 'ready', data: { months_from: '2025-11-01', commission: { available: true,
  accrued: [{ month: '2026-10', currency: code, cents: accrued }], paid: [{ month: '2026-10', currency: code, cents: paid }] } } });

test('the commission chart plots each currency at its own decimals, beside the table\'s figures', () => {
  // 2026-10 is the 12th month from 2025-11, the last of the series.
  const last = (code, a, p) => { const c = commissionChart(SERIES(code, a, p)); return { chart: [c.chart.series[0].values.at(-1), c.chart.series[1].values.at(-1)], row: c.chart.table.rows.at(-1) }; };
  const jpy = last('JPY', 5000, 3000);
  assert.deepEqual(jpy.chart, [5000, 3000], '5,000 yen accrued plots as 5,000, not 50');
  assert.match(jpy.row[1], /5,000/);
  const kwd = last('KWD', 1250, 500);
  assert.deepEqual(kwd.chart, [1.25, 0.5], '1.250 KWD plots as 1.25, not 12.5');
  assert.match(kwd.row[1], /1\.250/);
  assert.deepEqual(last('EUR', 99900, 30000).chart, [999, 300]);
  assert.deepEqual(last('USD', 50000, 30000).chart, [500, 300]);
});

test('a commission in a currency the layer does not list is unreadable, not plotted at a guessed factor', () => {
  const c = commissionChart(SERIES('XYZ', 5000, 3000));
  assert.equal(c.state, 'unreadable');
  assert.match(c.reason, /"XYZ" is not a currency we can price in/);
  assert.equal(c.chart, undefined);
});

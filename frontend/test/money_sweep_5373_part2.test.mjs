/**
 * D5373 part 2 — the cap-table models, the wire form and the commission chart read and write a minor-unit count at the
 * currency's own decimals, not a fixed 100. A JPY cap of 5,000 yen was read as 50 and proposed as 500,000; a 1.250 KWD
 * SAFE was proposed as 125 minor units (0.125 KWD); a JPY wire of 5,000 was written as 500,000 yen; a JPY commission chart
 * plotted 1/100th of the figure beside a table that said the right one.
 *
 * Every case runs JPY (no minor unit), KWD (three) and EUR (two, the unchanged rows), plus USD and a currency the layer
 * does not list. Mutation-checked both ways: each function with its old `/ 100` or `* 100` body put back fails the JPY and
 * KWD cases and leaves EUR and USD green (they are byte-for-byte what they were); with the new code all of them pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { instrumentView, recordInstruments } from '../src/pages/raise/captable/instrumentsModel.js';
import { modelMoneyNote, proposalsFromModel } from '../src/pages/raise/captable/overviewModel.js';
import { wireCents } from '../src/pages/deal/dealAudienceModel.js';
import { commissionChart } from '../src/pages/admin/programs/referralPartnersModel.js';

const NO_TERMS = { discount_bps: null, basis: 'post_money', mfn: null, interest_bps: null, maturity_on: null };
const record = (code, instrument) => ({
  currency: { code, source: 'set' },
  issuances: { rows: [] },
  instruments: { rows: [{ uid: 'i-1', status: 'recorded', source: 'typed', kind: 'safe', holder: { holder_id: null, name: 'Northwind Angels' }, currency: code, issued_on: '2026-09-02', document_ref: null, ...instrument }] },
});
const sim = (capPrice) => ({ result: { rounds: [{ name: 'Next round', price_per_share: 1, conversions: [{ name: 'Northwind Angels', binding: 'cap', shares: 1, pct_after_round: 1, price_per_share: capPrice, cap_price: capPrice, discount_price: null, round_price: 1 }] }] } });
const capLine = (code, capCents, capPrice) => {
  const [inst] = recordInstruments(record(code, { amount_cents: capCents, terms: { ...NO_TERMS, cap_cents: capCents } }));
  return instrumentView(inst, { sim: sim(capPrice) }).steps.lines[0];
};

test('the instrument drawer works the cap out in the instrument\'s own major units', () => {
  assert.equal(capLine('JPY', 5000, 100), 'Cap price = $5,000 ÷ 50 shares = $100.00', '5,000 yen is 5,000, not 50');
  assert.equal(capLine('KWD', 1250, 0.25), 'Cap price = $1.25 ÷ 5 shares = $0.25', '1.250 KWD is 1.25, not 12.5');
  assert.equal(capLine('EUR', 500000, 100), 'Cap price = $5,000 ÷ 50 shares = $100.00');
  assert.equal(capLine('USD', 500000, 100), 'Cap price = $5,000 ÷ 50 shares = $100.00');
  // A currency the layer does not list reads no cap step at a guessed factor.
  assert.doesNotMatch(capLine('XYZ', 500000, 100), /^Cap price/, 'no cap line for a currency we cannot price in');
});

test('an instrument carries the currency it is read in: its own, else the record\'s, else USD', () => {
  assert.equal(recordInstruments(record('JPY', { amount_cents: 5000, terms: NO_TERMS }))[0].currency, 'JPY');
  assert.equal(recordInstruments(record('EUR', { currency: null, amount_cents: 5000, terms: NO_TERMS }))[0].currency, 'EUR');
  assert.equal(recordInstruments({ instruments: { rows: [{ uid: 'x', kind: 'safe', terms: NO_TERMS, amount_cents: 1 }] } })[0].currency, 'USD');
});

const MODEL = (safes) => ({ inputs: { founders: [{ name: 'Mira', shares: 100 }], safes } });
const SAFE = (amount, cap) => ({ name: 'Harbor Seed Fund', amount, cap, discount: 0.15, basis: 'post_money' });
const safeBody = (list) => list.find((b) => b.kind === 'safe');

test('"Record them from the model" proposes the saved major units in the venture\'s own minor units', () => {
  const jpy = safeBody(proposalsFromModel(MODEL([SAFE(5000, 50000)]), 'JPY'));
  assert.deepEqual([jpy.amount_cents, jpy.cap_cents], [5000, 50000], 'a JPY amount of 5,000 yen is 5,000, not 500,000');
  const kwd = safeBody(proposalsFromModel(MODEL([SAFE(1.25, 12.5)]), 'KWD'));
  assert.deepEqual([kwd.amount_cents, kwd.cap_cents], [1250, 12500], 'a KWD 1.250 is 1,250 thousandths');
  const eur = safeBody(proposalsFromModel(MODEL([SAFE(250000, 8000000)]), 'EUR'));
  assert.deepEqual([eur.amount_cents, eur.cap_cents, eur.discount_bps], [25000000, 800000000, 1500]);
  assert.deepEqual(proposalsFromModel(MODEL([SAFE(250000, 8000000)])), proposalsFromModel(MODEL([SAFE(250000, 8000000)]), 'USD'), 'no currency is USD, as before');
  assert.deepEqual(proposalsFromModel(MODEL([SAFE(250000, 8000000)]), null), proposalsFromModel(MODEL([SAFE(250000, 8000000)])));
  // The founders' shares are not money and are proposed in every currency.
  for (const code of ['JPY', 'KWD', 'EUR', 'XYZ']) assert.equal(proposalsFromModel(MODEL([SAFE(1, 1)]), code)[0].shares, 100, code);
});

test('a currency the layer does not list proposes no SAFE or note, and says why', () => {
  const list = proposalsFromModel(MODEL([SAFE(5000, 50000)]), 'XYZ');
  assert.deepEqual(list.map((b) => b.kind), ['founding'], 'nothing is proposed at a guessed factor');
  assert.match(modelMoneyNote(MODEL([SAFE(5000, 50000)]), 'XYZ'), /"XYZ" is not one we can price in/);
  assert.equal(modelMoneyNote(MODEL([SAFE(5000, 50000)]), 'JPY'), null);
  assert.equal(modelMoneyNote(MODEL([]), 'XYZ'), null, 'no SAFE to hold back, nothing to say');
});

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

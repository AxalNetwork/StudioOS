/**
 * D5373 part 2, commit 2 — the cap table prints the venture's currency, not a hard-coded "$". `dollars`, `price`, the
 * chart label `short` and the sentences built from them took a whole-major-unit figure and wrote "$" before it for every
 * venture; a euro venture read "$5,000", a yen one "$5,000", a dinar one "$1.25".
 *
 * USD is byte-for-byte what it was (every USD string below is the string the code printed before the change). Any other
 * code prints `${code} ${amount}` (the option pool's convention), the amount grouped as before at the currency's own
 * decimals (JPY none, KWD up to three, else up to two). The figures are already whole MAJOR units, so nothing is
 * converted here: only the symbol and the decimals follow the currency. A code the layer does not list prints the number
 * as stored beside the code, with no decimals guessed.
 *
 * Mutation-checked both ways: `$` hard-coded again in `dollars`, `price`, `short`, a sentence or the access view fails the
 * EUR, JPY, KWD and XYZ cases and leaves every USD case green; with the new code all of them pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOf, dollars, scenarioCard, scenarioCards, symbolOf } from '../src/pages/raise/captable/capTableModel.js';
import { bindingLine, convertBody, convertView, instrumentView, price, recordInstruments } from '../src/pages/raise/captable/instrumentsModel.js';
import {
  beforeAfter, compareRows, exitPanels, exitTable, paymentReadBack, roundEvents, roundReadBack, short, todayPrice, waterfallTable,
} from '../src/pages/raise/captable/scenariosModel.js';
import { sharedView } from '../src/pages/raise/captable/capTableAccess.js';

test('the symbol and the code a figure is shown in', () => {
  assert.equal(codeOf(undefined), 'USD');
  assert.equal(codeOf(null), 'USD');
  assert.equal(codeOf('eur'), 'EUR');
  assert.equal(codeOf({ code: 'jpy', source: 'set' }), 'JPY', 'the Today read sends { code, source }');
  assert.equal(symbolOf('USD'), '$');
  assert.equal(symbolOf(undefined), '$');
  assert.equal(symbolOf('EUR'), 'EUR ');
  assert.equal(symbolOf({ code: 'KWD' }), 'KWD ');
});

test('dollars: USD is exactly as before; any other currency prints its code at its own decimals', () => {
  // USD: the strings the code printed before.
  assert.equal(dollars(500000), '$500,000');
  assert.equal(dollars(500000, 'USD'), '$500,000');
  assert.equal(dollars(1.25), '$1.25');
  assert.equal(dollars(1234567.891), '$1,234,567.89');
  assert.equal(dollars(0), '$0');
  assert.equal(dollars(null), 'Not recorded');
  assert.equal(dollars(undefined, 'JPY'), 'Not recorded', 'missing is never a figure, in any currency');
  // EUR, JPY, KWD: the code, not "$".
  assert.equal(dollars(5000, 'EUR'), 'EUR 5,000');
  assert.equal(dollars(1234.5, 'EUR'), 'EUR 1,234.5');
  assert.equal(dollars(5000, 'JPY'), 'JPY 5,000');
  assert.equal(dollars(5000.7, 'JPY'), 'JPY 5,001', 'a yen has no decimals');
  assert.equal(dollars(1.25, 'KWD'), 'KWD 1.25');
  assert.equal(dollars(1.2346, 'KWD'), 'KWD 1.235', 'a dinar keeps up to three');
  assert.equal(dollars(5000, { code: 'JPY' }), 'JPY 5,000');
  // A code the layer does not list: the number as stored, no decimals guessed.
  assert.equal(dollars(5000.123, 'XYZ'), 'XYZ 5000.123');
  assert.equal(dollars(5000, 'XYZ'), 'XYZ 5000');
});

test('price per share: USD is exactly as before; any other currency prints its code', () => {
  assert.equal(price(1.03), '$1.03');
  assert.equal(price(0.05), '$0.0500');
  assert.equal(price(0.05, 'USD'), '$0.0500');
  assert.equal(price(1.03, 'EUR'), 'EUR 1.03');
  assert.equal(price(0.05, 'JPY'), 'JPY 0.0500');
  assert.equal(price(1.03, 'KWD'), 'KWD 1.03');
  assert.equal(price(1.03, 'XYZ'), 'XYZ 1.03');
  assert.equal(price(null, 'EUR'), 'Not recorded');
});

test('chart labels: USD is exactly as before; any other currency prints its code', () => {
  assert.deepEqual([short(29070000), short(950000), short(1500000000), short(12), short(1500)], ['$29.07M', '$950K', '$1.5B', '$12', '$1.5K']);
  assert.equal(short(29070000, 'USD'), '$29.07M');
  assert.equal(short(29070000, 'EUR'), 'EUR 29.07M');
  assert.equal(short(950000, 'JPY'), 'JPY 950K');
  assert.equal(short(1500000000, 'KWD'), 'KWD 1.5B');
  assert.equal(short(12, 'XYZ'), 'XYZ 12');
  assert.equal(short(null, 'EUR'), 'Not recorded');
});

// ---------------------------------------------------------------- one rendered instrument line each

const NO_TERMS = { discount_bps: 1500, basis: 'post_money', mfn: null, interest_bps: null, maturity_on: null };
const recordOf = (code, instrument) => ({
  currency: { code, source: 'set' }, issuances: { rows: [] },
  instruments: { rows: [{ uid: 'i-1', status: 'recorded', source: 'typed', kind: 'safe', holder: { holder_id: null, name: 'Northwind Angels' }, currency: code, issued_on: '2026-09-02', document_ref: null, ...instrument }] },
});
const sim = (extra = {}) => ({ currency: undefined, result: { rounds: [{ name: 'Next round', price_per_share: 1, conversions: [{ name: 'Northwind Angels', binding: 'cap', shares: 1, pct_after_round: 1, price_per_share: 0.25, cap_price: 0.25, discount_price: 0.5, round_price: 1, accrued_interest: 10, converting_amount: 110, amount: 100, ...extra }] }] } });
const lines = (code, cap, capPrice) => {
  const [inst] = recordInstruments(recordOf(code, { amount_cents: cap, terms: { ...NO_TERMS, cap_cents: cap } }));
  const s = sim({ cap_price: capPrice });
  return instrumentView(inst, { sim: s }).steps.lines;
};

test('the instrument drawer\'s cap and discount steps read in the instrument\'s currency', () => {
  assert.deepEqual(lines('USD', 500000, 100).slice(0, 2), ['Cap price = $5,000 ÷ 50 shares = $100.00', 'Discount price = $1.00 × (1 − 15%) = $0.50']);
  assert.deepEqual(lines('EUR', 500000, 100).slice(0, 2), ['Cap price = EUR 5,000 ÷ 50 shares = EUR 100.00', 'Discount price = EUR 1.00 × (1 − 15%) = EUR 0.50']);
  assert.equal(lines('JPY', 5000, 100)[0], 'Cap price = JPY 5,000 ÷ 50 shares = JPY 100.00');
  assert.equal(lines('KWD', 1250, 0.25)[0], 'Cap price = KWD 1.25 ÷ 5 shares = KWD 0.25');
  assert.ok(!lines('XYZ', 5000, 100).some((l) => l.startsWith('Cap price =')), 'a currency we cannot price in shows no cap step');
  assert.match(lines('XYZ', 5000, 100)[0], /^Discount price = XYZ 1\.00/);
});

test('the accrued-interest line and the MFN cap line read in the instrument\'s currency', () => {
  const note = (code) => {
    const [inst] = recordInstruments(recordOf(code, { kind: 'note', amount_cents: 10000, terms: { ...NO_TERMS, cap_cents: null, interest_bps: 800, maturity_on: '2027-08-01', mfn: true } }));
    const today = { today: { result: { mfn: [{ name: 'Northwind Angels', later: [{ name: 'Kai Angel', cap: 1250, verdict: 'no_change' }] }] } } };
    const v = instrumentView(inst, { today, sim: { result: { rounds: [{ name: 'R', price_per_share: 1, conversions: [{ name: 'Northwind Angels', binding: 'discount', amount: 100, accrued_interest: 9, converting_amount: 109, discount_price: 0.5, round_price: 1 }] }] } } });
    return [v.steps.interest, v.mfn.later[0].line];
  };
  assert.deepEqual(note('USD'), ['Accrued interest converts too: $100 + $9 interest = $109 converts.', 'Kai Angel · cap $1,250']);
  assert.deepEqual(note('EUR'), ['Accrued interest converts too: EUR 100 + EUR 9 interest = EUR 109 converts.', 'Kai Angel · cap EUR 1,250']);
  assert.deepEqual(note('JPY'), ['Accrued interest converts too: JPY 100 + JPY 9 interest = JPY 109 converts.', 'Kai Angel · cap JPY 1,250']);
  assert.deepEqual(note('KWD'), ['Accrued interest converts too: KWD 100 + KWD 9 interest = KWD 109 converts.', 'Kai Angel · cap KWD 1,250']);
});

test('the conversion table and the "convert at" label read in the venture\'s currency', () => {
  const c = { binding: 'cap', cap_price: 0.25, discount_price: 0.5, round_price: 1 };
  assert.equal(bindingLine(c), 'Cap price $0.25 beats the discount price $0.50: cap wins');
  assert.equal(bindingLine(c, 'EUR'), 'Cap price EUR 0.25 beats the discount price EUR 0.50: cap wins');
  assert.equal(bindingLine(c, 'JPY'), 'Cap price JPY 0.25 beats the discount price JPY 0.50: cap wins');
  assert.equal(bindingLine({ binding: 'none', round_price: 1 }, 'KWD'), 'The round price KWD 1.00 applies');
  const view = (currency) => {
    const instruments = recordInstruments(recordOf(currency || 'USD', { amount_cents: 100, terms: NO_TERMS }));
    return convertView({ ...(currency ? { currency } : {}), result: { rounds: [{ name: 'R', price_per_share: 1.03, conversions: [{ name: 'Northwind Angels', binding: 'none', shares: 5, pct_after_round: 1, price_per_share: 1.03, round_price: 1.03 }] }] } }, instruments, 'x');
  };
  assert.equal(view().roundPrice, '$1.03');
  assert.equal(view().rows[0].price, '$1.03');
  assert.equal(view('EUR').roundPrice, 'EUR 1.03');
  assert.equal(view('JPY').rows[0].price, 'JPY 1.03');
  assert.equal(view('KWD').rows[0].binding, 'The round price KWD 1.03 applies');
  const body = (code) => convertBody('price', { price: '1.03', raise: '3,000,000' }, { today: { ...(code ? { currency: { code } } : {}), today: { result: { founding: [{ shares: 100 }] } } } }).label;
  assert.equal(body(), '$1.03');
  assert.equal(body('EUR'), 'EUR 1.03');
  assert.equal(body('JPY'), 'JPY 1.03');
});

// ---------------------------------------------------------------- the scenario pages' sentences

const ROUND = { name: 'Seed', price_per_share: 1.03, pre_money: 12000000, investment: 3000000, post_money: 15000000, shares_pre: 8000000, ledger: [], conversions: [{ instrument: 'safe', name: 'Northwind Angels', binding: 'cap', shares: 100, price_per_share: 0.82 }] };
const RESULT = { founding: [], rounds: [ROUND] };
const WF = { exit_value: 60000000, rows: [{ holder: 'Harbor', type: 'preferred', preference: 3000000, payout: 3000000, shares: 1000, source: '1x non-participating preference' }], totals: { total_distributed: 60000000 } };

test('before and after, the round events and the compare table read in the venture\'s currency', () => {
  const priceRow = (code) => beforeAfter(RESULT, todayPrice({ status: 'ready', data: { today: { price: { micros: 1030000, instrument: 'SAFE' } } } }, true, code), code).filter((r) => r.key === 'price' || r.key === 'post').map((r) => [r.before, r.after]);
  assert.deepEqual(priceRow('USD'), [['$1.0300', '$1.0300'], ['No round modelled', '$15,000,000']]);
  assert.deepEqual(priceRow(undefined), priceRow('USD'), 'no currency is USD, as before');
  assert.deepEqual(priceRow('EUR'), [['EUR 1.0300', 'EUR 1.0300'], ['No round modelled', 'EUR 15,000,000']]);
  assert.deepEqual(priceRow('JPY'), [['JPY 1.0300', 'JPY 1.0300'], ['No round modelled', 'JPY 15,000,000']]);
  assert.deepEqual(priceRow('KWD'), [['KWD 1.0300', 'KWD 1.0300'], ['No round modelled', 'KWD 15,000,000']]);
  assert.deepEqual(roundEvents(RESULT)[0].lines, ['SAFE Northwind Angels converts at the cap: 100 shares at $0.8200']);
  assert.deepEqual(roundEvents(RESULT, 'JPY')[0].lines, ['SAFE Northwind Angels converts at the cap: 100 shares at JPY 0.8200']);
  const cells = (code) => compareRows(null, [{ name: 'A', result: RESULT, status: 'ready' }], null, code).filter((r) => r.label === 'Price per share' || r.label === 'Post-money').map((r) => r.cells[1]);
  assert.deepEqual(cells('USD'), ['$1.0300', '$15,000,000']);
  assert.deepEqual(cells('EUR'), ['EUR 1.0300', 'EUR 15,000,000']);
  assert.deepEqual(cells('KWD'), ['KWD 1.0300', 'KWD 15,000,000']);
});

test('the waterfall table, the read-backs and the exit tables read in the venture\'s currency', () => {
  const t = (code) => { const w = waterfallTable(WF, [], code); return [w.rows[0].preference, w.rows[0].payout, w.foot]; };
  assert.deepEqual(t(undefined), ['1× · $3,000,000', '$3,000,000', 'Payouts add up to the $60,000,000 exit.']);
  assert.deepEqual(t('EUR'), ['1× · EUR 3,000,000', 'EUR 3,000,000', 'Payouts add up to the EUR 60,000,000 exit.']);
  assert.deepEqual(t('JPY'), ['1× · JPY 3,000,000', 'JPY 3,000,000', 'Payouts add up to the JPY 60,000,000 exit.']);
  assert.deepEqual(t('KWD'), ['1× · KWD 3,000,000', 'KWD 3,000,000', 'Payouts add up to the KWD 60,000,000 exit.']);
  assert.equal(paymentReadBack(WF).steps[0], 'First, each investor may take back what it put in: $3,000,000 in all, 1× and non-participating.');
  assert.equal(paymentReadBack(WF, 'EUR').steps[0], 'First, each investor may take back what it put in: EUR 3,000,000 in all, 1× and non-participating.');
  assert.match(paymentReadBack(WF, 'JPY').steps.join('\n'), /Above JPY 3M, Harbor does better converting to common\./);
  assert.match(paymentReadBack(WF).steps.join('\n'), /Above \$3M, Harbor/);
  // Two preferred holders: the first and the last conversion points are both written.
  const TWO = { ...WF, rows: [...WF.rows, { holder: 'Kai', type: 'preferred', preference: 3000000, payout: 3000000, shares: 500, source: '1x non-participating preference' }] };
  assert.match(paymentReadBack(TWO).steps[1], /^Above \$4\.5M, Harbor does better converting to common\. Above \$9M, every investor does\.$/);
  assert.match(paymentReadBack(TWO, 'KWD').steps[1], /^Above KWD 4\.5M, Harbor does better converting to common\. Above KWD 9M, every investor does\.$/);
  assert.equal(roundReadBack(RESULT).steps[0], 'Price: $1.0300 a share, the pre-money of $12,000,000 spread over the 8,000,000 shares before the round.');
  assert.equal(roundReadBack(RESULT, 'EUR').steps[0], 'Price: EUR 1.0300 a share, the pre-money of EUR 12,000,000 spread over the 8,000,000 shares before the round.');
  const col = { result: { waterfalls: [{ exit_value: 60000000, waterfall: WF }] }, short: 'A' };
  assert.deepEqual(exitTable(col, [60000000]).rows[0].cells.slice(0, 2), ['$60,000,000', '$0']);
  assert.deepEqual(exitTable(col, [60000000], 'JPY').rows[0].cells.slice(0, 2), ['JPY 60,000,000', 'JPY 0']);
  assert.deepEqual(exitTable(col, [60000000], 'KWD').rows[0].cells.slice(2), ['KWD 3,000,000', 'KWD 0']);
  assert.equal(exitPanels([col], [60000000])[0].rows[0].text, 'F $0');
  assert.equal(exitPanels([col], [60000000], 'EUR')[0].rows[0].text, 'F EUR 0');
});

test('a scenario card reads its round in the venture\'s currency', () => {
  const s = { uid: 'v1', name: 'Seed', inputs: { rounds: [{ name: 'Seed', pre_money: 12000000, investment: 3000000 }] } };
  assert.equal(scenarioCard(s).round, 'Seed · pre-money $12,000,000 · raise $3,000,000');
  assert.equal(scenarioCard(s, { currency: 'EUR' }).round, 'Seed · pre-money EUR 12,000,000 · raise EUR 3,000,000');
  assert.equal(scenarioCard(s, { model: true, currency: 'JPY' }).round, 'Seed · pre-money JPY 12,000,000 · raise JPY 3,000,000');
  assert.deepEqual(scenarioCards({ variants: [s] }, 'KWD').map((c) => c.round), ['Seed · pre-money KWD 12,000,000 · raise KWD 3,000,000']);
  assert.deepEqual(scenarioCards({ variants: [s] }).map((c) => c.round), ['Seed · pre-money $12,000,000 · raise $3,000,000']);
});

// ---------------------------------------------------------------- the access view

test('the access view shows an instrument\'s amount at its currency\'s own decimals', () => {
  const amount = (n, currency) => sharedView({ view: { level: 'own_position', holder: 'Fund', instruments: [{ holder: 'Fund', instrument: 'safe', amount: n, currency }] } }).instruments[0].amount;
  assert.equal(amount(100, 'EUR'), 'EUR 100.00', 'two decimals, as before');
  assert.equal(amount(100, 'USD'), 'USD 100.00');
  assert.equal(amount(5000, 'JPY'), 'JPY 5,000', 'a yen has no decimals');
  assert.equal(amount(1.25, 'KWD'), 'KWD 1.250');
  assert.equal(amount(5000.5, 'XYZ'), 'XYZ 5000.5', 'a code we cannot price in: the number as stored');
  assert.equal(amount(100, null), 'Currency not recorded 100');
});

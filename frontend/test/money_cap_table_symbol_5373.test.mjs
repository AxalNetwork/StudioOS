/**
 * D5373 part 2, commit 2 — the cap table prints the currency a figure is really in, not a hard-coded "$". `dollars`, the
 * chart label `short` and the sentences built from them took a whole-major-unit figure and wrote "$" before it for every
 * venture; a euro venture read "$5,000" on a figure that came from its euro record.
 *
 * D5497's rule decides WHICH figures: a saved model (and any scenario typed from it) is whole US dollars, so it keeps "$"
 * on a euro venture; a figure that comes from the RECORD (the Today read, a recorded instrument, a scenario that starts
 * from Today, the access view) is in the record's own currency. USD is byte-for-byte what it was (every USD string below
 * is the string the code printed before). Any other code prints `${code} ${amount}` (the option pool's convention), the
 * amount grouped as before at the currency's own decimals (JPY none, KWD up to three, else up to two). The figures are
 * already whole MAJOR units, so nothing is converted here. A code the layer does not list prints the number as stored.
 *
 * Mutation-checked both ways: `$` hard-coded again in `dollars`, `short`, a sentence or the access view fails the EUR, JPY,
 * KWD and XYZ cases and leaves every USD case green; a model figure printed in the record's currency fails the model cases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeOf, dollars, scenarioCard, scenarioCards, sourceCurrency, symbolOf } from '../src/pages/raise/captable/capTableModel.js';
import { bindingLine, convertBody, convertView, instrumentView, price, recordInstruments } from '../src/pages/raise/captable/instrumentsModel.js';
import {
  beforeAfter, compareRows, exitPanels, exitTable, paymentReadBack, roundEvents, roundReadBack, short, todayPrice, waterfallTable,
} from '../src/pages/raise/captable/scenariosModel.js';
import { sharedView } from '../src/pages/raise/captable/capTableAccess.js';

test('the currency a figure is in: a saved model is US dollars, the record is its own currency (D5497)', () => {
  assert.equal(sourceCurrency(false, 'EUR'), 'USD', 'a saved model is whole US dollars, whatever the venture\'s currency');
  assert.equal(sourceCurrency(true, 'EUR'), 'EUR');
  assert.equal(sourceCurrency(true, { code: 'jpy' }), 'JPY');
  assert.equal(sourceCurrency(true, undefined), 'USD');
});

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
  assert.equal(dollars(500000), '$500,000');
  assert.equal(dollars(500000, 'USD'), '$500,000');
  assert.equal(dollars(1.25), '$1.25');
  assert.equal(dollars(1234567.891), '$1,234,567.89');
  assert.equal(dollars(0), '$0');
  assert.equal(dollars(null), 'Not recorded');
  assert.equal(dollars(undefined, 'JPY'), 'Not recorded', 'missing is never a figure, in any currency');
  assert.equal(dollars(5000, 'EUR'), 'EUR 5,000');
  assert.equal(dollars(1234.5, 'EUR'), 'EUR 1,234.5');
  assert.equal(dollars(5000, 'JPY'), 'JPY 5,000');
  assert.equal(dollars(5000.7, 'JPY'), 'JPY 5,001', 'a yen has no decimals');
  assert.equal(dollars(1.25, 'KWD'), 'KWD 1.25');
  assert.equal(dollars(1.2346, 'KWD'), 'KWD 1.235', 'a dinar keeps up to three');
  assert.equal(dollars(5000, { code: 'JPY' }), 'JPY 5,000');
  assert.equal(dollars(5000.123, 'XYZ'), 'XYZ 5000.123', 'a code the layer does not list: the number as stored');
  assert.equal(dollars(5000, 'XYZ'), 'XYZ 5000');
});

test('price per share on the instruments page (D5497\'s `price`): USD exactly as before, the code after the figure otherwise', () => {
  assert.equal(price(1.03), '$1.03');
  assert.equal(price(0.05), '$0.0500');
  assert.equal(price(0.05, 'USD'), '$0.0500');
  assert.equal(price(1.03, 'EUR'), '1.03 EUR');
  assert.equal(price(0.05, 'JPY'), '0.0500 JPY');
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

// ---------------------------------------------------------------- the instrument drawer (figures from the record)

const NO_TERMS = { discount_bps: 1500, basis: 'post_money', mfn: null, interest_bps: null, maturity_on: null };
const recordOf = (code, instrument) => ({
  currency: { code, source: 'set' }, issuances: { rows: [] },
  instruments: { rows: [{ uid: 'i-1', status: 'recorded', source: 'typed', kind: 'safe', holder: { holder_id: null, name: 'Northwind Angels' }, currency: code, issued_on: '2026-09-02', document_ref: null, ...instrument }] },
});

test('the accrued-interest line and the MFN cap line read in the instrument\'s own currency, USD unchanged', () => {
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

test('the conversion table and the "convert at" label read in the record\'s currency, USD unchanged', () => {
  const c = { binding: 'cap', cap_price: 0.25, discount_price: 0.5, round_price: 1 };
  assert.equal(bindingLine(c), 'Cap price $0.25 beats the discount price $0.50: cap wins');
  assert.equal(bindingLine(c, 'EUR'), 'Cap price 0.25 EUR beats the discount price 0.50 EUR: cap wins');
  assert.equal(bindingLine({ binding: 'none', round_price: 1 }, 'JPY'), 'The round price 1.00 JPY applies');
  const view = (currency) => {
    const instruments = recordInstruments(recordOf(currency || 'USD', { amount_cents: 100, terms: NO_TERMS }));
    return convertView({ ...(currency ? { currency } : {}), result: { rounds: [{ name: 'R', price_per_share: 1.03, conversions: [{ name: 'Northwind Angels', binding: 'none', shares: 5, pct_after_round: 1, price_per_share: 1.03, round_price: 1.03 }] }] } }, instruments, 'x');
  };
  assert.equal(view().roundPrice, '$1.03');
  assert.equal(view('USD').rows[0].price, '$1.03');
  assert.equal(view('EUR').roundPrice, '1.03 EUR');
  assert.equal(view('JPY').rows[0].binding, 'The round price 1.03 JPY applies');
  const body = (code) => convertBody('price', { price: '1.03', raise: '3,000,000' }, { today: { ...(code ? { currency: { code } } : {}), today: { result: { founding: [{ shares: 100 }] } } } }).label;
  assert.equal(body(), '$1.03');
  assert.equal(body('EUR'), '1.03 EUR');
  assert.equal(body('JPY'), '1.03 JPY');
});

// ---------------------------------------------------------------- the scenario pages: record figures vs saved-model figures

const ROUND = { name: 'Seed', price_per_share: 1.03, pre_money: 12000000, investment: 3000000, post_money: 15000000, shares_pre: 8000000, ledger: [], conversions: [{ instrument: 'safe', name: 'Northwind Angels', binding: 'cap', shares: 100, price_per_share: 0.82 }] };
const RESULT = { founding: [], rounds: [ROUND] };
const WF = { exit_value: 60000000, rows: [{ holder: 'Harbor', type: 'preferred', preference: 3000000, payout: 3000000, shares: 1000, source: '1x non-participating preference' }], totals: { total_distributed: 60000000 } };
const TODAY_PRICE = { status: 'ready', data: { today: { price: { micros: 1030000, instrument: 'SAFE' } } } };

test('a scenario that starts from Today is in the record\'s currency; a saved-model scenario stays US dollars (D5497)', () => {
  const cols = (fromToday) => [{ name: 'A', result: RESULT, status: 'ready', fromToday }];
  const cells = (c, code) => compareRows(null, c, null, code).filter((r) => r.label === 'Price per share' || r.label === 'Post-money').map((r) => r.cells[1]);
  assert.deepEqual(cells(cols(true), 'USD'), ['$1.0300', '$15,000,000'], 'a USD record: unchanged');
  assert.deepEqual(cells(cols(true), 'EUR'), ['EUR 1.0300', 'EUR 15,000,000'], 'a Today scenario on a EUR record is in euros');
  assert.deepEqual(cells(cols(true), 'JPY'), ['JPY 1.0300', 'JPY 15,000,000']);
  assert.deepEqual(cells(cols(true), 'KWD'), ['KWD 1.0300', 'KWD 15,000,000']);
  assert.deepEqual(cells(cols(false), 'EUR'), ['$1.0300', '$15,000,000'], 'a saved-model scenario on a EUR record never prints "EUR"');
  assert.deepEqual(cells(cols(false), 'JPY'), ['$1.0300', '$15,000,000']);
  const row = compareRows({ founding: [] }, cols(false), todayPrice(TODAY_PRICE, true, 'EUR'), 'EUR').find((r) => r.label === 'Price per share');
  assert.deepEqual(row.cells, ['EUR 1.0300', '$1.0300'], 'Today (the record) in euros beside a model column in dollars');
});

test('the before and after rows and the round events read in the scenario\'s currency', () => {
  const rows = (code) => beforeAfter(RESULT, todayPrice(TODAY_PRICE, true, code), code).filter((r) => r.key === 'price' || r.key === 'post').map((r) => [r.before, r.after]);
  assert.deepEqual(rows('USD'), [['$1.0300', '$1.0300'], ['No round modelled', '$15,000,000']]);
  assert.deepEqual(rows(undefined), rows('USD'), 'no currency is USD, as before');
  assert.deepEqual(rows('EUR'), [['EUR 1.0300', 'EUR 1.0300'], ['No round modelled', 'EUR 15,000,000']]);
  assert.deepEqual(rows('KWD'), [['KWD 1.0300', 'KWD 1.0300'], ['No round modelled', 'KWD 15,000,000']]);
  assert.deepEqual(roundEvents(RESULT)[0].lines, ['SAFE Northwind Angels converts at the cap: 100 shares at $0.8200']);
  assert.deepEqual(roundEvents(RESULT, 'JPY')[0].lines, ['SAFE Northwind Angels converts at the cap: 100 shares at JPY 0.8200']);
});

test('the waterfall table and the read-backs read in the scenario\'s currency', () => {
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
});

test('the exit tables and panels are per column: a Today column in the record\'s currency, a model column in dollars', () => {
  const wfs = { waterfalls: [{ exit_value: 60000000, waterfall: WF }] };
  const today = { result: wfs, short: 'T', fromToday: true };
  const model = { result: wfs, short: 'M', fromToday: false };
  assert.deepEqual(exitTable(today, [60000000], 'USD').rows[0].cells.slice(0, 2), ['$60,000,000', '$0'], 'a USD record is unchanged');
  assert.deepEqual(exitTable(today, [60000000], 'JPY').rows[0].cells.slice(0, 2), ['JPY 60,000,000', 'JPY 0']);
  assert.deepEqual(exitTable(today, [60000000], 'KWD').rows[0].cells.slice(2), ['KWD 3,000,000', 'KWD 0']);
  assert.deepEqual(exitTable(model, [60000000], 'JPY').rows[0].cells.slice(0, 2), ['$60,000,000', '$0'], 'a model column on a JPY record is dollars');
  const panel = exitPanels([today, model], [60000000], 'EUR')[0].rows;
  assert.deepEqual(panel.map((r) => [r.currency, r.text]), [['EUR', 'F EUR 0'], ['USD', 'F $0']]);
  assert.equal(exitPanels([today], [60000000])[0].rows[0].text, 'F $0');
});

test('a scenario card reads its round in the record\'s currency only when it starts from Today', () => {
  const rounds = [{ name: 'Seed', pre_money: 12000000, investment: 3000000 }];
  const model = { uid: 'm', name: 'x', inputs: { rounds } };
  const fromToday = { uid: 'v1', name: 'Seed', inputs: { start: { holders: [] }, rounds } };
  const typed = { uid: 'v2', name: 'Typed', inputs: { rounds } };
  assert.equal(scenarioCard(fromToday).round, 'Seed · pre-money $12,000,000 · raise $3,000,000', 'a USD record is unchanged');
  assert.equal(scenarioCard(fromToday, { currency: 'EUR' }).round, 'Seed · pre-money EUR 12,000,000 · raise EUR 3,000,000');
  assert.equal(scenarioCard(fromToday, { currency: 'KWD' }).round, 'Seed · pre-money KWD 12,000,000 · raise KWD 3,000,000');
  assert.equal(scenarioCard(typed, { currency: 'EUR' }).round, 'Seed · pre-money $12,000,000 · raise $3,000,000', 'a typed-model variant stays in dollars');
  assert.equal(scenarioCard(model, { model: true, currency: 'JPY' }).round, 'Seed · pre-money $12,000,000 · raise $3,000,000', 'the saved model is US dollars (D5497)');
  assert.deepEqual(scenarioCards({ canonical: model, variants: [fromToday, typed] }, 'EUR').map((c) => c.round), [
    'Seed · pre-money $12,000,000 · raise $3,000,000',
    'Seed · pre-money EUR 12,000,000 · raise EUR 3,000,000',
    'Seed · pre-money $12,000,000 · raise $3,000,000',
  ]);
});

// ---------------------------------------------------------------- the access view

test('the access view shows an instrument\'s amount at its currency\'s own decimals', () => {
  const amount = (n, currency) => sharedView({ view: { level: 'own_position', holder: 'Fund', instruments: [{ holder: 'Fund', instrument: 'safe', amount: n, currency }] } }).instruments[0].amount;
  assert.equal(amount(100, 'EUR'), 'EUR 100.00', 'two decimals, as before');
  assert.equal(amount(100, 'USD'), 'USD 100.00');
  assert.equal(amount(5000, 'JPY'), 'JPY 5,000', 'a yen has no decimals');
  assert.equal(amount(1.25, 'KWD'), 'KWD 1.250');
  assert.equal(amount(5000.5, 'XYZ'), 'XYZ 5000.5', 'a code we cannot price in: the number as stored');
  assert.equal(amount(100, null), 'Currency not recorded 100.00', 'no currency recorded: the two decimals it always had');
});

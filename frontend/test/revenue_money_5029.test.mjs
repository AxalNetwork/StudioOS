/**
 * D5029 — Revenue and the licence pages read and write money at each currency's own exponent.
 * Mutations checked: Math.round(x * 100) back in a payload; money() dividing by 100; the 'EUR' guess back in
 * money(); the ceiling currency accepted on shape alone (ABC); the terms form reading a fee as hundredths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ceilingPayload, money, refundAmountShape, statementDisputePayload, floorsInCurrency, UNRECORDED_CURRENCY,
} from '../src/pages/hq/RevenuePage.jsx';
import { paymentPreview } from '../src/pages/hq/revenue/statementActionModel.js';
import { LICENCE_TERM_FIELDS, buildSave, displayValue, fromInput, initialForm, toInput } from '../src/lib/licenceTermsForm.js';
import { money as licenceMoney } from '../src/lib/licencePage.js';

const root = new URL('../../', import.meta.url);
// D5039 part 2: a payment is the governed Record a payment, an amount added to what was paid.
const issued = (currency, owedCents) => ({ status: 'issued', owed_cents: owedCents, paid_cents: 0, disputed_cents: 0, currency, unreported_streams: 0, estimated_streams: 0 });
const pay = (amountText, currency, owedCents = 10_000_000) => paymentPreview({ statement: issued(currency, owedCents), amountText, reason: 'Received by SEPA transfer' });
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const plain = (s) => String(s).replace(/ /g, ' ');

test('display: €1,234.56 is never €1,235, and JPY and KWD show their own decimals', () => {
  assert.equal(plain(money(123456, 'EUR')), '€1,234.56');
  assert.equal(plain(money(100, 'EUR')), '€1.00');
  assert.equal(plain(money(1235, 'JPY')), '¥1,235');
  assert.equal(plain(money(1235, 'KWD')), 'KWD 1.235');
  assert.equal(money(null, 'EUR'), null);
  assert.equal(money(undefined, 'EUR'), null);
  assert.equal(money('x', 'EUR'), null);
});

test('display: a missing or unknown currency is named with the stored count, never read as euros', () => {
  for (const currency of [undefined, null, '', 'XYZ', 'eur']) {
    const shown = money(123456, currency);
    assert.doesNotMatch(shown, /€|1,234\.56|1,235/, `${currency}: ${shown}`);
    assert.match(shown, /^123,456 minor units \(currency /);
  }
});

test('statement payment: the amount is parsed in the statement\'s currency, exactly', () => {
  const paid = pay;
  assert.equal(paid('19.99', 'EUR').body.amount_cents, 1999, '19.99 * 100 is 1998.9999999999998 as a float');
  assert.equal(paid('1234', 'JPY').body.amount_cents, 1234, 'JPY input is not multiplied by 100');
  assert.equal(paid('1.005', 'KWD').body.amount_cents, 1005);
  assert.ok(paid('0', 'EUR').error, 'a payment of nothing is not a payment');
  assert.match(paid('10.005', 'EUR').error, /2 decimal places/);
  assert.match(paid('10.5', 'JPY').error, /no minor unit/);
  assert.match(paid('1.0005', 'KWD').error, /3 decimal places/);
  assert.ok(paid('-1', 'EUR').error);
  assert.ok(paid('abc', 'EUR').error);
  assert.ok(paid('', 'EUR').error);
});

test('statement payment: no usable currency is refused, and overpayment names what is open in that currency', () => {
  for (const currency of [undefined, null, '', 'XYZ']) {
    assert.match(pay('10', currency, 5000).error, /no currency StudioOS can price in/);
  }
  assert.match(plain(pay('51', 'EUR', 5000).error), /more than the €50\.00 still open on this statement/);
  assert.match(plain(pay('5001', 'JPY', 5000).error), /more than the ¥5,000 still open on this statement/);
});

test('statement dispute: zero clears, positive needs a reason, and the amount follows the currency', () => {
  const dispute = (amountText, currency, note = 'why') => statementDisputePayload({ amountText, note, currency });
  assert.deepEqual(dispute('0', 'EUR', '').body, { disputed_cents: 0 });
  assert.equal(dispute('10', 'JPY').body.disputed_cents, 10);
  assert.equal(dispute('10.50', 'EUR').body.disputed_cents, 1050);
  assert.equal(dispute('0.001', 'BHD').body.disputed_cents, 1);
  assert.match(dispute('1.5', 'JPY').error, /no minor unit/);
  assert.ok(dispute('5', 'EUR', '').error, 'a positive dispute still needs a reason');
  assert.match(dispute('5', undefined).error, /no recorded currency/);
});

test('ceiling: parsed in the named currency, a listed currency only, lower case read, never guessed', () => {
  const ceiling = (amount, currency) => ceilingPayload({ licenceUid: 'lic_fr', period: '2026-Q3', amount, currency });
  assert.equal(ceiling('1234.56', 'eur').body.ceiling_cents, 123456);
  assert.equal(ceiling('1234.56', 'eur').body.currency, 'EUR');
  assert.equal(ceiling('50000', 'JPY').body.ceiling_cents, 50000);
  assert.equal(ceiling('1.500', 'KWD').body.ceiling_cents, 1500);
  assert.equal(ceiling('0', 'EUR').body.ceiling_cents, 0, '0 is a ceiling: no promotions this period');
  assert.match(ceiling('10.5', 'JPY').error, /no minor unit/);
  for (const currency of ['ABC', 'XYZ', 'EU', '', undefined]) assert.match(ceiling('10', currency).error, /ISO 4217/, String(currency));
  assert.ok(ceiling('', 'EUR').error);
});

test('refund: the amount is checked for shape here and converted by the worker in the charge\'s currency', () => {
  assert.deepEqual(refundAmountShape('25.50'), { ok: true, text: '25.50' });
  assert.deepEqual(refundAmountShape(' 2500 '), { ok: true, text: '2500' });
  assert.equal(refundAmountShape('10.005').ok, true, 'how many decimals is the currency\'s to say');
  for (const bad of ['0', '0.00', '-5', 'abc', '1e3', '1.2.3']) assert.equal(refundAmountShape(bad).ok, false, bad);
});

test('floors group by the same bucket the worker totals use, so a missing currency is not euros', () => {
  const items = [
    { currency: 'EUR', status: 'draft', complete: false, estimated_streams: 1 },
    { currency: '', status: 'draft', complete: false, estimated_streams: 1 },
    { currency: 'XYZ', status: 'draft', complete: false, estimated_streams: 1 },
  ];
  assert.equal(floorsInCurrency(items, 'EUR'), 1);
  assert.equal(floorsInCurrency(items, UNRECORDED_CURRENCY), 2);
});

test('licence terms: a fee is typed and shown in the licence\'s currency', () => {
  const fee = LICENCE_TERM_FIELDS.find((f) => f.type === 'cents');
  assert.equal(toInput(fee, 123450, 'EUR'), '1234.50');
  assert.equal(toInput(fee, 1234, 'JPY'), '1234');
  assert.equal(toInput(fee, 1005, 'KWD'), '1.005');
  assert.deepEqual(fromInput(fee, '1234', 'JPY'), { ok: true, value: 1234 });
  assert.deepEqual(fromInput(fee, '1.005', 'KWD'), { ok: true, value: 1005 });
  assert.equal(fromInput(fee, '1.5', 'JPY').ok, false);
  assert.equal(fromInput(fee, '1.234', 'EUR').ok, false);
  assert.equal(displayValue(fee, 1200000, 'EUR'), 'EUR 12,000');
  assert.equal(displayValue(fee, 1200000, 'JPY'), 'JPY 1,200,000');
  assert.equal(displayValue(fee, 12345, 'KWD'), 'KWD 12.345');
  assert.equal(displayValue(fee, 12345, 'EUR'), 'EUR 123.45');
  assert.match(displayValue(fee, 12345, 'XYZ'), /^12,345 minor units \(currency "XYZ"/);
  assert.match(displayValue(fee, 12345, undefined), /currency not recorded/);
});

test('licence terms: a stored fee on a licence with no usable currency is shown as its count, cannot be edited, and an untouched form does not clear it', () => {
  const fee = LICENCE_TERM_FIELDS.find((f) => f.type === 'cents');
  const stored = { terms: { [fee.key]: 123450 }, sections: {}, revision: 1 };
  const form = initialForm(stored, undefined, undefined);
  assert.equal(form.values[fee.key], '123450', 'never blanked, never divided by a guessed factor');
  assert.equal(fromInput(fee, '1234.50', undefined).ok, false);
  assert.match(fromInput(fee, '1234.50', 'XYZ').message, /Record the licence currency/);
  const untouched = buildSave(stored, { ...form, values: { ...form.values } }, 'A reason', undefined, undefined);
  assert.equal(untouched.ok, false);
  assert.deepEqual(untouched.errors, { form: 'Nothing has changed.' }, 'an untouched fee is unchanged, not an error and not a clear');
  const edited = buildSave(stored, { ...form, values: { ...form.values, [fee.key]: '99' } }, 'A reason', undefined, undefined);
  assert.equal(edited.ok, false);
  assert.match(edited.errors[fee.key], /Record the licence currency/);
});

test('the licence page shows a fee at its own decimals and never as euros by default', () => {
  assert.equal(plain(licenceMoney(9000000, 'EUR')), '€90,000');
  assert.equal(plain(licenceMoney(9012345, 'EUR')), '€90,123.45');
  assert.equal(plain(licenceMoney(9000000, 'JPY')), 'JP¥9,000,000', 'en-GB writes yen as JP¥, to tell it from yuan');
  assert.match(plain(licenceMoney(12345, 'KWD')), /KWD 12\.345/);
  assert.match(licenceMoney(9000000, undefined), /minor units \(currency not recorded\)/);
  assert.equal(licenceMoney(null, 'EUR'), 'Not recorded');
});

test('no financial code in the Revenue page or the licence helpers converts by a factor of 100 or uses a fixed two-decimal box', () => {
  const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const file of ['frontend/src/pages/hq/RevenuePage.jsx', 'frontend/src/lib/licencePage.js']) {
    const text = code(file);
    for (const line of text.split('\n')) {
      if (/bps|percent|pct/i.test(line)) continue; // basis points and progress percentages are not money
      assert.doesNotMatch(line, /\*\s*100\b|\/\s*100\b/, `${file}: ${line.trim()}`);
    }
    assert.doesNotMatch(text, /step="0\.01"/, `${file}: a fixed two-decimal input`);
    assert.doesNotMatch(text, /\|\|\s*'EUR'/, `${file}: a guessed EUR`);
  }
  // The terms form also holds basis points, which really are hundredths of a percent, so its MONEY path is asserted
  // directly: the fee reads and writes through the shared layer, and `hundredths` is used by the bps case alone.
  const terms = code('frontend/src/lib/licenceTermsForm.js');
  const centsCase = (name) => terms.slice(terms.indexOf(`export function ${name}`)).split("case 'bps'")[0];
  assert.match(centsCase('toInput'), /toMajorString\(/);
  assert.match(centsCase('fromInput'), /parseMinor\(/);
  assert.doesNotMatch(centsCase('fromInput'), /hundredths\(/);
  assert.doesNotMatch(terms, /\|\|\s*'EUR'/);
});


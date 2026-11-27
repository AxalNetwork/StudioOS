/**
 * D5373 part 2 — the Use of Funds source text, the capital-relationship legacy dollar columns and the raise_status mail
 * block's committed total read a minor-unit count at the currency's own decimals, not a fixed 100: "JPY 50.00" for 5,000
 * yen, a legacy dollar column on a JPY deal mirrored at x100, a JPY round's total printed at 1/100th. (The cap-table models
 * moved in D5497, which owns their conversions.)
 *
 * Every case runs JPY (no minor unit), KWD (three) and EUR (two; USD and EUR are byte-for-byte what they were), and a
 * currency the layer does not list. Mutation-checked both ways: each function with its old `/ 100` or `* 100` body put back
 * fails the JPY and KWD cases and leaves EUR and USD green; with the new code every case passes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { passage } from '../src/services/useOfFunds/eadwyn.ts';
import { dollarsToCents } from '../src/services/capRelReads.ts';
import { money } from '../src/services/mail/blocks.ts';

// ───────────────────────────────────────────────────── Use of Funds: the source text

test('the Eadwyn source text reads a *_cents count at its currency\'s own decimals', () => {
  assert.equal(passage(500000, 'jpy', 'cash_cents'), 'JPY 500,000', 'five hundred thousand yen, not "JPY 5,000.00"');
  assert.equal(passage(1250, 'KWD', 'amount_to_raise_cents'), 'KWD 1.250');
  assert.equal(passage(150000000, 'eur', 'amount_to_raise_cents'), 'EUR 1,500,000.00');
  assert.equal(passage(150000000, 'usd', 'cash_cents'), 'USD 1,500,000.00', 'the default currency and the wording are unchanged');
  assert.equal(passage(5, 'usd', 'cash_cents'), 'USD 0.05');
  assert.equal(passage(0, 'usd', 'cash_cents'), 'USD 0.00');
  assert.equal(passage(150000000, undefined, 'cash_cents'), 'USD 1,500,000.00', 'no currency is the plan default, usd');
  // Not a count of minor units: untouched.
  assert.equal(passage(18, 'jpy', 'target_runway_months'), '18');
  // A code the layer does not list names the stored count, never a figure at two decimals.
  assert.equal(passage(500000, 'xyz', 'cash_cents'), '500,000 minor units (currency "XYZ" is not one we can price in)');
});

test('the Eadwyn source text takes the currency of the object it reads', () => {
  const text = passage({ currency: 'JPY', amount_to_raise_cents: 5000000, cash_cents: 120000, target_runway_months: 18 });
  assert.equal(text, 'currency: JPY\namount to raise: JPY 5,000,000\ncash: JPY 120,000\ntarget runway months: 18');
  assert.match(passage({ currency: 'KWD', cash_cents: 12345 }), /cash: KWD 12\.345/);
  assert.match(passage({ currency: 'EUR', cash_cents: 12345 }), /cash: EUR 123\.45/);
});

// ───────────────────────────────────────────────────── capital relationships: the legacy REAL column

test('a legacy major-unit column becomes the currency\'s own minor units', () => {
  assert.equal(dollarsToCents(5000, 'JPY'), 5000, 'a JPY 5,000 deal is 5,000, not 500,000');
  assert.equal(dollarsToCents(12.345, 'KWD'), 12345);
  assert.equal(dollarsToCents(1234.56, 'EUR'), 123456);
  assert.equal(dollarsToCents(1234.56, 'USD'), 123456);
  assert.equal(dollarsToCents(1234.56), 123456, 'no currency is USD, as before');
  assert.equal(dollarsToCents(5000, 'XYZ'), null, 'a currency we cannot price in is not guessed');
  for (const v of [null, undefined, '', -1, Number.NaN, 1e14, 'twelve']) assert.equal(dollarsToCents(v, 'JPY'), null, String(v));
});

// ───────────────────────────────────────────────────── the mail block's committed total (capital relationships)

test('the raise_status mail block writes a commitment total at the round currency\'s own decimals', () => {
  assert.equal(money(123456, 'USD'), '$1,234', 'USD is whole dollars, as before');
  assert.equal(money(123456, 'EUR'), 'EUR 1,234');
  assert.equal(money(500000, 'JPY'), 'JPY 500,000', 'five hundred thousand yen, not "JPY 5,000"');
  assert.equal(money(12345000, 'KWD'), 'KWD 12,345', 'a dinar is thousandths');
  assert.equal(money(5000, 'XYZ'), '5,000 minor units (currency "XYZ" is not one we can price in)');
});

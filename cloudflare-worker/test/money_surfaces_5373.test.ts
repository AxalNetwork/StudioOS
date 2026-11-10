/**
 * D5373 — the Worker's money text follows the currency's own minor unit, not a fixed 100. Before, a licence fee of
 * 9,000,000 yen was written into the contract as "EUR 90,000.00", a Stripe coupon of 500 yen off read "5.00 JPY off", and
 * a payout minimum of 5,000 minor units read "50.00 JPY".
 *
 * Mutation-checked: `moneyFromCents` with `/ 100` and a two-place fraction put back; `suffixAmount` with `/ 100.toFixed(2)`
 * put back in the payout line, the programme schedule and the Interview findings; `plainStripeAmount` with `/ 100.toFixed(2)`
 * put back in the coupon line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyFromCents, exclusivityValues } from '../src/services/licenceContract.ts';
import { termLine } from '../src/services/programSchedule.ts';
import { amountWord } from '../src/services/interviewFindings.ts';
import { discountLine } from '../src/services/influencerOffers.ts';
import { termsLine } from '../src/routes/cycle_grow.ts';
import { PAYOUT_MINIMUM_CENTS, payoutMinimumWords } from '../src/services/influencer/payoutReadiness.ts';
import { suffixAmount, codeAmount, plainStripeAmount } from '../../frontend/src/lib/money.js';

test('the contract text writes a licence fee at the licence currency\'s own decimals', () => {
  assert.equal(moneyFromCents(9000000, 'JPY'), 'JPY 9,000,000', 'yen have no minor unit: 9,000,000 is nine million yen');
  assert.equal(moneyFromCents(12345, 'KWD'), 'KWD 12.345');
  assert.equal(moneyFromCents(9000000, 'EUR'), 'EUR 90,000.00');
  assert.equal(moneyFromCents(1, 'USD'), 'USD 0.01');
  assert.equal(moneyFromCents(0, null), 'EUR 0.00', 'licences.currency is NOT NULL DEFAULT EUR: none is the column default');
  assert.equal(moneyFromCents(1234.5, 'EUR'), 'EUR 12.345', 'a fraction of a minor unit keeps every digit, as before');
  assert.equal(moneyFromCents(1234.5, 'JPY'), 'JPY 1,234.5');
  assert.equal(moneyFromCents(500, 'XYZ'), null, 'a code that is not a currency leaves the field unfilled; it is never printed at two decimals');
  assert.equal(moneyFromCents(null, 'JPY'), null);
});

test('the exclusivity values for a contract follow the currency', () => {
  const x = {
    scope_type: 'country_exclusive', countries: ['JP'], regions: [], starts_on: null, ends_on: null, review_on: null, cure_period_days: null,
    targets: [{ year: 1, period_start: '2027-01-01', period_end: '2027-12-31', min_revenue_cents: 5000000, min_cohorts: null, min_active_members: null }],
  };
  const text = (currency: string) => JSON.stringify(exclusivityValues(x, currency));
  assert.match(text('JPY'), /JPY 5,000,000/);
  assert.match(text('KWD'), /KWD 5,000/);
  assert.match(text('EUR'), /EUR 50,000/);
  assert.equal(codeAmount(5000000, 'JPY', { locale: 'en-GB' }), 'JPY 5,000,000');
  assert.equal(codeAmount(5000000, 'KWD', { locale: 'en-GB' }), 'KWD 5,000');
  assert.equal(codeAmount(5000000, 'EUR', { locale: 'en-GB' }), 'EUR 50,000');
});

test('the programme schedule, the Interview findings and the partner terms line write the amount at the currency\'s decimals', () => {
  assert.equal(termLine('fee_cents', 2500, { currency: 'JPY' }), '2,500 JPY');
  assert.equal(termLine('fee_cents', 12345, { currency: 'KWD' }), '12.345 KWD');
  assert.equal(termLine('fee_cents', 200000, { currency: 'EUR' }), '2,000 EUR');
  assert.equal(termLine('fee_cents', 200000, {}), '200,000 minor units (currency not recorded)');
  assert.equal(amountWord({ amount_cents: 2500, currency: 'jpy', period: 'month' }), '2,500 JPY / month');
  assert.equal(amountWord({ amount_cents: 12345, currency: 'kwd' }), '12.345 KWD');
  assert.equal(amountWord({ amount_cents: 120050, currency: 'eur', period: 'year' }), '1,200.50 EUR / year');
  assert.equal(termsLine({ terms_kind: 'referral', terms_amount_cents: 2500, terms_currency: 'jpy' } as never), 'Referral · JPY 2,500');
  assert.equal(termsLine({ terms_kind: 'referral', terms_amount_cents: 12345, terms_currency: 'kwd' } as never), 'Referral · KWD 12.345');
});

test('a Stripe coupon, a payout minimum and a notice line use Stripe\'s units and the currency\'s decimals', () => {
  const promo = (amount_off: number, currency: string) => ({ percent_off: null, amount_off, currency } as never);
  assert.equal(discountLine(promo(500, 'jpy')).startsWith('500 JPY off'), true);
  assert.equal(discountLine(promo(1000, 'kwd')).startsWith('1.000 KWD off'), true);
  assert.equal(discountLine(promo(1000, 'eur')).startsWith('10.00 EUR off'), true);
  assert.equal(plainStripeAmount(10000, 'ISK'), '100', 'Stripe counts ISK in hundredths');
  assert.equal(payoutMinimumWords('EUR'), '50.00 EUR');
  assert.equal(payoutMinimumWords('JPY'), '5,000 JPY', 'the same stored minimum is 5,000 yen, not 50');
  assert.equal(payoutMinimumWords('KWD'), '5.000 KWD');
  assert.equal(suffixAmount(PAYOUT_MINIMUM_CENTS, 'USD'), '50.00 USD');
});

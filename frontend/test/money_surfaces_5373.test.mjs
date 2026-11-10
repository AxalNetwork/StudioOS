/**
 * D5373 — every surface that moved onto `lib/money.js` shows and writes the right count in JPY (no minor unit), KWD
 * (three decimals) and EUR (two). Before this, each divided by 100 or multiplied by 100 whatever the currency: a 2,500
 * yen ticket read ¥25.00, a typed 1.5 KWD fee was sent as 150.
 *
 * Mutation-checked: each migrated function with its old `/ 100` or `* 100` body put back fails its JPY and KWD cases
 * (the EUR case alone would pass, which is why it is not the only one).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventCurrency, formatEventPrice, formatMinorOrCount, formatStripeAmount, fromStripeUnits, majorToMinor, parseStripeAmount,
  plainAmount, plainStripeAmount, codeAmount, suffixAmount, toStripeUnits,
} from '../src/lib/money.js';
import { priceOf } from '../src/pages/events/myEventsModel.js';
import { money as drawerMoney } from '../src/pages/events/eventDrawersModel.js';
import { money as deskMoney } from '../src/pages/admin/events/eventsDeskModel.js';
import { moneyOf } from '../src/components/checkout/checkoutModel.js';
import { amountText, priceText } from '../src/pages/admin/payments/payModel.js';
import { centsOf, pricePreview } from '../src/pages/admin/payments/dialogModel.js';
import { formatMoney as partnerMoney, ruleDraftOf, ruleEditInput } from '../src/lib/partnerEarnings.js';
import { disputeMoney } from '../src/components/hqReview/hqReviewCopy.js';
import { moneyCents } from '../src/workspaces/boards/format.js';
import { money as grantMoney, termField, termInput, termsPayload } from '../src/pages/admin/grants/grantsModel.js';
import { buildPricing, centsOf as pricingCentsOf, money as pricingMoney } from '../src/pages/admin/grants/programPricingModel.js';
import { defaultsBody, money as influencerMoney } from '../src/pages/admin/programs/influencersModel.js';
import { FIRING_TRIGGERS, money as referralMoney, termsBody } from '../src/pages/admin/programs/referralPartnersModel.js';
import { money as influencerSectionMoney } from '../src/pages/influencer/section/influencerSectionModel.js';
import { disputeCents, money as licenceTabsMoney } from '../src/pages/subsidiary/licence/licenceTabsModel.js';
import { money as invoiceMoney, parseAmount } from '../src/pages/admin/licenceFeeInvoicesModel.js';
import { buildCoreSave, coreFormFrom } from '../src/lib/licenceCoreTermsForm.js';
import { buildSave as buildExclusivity, yearLine } from '../src/pages/admin/licences/exclusivityModel.js';
import { centsFrom, figure } from '../src/pages/admin/licences/countryPricingModel.js';
import { termAsItStands } from '../src/lib/escalationKinds.js';
import { money as wellbeingMoney, serviceBody, serviceDraft, servicePrice } from '../src/pages/wellbeing/wellbeingModel.js';
import { amountToCents, centsMoney } from '../src/components/deals/dealRoomCopy.js';
import { draftFrom, payloadFrom } from '../src/pages/cycles/suggestionForms.js';

const plain = (s) => String(s).replace(/[  ]/g, ' ');
// 2,500 yen, 12.345 dinars, 1,234.56 euros: the same stored count would read 25, 123.45 and 12,345,600 under a fixed 100.
const JPY = [2500, 'JPY'];
const KWD = [12345, 'KWD'];
const EUR = [123456, 'EUR'];

test('the layer: plain, code-first and code-last amounts, and the count named when the currency is unusable', () => {
  assert.equal(plainAmount(...JPY), '2,500');
  assert.equal(plainAmount(...KWD), '12.345');
  assert.equal(plainAmount(...EUR), '1,234.56');
  assert.equal(plainAmount(2000, 'EUR', { trimWhole: true }), '20');
  assert.equal(codeAmount(...JPY), 'JPY 2,500');
  assert.equal(codeAmount(...KWD), 'KWD 12.345');
  assert.equal(suffixAmount(...EUR), '1,234.56 EUR');
  assert.equal(suffixAmount(...JPY), '2,500 JPY');
  assert.equal(plain(formatMinorOrCount(...KWD)), 'KWD 12.345');
  assert.equal(formatMinorOrCount(5, 'XYZ'), '5 minor units (currency "XYZ" is not one we can price in)');
  assert.equal(formatMinorOrCount(5, null), '5 minor units (currency not recorded)');
  assert.equal(formatMinorOrCount('x', 'EUR'), null);
  assert.equal(majorToMinor(19.99, 'EUR'), 1999);
  assert.equal(majorToMinor(2500, 'JPY'), 2500);
  assert.equal(majorToMinor(1.5, 'KWD'), 1500);
  assert.equal(majorToMinor(1, 'XYZ'), null);
});

test('Stripe units: ISK and UGX in hundredths, three-decimal currencies in steps of ten, everything else its own minor unit', () => {
  assert.equal(fromStripeUnits(2500, 'JPY'), 2500);
  assert.equal(fromStripeUnits(10000, 'ISK'), 100);
  assert.equal(fromStripeUnits(150, 'ISK'), null, 'half a króna is not an ISK amount');
  assert.equal(toStripeUnits(100, 'UGX'), 10000);
  assert.equal(toStripeUnits(12340, 'KWD'), 12340);
  assert.equal(toStripeUnits(12345, 'KWD'), null, 'a three-decimal currency is taken in steps of ten');
  assert.equal(plain(formatStripeAmount(2500, 'jpy')), '¥2,500');
  assert.equal(plain(formatStripeAmount(12340, 'kwd')), 'KWD 12.340');
  assert.equal(plain(formatStripeAmount(1999, 'eur')), '€19.99');
  assert.equal(plain(formatStripeAmount(10000, 'isk')), 'ISK 100');
  assert.equal(formatStripeAmount(150, 'isk'), '150 Stripe units (not a whole amount of ISK)');
  assert.equal(plainStripeAmount(5, 'xyz'), '5 minor units (currency "XYZ" is not one we can price in)');
  assert.deepEqual(parseStripeAmount('2500', 'JPY'), { ok: true, minor: 2500, units: 2500, exponent: 0 });
  assert.deepEqual(parseStripeAmount('12.34', 'KWD'), { ok: true, minor: 12340, units: 12340, exponent: 3 });
  assert.deepEqual(parseStripeAmount('100', 'ISK'), { ok: true, minor: 100, units: 10000, exponent: 0 });
  assert.equal(parseStripeAmount('12.345', 'KWD').ok, false);
  assert.equal(parseStripeAmount('2500.5', 'JPY').reason, 'decimals');
});

test('event tickets: a JPY ticket is ¥2,500, not ¥25; the column default is USD; an unlisted code is named', () => {
  assert.equal(plain(formatEventPrice(2500, 'jpy')), '¥2,500');
  assert.equal(plain(formatEventPrice(12345, 'kwd')), 'KWD 12.345');
  assert.equal(plain(formatEventPrice(1999, 'eur')), '€19.99');
  assert.equal(plain(formatEventPrice(500, null)), '$5.00');
  assert.equal(formatEventPrice(500, 'xyz'), '500 minor units (currency "XYZ" is not one we can price in)');
  assert.equal(eventCurrency(' eur '), 'EUR');
  assert.equal(eventCurrency(''), 'USD');
  for (const [cents, code, want] of [[2500, 'jpy', '¥2,500'], [12345, 'kwd', 'KWD 12.345'], [1999, 'eur', '€19.99']]) {
    assert.equal(plain(priceOf({ price_cents: cents, currency: code })), want, `my events ${code}`);
    assert.equal(plain(drawerMoney(cents, code)), want, `drawers ${code}`);
    assert.equal(plain(deskMoney(cents, code)), want, `events desk ${code}`);
  }
  assert.equal(deskMoney(4000, ''), '4,000 minor units (currency not recorded)', 'no currency is not dollars');
});

test('checkout and the payments console read and write Stripe units at the currency\'s own decimals', () => {
  assert.equal(plain(moneyOf(2500, 'jpy')), '¥2,500');
  assert.equal(plain(moneyOf(12340, 'kwd')), 'KWD 12.340');
  assert.equal(plain(moneyOf(1999, 'eur')), '€19.99');
  assert.equal(priceText({ unit_amount: 2500, currency: 'jpy', interval: 'month' }), '2,500 JPY / month');
  assert.equal(priceText({ unit_amount: 12340, currency: 'kwd', interval: 'month' }), '12.340 KWD / month');
  assert.equal(priceText({ unit_amount: 1999, currency: 'eur', interval: 'month' }), '19.99 EUR / month');
  assert.equal(amountText({ unit_amount: 10000, currency: 'isk' }), '100 ISK');
  assert.equal(centsOf('2500', 'jpy'), 2500);
  assert.equal(centsOf('12.34', 'kwd'), 12340);
  assert.equal(centsOf('12.345', 'kwd'), null);
  assert.equal(centsOf('19.99', 'eur'), 1999);
  assert.equal(centsOf('100', 'isk'), 10000);
  assert.equal(centsOf('19.999', 'eur'), null);
  assert.equal(centsOf('204.00'), 20400, 'USD when the dialog names none: the catalogue default');
  assert.equal(pricePreview({ cents: 2500, currency: 'jpy', billing: 'month', isPlan: false }), '2,500 JPY / month.');
});

test('partner earnings and disputes: the stored count at the currency\'s decimals; the rule editor is the table default (USD)', () => {
  assert.equal(plain(partnerMoney(2500, 'JPY')), '¥2,500');
  assert.equal(plain(partnerMoney(12345, 'KWD')), 'KWD 12.345');
  assert.equal(plain(partnerMoney(1999, 'EUR')), '€19.99');
  assert.equal(partnerMoney(500, 'XYZ'), '500 minor units');
  assert.equal(ruleEditInput({ kind: 'fixed', value: '49.50', description: '', active: true }).body.amount_cents, 4950);
  assert.ok(ruleEditInput({ kind: 'fixed', value: '49.505', description: '', active: true }).error);
  assert.equal(ruleDraftOf({ amount_cents: 4950, active: 1 }).value, '49.50');
  assert.match(plain(disputeMoney(2500, 'jpy')), /^JP¥2,500 JPY$/);
  assert.equal(plain(disputeMoney(12340, 'kwd')), 'KWD 12.340');
  assert.match(plain(disputeMoney(1999, 'eur')), /^€19\.99 EUR$/);
  for (const [cents, code, want] of [[2500, 'JPY', '¥2,500'], [12345, 'KWD', 'KWD 12.345'], [1999, 'EUR', '€19.99']]) {
    assert.equal(plain(moneyCents(cents, code)), want, `boards ${code}`);
    assert.equal(plain(influencerMoney(cents, code)), want, `influencers ${code}`);
    assert.equal(plain(influencerSectionMoney(cents, code)), want, `influencer section ${code}`);
    assert.equal(plain(referralMoney(cents, code)), want, `referral partners ${code}`);
    assert.equal(plain(wellbeingMoney(cents, code)), want, `wellbeing ${code}`);
    assert.equal(plain(centsMoney(cents, code)), want, `deal room ${code}`);
  }
  assert.equal(referralMoney(500, undefined), '500 minor units (currency not recorded)', 'no currency is not USD');
});

test('grants and program prices: the fee is typed in the grant\'s own currency', () => {
  assert.equal(termInput('fee_cents', '2000', 'EUR'), 200000);
  assert.equal(termInput('fee_cents', '2500', 'JPY'), 2500);
  assert.equal(termInput('fee_cents', '12.345', 'KWD'), 12345);
  assert.equal(termInput('fee_cents', '2000', undefined), 2000, 'no currency: the text is the stored count, never rescaled');
  assert.equal(termField('fee_cents', 2500, 'JPY'), '2500');
  assert.equal(termField('fee_cents', 12345, 'KWD'), '12.345');
  assert.equal(termField('fee_cents', 200000, 'EUR'), '2000.00');
  assert.deepEqual(termsPayload(['fee_cents'], { fee_cents: '2500', currency: 'JPY' }, { fee_cents: 2500, currency: 'JPY' }), {}, 'an untouched yen fee sends nothing');
  assert.equal(plain(grantMoney(2500, 'JPY')), 'JP¥2,500');
  assert.equal(plain(grantMoney(12345, 'KWD')), 'KWD 12.345');
  assert.equal(pricingMoney(2500, 'JPY'), 'JPY 2,500');
  assert.equal(pricingMoney(12345, 'KWD'), 'KWD 12.345');
  assert.equal(pricingMoney(1999, 'EUR'), 'EUR 19.99');
  assert.equal(pricingCentsOf('2500', 'JPY'), 2500);
  assert.equal(pricingCentsOf('12.345', 'KWD'), 12345);
  assert.ok(Number.isNaN(pricingCentsOf('1.5', 'JPY')));
  const rec = { available: true, currency: 'JPY' };
  assert.equal(buildPricing({ mode: 'override', rec, form: { fee: '15000', override_reason: 'Pilot' } }).pricing.accepted_annual_fee_cents, 15000);
});

test('influencer budgets and referral-partner terms are typed in their own currency', () => {
  const budget = (b, currency) => defaultsBody({ rate: '', invoices: '', budget: b, currency });
  assert.equal(budget('250', 'JPY').body.offer_budget_cents, 250);
  assert.equal(budget('1.5', 'KWD').body.offer_budget_cents, 1500);
  assert.equal(budget('250', 'USD').body.offer_budget_cents, 25000);
  assert.ok(budget('1.5', 'JPY').error, 'half a yen is refused, not rounded');
  const form = (value, currency) => ({
    contract_slug: 'partner_custom', triggers: [{ rule_key: FIRING_TRIGGERS[0].key, kind: 'flat', value }],
    cap_per_intro: '', overall_cap: '', currency, starts_on: '2026-11-01', ends_on: '', sectors: '',
  });
  assert.equal(termsBody(form('2500', 'JPY')).body.triggers[0].amount_cents, 2500);
  assert.equal(termsBody(form('1.5', 'KWD')).body.triggers[0].amount_cents, 1500);
  assert.equal(termsBody(form('19.99', 'EUR')).body.triggers[0].amount_cents, 1999);
  assert.ok(termsBody(form('1.5', 'JPY')).error);
  assert.match(termsBody({ ...form('10', 'xx') }).error, /three-letter code/, 'the currency is checked first');
});

test('licence money: display, fee form, disputes, invoices, exclusivity and country pricing follow the licence currency', () => {
  for (const [cents, code, want] of [[2500, 'JPY', 'JP¥2,500'], [12345, 'KWD', 'KWD 12.345'], [123456, 'EUR', '€1,234.56']]) {
    assert.equal(plain(licenceTabsMoney(cents, code)), want, `licence tabs ${code}`);
  }
  assert.equal(licenceTabsMoney(500, null), '500 minor units (currency not recorded)', 'a missing currency is not euros');
  assert.deepEqual(disputeCents('2500', 99999999, 'JPY'), { ok: true, cents: 2500 });
  assert.deepEqual(disputeCents('12.345', 99999999, 'KWD'), { ok: true, cents: 12345 });
  assert.deepEqual(disputeCents('19.99', 99999999, 'EUR'), { ok: true, cents: 1999 });
  assert.equal(disputeCents('12.5', 99999999, 'JPY').ok, false);
  assert.equal(invoiceMoney(...JPY), 'JPY 2,500');
  assert.equal(invoiceMoney(...KWD), 'KWD 12.345');
  assert.equal(invoiceMoney(...EUR), '€1,234.56');
  assert.equal(parseAmount('2,500', 'JPY'), 2500);
  assert.equal(parseAmount('12.345', 'KWD'), 12345);
  assert.equal(parseAmount('€19.99', 'EUR'), 1999);
  assert.equal(parseAmount('2500.5', 'JPY'), null);
  const licence = (cents, currency) => ({ annual_fee_cents: cents, currency, term_years: 3, revenue_share_bps: 3000, token_split_bps: 5000, starts_on: '2026-01-01', renews_on: '2029-01-01' });
  assert.equal(coreFormFrom(licence(2500, 'JPY')).annual_fee, '2500');
  assert.equal(coreFormFrom(licence(12345, 'KWD')).annual_fee, '12.345');
  assert.equal(coreFormFrom(licence(123456, 'EUR')).annual_fee, '1234.56');
  const save = (fee, currency) => {
    const base = coreFormFrom(licence(1, currency));
    return buildCoreSave({ form: { ...base, annual_fee: fee }, base, revision: 1, reason: 'why' });
  };
  assert.equal(save('12000', 'JPY').body.annual_fee_cents, 12000);
  assert.equal(save('1.234', 'KWD').body.annual_fee_cents, 1234);
  assert.equal(save('19.99', 'EUR').body.annual_fee_cents, 1999);
  assert.ok(save('12000.5', 'JPY').errors.annual_fee);
  const exForm = (rev) => ({ scope_type: 'regional_exclusive', countries: '', regions: 'US-CA', reason: 'why not', targets: [{ year: 1, period_start: '2027-01-01', period_end: '2027-12-31', min_revenue: rev, min_cohorts: '', min_active_members: '' }] });
  assert.equal(buildExclusivity({ form: exForm('100000'), revision: 1, currency: 'JPY' }).body.targets[0].min_revenue_cents, 100000);
  assert.equal(buildExclusivity({ form: exForm('1.5'), revision: 1, currency: 'KWD' }).body.targets[0].min_revenue_cents, 1500);
  assert.equal(buildExclusivity({ form: exForm('100000'), revision: 1, currency: 'EUR' }).body.targets[0].min_revenue_cents, 10000000);
  assert.equal(buildExclusivity({ form: exForm('1.5'), revision: 1, currency: 'JPY' }).ok, false);
  assert.equal(yearLine({ year: 1, period_start: 'a', period_end: 'b', status: 'met', metrics: [{ metric: 'qualifying_revenue_cents', measured: 2500, target: 5000 }] }, 'JPY').metrics[0].text, 'Revenue: JPY 2,500 of JPY 5,000');
  assert.equal(figure(...JPY.slice(0, 1), 'cents', 'JPY'), 'JPY 2,500');
  assert.equal(figure(12345, 'cents', 'KWD'), 'KWD 12.345');
  assert.equal(centsFrom('42000', 'JPY'), 42000);
  assert.equal(centsFrom('12.345', 'KWD'), 12345);
  assert.equal(centsFrom('42000.5', 'EUR'), 4200050);
  assert.ok(Number.isNaN(centsFrom('1.5', 'JPY')));
  assert.equal(termAsItStands('fee', { annual_fee_cents: 2500, currency: 'JPY' }), 'Annual fee JPY 2,500');
  assert.equal(termAsItStands('fee', { annual_fee_cents: 12345, currency: 'KWD' }), 'Annual fee KWD 12.345');
});

test('wellbeing services and deal-room wires are typed in their own currency', () => {
  assert.equal(servicePrice({ price_cents: 2500, currency: 'JPY' }), 'JPY 2,500');
  assert.equal(servicePrice({ price_cents: 12345, currency: 'KWD' }), 'KWD 12.345');
  assert.equal(servicePrice({ price_cents: 123456, currency: 'EUR' }), 'EUR 1,234.56');
  assert.equal(serviceDraft({ price_cents: 2500, currency: 'JPY' }).price, '2500');
  assert.equal(serviceDraft({ price_cents: 12345, currency: 'KWD' }).price, '12.345');
  assert.equal(serviceDraft({ price_cents: 123456, currency: 'EUR' }).price, '1234.56');
  const body = (price, currency) => serviceBody({ title: 'x', minutes: '30', price, currency });
  assert.equal(body('1500', 'jpy').body.price_cents, 1500);
  assert.equal(body('1.5', 'kwd').body.price_cents, 1500);
  assert.equal(body('19.99', 'eur').body.price_cents, 1999);
  assert.equal(body('0', 'eur').body.price_cents, 0, 'zero is a free session');
  assert.ok(body('1.5', 'jpy').fields.price);
  assert.equal(amountToCents('12,500', 'JPY'), 12500);
  assert.equal(amountToCents('12.5', 'KWD'), 12500);
  assert.equal(amountToCents('12,500.00', 'EUR'), 1250000);
  assert.ok(Number.isNaN(amountToCents('12.5', 'JPY')));
  assert.ok(Number.isNaN(amountToCents('0', 'EUR')));
});

test('suggestion forms: the amount is typed in the draft\'s currency, USD when it names none', () => {
  const send = (amount, currency) => payloadFrom('competitor_mention', { name: 'Acme', context: '', amount, currency, period: '' });
  assert.equal(send('2500', 'jpy').payload.amount_cents, 2500);
  assert.equal(send('1.5', 'kwd').payload.amount_cents, 1500);
  assert.equal(send('49.99', 'eur').payload.amount_cents, 4999);
  assert.equal(send('49.99', '').payload.amount_cents, 4999);
  assert.ok(send('1.5', 'jpy').errors.amount);
  assert.equal(draftFrom('competitor_mention', { name: 'Acme', amount_cents: 2500, currency: 'jpy' }).amount, '2500');
  assert.equal(draftFrom('competitor_mention', { name: 'Acme', amount_cents: 1500, currency: 'kwd' }).amount, '1.5');
  assert.equal(draftFrom('competitor_mention', { name: 'Acme', amount_cents: 4999 }).amount, '49.99');
});

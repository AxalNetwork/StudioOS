/**
 * D1048 (#2451) — the checkout sheet: who pays here, the plan summary from the
 * public plans read (the price id from `prices[]`, the saving the Worker
 * computed, the AI allowance, storage as not read), and Pricing's Upgrade
 * opening it in place without starting a payment until Continue.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/checkout_sheet_d1048.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { familyOf, includedLines, intervalPrice, intervalsOf, sheetMode } from '../src/components/checkout/checkoutModel.js';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import { billingAlertsApi } from '../src/lib/api/billingAlerts.js';
import { api } from '../src/lib/api.js';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import CheckoutSheet from '../src/components/checkout/CheckoutSheet.jsx';
import { checkoutApi } from '../src/lib/api/billingCheckout.js';
import {
  DECLINE, FREE_FIRST, STEP_UP_LINE, cardWords, dayOf, declineFamily, moneyOf, planKeyOf, promoState, quoteView, refusalView,
  savedCardsApply, signinHref, statusView, whatYouGet,
} from '../src/components/checkout/checkoutModel.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const price = (unit_amount, interval, extra = {}) => ({
  price_id: `price_${unit_amount}_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1,
  allowance_microusd: Math.floor((unit_amount * 2500) / (interval === 'year' ? 12 : 1)), ...extra,
});
const GROWTH = {
  family: 'founder', licence_key: 'founder:growth', product_id: 'prod_growth', plan_name: 'Validate + Build', free: false,
  prices: [price(2000, 'month'), price(20400, 'year')],
  monthly: { unit_amount: 2000, currency: 'usd', allowance_microusd: 5_000_000 }, yearly: { unit_amount: 20400, currency: 'usd', allowance_microusd: 4_250_000 },
  yearly_saving_percent: 15,
  catalogue: { key: 'founder:growth' },
};
const SPEC = { id: 'growth', name: 'Validate + Build', tag: 'Prove the idea, then build the company.', feats: ['Unlimited startups', '$5.00 of AI tokens a month'] };

// ---------------------------------------------------------------- the model

test('a price from prices[], with its id; yearly as a monthly figure and the billed total; none for another currency', () => {
  const m = intervalPrice(GROWTH, 'monthly');
  assert.deepEqual([m.priceId, m.line, m.subtotal, m.ai], ['price_2000_month', '$20 / month', '$20.00', '$5.00 of AI a month']);
  const y = intervalPrice(GROWTH, 'yearly');
  assert.deepEqual([y.priceId, y.line, y.subtotal], ['price_20400_year', '$17 / month, $204 billed yearly', '$204.00']);
  assert.equal(intervalPrice({ prices: [price(2000, 'month', { currency: 'eur' })] }, 'monthly'), null);
  assert.equal(intervalPrice({ prices: [{ ...price(2000, 'month'), price_id: undefined }] }, 'monthly'), null, 'no id, nothing to pay');
  assert.equal(intervalsOf(GROWTH).saving, 'Save 15%', 'the Worker\'s saving, never computed here');
  assert.equal(intervalsOf({ ...GROWTH, yearly_saving_percent: null }).saving, null);
});

test('who pays here: staff, an Explorer, another profile, no price, a change on Billing, or a new plan', () => {
  assert.equal(sheetMode({ role: 'admin', plan: GROWTH }), 'staff');
  assert.equal(sheetMode({ role: 'exploring', plan: GROWTH }), 'explorer');
  assert.equal(sheetMode({ role: 'investor', plan: GROWTH }), 'other');
  assert.equal(sheetMode({ role: 'founder', plan: { ...GROWTH, prices: [] } }), 'unsellable');
  assert.equal(sheetMode({ role: 'founder', plan: GROWTH, held: 'studio' }), 'change', 'the intent refuses a second subscription (D892)');
  assert.equal(sheetMode({ role: 'founder', plan: GROWTH, held: 'free' }), 'pay');
  assert.equal(sheetMode({ role: 'founder', plan: GROWTH, held: null }), 'pay');
  assert.equal(familyOf(GROWTH).label, 'Founder');
});

test('Included: the AI allowance, storage as not read, the card\'s lines without its own AI line', () => {
  const lines = includedLines(GROWTH, SPEC, 'monthly');
  assert.deepEqual(lines.map((l) => [l.text, l.measured]), [
    ['$5.00 of AI a month', true],
    ['Storage per plan is #2449’s, not read here yet.', false],
    ['Unlimited startups', true],
  ]);
  assert.equal(includedLines({ ...GROWTH, prices: [{ ...price(2000, 'month'), allowance_microusd: 0 }] }, SPEC, 'monthly')[0].text, 'AI runs from AI tokens you top up');
});

// ---------------------------------------------------------------- mounted

test('mounted on /pricing: Upgrade opens the sheet in place, quoted, no payment starts until Pay, and Close returns to the page', async () => {
  const restore = installDocument();
  // No geometry in this DOM; Pricing's tab scrolling is browser-only (as pricing_tab_comparisons does).
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => { const node = createElement(tag); node.querySelector = () => null; return node; };
  const original = { ...publicPricingApi };
  const fetchWas = globalThis.fetch;
  const seen = [];
  // D1053: the quote answers with the plan's figures; everything else with {}.
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const body = String(url).includes('/billing/checkout/quote') ? { ...NEW_QUOTE, vat: { amount: null, reason: 'Tax is not charged on plans here.' }, total_due_today: 2000 } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  publicPricingApi.plansAndPacks = async () => ({ plans: [{ family: 'founder', licence_key: 'founder:free', free: true, prices: [] }, GROWTH], packs: [] });
  publicPricingApi.aiModels = async () => ({ ok: true, models: [] });
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  try {
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/pricing'] },
      React.createElement(PricingBody, { user: { role: 'founder', subscription_tier: 'free' } }))));
    await settle();
    const upgrade = byId('pricing-checkout-growth');
    assert.ok(upgrade, 'the paid card opens the sheet');
    assert.ok(!walk(container).some((n) => n.tagName === 'A' && String(props(n).href || '').startsWith('/pricing/products/')), 'no second pricing page');
    await act(async () => props(upgrade).onClick());
    await settle();
    assert.ok(byId('checkout-sheet'), 'the sheet is open');
    assert.equal(props(byId('checkout-sheet'))['aria-modal'], 'true');
    assert.match(text(byId('checkout-summary')), /Founder.*Validate \+ Build.*\$20 \/ month.*\$5\.00 of AI a month.*not read here yet.*Subtotal\$20\.00.*Due today\$20\.00/s);
    // D1053 moved the sheet onto the quote: Continue and today's form are gone; opening quotes and starts nothing.
    assert.ok(byId('checkout-pay'), 'the one primary button');
    assert.ok(seen.some((u) => u.includes('/billing/checkout/quote')), 'the totals are quoted');
    assert.ok(!seen.some((u) => u.includes('/payments/intent') || u.includes('/billing/checkout/start')), 'opening the sheet starts no payment');
    await act(async () => props(byId('checkout-interval-yearly')).onClick());
    assert.match(text(byId('checkout-price')), /\$17 \/ month, \$204 billed yearly/);
    const close = walk(container).find((n) => n.tagName === 'BUTTON' && props(n)['aria-label'] === 'Close');
    await act(async () => props(close).onClick());
    assert.ok(!byId('checkout-sheet'), 'Close returns to the page');
  } finally {
    await act(async () => root.unmount());
    Object.assign(publicPricingApi, original);
    globalThis.fetch = fetchWas;
    restore();
  }
});

// ---------------------------------------------------------------- the wiring

// D1053 retired Continue and today's form for plans; what still holds of D1048's wiring:
test('the sheet loads Stripe lazily, never at import, and has no alert or confirm', () => {
  const src = read('frontend/src/components/checkout/CheckoutSheet.jsx');
  assert.match(src, /= lazy\(\(\) => import\('\.\/PlanCardForm'\)\);/);
  assert.doesNotMatch(src, /^import .*(PlanCardForm|stripe)/m);
  assert.doesNotMatch(src, /window\.(alert|confirm)|(?<![.\w])alert\(|(?<![.\w])confirm\(/);
  assert.ok(read('design/incoming/Checkout · Boards.dc.html').includes('PAYX21'));
});


// D1133: a sheet opened while the plan read is pending must use its eventual result.
test('D1133 Pricing passes the Advisor and Partner plan read to the open sheet, with failure/retry', async () => {
  for (const [role, tab, key] of [['advisor', 'advisor', 'advisor'], ['partner', 'operating-partner', 'partner']]) {
    const restore = installDocument();
    const create = document.createElement.bind(document);
    document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; return n; };
    const saved = { ...publicPricingApi }; const planStatus = api.planStatus;
    let resolvePlan; let fail = false;
    api.planStatus = () => fail ? Promise.reject(new Error('fixture down')) : new Promise((r) => { resolvePlan = r; });
    publicPricingApi.plansAndPacks = async () => ({ plans: [{ ...GROWTH, family: role, licence_key: key, plan_name: 'Synthetic Pro' }], packs: [] });
    publicPricingApi.aiModels = async () => ({ models: [] });
    // D1053: the sheet quotes once the plan is read; the quote is the test's.
    const savedCheckout = { ...checkoutApi }; let nextQuote = null;
    checkoutApi.quote = async () => nextQuote; checkoutApi.methods = async () => ({ methods: [] });
    const container = document.createElement('div'); const root = createRoot(container);
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
    const settle = async () => { for (let n = 0; n < 6; n++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
    try {
      await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/pricing?for=' + tab] }, React.createElement(ViewModeContext.Provider, { value: { shellRole: role } }, React.createElement(PricingBody, { user: { role } })))));
      await settle();
      await act(async () => props(byId('pricing-checkout-pro')).onClick()); await settle();
      assert.ok(byId('checkout-mode-reading')); assert.ok(!byId('checkout-pay'));
      nextQuote = CHANGE_UP;
      await act(async () => resolvePlan({ plan_group: role, status: 'active' })); await settle();
      assert.ok(byId('checkout-change-upgrade'), 'a held plan is changed here since D1053'); assert.ok(byId('checkout-step-up'));
      // Remount to exercise a failed read while a sheet is open, then its own retry.
      await act(async () => root.unmount());
      const next = createRoot(container); fail = true;
      await act(async () => next.render(React.createElement(MemoryRouter, { initialEntries: ['/pricing?for=' + tab] }, React.createElement(ViewModeContext.Provider, { value: { shellRole: role } }, React.createElement(PricingBody, { user: { role } }))))); await settle();
      await act(async () => props(byId('pricing-checkout-pro')).onClick()); await settle();
      assert.ok(byId('checkout-mode-unreadable')); assert.ok(!byId('checkout-pay'));
      fail = false;
      await act(async () => props(byId('checkout-plan-retry')).onClick()); await settle();
      assert.ok(byId('checkout-mode-reading'));
      nextQuote = NEW_QUOTE;
      await act(async () => resolvePlan({ plan_group: role, status: 'free' })); await settle();
      assert.ok(byId('checkout-pay'));
      await act(async () => next.unmount());
    } finally { Object.assign(publicPricingApi, saved); Object.assign(checkoutApi, savedCheckout); api.planStatus = planStatus; restore(); }
  }
});


test('D1133 renewal clients prepare the mounted alert actions with explicit POSTs', async () => {
  const restore = installDocument(); const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init) => { calls.push([String(url), init.method, init.body]); return new Response('{}', { status: 200 }); };
  try {
    await billingAlertsApi.pay(17); await billingAlertsApi.updateCard(17, 'fixture_nonce_1');
    assert.deepEqual(calls, [['/api/billing/alerts/17/pay', 'POST', undefined], ['/api/billing/alerts/17/update-card', 'POST', JSON.stringify({ nonce: 'fixture_nonce_1' })]]);
  } finally { globalThis.fetch = original; restore(); }
});

// ================================================================ D1053 (#2904)
//
// Part 5: the sheet complete on D1051's quote, start and status routes. Stripe
// is stood in for through the sheet's `bridge` (the card form, a saved card,
// an existing intent), and every route through `checkoutApi`. No network, no
// Stripe, and fake figures only.


const NEW_QUOTE = {
  mode: 'new', plan_key: 'founder:growth', plan_name: 'Validate + Build', interval: 'monthly', unit_amount: 2000, currency: 'usd',
  discount: null, discount_reason: null, vat: { amount: 100, reason: null }, total_due_today: 2100, total_reason: null, step_up_required: false,
};
const CHANGE_UP = {
  mode: 'change', direction: 'upgrade', plan_name: 'Raise + Grow', unit_amount: 10000, currency: 'usd', proration_amount: 8710,
  change_at: 'now', vat: { amount: null, reason: 'Tax is not charged on plans here.' }, total_due_today: 8710, total_reason: null, step_up_required: true,
};
const CHANGE_DOWN = { ...CHANGE_UP, direction: 'downgrade', plan_name: 'Validate + Build', proration_amount: 0, total_due_today: 0, change_at: '2026-11-21T00:00:00Z' };

test('D1053 the totals are the quote’s: Pay [$total] only when it was sent, its reason otherwise, never $0.00 for a missing figure', () => {
  const v = quoteView(NEW_QUOTE);
  assert.deepEqual(v.rows.map((r) => [r.key, r.value]), [['subtotal', '$20.00'], ['vat', '$1.00'], ['due', '$21.00']]);
  assert.equal(v.button, 'Pay $21.00');
  const noTotal = quoteView({ ...NEW_QUOTE, vat: { amount: null, reason: 'Tax is worked out from your billing address when you pay.' }, total_due_today: null, total_reason: 'The total, with tax, shows in the payment form.' });
  assert.equal(noTotal.button, 'Pay');
  assert.deepEqual(noTotal.rows.slice(1).map((r) => [r.value, r.reason]), [[null, 'Tax is worked out from your billing address when you pay.'], [null, 'The total, with tax, shows in the payment form.']]);
  const coded = quoteView({ ...NEW_QUOTE, discount: { amount: 500, code: 'LAUNCH20' }, total_due_today: 1600 });
  assert.deepEqual(coded.rows[1], { key: 'discount', label: 'Discount · LAUNCH20', value: '−$5.00' });
  const free = quoteView({ ...NEW_QUOTE, discount: { amount: 2000, code: 'FIRSTMONTH' }, total_due_today: 0 });
  assert.deepEqual([free.free, free.button], [true, 'Start my plan']);
  assert.equal(quoteView({ ...NEW_QUOTE, total_due_today: 0 }).free, false, 'a zero total without a code is not a free first payment');
  assert.equal(moneyOf(null), null);
  assert.equal(moneyOf(0), '$0.00', 'a zero the Worker sent is a figure');
  assert.equal(quoteView(null), null);
});

test('D1053 a change in place: an upgrade now with its proration, a downgrade at the period’s end with the storage note, both behind the step-up', () => {
  const up = quoteView(CHANGE_UP);
  assert.equal(up.change, 'upgrade');
  assert.deepEqual(up.rows.map((r) => [r.key, r.value ?? r.reason]), [['plan', '$100.00'], ['proration', '$87.10'], ['vat', 'Tax is not charged on plans here.'], ['due', '$87.10']]);
  assert.equal(up.button, 'Confirm change · $87.10');
  assert.match(up.line, /changes to Raise \+ Grow now/);
  assert.equal(up.storage, null);
  assert.equal(up.stepUp, STEP_UP_LINE);
  const unread = quoteView({ ...CHANGE_UP, proration_amount: null, total_due_today: null, total_reason: 'The prorated amount could not be read from Stripe. Nothing is charged until you confirm.' });
  assert.deepEqual(unread.rows.find((r) => r.key === 'proration'), { key: 'proration', label: 'Prorated difference', value: null, reason: 'The prorated amount could not be read from Stripe. Nothing is charged until you confirm.' });
  assert.equal(unread.button, 'Confirm change');
  const down = quoteView(CHANGE_DOWN);
  assert.equal(down.button, 'Schedule the change');
  assert.match(down.line, /on 21 Nov 2026\. Nothing is charged today\./);
  assert.match(down.storage, /nothing is deleted/);
  assert.ok(!down.rows.some((r) => r.key === 'proration'), 'a downgrade prorates nothing');
  assert.match(quoteView({ ...CHANGE_DOWN, change_at: null }).line, /the end of your paid period/);
  assert.equal(dayOf('nonsense'), null);
  assert.equal(dayOf(1795219200), '21 Nov 2026', 'epoch seconds');
});

test('D1053 PAYX5: the promo’s states, in the canvas’s words; a raw reason is never shown', () => {
  assert.deepEqual(promoState(NEW_QUOTE, ''), { state: 'none' });
  assert.deepEqual(promoState(null, 'LAUNCH20'), { state: 'applying', code: 'LAUNCH20' });
  assert.deepEqual(promoState({ ...NEW_QUOTE, discount: { amount: 500, code: 'LAUNCH20' }, total_due_today: 1600 }, 'launch20'), { state: 'valid', code: 'LAUNCH20', amount: '$5.00' });
  assert.equal(promoState({ ...NEW_QUOTE, discount: { amount: 2000, code: 'FIRSTMONTH' }, total_due_today: 0 }, 'FIRSTMONTH').state, 'covers');
  assert.equal(promoState({ ...NEW_QUOTE, discount_reason: 'expired' }, 'OLDCODE').line, 'This code has expired.');
  assert.equal(promoState({ ...NEW_QUOTE, discount_reason: 'not_found' }, 'NOPE').line, 'That code isn’t valid.');
  assert.equal(promoState({ ...NEW_QUOTE, discount_reason: null }, 'NOPE').line, 'That code isn’t valid.', 'no reason sent reads as not found');
  const other = promoState({ ...NEW_QUOTE, discount_reason: 'product_not_eligible' }, 'INVESTOR10');
  assert.deepEqual([other.state, other.line], ['other_plan', 'This code doesn’t apply to Validate + Build.']);
  assert.equal(promoState({ ...NEW_QUOTE, discount_reason: 'something_new' }, 'X').line, 'That code can’t be applied to this purchase.');
  assert.ok(!/something_new/.test(JSON.stringify(promoState({ ...NEW_QUOTE, discount_reason: 'something_new' }, 'X'))));
});

test('D1053 PAYX9: the decline map turns every code into one of five families; fraud and unknown codes read Card declined', () => {
  const fam = (code, decline_code, type) => declineFamily({ code, decline_code, type }).key;
  assert.equal(fam('card_declined', 'generic_decline'), 'declined');
  assert.equal(fam('card_declined', 'fraudulent'), 'declined', 'fraud never says so');
  assert.equal(fam('card_declined', 'stolen_card'), 'declined');
  assert.equal(fam('card_declined', 'do_not_honor'), 'declined');
  assert.equal(fam('some_new_code', 'some_new_reason'), 'declined', 'an unknown code');
  assert.equal(fam(undefined, undefined), 'declined');
  assert.equal(fam('card_declined', 'insufficient_funds'), 'funds');
  assert.equal(fam('card_declined', 'card_velocity_exceeded'), 'funds');
  assert.equal(fam('expired_card'), 'expired');
  assert.equal(fam('card_declined', 'expired_card'), 'expired');
  assert.equal(fam('payment_intent_authentication_failure'), 'auth');
  assert.equal(fam('card_declined', 'authentication_required'), 'auth');
  assert.equal(fam('incorrect_cvc'), 'auth');
  assert.equal(fam('processing_error'), 'generic');
  assert.equal(fam(undefined, undefined, 'api_connection_error'), 'generic');
  assert.equal(fam(undefined, undefined, 'rate_limit_error'), 'generic');
  assert.deepEqual(Object.keys(DECLINE), ['declined', 'funds', 'expired', 'auth', 'generic']);
  for (const [k, d] of Object.entries(DECLINE)) {
    assert.match(d.line, /You were not charged\./, `${k} says no money moved`);
    assert.doesNotMatch(`${d.title} ${d.line}`, /_/, `${k} shows no raw code`);
  }
  assert.equal(declineFamily({ code: 'card_declined', decline_code: 'fraudulent' }).title, 'Card declined');
});

test('D1053 PAYX18: each refusal says whether money moved, and offers what fits', () => {
  assert.deepEqual(refusalView({ code: 'stripe_not_configured' }), { key: 'not_set_up', title: 'Payments aren’t set up here.', line: 'Nothing can be bought here yet. You were not charged.', retry: false });
  assert.equal(refusalView({ code: 'price_missing' }).line, 'This plan’s price couldn’t be read just now. That doesn’t mean it’s free.');
  assert.equal(refusalView({ code: 'catalogue_unreadable' }).key, 'price');
  const held = refusalView({ code: 'subscription_exists', message: 'You already pay for a plan of this kind. Change it from Billing.' });
  assert.deepEqual([held.title, held.billing, held.retry], ['You already pay for a plan of this kind. Change it from Billing.', true, false]);
  assert.match(refusalView({ code: 'step_up_required' }).line, /Nothing changed\.$/);
  assert.equal(refusalView({ code: 'start_failed', message: 'The payment could not be started. Nothing was charged; try again in a moment.' }).line, 'The payment could not be started. Nothing was charged; try again in a moment.');
  assert.equal(refusalView({ code: 'odd', message: 'boom' }).line, 'You were not charged. Try again in a moment.', 'a message that does not say what happened to the money is not shown');
  assert.equal(refusalView(new Error('network')).title, 'Checkout couldn’t start.');
});

test('D1053 PAYX7–PAYX8: the status words, the slow line, and What you get now from the result, a missing figure with its reason', () => {
  assert.equal(statusView({ state: 'activating' }).key, 'activating');
  assert.deepEqual([statusView({ state: 'activating' }, { slow: true }).key, statusView({ state: 'activating' }, { slow: true }).title], ['slow', 'Your payment went through, and your plan is still being switched on.']);
  assert.equal(statusView({ state: 'active' }).key, 'active');
  assert.match(statusView({ state: 'scheduled', change_at: '2026-11-21T00:00:00Z' }).title, /21 Nov 2026/);
  assert.match(statusView({ state: 'failed' }).line, /You were not charged/);
  const lines = whatYouGet({ ai_allowance_microusd: 5_000_000, storage_bytes: null, included: ['Unlimited startups', '$5.00 of AI tokens a month'], reasons: { storage_bytes: 'Not recorded: no figure is set.' } });
  assert.deepEqual(lines.map((l) => [l.text, l.measured]), [['$5.00 of AI a month, starting today', true], ['Not recorded: no figure is set.', false], ['Unlimited startups', true]]);
  assert.equal(whatYouGet({ ai_allowance_microusd: null, reasons: {} })[0].text, 'AI allowance: Not recorded.');
  assert.deepEqual(whatYouGet(null), []);
});

test('D1053 PAYX19: a visitor signs in first with the plan kept; saved cards and the plan key', () => {
  const plan = { ...GROWTH, catalogue: { key: 'founder:growth' } };
  assert.equal(sheetMode({ user: null, role: null, plan }), 'signin');
  assert.equal(signinHref(plan, 'yearly'), `/login?next=${encodeURIComponent('/pricing?checkout=founder%3Agrowth&interval=yearly')}`);
  assert.equal(signinHref({ ...GROWTH, catalogue: null }, 'monthly'), `/login?next=${encodeURIComponent('/pricing')}`, 'no key, no plan to keep');
  assert.equal(planKeyOf(plan), 'founder:growth');
  assert.equal(planKeyOf({ catalogue: { key: '' } }), null);
  assert.equal(cardWords({ brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 }), 'Visa ending 4242 · expires 08/28');
  assert.equal(savedCardsApply({ family: 'investor' }), false, 'an investor plan is paid on its own customer (D892 §6)');
  assert.equal(savedCardsApply({ family: 'founder' }), true);
});

// ---------------------------------------------------------------- mounted (D1053)

const PLAN = { ...GROWTH, catalogue: { key: 'founder:growth', included: ['Unlimited startups'] } };

function fakeBridge(log, { confirm = { error: null }, saved = { error: null }, intent = { error: null } } = {}) {
  function CardForm({ onReady }) {
    React.useEffect(() => {
      onReady({
        submit: async () => { log.push(['submit']); return { error: null }; },
        confirm: async (secret) => { log.push(['confirm', secret]); return typeof confirm === 'function' ? confirm() : confirm; },
      });
    }, [onReady]);
    return React.createElement('div', { 'data-testid': 'stub-card-form' });
  }
  return {
    CardForm,
    confirmSaved: async (secret, pm) => { log.push(['saved', secret, pm]); return saved; },
    confirmIntent: async (secret) => { log.push(['intent', secret]); return intent; },
  };
}

async function sheet(props, routes) {
  const restore = installDocument();
  const saved = { ...checkoutApi };
  const calls = [];
  for (const k of ['quote', 'start', 'status', 'methods']) {
    checkoutApi[k] = async (arg) => {
      calls.push([k, arg]);
      const r = routes[k];
      const v = typeof r === 'function' ? r(arg, calls) : r;
      if (v instanceof Error) throw v;
      return v ?? {};
    };
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const props_ = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props_(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  await act(async () => root.render(React.createElement(MemoryRouter, null, React.createElement(CheckoutSheet, props))));
  await settle();
  return {
    calls, byId, settle, has: (id) => !!byId(id), text: (id) => text(byId(id)), props: (id) => props_(byId(id)),
    async click(id) { const p = props_(byId(id)); assert.ok(p.onClick, `no ${id}`); await act(async () => { await p.onClick({ preventDefault() {} }); }); await settle(); },
    async change(id, value) { const p = props_(byId(id)); await act(async () => { p.onChange({ target: { value, checked: true } }); }); await settle(); },
    async submit(id) { const p = props_(byId(id)); await act(async () => { p.onSubmit({ preventDefault() {} }); }); await settle(); },
    hrefs: () => walk(container).filter((n) => n.tagName === 'A').map((n) => n.getAttribute?.('href') || props_(n).href || props_(n).to),
    async close() { await act(async () => root.unmount()); Object.assign(checkoutApi, saved); restore(); },
  };
}

const FOUNDER = { user: { role: 'founder', subscription_tier: 'free' }, role: 'founder', plan: PLAN, spec: SPEC };

test('D1053 a new plan: the quote’s totals, Pay [$total], the card form, then start, confirm and the status route to Accepted', async () => {
  const log = [];
  const v = await sheet({ ...FOUNDER, bridge: fakeBridge(log) }, {
    quote: NEW_QUOTE, methods: { methods: [] },
    start: { mode: 'new', client_secret: 'cs_fake_1', ref: 'sub_fake1' },
    status: { state: 'active', result: { ai_allowance_microusd: 5_000_000, storage_bytes: null, included: ['Unlimited startups'], reasons: { storage_bytes: 'Not recorded: no figure is set.' } }, changes: { before: null } },
  });
  try {
    assert.deepEqual(v.calls[0], ['quote', { planKey: 'founder:growth', interval: 'monthly', promoCode: undefined }]);
    assert.match(v.text('checkout-totals'), /Subtotal\$20\.00VAT\$1\.00Due today\$21\.00/);
    assert.equal(v.text('checkout-pay'), 'Pay $21.00');
    assert.ok(v.has('stub-card-form'));
    assert.ok(!v.calls.some(([k]) => k === 'start'), 'opening starts nothing');
    await v.click('checkout-pay');
    assert.deepEqual(log, [['submit'], ['confirm', 'cs_fake_1']], 'the form is submitted before the subscription is made, then confirmed');
    const start = v.calls.find(([k]) => k === 'start')[1];
    assert.equal(start.paymentMethod, undefined);
    assert.ok(/^.{8,64}$/.test(start.nonce), 'a nonce the Worker accepts');
    assert.deepEqual(v.calls.find(([k]) => k === 'status'), ['status', 'sub_fake1']);
    assert.ok(v.has('checkout-after-active'));
    assert.match(v.text('checkout-what-you-get'), /\$5\.00 of AI a month, starting today.*Not recorded: no figure is set\..*Unlimited startups/);
  } finally { await v.close(); }
});

test('D1053 a decline keeps the form, says no money moved in one of five families, and a retry reuses the same nonce', async () => {
  const log = [];
  let n = 0;
  const v = await sheet({ ...FOUNDER, bridge: fakeBridge(log, { confirm: () => (n++ === 0 ? { error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds' } } : { error: null }) }) }, {
    quote: NEW_QUOTE, methods: { methods: [] }, start: { mode: 'new', client_secret: 'cs_fake_2', ref: 'sub_fake2' }, status: { state: 'activating' },
  });
  try {
    await v.click('checkout-pay');
    assert.ok(v.has('checkout-decline-funds'));
    assert.match(v.text('checkout-decline-funds'), /Insufficient funds.*You were not charged\./);
    assert.doesNotMatch(v.text('checkout-decline-funds'), /insufficient_funds|card_declined/);
    assert.ok(v.has('stub-card-form'), 'the form stays filled in');
    assert.ok(!v.calls.some(([k]) => k === 'status'));
    await v.click('checkout-decline-retry');
    const nonces = v.calls.filter(([k]) => k === 'start').map(([, a]) => a.nonce);
    assert.equal(nonces.length, 2);
    assert.equal(nonces[0], nonces[1], 'one press, one subscription');
    assert.ok(v.has('checkout-after-activating'));
  } finally { await v.close(); }
});

test('D1053 PAYX8: Activating polls the status route until the plan is on', async () => {
  const states = ['activating', 'activating', 'active'];
  const v = await sheet({ ...FOUNDER, pollMs: 1, bridge: fakeBridge([]) }, {
    quote: NEW_QUOTE, methods: { methods: [] }, start: { mode: 'new', client_secret: 'cs_fake_6', ref: 'sub_fake6' },
    status: () => ({ state: states.shift() || 'active', result: {}, changes: { before: { plan_name: 'Free' }, after: { plan_name: 'Validate + Build' } } }),
  });
  try {
    await v.click('checkout-pay');
    for (let i = 0; i < 5 && !v.has('checkout-after-active'); i += 1) await v.settle();
    assert.ok(v.has('checkout-after-active'), 'the poll went on until active');
    assert.equal(v.calls.filter(([k]) => k === 'status').length, 3);
    assert.equal(v.text('checkout-changes'), 'From Free to Validate + Build.');
  } finally { await v.close(); }
});

test('D1053 a failed payment offers Try again with a new nonce, since the failed one is spent', async () => {
  const log = [];
  let state = 'failed';
  const v = await sheet({ ...FOUNDER, bridge: fakeBridge(log) }, {
    quote: NEW_QUOTE, methods: { methods: [] }, start: { mode: 'new', client_secret: 'cs_fake_5', ref: 'sub_fake5' }, status: () => ({ state }),
  });
  try {
    await v.click('checkout-pay');
    assert.match(v.text('checkout-after-failed'), /The payment didn’t go through\..*You were not charged/);
    state = 'activating';
    await v.click('checkout-after-retry');
    assert.ok(v.has('checkout-pay'), 'back on the form');
    await v.click('checkout-pay');
    const nonces = v.calls.filter(([k]) => k === 'start').map(([, a]) => a.nonce);
    assert.equal(nonces.length, 2);
    assert.notEqual(nonces[0], nonces[1]);
  } finally { await v.close(); }
});

test('D1053 PAYX3: a saved card is the default, is sent by id, and is confirmed without the card form', async () => {
  const log = [];
  const v = await sheet({ ...FOUNDER, bridge: fakeBridge(log) }, {
    quote: NEW_QUOTE, methods: { methods: [{ id: 'pm_fake9', brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 }] },
    start: { mode: 'new', client_secret: 'cs_fake_3', ref: 'sub_fake3', saved_card: true }, status: { state: 'activating' },
  });
  try {
    assert.match(v.text('checkout-pay-with'), /Visa ending 4242 · expires 08\/28.*A new card.*authenticator code/);
    assert.ok(!v.has('stub-card-form'), 'the card form shows only for A new card');
    await v.click('checkout-pay');
    assert.equal(v.calls.find(([k]) => k === 'start')[1].paymentMethod, 'pm_fake9');
    assert.deepEqual(log, [['saved', 'cs_fake_3', 'pm_fake9']]);
  } finally { await v.close(); }
  const inv = await sheet({ ...FOUNDER, role: 'investor', user: { role: 'investor' }, plan: { ...PLAN, family: 'investor' }, bridge: fakeBridge([]) }, { quote: NEW_QUOTE, methods: { methods: [{ id: 'pm_x', last4: '1' }] } });
  try {
    assert.ok(!inv.calls.some(([k]) => k === 'methods'), 'an investor plan reads no saved cards');
    assert.ok(!inv.has('checkout-pay-with'));
  } finally { await inv.close(); }
});

test('D1053 PAYX4: a downgrade is scheduled with the storage note and the step-up line; an upgrade confirms its invoice', async () => {
  const down = await sheet({ ...FOUNDER, held: 'studio', bridge: fakeBridge([]) }, {
    quote: CHANGE_DOWN, start: { mode: 'change', direction: 'downgrade', scheduled: true, ref: 'sub_held', change_at: '2026-11-21T00:00:00Z' },
    status: { state: 'scheduled', change_at: '2026-11-21T00:00:00Z' },
  });
  try {
    assert.match(down.text('checkout-change-downgrade'), /Downgrade.*21 Nov 2026\. Nothing is charged today\./);
    assert.ok(down.has('checkout-change-storage') && down.has('checkout-step-up'));
    assert.ok(!down.has('checkout-promo'), 'a change takes no code');
    assert.ok(!down.has('stub-card-form'));
    assert.equal(down.text('checkout-pay'), 'Schedule the change');
    await down.click('checkout-pay');
    assert.equal(down.calls.find(([k]) => k === 'start')[1].paymentMethod, undefined);
    assert.ok(down.has('checkout-after-scheduled'));
  } finally { await down.close(); }
  const log = [];
  const up = await sheet({ ...FOUNDER, held: 'growth', bridge: fakeBridge(log) }, {
    quote: CHANGE_UP, start: { mode: 'change', direction: 'upgrade', client_secret: 'cs_fake_4', ref: 'sub_held', change_at: 'now' }, status: { state: 'activating' },
  });
  try {
    assert.equal(up.text('checkout-pay'), 'Confirm change · $87.10');
    await up.click('checkout-pay');
    assert.deepEqual(log, [['intent', 'cs_fake_4']]);
  } finally { await up.close(); }
});

test('D1053 PAYX5: a code re-quotes; an invalid one says why in place; one that covers the first payment starts without a card', async () => {
  const quote = ({ promoCode }) => (!promoCode ? NEW_QUOTE
    : promoCode === 'OLDCODE' ? { ...NEW_QUOTE, discount_reason: 'expired' }
      : { ...NEW_QUOTE, discount: { amount: 2000, code: 'FIRSTMONTH' }, vat: { amount: 0, reason: null }, total_due_today: 0 });
  const log = [];
  const v = await sheet({ ...FOUNDER, bridge: fakeBridge(log) }, { quote, methods: { methods: [] }, start: { mode: 'new', free: true, ref: 'sub_free' }, status: { state: 'active', result: {}, changes: { before: null } } });
  try {
    await v.change('checkout-promo-input', 'OLDCODE');
    await v.submit('checkout-promo');
    assert.equal(v.calls.filter(([k]) => k === 'quote').at(-1)[1].promoCode, 'OLDCODE');
    assert.equal(v.text('checkout-promo-line'), 'This code has expired.');
    await v.change('checkout-promo-input', 'FIRSTMONTH');
    await v.submit('checkout-promo');
    assert.equal(v.text('checkout-promo-covers'), FREE_FIRST);
    assert.ok(v.has('checkout-promo-remove'));
    assert.ok(!v.has('stub-card-form'), 'nothing to pay today');
    assert.equal(v.text('checkout-pay'), 'Start my plan');
    await v.click('checkout-pay');
    assert.deepEqual(log, [], 'no card submitted or confirmed');
    assert.equal(v.calls.find(([k]) => k === 'start')[1].promoCode, 'FIRSTMONTH');
    assert.ok(v.has('checkout-after-active'));
  } finally { await v.close(); }
});

test('D1053 PAYX18: a refused quote shows no Pay button and no price; a refused start says nothing was charged', async () => {
  const notSetUp = await sheet({ ...FOUNDER, bridge: fakeBridge([]) }, { quote: Object.assign(new Error('Payments are not set up on this deployment.'), { code: 'stripe_not_configured' }) });
  try {
    assert.match(notSetUp.text('checkout-refused'), /Payments aren’t set up here\..*You were not charged\./);
    assert.ok(!notSetUp.has('checkout-pay'));
    assert.ok(!notSetUp.has('checkout-refused-retry'));
  } finally { await notSetUp.close(); }
  let fails = 1;
  const price = await sheet({ ...FOUNDER, bridge: fakeBridge([]) }, { quote: () => (fails-- > 0 ? Object.assign(new Error('x'), { code: 'price_missing' }) : NEW_QUOTE), methods: { methods: [] } });
  try {
    assert.match(price.text('checkout-refused'), /That doesn’t mean it’s free\./);
    await price.click('checkout-refused-retry');
    assert.equal(price.text('checkout-pay'), 'Pay $21.00');
  } finally { await price.close(); }
  const log = [];
  const held = await sheet({ ...FOUNDER, bridge: fakeBridge(log) }, {
    quote: NEW_QUOTE, methods: { methods: [] },
    start: Object.assign(new Error('You already pay for a plan of this kind. Change it from Billing.'), { code: 'subscription_exists' }),
  });
  try {
    await held.click('checkout-pay');
    assert.match(held.text('checkout-start-refused-subscription_exists'), /You already pay for a plan of this kind.*Nothing was charged\./);
    assert.deepEqual(log, [['submit']], 'nothing is confirmed');
  } finally { await held.close(); }
});

test('D1053 PAYX17 and PAYX19a: loading draws the frame with skeletons; a visitor signs in with the plan kept', async () => {
  const v = await sheet({ ...FOUNDER, bridge: fakeBridge([]) }, { quote: () => new Promise(() => {}) });
  try {
    assert.ok(v.has('checkout-payment-loading') && v.has('checkout-totals-loading'));
    assert.ok(!v.has('checkout-pay'));
  } finally { await v.close(); }
  const s = await sheet({ user: null, role: null, plan: PLAN, spec: SPEC, interval: 'yearly', bridge: fakeBridge([]) }, {});
  try {
    assert.ok(s.has('checkout-mode-signin'));
    assert.ok(s.hrefs().includes(`/login?next=${encodeURIComponent('/pricing?checkout=founder%3Agrowth&interval=yearly')}`));
    assert.equal(s.calls.length, 0, 'a visitor’s sheet reads nothing');
  } finally { await s.close(); }
});

test('D1053 the wiring: no AxalCheckout for a plan, the card form lazy with Apple Pay first, no alert or confirm, Pricing reopens the kept plan', () => {
  const src = read('frontend/src/components/checkout/CheckoutSheet.jsx');
  assert.doesNotMatch(src, /import\(['"]\.\.\/AxalCheckout|^import AxalCheckout|<AxalCheckout/m, 'plans no longer use today’s payment form (packs keep it until #2452)');
  assert.match(src, /const PlanCardForm = lazy\(\(\) => import\('\.\/PlanCardForm'\)\);/);
  assert.doesNotMatch(src, /window\.(alert|confirm)|(?<![.\w])alert\(|(?<![.\w])confirm\(/);
  const form = read('frontend/src/components/checkout/PlanCardForm.jsx');
  assert.match(form, /paymentMethodOrder: \['apple_pay', 'google_pay', 'card'\]/);
  assert.match(form, /mode: 'subscription'/);
  assert.match(read('frontend/src/pages/PricingPage.jsx'), /planKeyOf\(c\.plan\) === wanted/);
  assert.match(read('frontend/src/lib/api/billingCheckout.js'), /methods: \(\) => request\('\/payments\/methods'\)/);
});

test('D1053 PAYX19a: back from sign-in, Pricing opens the sheet on the kept plan and interval, once', async () => {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; return n; };
  const savedPricing = { ...publicPricingApi };
  const savedCheckout = { ...checkoutApi };
  const asked = [];
  publicPricingApi.plansAndPacks = async () => ({ plans: [{ family: 'founder', licence_key: 'founder:free', free: true, prices: [] }, PLAN], packs: [] });
  publicPricingApi.aiModels = async () => ({ models: [] });
  checkoutApi.quote = async (a) => { asked.push(a); return { ...NEW_QUOTE, total_due_today: 0, discount: { amount: 20400, code: 'FIXTURE' } }; };
  checkoutApi.methods = async () => ({ methods: [] });
  const container = document.createElement('div'); const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  try {
    let at = null;
    const Probe = () => { at = useLocation(); return null; };
    await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/pricing?checkout=founder%3Agrowth&interval=yearly'] },
      React.createElement(PricingBody, { user: { role: 'founder', subscription_tier: 'free' } }), React.createElement(Probe))));
    await settle();
    assert.ok(byId('checkout-sheet'), 'the sheet opens on its own');
    assert.equal(at.search, '', 'the request leaves the address, so Back does not reopen it');
    assert.equal(props(byId('checkout-interval-yearly'))['aria-pressed'], true);
    assert.deepEqual(asked[0], { planKey: 'founder:growth', interval: 'yearly', promoCode: undefined });
    const close = walk(container).find((n) => n.tagName === 'BUTTON' && props(n)['aria-label'] === 'Close');
    await act(async () => props(close).onClick()); await settle();
    assert.ok(!byId('checkout-sheet'), 'closed, and the request left the address, so it does not reopen');
  } finally {
    await act(async () => root.unmount());
    Object.assign(publicPricingApi, savedPricing); Object.assign(checkoutApi, savedCheckout); restore();
  }
});

// ---------------------------------------------------------------- D1055 (#2906): the phone (PAYX20) and dark (PAYX21)

test('D1055 PAYX20: the summary row is "[Plan] · [$20]/month"; the phone\'s total only when the Worker sent it', async () => {
  const { summaryRow, payTotal } = await import('../src/components/checkout/checkoutModel.js');
  const ivs = intervalsOf(GROWTH);
  // Mutation checked: keep the price line whole → "· $20 / month".
  assert.equal(summaryRow(GROWTH, SPEC, ivs.monthly), 'Validate + Build · $20/month');
  // Mutation checked: keep the billed-yearly tail → the row runs past 390.
  assert.equal(summaryRow(GROWTH, SPEC, ivs.yearly), 'Validate + Build · $17/month');
  assert.equal(summaryRow({ ...GROWTH, plan_name: null }, SPEC, null), 'Validate + Build');
  assert.deepEqual(payTotal(quoteView(NEW_QUOTE)), { label: 'Due today', value: '$21.00' });
  // Mutation checked: draw a total without the Worker's → "$0.00" for a missing figure.
  assert.equal(payTotal(quoteView({ ...NEW_QUOTE, total_due_today: null, total_reason: 'Not recorded: VAT is not read.' })), null);
  assert.equal(payTotal(null), null);
});

test('D1055 PAYX20 at 390: ‹ Back and Checkout, the summary as one row with Details, Pay held at the bottom with the total', async () => {
  let closed = 0;
  const v = await sheet({ ...FOUNDER, onClose: () => { closed += 1; }, bridge: fakeBridge([]) }, { quote: NEW_QUOTE, methods: { methods: [] } });
  try {
    const back = v.props('checkout-back');
    assert.equal(v.text('checkout-back'), '‹ Back');
    // Mutation checked: drop sm:hidden → the desktop gets a second close.
    assert.match(back.className, /(^|\s)sm:hidden(\s|$)/);
    assert.match(back.className, /min-h-\[44px\]/);
    // Mutation checked: show the × on the phone → two ways out in the top bar.
    assert.match(v.props('checkout-close').className, /^hidden .*\bsm:grid\b/);
    const row = v.props('checkout-summary-row');
    assert.equal(v.text('checkout-summary-row'), 'Validate + Build · $20/monthDetails ⌄');
    assert.equal(row['aria-expanded'], false);
    assert.match(row.className, /(^|\s)sm:hidden(\s|$)/);
    // Mutation checked: draw the panel open → the whole summary above Pay at 390.
    assert.equal(v.props('checkout-summary-panel').className, 'hidden sm:block');
    await v.click('checkout-summary-row');
    assert.equal(v.props('checkout-summary-row')['aria-expanded'], true);
    assert.equal(v.props('checkout-summary-panel').className, 'block');
    assert.match(v.text('checkout-summary-row'), /Details ⌃$/);
    const bar = v.props('checkout-pay-bar').className;
    // Mutation checked: drop sticky → Pay scrolls away under the card form.
    assert.match(bar, /^sticky bottom-0 /);
    assert.match(bar, /\bsm:static\b/);
    assert.match(bar, /\bdark:bg-gray-900\b/, 'the held bar keeps its dark ground');
    assert.equal(v.text('checkout-pay-total'), 'Due today$21.00');
    assert.match(v.props('checkout-pay-total').className, /\bsm:hidden\b/);
    await v.click('checkout-back');
    assert.equal(closed, 1, '‹ Back closes the sheet');
  } finally { await v.close(); }
});

test('D1055 PAYX20: every target on the sheet and the renewal banner is 44px tall below sm; Accepted is one column', async () => {
  const src = read('frontend/src/components/checkout/CheckoutSheet.jsx');
  // Mutation checked: restore the 36px interval buttons → this pin fails.
  assert.match(src, /className=\{`min-h-\[44px\] sm:min-h-\[36px\] rounded-\[7px\] px-3 text-\[12\.5px\] font-bold/);
  assert.match(src, /const LINK = 'inline-flex min-h-\[44px\] items-center [^']*sm:min-h-0';/);
  assert.match(src, /const INPUT = 'min-h-\[44px\] sm:min-h-\[40px\] /);
  assert.match(src, /<button type="submit" className="min-h-\[44px\] sm:min-h-\[40px\] /);
  assert.equal((src.match(/<label (key=\{m\.id\} )?className="flex min-h-\[44px\] items-center gap-2 [^"]*sm:min-h-0">/g) || []).length, 2, 'both Pay with rows');
  assert.ok(!/min-h-\[(3[0-9]|40)px\](?! )/.test(src.replace(/sm:min-h-\[\d+px\]/g, '')), 'no target under 44px left below sm');
  const banner = read('frontend/src/components/checkout/RenewalBanner.jsx');
  assert.match(banner, /const BTN = 'inline-flex min-h-\[44px\] sm:min-h-\[36px\] items-center/);
  assert.match(banner, /const LINK = 'inline-flex min-h-\[44px\] items-center [^']*sm:min-h-0';/);
  assert.match(banner, /className=\{`flex flex-wrap items-center gap-x-3 gap-y-2 border-b/, 'the banner wraps');
  const v = await sheet({ ...FOUNDER, bridge: fakeBridge([]) }, {
    quote: NEW_QUOTE, methods: { methods: [] }, start: { mode: 'new', client_secret: 'cs_fake_2', ref: 'sub_fake2' },
    status: { state: 'active', result: { ai_allowance_microusd: 5_000_000, storage_bytes: null, included: [], reasons: {} }, changes: { before: null } },
  });
  try {
    await v.click('checkout-pay');
    assert.ok(v.has('checkout-after-active'));
    // Mutation checked: keep flex-wrap on the phone → Close, Open Billing and Back side by side at 390.
    assert.match(v.props('checkout-after-actions').className, /^flex w-full flex-col gap-1 sm:w-auto sm:flex-row/);
  } finally { await v.close(); }
});

test('D1055 PAYX21: the Payment Element\'s dark tabs on the sheet; light and the shared appearance unchanged; Apple Pay first', async () => {
  const { SHEET_DARK_RULES, sheetAppearance } = await import('../src/components/checkout/checkoutModel.js');
  const base = { theme: 'night', rules: { '.Input': { color: '#f3f4f6' } } };
  const dark = sheetAppearance(base, true);
  assert.equal(dark.rules['.Input'].color, '#f3f4f6', 'the shared rules stay');
  // Mutation checked: drop the selected tab's rule → no violet edge in dark.
  assert.equal(dark.rules['.Tab--selected'].border, '1px solid #a78bfa');
  assert.equal(dark.rules['.Tab'].border, '1px solid #374151');
  // Mutation checked: drop the selected label's pair → the shared deep violet on the dark card.
  assert.equal(dark.rules['.TabLabel--selected, .TabIcon--selected'].color, '#c4b5fd');
  assert.deepEqual(Object.keys(SHEET_DARK_RULES).sort(), ['.Tab', '.Tab--selected', '.Tab:hover', '.TabLabel, .TabIcon', '.TabLabel--selected, .TabIcon--selected']);
  // Mutation checked: apply the dark rules in light → light tabs on a dark ground.
  assert.equal(sheetAppearance(base, false), base);
  assert.equal(base.rules['.Tab'], undefined, 'the shared appearance is never written to');
  const form = read('frontend/src/components/checkout/PlanCardForm.jsx');
  assert.match(form, /appearance: sheetAppearance\(buildAppearance\(isDark\), isDark\)/);
  assert.match(form, /paymentMethodOrder: \['apple_pay', 'google_pay', 'card'\]/);
  assert.doesNotMatch(read('frontend/src/lib/stripe.js'), /#c4b5fd|SHEET_DARK/, 'lib/stripe.js is the six forms\' and stays as it was');
});

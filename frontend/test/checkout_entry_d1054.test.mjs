/**
 * D1054 (#2905, part 6 of #2451) — the checkout sheet opened from the paywall,
 * Billing, Usage and every Upgrade (`openCheckout` and the one `CheckoutHost`),
 * the renewal banner (PAYX10), Billing's Cancel dialog and cancelled card
 * (PAYX11), Usage › Limits' Upgrade (PAYX12), and the sheet per family
 * (PAYX13–16). No network and no Stripe: every route and the Stripe side are
 * stood in for, with fake figures only.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/checkout_entry_d1054.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import {
  BANNER_ACTION, CHECKOUT_EVENT, STAFF_ROLES, bannerKind, bannerView, changePlanKey, dismissKey, familyOfKey, heldOfStatus,
  cancelWords, nextPlanKey, openCheckout, planForKey, planKeyOfProduct, planKeyOfTier,
} from '../src/components/checkout/checkoutEntry.js';
import { notSoldView, sheetMode } from '../src/components/checkout/checkoutModel.js';
import CheckoutSheet from '../src/components/checkout/CheckoutSheet.jsx';
import CheckoutHost from '../src/components/checkout/CheckoutHost.jsx';
import RenewalBanner, { renewalRefusal } from '../src/components/checkout/RenewalBanner.jsx';
import { PlanHeader } from '../src/pages/account/AccountBilling.jsx';
import { FREE_INCLUDED, IncludedCard } from '../src/pages/account/LimitsPage.jsx';
import ViewModeContext from '../src/contexts/ViewModeContext.js';
import { checkoutApi } from '../src/lib/api/billingCheckout.js';
import { billingAlertsApi } from '../src/lib/api/billingAlerts.js';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { api } from '../src/lib/api.js';
import { resetPlansRead } from '../src/lib/planPrices.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;
const price = (unit_amount, interval) => ({ price_id: `price_${unit_amount}_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1, allowance_microusd: 0 });
const STUDIO = {
  family: 'founder', licence_key: 'founder:studio', product_id: 'prod_fake_studio', plan_name: 'Raise + Grow', free: false,
  prices: [price(10000, 'month')], yearly_saving_percent: null,
  catalogue: { key: 'founder:studio', label: 'Raise + Grow', sellable: true, sellable_reason: null, included: ['Cap table scenarios and the dilution simulator'] },
};
const CATALOGUE = [
  // D1334 (#3540): Investor Plus is sold; with no Stripe product mirrored yet it has no price.
  { key: 'investor:plus', family: 'investor', licence_key: 'investor:plus', matches: { investor_tier: 'plus' }, label: 'Investor Plus', tagline: 'For angel investors.', sellable: true, sellable_reason: null, included: ['Investment research workspace'] },
  { key: 'investor:institutional', family: 'investor', licence_key: 'investor:institutional', matches: { investor_tier: 'institutional' }, label: 'Institutional', tagline: 'For institutional investors.', sellable: false, sellable_reason: 'Priced by our sales team: Contact Sales.', included: ['Shared research workspaces'] },
  { key: 'founder:studio', family: 'founder', licence_key: 'founder:studio', matches: { tier: 'studio' }, label: 'Raise + Grow', sellable: true, sellable_reason: null, included: [] },
];
const STUB_BRIDGE = { CardForm: () => null, confirmSaved: async () => ({ error: null }), confirmIntent: async () => ({ error: null }) };
const READ = { plans: [{ family: 'founder', licence_key: 'founder:free', free: true, prices: [], catalogue: { key: 'founder:free' } }, STUDIO], catalogue: CATALOGUE };

/** A small mounted harness over the contracts DOM, with window listeners that work. */
async function mount(node, { path = '/', viewMode = null, stored = new Map() } = {}) {
  const restore = installDocument();
  const listeners = new Map();
  const prev = { add: globalThis.addEventListener, remove: globalThis.removeEventListener, dispatch: globalThis.dispatchEvent, ls: globalThis.localStorage };
  globalThis.addEventListener = (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); };
  globalThis.removeEventListener = (type, fn) => { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); };
  globalThis.dispatchEvent = (e) => { for (const fn of listeners.get(e.type) || []) fn(e); return true; };
  globalThis.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
  const container = document.createElement('div');
  const root = createRoot(container);
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const text = (n) => (!n ? '' : n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const byId = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
  const tree = viewMode ? h(ViewModeContext.Provider, { value: viewMode }, node) : node;
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, tree)));
  await settle();
  return {
    stored, byId, settle, has: (id) => !!byId(id), text: (id) => text(id ? byId(id) : container), props: (id) => props(byId(id)),
    hrefs: () => walk(container).filter((n) => n.tagName === 'A').map((n) => props(n).href || props(n).to),
    async click(id) { const p = props(byId(id)); assert.ok(p.onClick, `no ${id}`); await act(async () => { await p.onClick({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async press(label) {
      const n = walk(container).find((x) => x.tagName === 'BUTTON' && (text(x).trim() === label || props(x)['aria-label'] === label));
      assert.ok(n, `no button "${label}"`);
      await act(async () => { await props(n).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async fire(type, detail) { await act(async () => { for (const fn of listeners.get(type) || []) fn({ type, detail }); }); await settle(); },
    async close() {
      await act(async () => root.unmount());
      Object.assign(globalThis, { addEventListener: prev.add, removeEventListener: prev.remove, dispatchEvent: prev.dispatch, localStorage: prev.ls });
      restore();
    },
  };
}

// ---------------------------------------------------------------- the model

test('openCheckout: one event with the plan key, the interval, where it came from and what it unlocks; nothing without a key', () => {
  const seen = [];
  const prev = { win: globalThis.window, dispatch: globalThis.dispatchEvent };
  globalThis.window = globalThis;
  globalThis.dispatchEvent = (e) => { seen.push([e.type, e.detail]); return true; };
  try {
    assert.equal(openCheckout({ plan_key: 'founder:studio', from: { label: 'Cap table', href: '/cap-table' }, unlocks: 'Cap table' }), true);
    assert.equal(openCheckout({ plan_key: 'advisor:pro', interval: 'yearly', from: { label: 'Elsewhere', href: 'https://example.invalid/' } }), true);
    assert.equal(openCheckout({}), false);
    assert.deepEqual(seen, [
      [CHECKOUT_EVENT, { plan_key: 'founder:studio', interval: 'monthly', from: { label: 'Cap table', href: '/cap-table' }, unlocks: 'Cap table' }],
      [CHECKOUT_EVENT, { plan_key: 'advisor:pro', interval: 'yearly', from: null, unlocks: null }],
    ], 'Back to goes only to an address inside the app');
  } finally { Object.assign(globalThis, { window: prev.win, dispatchEvent: prev.dispatch }); }
});

test('planForKey: the priced row by catalogue key, or the catalogue entry with no price; never a free row', () => {
  assert.equal(planForKey(READ, 'founder:studio'), STUDIO);
  const plus = planForKey(READ, 'investor:plus');
  assert.deepEqual([plus.family, plus.plan_name, plus.prices, plus.catalogue.key, plus.catalogue.sellable], ['investor', 'Investor Plus', [], 'investor:plus', true]);
  assert.equal(planForKey(READ, 'founder:free'), null);
  assert.equal(planForKey(READ, 'founder:nothing'), null);
  assert.equal(planForKey(null, 'founder:studio'), null);
});

test('the plan an Upgrade or Change plan offers, by profile and what is held', () => {
  assert.deepEqual(['free', 'growth', 'studio', null].map((t) => nextPlanKey('founder', t)), ['founder:growth', 'founder:studio', null, null]);
  // D1334: Free → Plus → Pro; Institutional is sales'.
  assert.deepEqual(['free', 'plus', 'professional', 'institutional'].map((t) => nextPlanKey('investor', t)), ['investor:plus', 'investor:professional', null, null]);
  assert.deepEqual([nextPlanKey('advisor', 'free'), nextPlanKey('partner', 'free'), nextPlanKey('partner', 'pro'), nextPlanKey('admin', 'free'), nextPlanKey('exploring', 'free')],
    ['advisor:pro', 'partner:pro', null, null, null]);
  assert.equal(changePlanKey('founder', 'studio'), 'founder:growth', 'the top Founder plan changes down');
  assert.equal(changePlanKey('investor', 'professional'), null, 'Institutional is sales’');
  assert.deepEqual([heldOfStatus('founder', { tier: 'growth' }), heldOfStatus('investor', {}), heldOfStatus('advisor', { plan_group: 'advisor', status: 'past_due' }),
    heldOfStatus('partner', { plan_group: 'partner', status: 'canceled' }), heldOfStatus('advisor', { plan_group: 'partner', status: 'active' }), heldOfStatus('admin', {})],
  ['growth', 'free', 'pro', 'free', 'free', null]);
  assert.deepEqual(['growth', 'studio', 'plus', 'professional', 'investor_institutional', 'free', ''].map(planKeyOfTier),
    ['founder:growth', 'founder:studio', 'investor:plus', 'investor:professional', 'investor:institutional', null, null]);
  assert.deepEqual([familyOfKey('partner:pro'), familyOfKey('lp_access'), familyOfKey(null)], ['partner', null, null]);
});

test('PAYX13–16: who pays here — a licence administrator is staff, and a plan the catalogue does not sell says why', () => {
  for (const r of ['admin', 'super_admin', 'branch_admin']) assert.equal(sheetMode({ role: r, plan: STUDIO }), 'staff', r);
  assert.ok(STAFF_ROLES.has('branch_admin'));
  const plus = planForKey(READ, 'investor:plus');
  const inst = { ...planForKey(READ, 'investor:institutional'), prices: [price(90000, 'month')] };
  // D1334: Plus is sold. With no price mirrored it cannot be paid yet; with one, it pays.
  assert.equal(sheetMode({ role: 'investor', plan: plus }), 'unsellable');
  assert.equal(sheetMode({ role: 'investor', plan: { ...plus, prices: [price(5000, 'month')] }, held: 'free' }), 'pay');
  assert.equal(sheetMode({ role: 'investor', plan: inst }), 'notsold', 'a Stripe price does not make Institutional sold here');
  assert.equal(sheetMode({ role: 'founder', plan: plus }), 'other', 'another profile’s plan says so first');
  assert.equal(notSoldView(inst).title, 'Contact sales');
  assert.equal(notSoldView(inst).contact, true);
  assert.equal(sheetMode({ role: 'founder', plan: STUDIO, held: 'free' }), 'pay', 'a sold plan pays as before');
});

const NOW = new Date('2026-11-21T09:00:00Z');
const FAILED = { id: 7, kind: 'payment_failed', plan_family: 'founder', attempt_count: 1, next_attempt_at: '2026-11-24T00:00:00Z', amount_cents: 10000, currency: 'usd', can_confirm: false, created_at: '2026-11-21T08:00:00Z', updated_at: '2026-11-21T08:00:00Z' };
const CONFIRM = { ...FAILED, id: 8, kind: 'needs_confirmation', can_confirm: true, next_attempt_at: null };
const ENDED = { ...FAILED, id: 9, next_attempt_at: null, plan_family: 'advisor' };

test('PAYX10: the banner in the canvas’s words — failed with its retry date, confirm, ended — one at a time; a dispute draws none', () => {
  assert.deepEqual([bannerKind(FAILED), bannerKind(CONFIRM), bannerKind(ENDED), bannerKind({ ...CONFIRM, can_confirm: false }), bannerKind({ kind: 'dispute' })],
    ['failed', 'confirm', 'ended', null, null]);
  const f = bannerView([FAILED]);
  assert.equal(f.line, 'Your payment for your Founder plan on 21 Nov didn’t go through. We’ll try again on 24 Nov.');
  assert.deepEqual(f.actions.map((a) => BANNER_ACTION[a]), ['Update card', 'Pay now']);
  const c = bannerView([FAILED, CONFIRM]);
  assert.equal(c.kind, 'confirm', 'the bank’s check comes first');
  assert.equal(c.line, 'Your bank needs you to confirm the payment for your Founder plan.');
  assert.deepEqual(c.actions, ['confirm']);
  const e = bannerView([ENDED]);
  assert.equal(e.line, 'Advisor Pro ended because the payment didn’t go through. You’re on Free. Nothing was deleted.');
  assert.deepEqual(e.actions.map((a) => BANNER_ACTION[a]), ['Pay now', 'Open Billing']);
  assert.equal(bannerView([{ kind: 'dispute', id: 1 }]), null);
  assert.equal(bannerView(null), null);
  assert.equal(bannerView([{ ...FAILED, next_attempt_at: 'not a date', updated_at: null, created_at: null }]).line, 'Your payment for your Founder plan didn’t go through. We’ll try again.', 'a date not read is left out, never guessed');
  assert.equal(dismissKey(f, NOW), 'axal:renewal-banner:7:failed:2026-11-21');
  assert.notEqual(dismissKey(f, NOW), dismissKey(f, new Date('2026-11-22T00:00:01Z')), 'Dismiss is for the day only');
  assert.notEqual(dismissKey(f, NOW), dismissKey(bannerView([{ ...FAILED, next_attempt_at: null }]), NOW), 'a new state shows again');
});

test('PAYX11: the Cancel dialog’s and the cancelled card’s words; the catalog product’s plan key', () => {
  const sub = { id: 'sub_fake', current_period_end: '2026-11-28T00:00:00Z', cancel_at: null, canceled_at: '2026-11-02T00:00:00Z' };
  const w = cancelWords(sub, 'Raise + Grow');
  assert.equal(w.title, 'Cancel Raise + Grow?');
  assert.equal(w.line, 'It stays on until 28 Nov 2026. After that you’re on Free, and the plan’s limits apply. Your files stay.');
  assert.equal(w.pill, 'Ends 28 Nov 2026');
  assert.equal(w.cancelled, 'Cancelled on 2 Nov 2026. You’re on Free from 28 Nov 2026. Files stay.');
  assert.equal(cancelWords({}, null).cancelled, 'You’re on Free from the end of your paid period. Files stay.', 'no date is guessed');
  assert.deepEqual([{ metadata: { tier: 'studio' } }, { metadata: { investor_tier: 'professional' } }, { metadata: { plan_group: 'advisor' } }, {}].map(planKeyOfProduct),
    ['founder:studio', 'investor:professional', null, null]);
});

test('PAYX10c, PAYX11: Billing’s pills read Payment failed and Ended, and Change plan opens the sheet instead of Pricing', async () => {
  const ready = (data) => ({ status: 'ready', data, reload() {} });
  const v = await mount(h(PlanHeader, { role: 'founder', billing: ready({ tier: 'studio', status: 'past_due', renews_at: '2026-11-28T00:00:00Z', has_customer: true }) }));
  const opened = [];
  globalThis.dispatchEvent = (e) => { opened.push(e.detail); return true; };
  try {
    assert.match(v.text(), /Payment failed/);
    assert.doesNotMatch(v.text(), /Past due/);
    await v.click('button-change-plan');
    assert.deepEqual(opened, [{ plan_key: 'founder:growth', interval: 'monthly', from: { label: 'Billing', href: '/account/billing' }, unlocks: null }]);
  } finally { await v.close(); }
  const e = await mount(h(PlanHeader, { role: 'founder', billing: ready({ tier: 'free', status: 'unpaid', has_customer: true }) }));
  try { assert.match(e.text(), /Ended/); assert.doesNotMatch(e.text(), /Unpaid/); } finally { await e.close(); }
});

// ---------------------------------------------------------------- the sheet, per family

async function sheet(props, routes = {}) {
  const saved = { ...checkoutApi };
  const calls = [];
  for (const k of ['quote', 'start', 'status', 'methods']) {
    checkoutApi[k] = async (arg) => { calls.push([k, arg]); const r = routes[k]; const v = typeof r === 'function' ? r(arg) : r; if (v instanceof Error) throw v; return v ?? {}; };
  }
  const v = await mount(h(CheckoutSheet, props));
  return { ...v, calls, async close() { await v.close(); Object.assign(checkoutApi, saved); } };
}

test('PAYX13: Investor Plus with no price mirrored yet is not on sale (D1334), and Institutional is Contact sales, each with no price, no quote and no Pay', async () => {
  const user = { role: 'investor', investor_tier: 'free' };
  const plus = await sheet({ user, role: 'investor', plan: planForKey(READ, 'investor:plus') });
  try {
    assert.ok(!plus.has('checkout-mode-notsold'), 'Plus is no longer "not offered" (D786 replaced by D1334)');
    assert.match(plus.text('checkout-sheet'), /Not read here yet/, 'no price is on sale until Stripe\'s product is mirrored');
    assert.ok(!plus.has('checkout-pay') && !plus.has('checkout-price'), 'no price and no Pay');
    assert.deepEqual(plus.calls, [], 'nothing is quoted');
  } finally { await plus.close(); }
  const inst = await sheet({ user, role: 'investor', plan: planForKey(READ, 'investor:institutional') });
  try {
    assert.match(inst.text('checkout-mode-notsold'), /Contact sales/);
    assert.equal(inst.props('checkout-contact-sales').href, '/contact', 'the contact page, inside the app');
    assert.deepEqual(inst.calls, []);
  } finally { await inst.close(); }
});

test('PAYX16: staff hold no plan; a Super Admin in Stripe test mode sees the Test mode pill with Payments and Promo codes', async () => {
  const v = await sheet({ user: { role: 'admin', is_super_admin: 1 }, role: 'super_admin', plan: STUDIO, testMode: true });
  try {
    assert.match(v.text('checkout-mode-staff'), /Staff account · no plan needed/);
    assert.match(v.text('checkout-test-mode'), /Test modeNo real money moves\.Payments ›Promo codes ›/);
    assert.ok(v.hrefs().includes('/admin/platform/payments') && v.hrefs().includes('/admin/platform/promo-codes'));
    assert.deepEqual(v.calls, []);
  } finally { await v.close(); }
  const b = await sheet({ user: { role: 'admin' }, role: 'branch_admin', plan: STUDIO });
  try {
    assert.ok(b.has('checkout-mode-staff'), 'a licence administrator is staff');
    assert.ok(!b.has('checkout-test-mode'), 'no pill without test mode');
  } finally { await b.close(); }
});

test('PAYX12, PAYX7b: the sheet names what it unlocks, and Accepted offers Back to the page it opened over', async () => {
  const fakeBridge = { CardForm: () => null, confirmSaved: async () => ({ error: null }), confirmIntent: async () => ({ error: null }) };
  const v = await sheet({
    user: { role: 'founder', subscription_tier: 'growth' }, role: 'founder', plan: STUDIO, held: 'growth',
    from: { label: 'Cap table', href: '/cap-table' }, unlocks: 'Cap table', bridge: fakeBridge, pollMs: 1,
  }, {
    quote: { mode: 'change', direction: 'upgrade', plan_name: 'Raise + Grow', unit_amount: 10000, currency: 'usd', proration_amount: 5000, change_at: 'now', vat: { amount: null, reason: 'Tax is not charged on plans here.' }, total_due_today: 5000, total_reason: null, step_up_required: false },
    start: { mode: 'change', ref: 'sub_fake_up' },
    status: { state: 'active', result: { ai_allowance_microusd: 0, storage_bytes: 0, included: [], reasons: {} }, changes: { before: null } },
  });
  try {
    assert.equal(v.text('checkout-unlocks'), 'Unlocks: Cap table');
    await v.click('checkout-pay');
    assert.ok(v.has('checkout-after-active'));
    assert.equal(v.text('checkout-back-to'), 'Back to Cap table');
    assert.equal(v.props('checkout-back-to').href, '/cap-table');
  } finally { await v.close(); }
});

// ---------------------------------------------------------------- the host

test('CheckoutHost: nothing until asked; then the plan by key over the page, the Advisor’s plan read, and the test-mode read for a Super Admin only', async () => {
  const saved = { plans: publicPricingApi.plansAndPacks, planStatus: api.planStatus, config: api.paymentsConfig, quote: checkoutApi.quote };
  const reads = [];
  publicPricingApi.plansAndPacks = async () => { reads.push('plans'); return READ; };
  api.planStatus = async () => { reads.push('plan-status'); return { plan_group: 'advisor', status: 'active' }; };
  api.paymentsConfig = async () => { reads.push('config'); return { publishable_key: 'pk_test_fake' }; };
  checkoutApi.quote = async () => ({});
  resetPlansRead();
  const v = await mount(h(CheckoutHost, { user: { id: 1, role: 'founder', subscription_tier: 'free' }, bridge: STUB_BRIDGE }), { viewMode: { shellRole: 'founder' } });
  try {
    assert.ok(!v.has('checkout-sheet'), 'nothing is drawn or read until a plan is asked for');
    assert.deepEqual(reads, []);
    await v.fire(CHECKOUT_EVENT, { plan_key: 'founder:studio', interval: 'monthly', from: { label: 'Cap table', href: '/cap-table' }, unlocks: 'Cap table' });
    assert.ok(v.has('checkout-sheet'));
    assert.match(v.text('checkout-summary'), /Raise \+ Grow/);
    assert.deepEqual(reads, ['plans'], 'a Founder needs no plan status, and only a Super Admin reads the test mode');
    assert.ok(!v.has('checkout-test-mode'));
    await v.press('Close');
    assert.ok(!v.has('checkout-sheet'));
  } finally { await v.close(); }

  reads.length = 0;
  const a = await mount(h(CheckoutHost, { user: { id: 2, role: 'advisor' }, bridge: STUB_BRIDGE }));
  try {
    await a.fire(CHECKOUT_EVENT, { plan_key: 'founder:studio', interval: 'monthly' });
    assert.ok(a.has('checkout-mode-other'), 'outside the shell the session’s own role decides');
    await a.press('Close');
    await a.fire(CHECKOUT_EVENT, { plan_key: 'advisor:pro', interval: 'monthly' });
    assert.ok(reads.includes('plan-status'), 'an Advisor’s plan is read from their plan status');
  } finally { await a.close(); }

  reads.length = 0;
  const s = await mount(h(CheckoutHost, { user: { id: 3, role: 'admin', is_super_admin: 1 }, bridge: STUB_BRIDGE }));
  try {
    await s.fire(CHECKOUT_EVENT, { plan_key: 'founder:studio', interval: 'monthly' });
    assert.ok(s.has('checkout-mode-staff'));
    assert.ok(s.has('checkout-test-mode'), 'pk_test_ is test mode');
    assert.ok(reads.includes('config'));
  } finally { await s.close(); Object.assign(publicPricingApi, { plansAndPacks: saved.plans }); Object.assign(api, { planStatus: saved.planStatus, paymentsConfig: saved.config }); checkoutApi.quote = saved.quote; resetPlansRead(); }
});

test('CheckoutHost: a plans read that fails says so with Try again, and never opens a sheet on a guessed price', async () => {
  const saved = publicPricingApi.plansAndPacks;
  let fail = true;
  publicPricingApi.plansAndPacks = async () => { if (fail) throw new Error('offline'); return READ; };
  resetPlansRead();
  const v = await mount(h(CheckoutHost, { user: { id: 1, role: 'founder' }, bridge: STUB_BRIDGE }), { viewMode: { shellRole: 'founder' } });
  try {
    await v.fire(CHECKOUT_EVENT, { plan_key: 'founder:studio', interval: 'monthly' });
    assert.match(v.text('checkout-host-unreadable'), /This plan couldn’t be read just now\.That doesn’t mean it’s free\./);
    assert.ok(!v.has('checkout-sheet'));
    fail = false;
    await v.click('checkout-host-retry');
    assert.ok(v.has('checkout-sheet'));
  } finally { await v.close(); publicPricingApi.plansAndPacks = saved; resetPlansRead(); }
});

// ---------------------------------------------------------------- the renewal banner

function stubAlerts(alerts, over = {}) {
  const saved = { ...billingAlertsApi, def: api.billingPaymentMethodDefault };
  const calls = [];
  billingAlertsApi.list = async () => { calls.push(['list']); return { alerts: typeof alerts === 'function' ? alerts() : alerts }; };
  billingAlertsApi.pay = async (id) => { calls.push(['pay', id]); return over.pay ?? { kind: 'payment', client_secret: 'pi_fake_secret_1', scope: 'founder' }; };
  billingAlertsApi.updateCard = async (id, nonce) => { calls.push(['update', id, typeof nonce]); return over.update ?? { kind: 'setup', client_secret: 'seti_fake_secret_1', scope: 'founder' }; };
  billingAlertsApi.confirm = async (id) => { calls.push(['confirm', id]); return { client_secret: 'pi_fake_secret_2', payment_intent: 'pi_fake' }; };
  api.billingPaymentMethodDefault = async (pm, scope) => { calls.push(['default', pm, scope]); return {}; };
  return { calls, restore() { Object.assign(billingAlertsApi, saved); api.billingPaymentMethodDefault = saved.def; } };
}
const fakeRenewal = (log, result = { error: null, paymentMethod: null }) => ({
  PayForm({ clientSecret, kind, onReady }) {
    React.useEffect(() => { onReady({ confirm: async () => { log.push(['confirm', clientSecret, kind]); return result; } }); }, [onReady, clientSecret, kind]);
    return h('div', { 'data-testid': 'stub-renewal-form' });
  },
  confirmIntent: async (secret) => { log.push(['intent', secret]); return { error: null }; },
});

test('PAYX10: Pay now prepares the renewal behind the step-up, confirms it on the card form, and re-reads the alerts', async () => {
  let open = [FAILED];
  const s = stubAlerts(() => open);
  const log = [];
  const v = await mount(h(RenewalBanner, { user: { id: 1, role: 'founder' }, bridge: fakeRenewal(log), now: () => NOW }), { viewMode: { shellRole: 'founder' } });
  try {
    assert.match(v.text('renewal-banner-failed'), /Your payment didn’t go through\. Your payment for your Founder plan on 21 Nov didn’t go through\. We’ll try again on 24 Nov\./);
    await v.click('renewal-action-pay');
    assert.deepEqual(s.calls.slice(1), [['pay', 7]], 'the intent is asked for only on the press');
    assert.ok(v.has('stub-renewal-form'));
    open = [];
    await v.click('renewal-submit');
    assert.deepEqual(log, [['confirm', 'pi_fake_secret_1', 'payment']]);
    assert.match(v.text('renewal-done'), /Thanks\. Your payment is being confirmed\./);
    assert.equal(s.calls.filter(([k]) => k === 'list').length, 2, 'the alerts are read again');
    assert.ok(!v.has('renewal-banner-failed'), 'a settled alert draws no banner');
  } finally { await v.close(); s.restore(); }
});

test('PAYX10: Update card saves a new card with a nonce and makes it the default; a decline keeps the form and says no money moved', async () => {
  const s = stubAlerts([FAILED]);
  const log = [];
  const v = await mount(h(RenewalBanner, { user: { id: 1, role: 'founder' }, bridge: fakeRenewal(log, { error: null, paymentMethod: 'pm_fake_new' }), now: () => NOW }), { viewMode: { shellRole: 'founder' } });
  try {
    await v.click('renewal-action-update');
    assert.deepEqual(s.calls[1], ['update', 7, 'string']);
    assert.equal(v.text('renewal-submit'), 'Save card');
    await v.click('renewal-submit');
    assert.deepEqual(s.calls.find(([k]) => k === 'default'), ['default', 'pm_fake_new', 'founder']);
    assert.match(v.text('renewal-done'), /Your card is updated\. We’ll use it for the next try\./);
  } finally { await v.close(); s.restore(); }
  const s2 = stubAlerts([FAILED]);
  const d = await mount(h(RenewalBanner, { user: { id: 1, role: 'founder' }, bridge: fakeRenewal([], { error: { code: 'card_declined', decline_code: 'insufficient_funds' } }), now: () => NOW }), { viewMode: { shellRole: 'founder' } });
  try {
    await d.click('renewal-action-pay');
    await d.click('renewal-submit');
    assert.equal(d.text('renewal-decline'), 'Your card doesn’t have enough funds for this payment. You were not charged.');
    assert.ok(d.has('renewal-submit'), 'the form stays for another try');
  } finally { await d.close(); s2.restore(); }
});

test('PAYX10b: Confirm payment hands the bank’s check to Stripe with no card form', async () => {
  const s = stubAlerts([CONFIRM]);
  const log = [];
  const v = await mount(h(RenewalBanner, { user: { id: 1, role: 'founder' }, bridge: fakeRenewal(log), now: () => NOW }), { viewMode: { shellRole: 'founder' } });
  try {
    assert.match(v.text('renewal-banner-confirm'), /Your bank needs you to confirm the payment for your Founder plan\./);
    await v.click('renewal-action-confirm');
    assert.deepEqual(s.calls.slice(1, 2), [['confirm', 8]]);
    assert.deepEqual(log, [['intent', 'pi_fake_secret_2']]);
    assert.ok(v.has('renewal-done'));
    assert.ok(!v.has('stub-renewal-form'));
  } finally { await v.close(); s.restore(); }
});

test('PAYX10: Dismiss hides the banner for today only; staff see none; a refused prepare is words, never a code', async () => {
  const s = stubAlerts([ENDED]);
  const v = await mount(h(RenewalBanner, { user: { id: 1, role: 'advisor' }, bridge: fakeRenewal([]), now: () => NOW }), { viewMode: { shellRole: 'advisor' } });
  try {
    assert.ok(v.has('renewal-banner-ended'));
    assert.equal(v.props('renewal-action-billing').href, '/account/billing');
    await v.click('renewal-dismiss');
    assert.ok(!v.has('renewal-banner-ended'));
    assert.equal(v.stored.get('axal:renewal-banner:9:ended:2026-11-21'), '1');
  } finally { await v.close(); s.restore(); }
  // A page loaded later the same day reads the stored dismissal; the next day shows it again.
  const s1 = stubAlerts([ENDED]);
  const kept = new Map([['axal:renewal-banner:9:ended:2026-11-21', '1']]);
  const later = await mount(h(RenewalBanner, { user: { id: 1, role: 'advisor' }, bridge: fakeRenewal([]), now: () => NOW }), { viewMode: { shellRole: 'advisor' }, stored: kept });
  try { assert.ok(!later.has('renewal-banner-ended'), 'dismissed for the rest of the day'); } finally { await later.close(); }
  const next = await mount(h(RenewalBanner, { user: { id: 1, role: 'advisor' }, bridge: fakeRenewal([]), now: () => new Date('2026-11-22T09:00:00Z') }), { viewMode: { shellRole: 'advisor' }, stored: kept });
  try { assert.ok(next.has('renewal-banner-ended'), 'and back the next day'); } finally { await next.close(); s1.restore(); }
  const st = stubAlerts([FAILED]);
  const a = await mount(h(RenewalBanner, { user: { id: 2, role: 'admin' } }), { viewMode: { shellRole: 'branch_admin' } });
  try {
    assert.ok(!a.has('renewal-banner-failed'));
    assert.deepEqual(st.calls, [], 'staff alerts are not even read');
  } finally { await a.close(); st.restore(); }
  assert.equal(renewalRefusal({ code: 'payment_not_needed' }), 'This payment is already settled. Nothing was charged.');
  assert.equal(renewalRefusal(new Error('TOTP required')), 'Sign in with your authenticator app to pay here. Nothing was charged.');
  for (const e of [{ code: 'payment_not_needed' }, { code: 'renewal_unreadable' }, new Error('TOTP required'), null]) assert.doesNotMatch(renewalRefusal(e), /_|TOTP/);
});

// ---------------------------------------------------------------- Usage › Limits

const M = 1_000_000;
const BUDGET = { licence: 'founder', daily_microusd: 0, monthly_microusd: 0, day_spend_microusd: 0, month_spend_microusd: 0,
  balance_microusd: 0, day_reserved_microusd: 0, month_reserved_microusd: 0, topup_reserved_microusd: 0, held_for_review: [], daily_capped: false };
test('PAYX12: Usage › Limits says what the plan includes, with Compare plans and Upgrade into the sheet', async () => {
  const ready = (data) => ({ status: 'ready', data, reload() {} });
  const v = await mount(h(IncludedCard, { budget: ready(BUDGET), role: 'founder', held: 'free' }));
  const opened = [];
  globalThis.dispatchEvent = (e) => { opened.push(e.detail); return true; };
  try {
    assert.equal(v.text('included-line'), FREE_INCLUDED);
    assert.equal(FREE_INCLUDED, 'Free plan: no AI allowance. AI runs from AI tokens you top up.');
    assert.equal(v.props('included-compare').href, '/pricing');
    await v.click('included-upgrade');
    assert.deepEqual(opened, [{ plan_key: 'founder:growth', interval: 'monthly', from: { label: 'Usage', href: '/account/usage/limits' }, unlocks: 'a monthly AI allowance' }]);
  } finally { await v.close(); }
  const top = await mount(h(IncludedCard, { budget: ready({ ...BUDGET, licence: 'partner', monthly_microusd: 50 * M }), role: 'partner', held: 'pro' }));
  try {
    assert.match(top.text('included-line'), /Your plan includes \$50\.00 of AI a month\./);
    assert.ok(!top.has('included-upgrade'), 'nothing above the top plan');
    assert.equal(top.props('included-compare').href, '/pricing?for=operating-partner');
  } finally { await top.close(); }
});

// ---------------------------------------------------------------- the wiring

test('the wiring: no entry leaves for Stripe; the host is mounted beside the paywall, the banner in the shell; no alert or confirm', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /<SafeMount name="GlobalCheckoutMount"><GlobalCheckoutMount \/><\/SafeMount>/);
  assert.match(app, /<SafeMount name="RenewalBanner"><RenewalBanner user=\{user\} \/><\/SafeMount>/);
  // Billing's Cancel asks in its own dialog (PAYX11); removing a card keeps its older confirm, which is not this issue's.
  assert.doesNotMatch(read('frontend/src/components/BillingDashboard.jsx').match(/const cancel = async[\s\S]*?\n  \};/)[0], /confirm\(/);
  assert.doesNotMatch(codeOnly(read('frontend/src/components/BillingDashboard.jsx')), /tierCheckout|investorCheckout|billingSwapPreview/);
  for (const f of ['frontend/src/components/PaywallModal.jsx', 'frontend/src/pages/account/AccountBilling.jsx', 'frontend/src/pages/account/LimitsPage.jsx', 'frontend/src/pages/PerksPage.jsx', 'frontend/src/components/checkout/RenewalBanner.jsx', 'frontend/src/components/checkout/CheckoutHost.jsx', 'frontend/src/components/checkout/checkoutEntry.js']) {
    const src = codeOnly(read(f));
    assert.doesNotMatch(src, /tierCheckout|investorCheckout|planCheckout|location\.href\s*=/, `${f} leaves for Stripe`);
    assert.doesNotMatch(src, /window\.confirm|\balert\(/, `${f} pops up`);
  }
  const settings = codeOnly(read('frontend/src/pages/SettingsPage.jsx'));
  assert.doesNotMatch(settings, /api\.(tierCheckout|investorCheckout|planCheckout)/, 'Billing’s panels open the sheet');
  assert.doesNotMatch(read('frontend/src/components/advisor/AdvisorProgressWidget.jsx') + read('frontend/src/components/advisor/eadwynPhone.jsx'), /\/billing\/upgrade/, 'no Upgrade goes to an address that does not exist');
  assert.match(read('frontend/src/components/checkout/RenewalBanner.jsx'), /lazy\(\(\) => import\('\.\/RenewalPayForm'\)\)/, 'Stripe loads only on a press');
  assert.match(read('cloudflare-worker/src/routes/billing.ts'), /canceled_at: sub\.canceled_at \? new Date\(sub\.canceled_at \* 1000\)\.toISOString\(\) : null/);
});

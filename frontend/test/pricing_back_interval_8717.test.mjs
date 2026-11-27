/**
 * #8717 — browser Back from an annual signup returned Pricing to Monthly: the address kept `?for=` and the billing
 * interval lived only in component state, so the page that Back mounted started again on the default.
 *
 * The interval is now in the address beside the audience (`?interval=`, written with `replace`), so:
 *   · Back restores the audience and the interval that produced the quote; Forward returns to that same quote;
 *   · a fresh visit and a bare deep link are Monthly, a yearly deep link and its reload are Yearly;
 *   · a deliberate change to Monthly persists through the same journey;
 *   · pressing Monthly / Yearly adds no history entry;
 *   · a member's checkout return keeps the interval it opened the sheet on, and drops one it could not.
 *
 * Every audience with a paid card is covered (Founder, Investor, Advisor, Operating Partner). The expected figures and
 * destinations are read from the test's catalogue through the catalogue helpers, never typed in as prices.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { PLAN_CARDS } from '../src/lib/sitePricing.js';
import { billingFromSearch, priceOf, searchWithBilling, usd } from '../src/lib/pricingModel.js';
import { planKeyOfSpec, registerPathFor } from '../src/lib/planIntent.js';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { checkoutApi } from '../src/lib/api/billingCheckout.js';
import { billingAlertsApi } from '../src/lib/api/billingAlerts.js';

const h = React.createElement;
const price = (unit_amount, interval) => ({ price_id: `price_${unit_amount}_${interval}`, unit_amount, currency: 'usd', interval, interval_count: 1, allowance_microusd: 1_000_000 });

// A synthetic catalogue: every paid card's plan, each with a monthly and a yearly price that differ per plan, so a card
// that showed another plan's figure, or the other interval's, cannot pass by coincidence.
const PAID = Object.entries(PLAN_CARDS).flatMap(([tab, specs]) => specs
  .filter((spec) => planKeyOfSpec(spec) && spec.match)
  .map((spec) => ({ tab, spec })));
const CATALOGUE = {
  plans: PAID.map(({ spec }, i) => {
    const month = 1900 + i * 1000;
    const year = month * 10 + i * 100;
    return {
      family: spec.storage.split(':')[0], licence_key: spec.match, product_id: `prod_${spec.storage}`, plan_name: spec.name, free: false,
      prices: [price(month, 'month'), price(year, 'year')],
      monthly: { unit_amount: month, currency: 'usd', allowance_microusd: 1_000_000 },
      yearly: { unit_amount: year, currency: 'usd', allowance_microusd: 1_000_000 },
      catalogue: { key: spec.storage },
    };
  }),
  packs: [],
};
const planOf = (spec) => CATALOGUE.plans.find((p) => p.licence_key === spec.match);

/** What the catalogue says a visitor's card shows and where it leads, for one interval. */
function expected(tab, spec, interval) {
  const shown = priceOf(planOf(spec), interval === 'yearly' ? 'year' : 'month');
  return {
    price: interval === 'yearly' ? usd(Math.round(shown.unit_amount / 12)) : usd(shown.unit_amount),
    note: interval === 'yearly' ? `${usd(shown.unit_amount)} billed yearly` : '',
    to: registerPathFor({ lane: spec.lane, tab, planKey: planKeyOfSpec(spec), interval, seen: shown.unit_amount }),
  };
}

const AUDIENCES = ['founder', 'investor', 'advisor', 'operating-partner'];

test('the paid cards under test are one or more per audience, Founder, Investor, Advisor and Operating Partner', () => {
  for (const tab of AUDIENCES) assert.ok(PAID.some((p) => p.tab === tab), `${tab} has a paid card`);
  assert.ok(PAID.some(({ spec }) => spec.cta === 'Get Advisor Pro'), 'the card in the report is among them');
});

test('billingFromSearch: Yearly only when the address says so; no interval, or one it does not know, is the Monthly default', () => {
  for (const [search, want] of [
    ['', 'monthly'], [null, 'monthly'], ['?for=advisor', 'monthly'], ['?for=advisor&interval=monthly', 'monthly'],
    ['?for=advisor&interval=yearly', 'yearly'], ['interval=yearly', 'yearly'], ['?interval=YEARLY', 'monthly'],
    ['?interval=weekly', 'monthly'], ['?interval=', 'monthly'],
  ]) assert.equal(billingFromSearch(search), want, String(search));
});

test('searchWithBilling sets the interval and keeps the audience and any other parameter as they were', () => {
  const next = new URLSearchParams(searchWithBilling('?for=advisor&checkout=advisor%3Apro&seen=4900', 'yearly'));
  assert.deepEqual([next.get('for'), next.get('interval'), next.get('checkout'), next.get('seen')], ['advisor', 'yearly', 'advisor:pro', '4900']);
  assert.equal(new URLSearchParams(searchWithBilling('?for=founder&interval=yearly', 'monthly')).get('interval'), 'monthly');
  assert.equal(new URLSearchParams(searchWithBilling('', 'anything')).get('interval'), 'monthly', 'never writes an interval it does not know');
});

// ---------------------------------------------------------------- mounted

const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const text = (n) => (n?.nodeType === 3 ? n.textContent : (n?.childNodes || []).map(text).join('') || n?.textContent || '');
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((r) => setImmediate(r)); }); };

/**
 * Pricing at `entries[index]` inside a memory history, with /register as the next page. `nav` drives the history the
 * way the browser does (`go(-1)` is Back, `go(1)` Forward); `where()` is the current address.
 */
async function mount(entries, { user = null, index = entries.length - 1, read = CATALOGUE } = {}) {
  const restore = installDocument();
  const createEl = document.createElement.bind(document);
  document.createElement = (tag) => { const n = createEl(tag); n.querySelector = () => null; return n; };
  const saved = [{ ...publicPricingApi }, { ...checkoutApi }, { ...billingAlertsApi }];
  publicPricingApi.plansAndPacks = async () => read;
  publicPricingApi.aiModels = async () => ({ models: [] });
  checkoutApi.quote = async () => ({ plan_key: 'x', interval: 'yearly', subtotal: 0 });
  checkoutApi.methods = async () => ({ methods: [] });
  const container = document.createElement('div');
  const root = createRoot(container);
  const nav = { go: null, at: null };
  const Probe = () => { const l = useLocation(); nav.go = useNavigate(); nav.at = `${l.pathname}${l.search}`; return null; };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: entries, initialIndex: index },
    h(Routes, null,
      h(Route, { path: '/pricing', element: h(PricingBody, { user }) }),
      h(Route, { path: '*', element: h('div', { 'data-testid': 'elsewhere' }) })),
    h(Probe))));
  await settle();
  const by = (id) => walk(container).find((n) => props(n)['data-testid'] === id);
  const billingButton = (label) => walk(container).find((n) => n.tagName === 'BUTTON' && 'aria-pressed' in props(n) && text(n) === label);
  return {
    by,
    where: () => nav.at,
    pressed: () => ['Monthly', 'Yearly'].filter((l) => props(billingButton(l))['aria-pressed'] === true),
    async choose(label) { await act(async () => { props(billingButton(label)).onClick(); }); await settle(); },
    async go(delta) { await act(async () => { nav.go(delta); }); await settle(); },
    async pick(tab) { await act(async () => { props(walk(container).find((n) => props(n).id === `pricing-audience-${tab}`)).onClick(); }); await settle(); },
    card(spec) {
      const el = by(`pricing-card-${spec.id}`);
      const link = el && walk(el).find((n) => n.tagName === 'A');
      return { price: text(by(`pricing-price-${spec.id}`)), note: text(walk(el).find((n) => /axp-price-note/.test(props(n).className || ''))), to: link ? props(link).href ?? link.href : null, link };
    },
    /** Follow the card's own link as a click does: a push onto the history. */
    async follow(spec) {
      const { link } = this.card(spec);
      assert.ok(link, `${spec.name} has a signup link`);
      await act(async () => {
        props(link).onClick({ button: 0, defaultPrevented: false, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, preventDefault() { this.defaultPrevented = true; }, currentTarget: link, target: link });
      });
      await settle();
    },
    async close() { await act(async () => root.unmount()); Object.assign(publicPricingApi, saved[0]); Object.assign(checkoutApi, saved[1]); Object.assign(billingAlertsApi, saved[2]); restore(); },
  };
}

const searchOf = (path) => new URL(path, 'https://x.test').searchParams;

for (const { tab, spec } of PAID) {
  test(`${tab} · ${spec.name}: Yearly, signup, Back restores the audience and Yearly; Forward returns to the same yearly quote`, async () => {
    const page = await mount(['/start', `/pricing?for=${tab}`]);
    try {
      assert.deepEqual(page.pressed(), ['Monthly'], 'a fresh visit is the Monthly default');
      const monthly = expected(tab, spec, 'monthly');
      assert.equal(page.card(spec).price, monthly.price);
      await page.choose('Yearly');
      assert.equal(searchOf(page.where()).get('for'), tab);
      assert.equal(searchOf(page.where()).get('interval'), 'yearly', 'the interval is in the address beside the audience');
      const yearly = expected(tab, spec, 'yearly');
      const card = page.card(spec);
      assert.deepEqual([card.price, card.note, card.to], [yearly.price, yearly.note, yearly.to], 'the yearly figure, its annual total and the signup destination are the catalogue\'s');

      await page.follow(spec);
      assert.equal(page.where(), yearly.to, 'the signup carries the yearly quote');
      assert.ok(page.by('elsewhere'));

      await page.go(-1);
      assert.equal(searchOf(page.where()).get('for'), tab, 'Back keeps the audience');
      assert.deepEqual(page.pressed(), ['Yearly'], 'Back restores the interval that produced the quote');
      const back = page.card(spec);
      assert.deepEqual([back.price, back.note, back.to], [yearly.price, yearly.note, yearly.to], 'and the same card, total and destination');

      await page.go(1);
      assert.equal(page.where(), yearly.to, 'Forward returns to the same plan and cadence');
      const fwd = searchOf(page.where());
      assert.deepEqual([fwd.get('plan'), fwd.get('interval')], [planKeyOfSpec(spec), 'yearly']);

      // Pressing Monthly / Yearly replaced the Pricing entry: two Backs from signup reach the page before Pricing.
      await page.go(-1);
      await page.go(-1);
      assert.equal(page.where(), '/start', 'the billing switch added no history entry');
    } finally { await page.close(); }
  });

  test(`${tab} · ${spec.name}: a deliberate change to Monthly persists through signup, Back and Forward`, async () => {
    const page = await mount([`/pricing?for=${tab}&interval=yearly`]);
    try {
      assert.deepEqual(page.pressed(), ['Yearly'], 'a yearly deep link opens on Yearly');
      await page.choose('Monthly');
      assert.equal(searchOf(page.where()).get('interval'), 'monthly');
      const monthly = expected(tab, spec, 'monthly');
      const card = page.card(spec);
      assert.deepEqual([card.price, card.note, card.to], [monthly.price, monthly.note, monthly.to]);
      await page.follow(spec);
      assert.equal(searchOf(page.where()).get('interval'), 'monthly');
      await page.go(-1);
      assert.deepEqual(page.pressed(), ['Monthly'], 'Back keeps the deliberate Monthly');
      assert.equal(page.card(spec).to, monthly.to);
      await page.go(1);
      assert.equal(page.where(), monthly.to);
    } finally { await page.close(); }
  });
}

test('deep links and reload: monthly and yearly deep links open on their interval; a reload (a fresh mount of the address) keeps it', async () => {
  for (const [search, want] of [
    ['/pricing?for=advisor', 'Monthly'], ['/pricing', 'Monthly'], ['/pricing?for=advisor&interval=monthly', 'Monthly'],
    ['/pricing?for=advisor&interval=yearly', 'Yearly'], ['/pricing?interval=yearly&for=operating-partner', 'Yearly'],
    ['/pricing?for=investor&interval=bogus', 'Monthly'],
  ]) {
    for (let load = 0; load < 2; load += 1) {
      const page = await mount([search]);
      try {
        assert.deepEqual(page.pressed(), [want], `${search} (load ${load + 1})`);
        assert.equal(page.where(), search, 'opening the page does not rewrite its address');
      } finally { await page.close(); }
    }
  }
});

test('switching audience keeps the chosen interval and the audience in the same entry', async () => {
  const page = await mount(['/start', '/pricing?for=advisor']);
  try {
    await page.choose('Yearly');
    await page.pick('founder');
    const q = searchOf(page.where());
    assert.deepEqual([q.get('for'), q.get('interval')], ['founder', 'yearly']);
    assert.deepEqual(page.pressed(), ['Yearly']);
    await page.go(-1);
    assert.equal(page.where(), '/start');
  } finally { await page.close(); }
});

test('a member\'s checkout return keeps the interval the sheet opened on, and drops one it could not open', async () => {
  const studio = PLAN_CARDS.founder.find((s) => s.id === 'studio');
  const key = encodeURIComponent(planKeyOfSpec(studio));
  const member = { role: 'founder', subscription_tier: 'free' };
  {
    const page = await mount([`/pricing?for=founder&checkout=${key}&interval=yearly&seen=${planOf(studio).yearly.unit_amount}`], { user: member });
    try {
      assert.ok(page.by('checkout-sheet'), 'the sheet opens');
      assert.equal(page.where(), '/pricing?for=founder&interval=yearly', 'the ask leaves the address; the interval stays as the page\'s billing');
      assert.deepEqual(page.pressed(), ['Yearly']);
    } finally { await page.close(); }
  }
  {
    const noYear = { plans: CATALOGUE.plans.map((p) => (p.licence_key === studio.match ? { ...p, prices: p.prices.filter((x) => x.interval === 'month'), yearly: null } : p)), packs: [] };
    const page = await mount([`/pricing?for=founder&checkout=${key}&interval=yearly`], { user: member, read: noYear });
    try {
      assert.ok(page.by('pricing-returned-interval'), 'the yearly price no longer sold is said');
      assert.ok(!page.by('checkout-sheet'));
      assert.equal(page.where(), '/pricing?for=founder', 'an interval that opened nothing leaves with the ask');
      assert.deepEqual(page.pressed(), ['Monthly']);
    } finally { await page.close(); }
  }
});

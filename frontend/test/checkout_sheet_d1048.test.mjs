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
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { familyOf, includedLines, intervalPrice, intervalsOf, sheetMode } from '../src/components/checkout/checkoutModel.js';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';

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

test('mounted on /pricing: Upgrade opens the sheet in place, no payment starts until Continue, and Close returns to the page', async () => {
  const restore = installDocument();
  // No geometry in this DOM; Pricing's tab scrolling is browser-only (as pricing_tab_comparisons does).
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => { const node = createElement(tag); node.querySelector = () => null; return node; };
  const original = { ...publicPricingApi };
  const fetchWas = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
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
    assert.match(text(byId('checkout-summary')), /Founder.*Validate \+ Build.*\$20 \/ month.*\$5\.00 of AI a month.*not read here yet.*Subtotal\$20\.00/s);
    assert.ok(byId('checkout-continue'), 'Continue to payment');
    assert.ok(!seen.some((u) => u.includes('/payments/intent')), 'opening the sheet starts no payment');
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

test('the sheet loads Stripe only on Continue, uses today\'s payment form, and has no alert or confirm', () => {
  const src = read('frontend/src/components/checkout/CheckoutSheet.jsx');
  assert.match(src, /const AxalCheckout = lazy\(\(\) => import\('\.\.\/AxalCheckout'\)\);/);
  assert.doesNotMatch(src, /^import AxalCheckout/m);
  assert.match(src, /paying \? \(/, 'the form mounts once the member presses Continue');
  assert.doesNotMatch(src, /window\.(alert|confirm)|\balert\(|\bconfirm\(/);
  assert.ok(read('design/incoming/Checkout · Boards.dc.html').includes('PAYX21'));
});

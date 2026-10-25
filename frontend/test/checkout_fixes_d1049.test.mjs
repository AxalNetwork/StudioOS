/**
 * D1049 (#2900) — Checkout part 1, the fixes:
 *   · the paywall says a refused checkout in the page, never a browser
 *     pop-up, and says no money moved;
 *   · a paying Advisor or Operating Partner is "Current plan" on Pro, read
 *     from their plan status (`account_subscriptions`), and nothing is marked
 *     while that read is loading or failed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { HOLDS_PLAN, NOT_CHARGED, checkoutRefusal, heldCard, needsPlanStatus } from '../src/lib/pricingModel.js';
import PaywallModal from '../src/components/PaywallModal.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const h = React.createElement;
const ready = (body) => ({ status: 'ready', body });

test('heldCard: an Advisor or Operating Partner who pays is on Pro; one who does not is on Basic', () => {
  for (const status of ['active', 'trialing', 'past_due', 'ACTIVE']) {
    assert.equal(heldCard({}, 'advisor', 'advisor', ready({ plan_group: 'advisor', status })), 'pro', status);
    assert.equal(heldCard({}, 'partner', 'operating-partner', ready({ plan_group: 'partner', status })), 'pro', status);
  }
  for (const status of ['free', 'cancelled', 'incomplete', 'unpaid', '', undefined]) {
    assert.equal(heldCard({}, 'advisor', 'advisor', ready({ plan_group: 'advisor', status })), 'free', String(status));
  }
  assert.deepEqual([...HOLDS_PLAN].sort(), ['active', 'past_due', 'trialing'], 'the Billing panel\'s own rule for subscribed');
  assert.equal(heldCard({}, 'advisor', 'advisor', ready({ plan_group: 'partner', status: 'active' })), 'free', 'a plan in another group is not this one');
  assert.equal(heldCard({}, 'advisor', 'advisor', ready(null)), 'free');
});

test('heldCard marks nothing while the plan status is reading or could not be read, and other tabs are unchanged', () => {
  assert.equal(heldCard({}, 'advisor', 'advisor', { status: 'loading', body: null }), null);
  assert.equal(heldCard({}, 'advisor', 'advisor', { status: 'unreadable', body: null }), null, 'a failed read is not Basic');
  assert.equal(heldCard({}, 'partner', 'operating-partner'), null);
  assert.equal(heldCard({}, 'advisor', 'operating-partner', ready({ plan_group: 'partner', status: 'active' })), null, 'not their role\'s tab');
  assert.equal(heldCard(null, 'advisor', 'advisor', ready({ plan_group: 'advisor', status: 'active' })), null, 'a visitor holds nothing');
  assert.equal(heldCard({ subscription_tier: 'growth' }, 'founder', 'founder', ready({ status: 'active' })), 'growth', 'a founder still reads the session');
  assert.equal(heldCard({ investor_tier: 'professional' }, 'investor', 'investor'), 'professional');
});

test('needsPlanStatus: the read is made only for an Advisor or Operating Partner on their own tab', () => {
  assert.equal(needsPlanStatus({}, 'advisor', 'advisor'), true);
  assert.equal(needsPlanStatus({}, 'partner', 'operating-partner'), true);
  assert.equal(needsPlanStatus(null, 'advisor', 'advisor'), false);
  assert.equal(needsPlanStatus({}, 'partner', 'advisor'), false);
  assert.equal(needsPlanStatus({}, 'founder', 'founder'), false);
  const page = codeOnly(read('frontend/src/pages/PricingPage.jsx'));
  assert.match(page, /needsPlanStatus\(user, role, tab\)/);
  assert.match(page, /wantPlan \? api\.planStatus\(\) : Promise\.resolve\(null\)/);
  assert.match(page, /heldCard\(user, role, tab, planRead\)/);
});

test('checkoutRefusal: every line says no money moved, and none shows a code', () => {
  const lines = [
    checkoutRefusal({ code: 'catalog_price_missing', message: 'No active Stripe price for tier=growth interval=month' }),
    checkoutRefusal({ code: 'stripe_not_configured' }),
    checkoutRefusal({ code: 'investor_only' }),
    checkoutRefusal({ code: 'timeout' }),
    checkoutRefusal({ status: 502, message: 'card_declined' }),
    checkoutRefusal(new Error('resource_missing: No such price')),
    checkoutRefusal(null),
  ];
  for (const l of lines) {
    assert.ok(l.includes(NOT_CHARGED), l);
    assert.doesNotMatch(l, /_|Stripe|price=|tier=|resource|declined/, `a raw code or message reached the member: ${l}`);
  }
  assert.equal(NOT_CHARGED, 'You were not charged.');
  assert.equal(lines[0], 'Checkout is not open for this plan yet. You were not charged.');
  assert.equal(lines[2], 'This plan is for investor accounts. You were not charged.');
  assert.equal(lines[3], 'Checkout could not be reached. You were not charged. Try again.');
  assert.equal(lines[4], 'Checkout could not be reached. You were not charged. Try again.');
  assert.equal(lines[6], 'Checkout could not start. You were not charged. Try again.');
});

test('the paywall has no browser pop-up', () => {
  const src = codeOnly(read('frontend/src/components/PaywallModal.jsx'));
  assert.doesNotMatch(src, /\balert\(|\bconfirm\(|no-alert/);
  assert.match(src, /role="alert" data-testid="paywall-refusal"/);
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

async function mountedPaywall(handle) {
  const restore = installDocument();
  const listeners = new Map();
  const prev = { fetch: globalThis.fetch, add: globalThis.addEventListener, remove: globalThis.removeEventListener, ss: globalThis.sessionStorage };
  globalThis.addEventListener = (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); };
  globalThis.removeEventListener = (type, fn) => { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); };
  globalThis.sessionStorage = { getItem: () => null, setItem() {} };
  const requests = [];
  globalThis.fetch = async (u, o = {}) => { requests.push({ url: String(u), method: o.method || 'GET', body: o.body }); return handle(String(u), o); };
  const container = document.createElement('div'); document.body.appendChild(container);
  const r = createRoot(container);
  await act(async () => r.render(h(MemoryRouter, null, h(PaywallModal, { user: { role: 'founder', subscription_tier: 'free' } }))));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((res) => setTimeout(res, 0)); });
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  return {
    requests,
    text: () => text(container),
    textOf: (id) => text(nodes().find((n) => props(n)['data-testid'] === id)),
    async open(required) { await act(async () => { for (const fn of listeners.get('studioos:tier_required') || []) fn({ detail: { required } }); }); await flush(); },
    /** The first button whose words start with `label`. */
    async press(label) {
      const node = nodes().find((n) => String(n.tagName).toUpperCase() === 'BUTTON' && text(n).trim().startsWith(label));
      assert.ok(node, `no button "${label}"`);
      await act(async () => { props(node).onClick({ preventDefault() {}, stopPropagation() {} }); });
      await flush();
    },
    async close() {
      await act(async () => r.unmount());
      Object.assign(globalThis, { fetch: prev.fetch, addEventListener: prev.add, removeEventListener: prev.remove, sessionStorage: prev.ss });
      restore();
    },
  };
}

test('mounted: a refused checkout is a line in the paywall, with no pop-up and no code', async () => {
  const popped = [];
  const prevAlert = globalThis.alert;
  globalThis.alert = (m) => popped.push(m);
  const view = await mountedPaywall((url) => (url.includes('/billing/tier/checkout')
    ? response({ error: 'catalog_price_missing', detail: 'No active Stripe price for tier=growth interval=month' }, 502)
    : response({})));
  try {
    await view.open('growth');
    assert.match(view.text(), /Upgrade to keep building/);
    assert.equal(view.textOf('paywall-refusal'), '', 'no line before a checkout is tried');
    await view.press('Upgrade to ');
    assert.ok(view.requests.some((r) => r.url.endsWith('/billing/tier/checkout') && r.method === 'POST'));
    assert.equal(view.textOf('paywall-refusal'), 'Checkout is not open for this plan yet. You were not charged.');
    assert.deepEqual(popped, [], 'no browser pop-up');
    assert.doesNotMatch(view.text(), /catalog_price_missing|tier=growth/);
  } finally { await view.close(); globalThis.alert = prevAlert; }
});

test('mounted: an answer with no checkout address is a refusal too', async () => {
  const view = await mountedPaywall((url) => (url.includes('/billing/tier/checkout') ? response({}) : response({})));
  try {
    await view.open('studio');
    await view.press('Upgrade to ');
    assert.equal(view.textOf('paywall-refusal'), 'Checkout could not start. You were not charged. Try again.');
  } finally { await view.close(); }
});

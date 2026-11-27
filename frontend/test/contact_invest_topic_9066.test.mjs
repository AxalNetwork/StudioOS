/**
 * #9066 — an investment team that picks Institutional and presses Contact
 * Axal VC lands on the Contact form with Investing / LP pressed, not
 * Spin-Out Lab. The Pricing card already sent `?topic=invest` (#6984); the
 * checkout sheet (pinned in checkout_entry_d1054.test.mjs), the paywall's
 * Institutional card and Billing's Institutional tier went to a bare
 * `/contact`. A territory-licence link keeps `?topic=licence`, and every
 * pill stays on the form.
 */
import test from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

// BillingSection reaches lib/stripe.js, which reads `import.meta.env` at load; this hook gives it one (as account_regressions_4618).
register(new URL('./_airailRender-hook.mjs', import.meta.url));

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
globalThis.localStorage ??= memoryStorage();
globalThis.sessionStorage ??= memoryStorage();

const { INSTITUTIONAL_CONTACT_HREF } = await import('../src/components/checkout/checkoutModel.js');
const { default: PaywallModal } = await import('../src/components/PaywallModal.jsx');
const { InvestorBillingPanel } = await import('../src/pages/account/BillingSection.jsx');
const { default: ContactPage } = await import('../src/pages/ContactPage.jsx');
const { LICENCE_REQUEST_PATH } = await import('../src/lib/siteFirm.js');
const { resetPlansRead } = await import('../src/lib/planPrices.js');

const h = React.createElement;
const json = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

/** Mount `el` in a router with every request answered `{}`; returns the live helpers. */
async function mount(el) {
  const restore = installDocument();
  const listeners = new Map();
  const prev = { fetch: globalThis.fetch, add: globalThis.addEventListener, remove: globalThis.removeEventListener };
  globalThis.addEventListener = (type, fn) => { listeners.set(type, [...(listeners.get(type) || []), fn]); };
  globalThis.removeEventListener = (type, fn) => { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); };
  globalThis.fetch = async () => json({});
  resetPlansRead();
  const container = document.createElement('div'); document.body.appendChild(container);
  const r = createRoot(container);
  await act(async () => r.render(h(MemoryRouter, null, el)));
  const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((res) => setTimeout(res, 0)); });
  await flush();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
  return {
    /** Every link whose words are `label`, as [href]. */
    linksNamed: (label) => nodes().filter((n) => n.tagName === 'A' && text(n).trim() === label).map((n) => props(n).href || props(n).to),
    byTestId: (id) => nodes().find((n) => props(n)['data-testid'] === id),
    href: (n) => props(n).href || props(n).to,
    async fire(type, detail) { await act(async () => { for (const fn of listeners.get(type) || []) fn({ detail }); }); await flush(); },
    async close() {
      await act(async () => r.unmount());
      Object.assign(globalThis, { fetch: prev.fetch, addEventListener: prev.add, removeEventListener: prev.remove });
      restore();
    },
  };
}

const pressed = (path) => [...renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, h(ContactPage)))
  .matchAll(/<button type="button" class="ax-pill[^"]*" aria-pressed="true">([^<]+)<\/button>/g)].map((m) => m[1].replace(/&amp;/g, '&'));

test('#9066: the Institutional contact address is the Contact form\'s Investing / LP topic', () => {
  assert.equal(INSTITUTIONAL_CONTACT_HREF, '/contact?topic=invest');
  assert.deepEqual(pressed(INSTITUTIONAL_CONTACT_HREF), ['Investing / LP'], 'the form opens with Investing / LP pressed');
  assert.deepEqual(pressed('/contact'), ['Spin-Out Lab'], 'a bare /contact would have pressed Spin-Out Lab');
});

test('#9066: a territory-licence link keeps ?topic=licence, and opens on Licence', () => {
  assert.equal(LICENCE_REQUEST_PATH, '/contact?topic=licence');
  assert.deepEqual(pressed(LICENCE_REQUEST_PATH), ['Licence']);
});

test('#9066 mounted: the paywall\'s Institutional card links Contact Axal VC to the Investing / LP topic', async () => {
  const v = await mount(h(PaywallModal, { user: { role: 'investor', investor_tier: 'free' } }));
  try {
    await v.fire('studioos:tier_required', { required: 'institutional' });
    const link = v.byTestId('paywall-contact-institutional');
    assert.ok(link, 'the Institutional card offers Contact Axal VC');
    assert.equal(v.href(link), '/contact?topic=invest');
    assert.deepEqual(v.linksNamed('Contact Axal VC'), ['/contact?topic=invest'], 'no Contact Axal VC on the paywall goes to a bare /contact');
  } finally { await v.close(); }
});

test('#9066 mounted: Billing\'s Institutional tier links Contact Axal VC to the Investing / LP topic', async () => {
  const billing = { status: 'ready', data: { tier: 'free', quotas: {} }, reload() {} };
  const v = await mount(h(InvestorBillingPanel, { billing, flash() {}, overview: null }));
  try {
    const link = v.byTestId('billing-contact-institutional');
    assert.ok(link, 'the Institutional tier offers Contact Axal VC');
    assert.equal(v.href(link), '/contact?topic=invest');
    assert.deepEqual(v.linksNamed('Contact Axal VC'), ['/contact?topic=invest'], 'no Contact Axal VC under Billing goes to a bare /contact');
  } finally { await v.close(); }
});

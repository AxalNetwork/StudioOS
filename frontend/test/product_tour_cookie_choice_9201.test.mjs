// #9201: on a first signed-in visit the product tour opened over the cookie banner, dimmed it and made
// 'Reject all' unreachable (the tour's backdrop and inert page). The tour now waits until the cookie
// choice is settled: a choice stored and the banner or preferences dialog closed.
//   · no stored choice: the tour does not open, and the banner's 'Reject all' is drawn, not inert, not covered;
//   · choosing on the banner ('Reject all' or 'Accept all') opens the tour;
//   · saving in 'More choices' keeps the tour waiting until the dialog is closed;
//   · a stored choice: no banner, and the tour opens as before;
//   · the stored choice itself is read: with no banner drawn (not mounted yet), the tour still waits for it.
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import ProductTour from '../src/components/ProductTour.jsx';
import CookieConsent from '../src/components/CookieConsent.jsx';
import { isChoiceSettled, isDecided, rejectAll } from '../src/lib/cookieConsent.js';

const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const propsOf = (n) => (n && Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1]) || {};
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const studio = { getBoundingClientRect: () => ({ left: 300, top: 120, width: 900, height: 600 }), getClientRects: () => [{}], scrollIntoView() {} };

async function mountBoth({ stored = false, banner = true } = {}) {
  const restore = installDocument('', { focus: true });
  if (stored) rejectAll();
  // A window that really dispatches, so the banner's choice reaches the tour the way it does in a browser.
  const listeners = [];
  globalThis.addEventListener = (type, fn) => listeners.push({ type, fn });
  globalThis.removeEventListener = (type, fn) => { const at = listeners.findIndex((l) => l.type === type && l.fn === fn); if (at >= 0) listeners.splice(at, 1); };
  globalThis.dispatchEvent = (e) => { for (const l of listeners.filter((x) => x.type === e.type)) l.fn(e); return true; };
  const prevMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.innerWidth = 1440; globalThis.innerHeight = 900;
  const make = document.createElement.bind(document);
  const enhance = (node) => {
    const attrs = {};
    node.setAttribute = (k, v) => { attrs[k] = String(v); };
    node.getAttribute = (k) => attrs[k] ?? null;
    node.hasAttribute = (k) => Object.hasOwn(attrs, k);
    node.removeAttribute = (k) => { delete attrs[k]; };
    Object.defineProperty(node, 'children', { get: () => node.childNodes.filter((c) => c.nodeType === 1) });
    node.getClientRects = () => [{}];
    node.querySelectorAll = () => walk(node).slice(1).filter((c) => c.tagName === 'BUTTON' && !propsOf(c).disabled);
    return node;
  };
  document.createElement = (tag) => enhance(make(tag));
  enhance(document.body);
  document.querySelector = (sel) => (sel === '[data-tour="studio-modules"]' ? studio : null);
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}' });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(MemoryRouter, null,
      React.createElement(ProductTour, { enabled: true, role: 'founder' }),
      banner ? React.createElement(CookieConsent) : null));
  });
  const nodes = () => walk(document.body);
  const button = (label) => nodes().find((n) => n.tagName === 'BUTTON' && (textOf(n).trim() === label || propsOf(n)['aria-label'] === label));
  const inert = (n) => { for (let p = n; p; p = p.parentNode) if (p.hasAttribute?.('inert')) return true; return false; };
  return {
    button, inert,
    tour: () => nodes().find((n) => propsOf(n)['data-testid'] === 'product-tour'),
    banner: () => nodes().find((n) => propsOf(n).role === 'dialog' && propsOf(n)['aria-labelledby'] === 'cookie-consent-title'),
    prefs: () => nodes().find((n) => propsOf(n)['aria-labelledby'] === 'cookie-prefs-title'),
    async wait(ms = 900) { await act(async () => { await sleep(ms); }); },
    async click(label) { const b = button(label); assert.ok(b, `a ${label} button`); await act(async () => { propsOf(b).onClick({ stopPropagation() {} }); await sleep(0); }); },
    async close() { await act(async () => root.unmount()); globalThis.fetch = prevFetch; globalThis.matchMedia = prevMedia; delete globalThis.dispatchEvent; restore(); },
  };
}

for (const choice of ['Reject all', 'Accept all']) {
  test(`no stored cookie choice: the tour waits, '${choice}' is reachable, and choosing opens the tour`, async () => {
    const t = await mountBoth();
    try {
      await t.wait();
      assert.ok(t.banner(), 'the banner is drawn');
      assert.ok(t.tour() === undefined, 'the tour has not opened over the banner');
      const reject = t.button('Reject all');
      assert.ok(reject, "'Reject all' is drawn");
      assert.equal(t.inert(reject), false, "'Reject all' is not inert");
      assert.equal(t.inert(t.button(choice)), false, `'${choice}' is not inert`);
      assert.equal(isChoiceSettled(), false);

      await t.click(choice);
      assert.equal(isDecided(), true, 'the choice is stored');
      assert.ok(t.banner() === undefined, 'the banner closed');
      await t.wait();
      assert.ok(t.tour(), 'the tour opened once the choice was made');
      assert.match(textOf(t.tour()), /Step 1 of/);
    } finally { await t.close(); }
  });
}

test("'More choices' then 'Save preferences': the tour waits until the dialog is closed", async () => {
  const t = await mountBoth();
  try {
    await t.click('More choices');
    await t.click('Save preferences');
    assert.equal(isDecided(), true, 'the choice is stored');
    await t.wait();
    assert.ok(t.prefs(), 'the dialog is still open, saying it saved');
    assert.ok(t.tour() === undefined, 'the tour does not open over (and inert) the open dialog');
    await t.click('Close cookie preferences');
    assert.ok(t.prefs() === undefined);
    await t.wait();
    assert.ok(t.tour(), 'the tour opened once the dialog closed');
  } finally { await t.close(); }
});

test('a stored cookie choice: no banner, and the tour opens as before', async () => {
  const t = await mountBoth({ stored: true });
  try {
    assert.ok(t.banner() === undefined, 'no banner');
    assert.equal(isChoiceSettled(), true);
    await t.wait();
    assert.ok(t.tour(), 'the tour opened');
  } finally { await t.close(); }
});

test('the stored choice is what the tour reads: with no banner drawn, it still waits, then opens once one is stored', async () => {
  const t = await mountBoth({ banner: false });
  try {
    await t.wait();
    assert.ok(t.tour() === undefined, 'no stored choice: no tour, banner or not');
    await act(async () => { rejectAll(); });
    await t.wait();
    assert.ok(t.tour(), 'a choice stored (another tab or the banner) opens it');
  } finally { await t.close(); }
});

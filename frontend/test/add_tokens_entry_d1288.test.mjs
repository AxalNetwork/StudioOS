/**
 * D1288 (#3371, part 3 of #2452) — one Add tokens (CRP9): `openAddTokens` and
 * `AddTokensHost` open D1287's sheet over the page the member is on, from every
 * caller; `ADD_TOKENS_PATH` is Pricing's Models tab, which opens the same
 * sheet; the old addresses redirect there keeping the pack; the old
 * storefront's back links go to Models. Every API is stubbed; every pack is
 * invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/add_tokens_entry_d1288.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import {
  ADD_TOKENS_EVENT, ADD_TOKENS_HASH, ADD_TOKENS_PATH, MODELS_PATH, TOKEN_PACKS_PATH, addTokensHref, isAddTokensHref, openAddTokens, packOfHref,
} from '../src/lib/aiTokens.js';
import AddTokensHost, { TokensRedirect, fromOfPath, takesClick } from '../src/components/checkout/AddTokensHost.jsx';
import { PricingBody } from '../src/pages/PricingPage.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);
const h = React.createElement;

const PACKS = { state: 'ready', packs: [
  { uid: 'k10', price_id: 'price_k10', unit_amount: 1000, currency: 'usd', credit_microusd: 10_000_000, bonus_microusd: 0 },
  { uid: 'k25', price_id: 'price_k25', unit_amount: 2500, currency: 'usd', credit_microusd: 25_000_000, bonus_microusd: 0 },
], on_hold: false, latest: null };

function stubBudget() {
  const original = { ...aiBudgetApi };
  aiBudgetApi.topUp = async () => PACKS;
  aiBudgetApi.mine = async () => ({ balance_microusd: 3_400_000, ai_paused: false });
  aiBudgetApi.autoReloadState = async () => ({ enabled: false });
  return () => Object.assign(aiBudgetApi, original);
}

// ─────────────────────────────────────────────────────────── the entry

test('ADD_TOKENS_PATH is Models with #add-tokens; a pack rides in ?pack=; nothing else counts as Add tokens', () => {
  assert.equal(ADD_TOKENS_PATH, '/pricing?for=models#add-tokens');
  assert.equal(TOKEN_PACKS_PATH, ADD_TOKENS_PATH, 'the old name is the same address');
  assert.equal(MODELS_PATH, '/pricing?for=models');
  assert.equal(addTokensHref(), ADD_TOKENS_PATH);
  assert.equal(addTokensHref('  '), ADD_TOKENS_PATH);
  // Mutation checked: drop encodeURIComponent → "a b&c" breaks the query.
  assert.equal(addTokensHref('a b&c'), '/pricing?for=models&pack=a%20b%26c#add-tokens');
  for (const yes of [ADD_TOKENS_PATH, addTokensHref('k25'), '/pricing?pack=k25&for=models#add-tokens']) assert.equal(isAddTokensHref(yes), true, yes);
  // Mutation checked: skip the for=models check → the Founders tab's #add-tokens counts.
  for (const no of ['/pricing?for=founder#add-tokens', '/pricing?for=models', '/pricing?for=models#token-packs', '/pricing/products#token-packs', '#add-tokens', null, 7]) {
    assert.equal(isAddTokensHref(no), false, String(no));
  }
  assert.equal(packOfHref(addTokensHref('k25')), 'k25');
  assert.equal(packOfHref(ADD_TOKENS_PATH), null);
  assert.equal(packOfHref('/pricing?for=founder&pack=k25#add-tokens'), null);
});

test('openAddTokens sends one ask with the page and the pack, trimmed; nothing without a window', () => {
  const seen = [];
  const w = globalThis.window;
  globalThis.window = { dispatchEvent: (e) => { seen.push([e.type, e.detail]); return true; } };
  try {
    assert.equal(openAddTokens({ from: ' Billing ', pack_uid: ' k25 ' }), true);
    assert.equal(openAddTokens(), true);
    assert.equal(openAddTokens({ from: '', pack_uid: 3 }), true);
  } finally { globalThis.window = w; }
  assert.deepEqual(seen, [
    [ADD_TOKENS_EVENT, { from: 'Billing', pack_uid: 'k25' }],
    [ADD_TOKENS_EVENT, { from: null, pack_uid: null }],
    [ADD_TOKENS_EVENT, { from: null, pack_uid: null }],
  ]);
  globalThis.window = undefined;
  try { assert.equal(openAddTokens({ from: 'Billing' }), false); } finally { globalThis.window = w; }
});

// ─────────────────────────────────────────────────────────── the host

const link = (href, attrs = {}) => ({ getAttribute: (k) => (k === 'href' ? href : attrs[k] ?? null) });
const click = (a, over = {}) => ({ button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: { closest: () => a }, ...over });

test('the host takes a plain left click on a same-tab Add tokens link, off Pricing, and nothing else', () => {
  const a = link(ADD_TOKENS_PATH);
  assert.equal(takesClick(click(a), '/account/usage'), a);
  const packed = link(addTokensHref('k10'));
  assert.equal(takesClick(click(packed), '/raise/pitch'), packed, 'a link on one pack too');
  // Mutation checked: drop each guard in turn → that click is taken.
  for (const over of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) {
    assert.equal(takesClick(click(a, over), '/account/usage'), null, JSON.stringify(over));
  }
  assert.equal(takesClick(click(link(ADD_TOKENS_PATH, { target: '_blank' })), '/account/usage'), null, 'a new tab goes to the address');
  assert.equal(takesClick(click(a), '/pricing'), null, 'Pricing opens its own sheet');
  assert.equal(takesClick(click(link('/account/billing')), '/account/usage'), null);
  assert.equal(takesClick(click(null), '/account/usage'), null);
});

test('"Back to [page]" names the page the member came from, or says where they were', () => {
  assert.equal(fromOfPath('/account/usage'), 'Usage');
  assert.equal(fromOfPath('/account/ai-tokens'), 'AI tokens');
  assert.equal(fromOfPath('/account/billing'), 'Billing');
  // Mutation checked: match by startsWith(prefix) alone → /account/usagex reads Usage.
  assert.equal(fromOfPath('/account/usagex'), 'your account');
  assert.equal(fromOfPath('/raise/pitch/d1'), 'Pitch deck');
  assert.equal(fromOfPath('/somewhere'), 'where you were');
});

async function mountHost(user = { id: 1 }) {
  const restore = installDocument();
  const restoreBudget = stubBudget();
  const on = { window: new Map(), document: new Map() };
  const prev = { wa: window.addEventListener, wr: window.removeEventListener, da: document.addEventListener, dr: document.removeEventListener, loc: window.location };
  window.addEventListener = (t, fn) => on.window.set(t, fn);
  window.removeEventListener = (t) => on.window.delete(t);
  document.addEventListener = (t, fn) => on.document.set(t, fn);
  document.removeEventListener = (t) => on.document.delete(t);
  window.location = { pathname: '/account/usage' };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, null, h(AddTokensHost, { user }))));
  return {
    container, on,
    async ask(detail) { await act(async () => { on.window.get(ADD_TOKENS_EVENT)({ detail }); await new Promise((r) => setTimeout(r, 0)); }); },
    async click(e) { await act(async () => { on.document.get('click')(e); await new Promise((r) => setTimeout(r, 0)); }); },
    async done() {
      await act(async () => root.unmount());
      Object.assign(window, { addEventListener: prev.wa, removeEventListener: prev.wr, location: prev.loc });
      Object.assign(document, { addEventListener: prev.da, removeEventListener: prev.dr });
      restoreBudget(); restore();
    },
  };
}

test('mounted: an ask opens the sheet over the page on its pack; closing it leaves the member there', async () => {
  const v = await mountHost();
  try {
    assert.equal(byId(v.container, 'pack-sheet'), undefined, 'nothing until asked');
    await v.ask({ from: 'Billing', pack_uid: 'k25' });
    assert.ok(byId(v.container, 'pack-sheet'), 'openAddTokens opened the sheet');
    // Mutation checked: drop pack_uid from the ask → the sheet opens on the first pack.
    assert.equal(props(byId(v.container, 'pack-pick-k25')).checked, true);
    const close = walk(v.container).find((n) => n.tagName === 'BUTTON' && props(n)['aria-label'] === 'Close');
    await act(async () => props(close).onClick());
    assert.equal(byId(v.container, 'pack-sheet'), undefined, 'closed, the page is as it was');
  } finally { await v.done(); }
});

test('mounted: a click on any Add tokens link opens the sheet in place, on the link\'s pack, and stops the navigation', async () => {
  const v = await mountHost();
  try {
    let prevented = 0;
    await v.click(click(link(addTokensHref('k25')), { preventDefault() { prevented += 1; } }));
    // Mutation checked: drop e.preventDefault() → the router still navigates away.
    assert.equal(prevented, 1);
    assert.ok(byId(v.container, 'pack-sheet'));
    // Mutation checked: drop the link's pack → the sheet opens on the first pack, k10.
    assert.equal(props(byId(v.container, 'pack-pick-k25')).checked, true);
  } finally { await v.done(); }
  const visitor = await mountHost(null);
  try {
    await visitor.ask({ from: 'Usage' });
    assert.equal(byId(visitor.container, 'pack-sheet'), undefined, 'a visitor never gets the sheet: the link goes to Pricing');
  } finally { await visitor.done(); }
});

test('every caller links to ADD_TOKENS_PATH (the host takes the click), and Billing asks openAddTokens', () => {
  const linked = {
    'frontend/src/ui/WorkerRail.jsx': /href=\{ADD_TOKENS_PATH\}/,
    'frontend/src/ui/AiBudgetUsage.jsx': /href=\{ADD_TOKENS_PATH\}/,
    'frontend/src/pages/account/AccountUsage.jsx': /href=\{ADD_TOKENS_PATH\}/,
    'frontend/src/pages/account/AiTokensPage.jsx': /to=\{ADD_TOKENS_PATH\}/,
    'frontend/src/pages/account/PricingPhone.jsx': /href: ADD_TOKENS_PATH/,
    'frontend/src/pages/cycles/BuildPlan.jsx': /to=\{ADD_TOKENS_PATH\}/,
    'frontend/src/pages/raise/narrative/StoryTab.jsx': /to=\{ADD_TOKENS_PATH\}/,
    'frontend/src/pages/raise/pitch/newDeckModel.js': /href: ADD_TOKENS_PATH/,
    'frontend/src/pages/founder/ChannelSessionParts.jsx': /href=\{ADD_TOKENS_PATH\}/,
    'frontend/src/pages/founder/sessionDigestModel.js': /\? ADD_TOKENS_PATH : null/,
    'frontend/src/components/products/TokenPacksSection.jsx': /addTokensHref\(pack\.uid \|\| pack\.price_id\)/,
  };
  for (const [file, re] of Object.entries(linked)) assert.match(read(file), re, `${file} links to Add tokens`);
  const billing = read('frontend/src/pages/account/BillingCards.jsx');
  assert.match(billing, /onClick=\{\(\) => openAddTokens\(\{ from: 'Billing' \}\)\} data-testid="link-buy-tokens"/);
  assert.match(billing, /onClick=\{\(\) => openAddTokens\(\{ from: 'Billing', pack_uid: p\.key \}\)\} data-testid=\{`pack-buy-\$\{p\.key\}`\}/);
  const app = read('frontend/src/App.jsx');
  assert.match(app, /import AddTokensHost, \{ TokensRedirect \} from '\.\/components\/checkout\/AddTokensHost';/);
  // Mutation checked: unmount the host → no caller opens the sheet.
  assert.match(app, /<CheckoutHost user=\{user\} \/><AddTokensHost user=\{user\} \/>/);
  // The host listens in the capture phase, so a router link sees the click handled.
  assert.match(read('frontend/src/components/checkout/AddTokensHost.jsx'), /document\.addEventListener\('click', onClick, true\)/);
});

// ─────────────────────────────────────────────────────────── the addresses

async function landOn(url) {
  const restore = installDocument();
  let at = null;
  const Where = () => { const l = useLocation(); at = `${l.pathname}${l.search}${l.hash}`; return null; };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(Routes, null,
    h(Route, { path: '/pricing/products', element: h(TokensRedirect, null, h('p', { 'data-testid': 'storefront' })) }),
    h(Route, { path: '/checkout', element: h(TokensRedirect, null, h('p', { 'data-testid': 'checkout' })) }),
    h(Route, { path: '/pricing', element: h(Where) }),
  ))));
  const page = byId(container, 'storefront') ? 'storefront' : byId(container, 'checkout') ? 'checkout' : at;
  await act(async () => root.unmount());
  restore();
  return page;
}

test('the old addresses land on Add tokens, keeping the pack; every other address is its page', async () => {
  assert.equal(await landOn('/pricing/products#token-packs'), ADD_TOKENS_PATH);
  // Mutation checked: drop the pack from the redirect → the sheet opens on the first pack.
  assert.equal(await landOn('/checkout?token_pack=k25'), '/pricing?for=models&pack=k25#add-tokens');
  assert.equal(await landOn('/checkout?ai_topup=1'), ADD_TOKENS_PATH);
  assert.equal(await landOn('/pricing/products'), 'storefront', 'the storefront itself is not redirected');
  assert.equal(await landOn('/checkout?ai_topup=0'), 'checkout');
  assert.equal(await landOn('/checkout'), 'checkout', 'the cart checkout is not redirected');
});

async function pricingAt(url, user = { id: 1 }) {
  const restore = installDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => { const node = createElement(tag); node.querySelector = () => null; return node; };
  const restoreBudget = stubBudget();
  const original = { ...publicPricingApi };
  publicPricingApi.plansAndPacks = async () => ({ plans: [], packs: PACKS.packs });
  publicPricingApi.aiModels = async () => ({ ok: true, models: [] });
  let at = null;
  const Where = () => { const l = useLocation(); at = `${l.pathname}${l.search}${l.hash}`; return null; };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(React.Fragment, null, h(PricingBody, { user }), h(Where)))));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return {
    container, at: () => at,
    async done() { await act(async () => root.unmount()); Object.assign(publicPricingApi, original); restoreBudget(); restore(); },
  };
}

test('Pricing: #add-tokens opens the sheet for a member, on the pack named, once; a visitor stays on the packs', async () => {
  const w = await pricingAt(addTokensHref('k25'));
  try {
    assert.ok(byId(w.container, 'pack-sheet'), 'the address opened the sheet');
    assert.equal(props(byId(w.container, 'pack-pick-k25')).checked, true);
    // Mutation checked: keep the hash → Back reopens the sheet.
    assert.equal(w.at(), MODELS_PATH, 'the ask is dropped from the address');
  } finally { await w.done(); }
  const plain = await pricingAt(MODELS_PATH);
  try { assert.equal(byId(plain.container, 'pack-sheet'), undefined, 'Models alone opens nothing'); } finally { await plain.done(); }
  const visitor = await pricingAt(ADD_TOKENS_PATH, null);
  try {
    assert.equal(byId(visitor.container, 'pack-sheet'), undefined);
    assert.equal(visitor.at(), ADD_TOKENS_PATH, "a visitor's address is left alone");
  } finally { await visitor.done(); }
  assert.equal(ADD_TOKENS_HASH, '#add-tokens');
});

test('the old storefront\'s back links read "Back to Models" and go there; none is left to Plans & Pricing', () => {
  const checkout = read('frontend/src/pages/CheckoutPage.jsx');
  const receipt = read('frontend/src/pages/CheckoutConfirmationPage.jsx');
  // Mutation checked: restore one "Back to Plans & Pricing" → it is found.
  for (const src of [checkout, receipt]) {
    assert.doesNotMatch(src, /Back to Plans &amp; Pricing|'\/pricing\/products'/);
  }
  assert.equal((checkout.match(/Back to Models/g) || []).length, 3);
  assert.equal((checkout.match(/navigate\(MODELS_PATH\)|href=\{MODELS_PATH\}/g) || []).length, 3);
  assert.equal((receipt.match(/navigate\(MODELS_PATH/g) || []).length, 3);
  assert.match(receipt, /Back to Models/);
});

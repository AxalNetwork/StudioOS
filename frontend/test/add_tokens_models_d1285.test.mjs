/**
 * D1285 (#2452) — the "Add tokens" canvas's integration on /pricing's Models
 * tab: the member's "Your AI tokens" band from `GET /api/ai-budget/me`, then
 * Token packs above the model tables, one Buy per pack straight to its
 * checkout, and a failed read that says so rather than drawing a zero or an
 * empty list.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/add_tokens_models_d1285.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { PricingBody } from '../src/pages/PricingPage.jsx';
import { publicPricingApi } from '../src/lib/api/publicPricing.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { TOPUP_UNAVAILABLE } from '../src/lib/aiTokens.js';
import { PACKS, TOKENS_BAND } from '../src/lib/sitePricing.js';
import { installDocument } from './_contracts_dom.mjs';

const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

const PACK_READ = {
  plans: [],
  packs: [
    { uid: 'k10', unit_amount: 1000, credit_microusd: 10_000_000, bonus_microusd: 0, first_purchase_only: true },
    { uid: 'k25', unit_amount: 2500, credit_microusd: 25_000_000, bonus_microusd: 0 },
  ],
};
const MODELS = { ok: true, models: [{ id: 'm1', name: 'Synthetic model', group: 'Reasoning', billed: { tokens_in: 0.3 }, unit_words: { tokens_in: 'per 1M input tokens' }, pages: [] }] };

async function mount({ user = {}, me = async () => ({ balance_microusd: 3_400_000, ai_paused: false }), packs = async () => PACK_READ } = {}) {
  const restore = installDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const node = createElement(tag);
    node.querySelector = () => null; // No geometry in this DOM; tab scrolling is browser-only.
    return node;
  };
  const original = { pricing: { ...publicPricingApi }, budget: { ...aiBudgetApi } };
  const calls = { me: 0, packs: 0 };
  publicPricingApi.plansAndPacks = async () => { calls.packs += 1; return packs(); };
  publicPricingApi.aiModels = async () => MODELS;
  aiBudgetApi.mine = async () => { calls.me += 1; return me(); };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/pricing?for=models'] },
    React.createElement(PricingBody, { user }))));
  return {
    container, calls,
    async click(node) { await act(async () => props(node).onClick()); },
    async done() { await act(async () => root.unmount()); Object.assign(publicPricingApi, original.pricing); Object.assign(aiBudgetApi, original.budget); restore(); },
  };
}

test('a member: the band reads the balance, then Token packs, then the model tables', async () => {
  const w = await mount();
  try {
    const band = byId(w.container, 'pricing-tokens-band');
    // Mutation checked: drop the band → undefined.
    assert.ok(band, 'the band is drawn');
    assert.ok(text(band).includes('$3.40') && text(band).includes(TOKENS_BAND.never), text(band));
    assert.equal(props(byId(w.container, 'pricing-tokens-add')).href, '#token-packs');
    // Mutation checked: keep Packs after the model tables → the order fails.
    const order = walk(w.container).filter((n) => props(n)['data-testid'] === 'pricing-tokens-band' || props(n)['data-testid'] === 'pricing-token-packs'
      || (props(n).className || '').split(' ').includes('axp-models'));
    assert.deepEqual(order.map((n) => props(n)['data-testid'] || 'models'), ['pricing-tokens-band', 'pricing-token-packs', 'models']);
    assert.equal(w.calls.me, 1);
  } finally { await w.done(); }
});

test('one Buy per pack, straight to its checkout; never the old storefront', async () => {
  const w = await mount();
  try {
    const packs = byId(w.container, 'pricing-token-packs');
    const buys = walk(packs).filter((n) => n.tagName === 'A' && text(n) === 'Buy');
    // Mutation checked: link Buy to /pricing/products#token-packs → both hrefs fail.
    assert.deepEqual(buys.map((n) => props(n).href), ['/checkout?token_pack=k10', '/checkout?token_pack=k25']);
    assert.ok(text(byId(w.container, 'pricing-pack-k10')).includes('$10 of AI tokens'));
    assert.ok(text(byId(w.container, 'pricing-pack-k10')).includes('First purchase only'));
    assert.ok(!walk(w.container).some((n) => String(props(n).href || '').startsWith('/pricing/products')), 'no link to the old storefront');
    assert.ok(text(packs).includes(PACKS.foot));
  } finally { await w.done(); }
});

test('a balance that cannot be read says so, never $0.00, and Try again reads again', async () => {
  const w = await mount({ me: async () => { throw new Error('503'); } });
  try {
    const band = byId(w.container, 'pricing-tokens-band');
    // Mutation checked: draw usageMoney(0) on a failed read → "$0.00" appears.
    assert.ok(text(band).includes(TOKENS_BAND.unreadable));
    assert.ok(!text(band).includes('$0'));
    const retry = walk(band).find((n) => n.tagName === 'BUTTON' && text(n) === 'Try again');
    await w.click(retry);
    assert.equal(w.calls.me, 2);
  } finally { await w.done(); }
});

test('AI paused: the band says runs are paused, and Add tokens stays', async () => {
  const w = await mount({ me: async () => ({ balance_microusd: 3_400_000, ai_paused: true }) });
  try {
    assert.ok(text(byId(w.container, 'pricing-tokens-band')).includes(TOKENS_BAND.paused));
    assert.ok(byId(w.container, 'pricing-tokens-add'));
  } finally { await w.done(); }
});

test('packs that cannot be read say so with Try again, never an empty list; none on sale says so', async () => {
  const w = await mount({ packs: async () => { throw new Error('503'); } });
  try {
    const packs = byId(w.container, 'pricing-token-packs');
    // Mutation checked: return null on a failed read (the old strip) → the section is gone.
    assert.ok(text(packs).includes(PACKS.unreadable));
    const before = w.calls.packs;
    await w.click(walk(packs).find((n) => n.tagName === 'BUTTON' && text(n) === 'Try again'));
    assert.equal(w.calls.packs, before + 1);
  } finally { await w.done(); }
  const none = await mount({ packs: async () => ({ plans: [], packs: [] }) });
  try {
    assert.ok(text(byId(none.container, 'pricing-token-packs')).includes(TOPUP_UNAVAILABLE));
  } finally { await none.done(); }
});

test('a visitor: no band, no balance read, and Sign in to buy comes back to the packs', async () => {
  const w = await mount({ user: null });
  try {
    // Mutation checked: draw the band for a visitor → it is found and /me is called.
    assert.equal(byId(w.container, 'pricing-tokens-band'), undefined);
    assert.equal(w.calls.me, 0);
    const signIn = walk(w.container).filter((n) => n.tagName === 'A' && text(n) === 'Sign in to buy');
    assert.equal(signIn.length, 2);
    assert.equal(new URL(props(signIn[0]).href, 'https://example.test').searchParams.get('next'), '/pricing?for=models#token-packs');
  } finally { await w.done(); }
});

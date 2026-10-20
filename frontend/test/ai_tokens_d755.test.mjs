/**
 * D755 (#1916, CR4 PR 1) — one top-up state model, one "nothing is on sale"
 * sentence, one Add tokens path, and the Usage banners that stop promising the
 * top-up balance when nothing is on sale. Every fixture is synthetic.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ai_tokens_d755.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  ADD_TOKENS_PATH, TOKENS_LINE, TOPUP_UNAVAILABLE, TOPUP_UNAVAILABLE_RUNS, aiTokenState, microMoney, packLabel,
  pastAllowanceLine, purchaseState, topUpLine, usageMoney,
} from '../src/lib/aiTokens.js';
import * as card from '../src/ui/AiBudgetUsage.jsx';
import { TOKENS_LINE as PHONE_TOKENS_LINE } from '../src/pages/account/PricingPhone.jsx';
import { AllowanceCard, allowanceGroup } from '../src/pages/account/AccountUsage.jsx';

const SRC = new URL('../src/', import.meta.url).pathname;
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');
function sources() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(p)) out.push(p);
    }
  };
  walk(SRC);
  return out;
}

const PRICE = { price_id: 'price_FixtureTopUp1', currency: 'usd', unit_amount: 2500 };
const D750_READY = { configured: true, state: 'ready', product: PRICE };
const CR2_READY = { state: 'ready', packs: [{ uid: 'pk1', label: '$25 of tokens', ...PRICE, credit_microusd: 25_000_000, bonus_microusd: 0 }], on_hold: false, latest: null };

test('aiTokenState: loading, unreadable, not_ready and ready, from both answers of /ai-budget/top-up', () => {
  assert.equal(aiTokenState({ loading: true }), 'loading');
  assert.equal(aiTokenState({ loading: true, data: D750_READY }), 'loading');
  assert.equal(aiTokenState({ error: true, data: D750_READY }), 'unreadable');
  for (const data of [undefined, null, 'ready', 42]) assert.equal(aiTokenState({ data }), 'unreadable', String(data));
  assert.equal(aiTokenState(undefined), 'unreadable');
  // D750's shape.
  assert.equal(aiTokenState({ data: D750_READY }), 'ready');
  assert.equal(aiTokenState({ data: { configured: false } }), 'not_ready');
  assert.equal(aiTokenState({ data: { configured: true, state: 'not_ready' } }), 'not_ready');
  assert.equal(aiTokenState({ data: { configured: true, product: PRICE } }), 'unreadable', 'no state is not on sale');
  assert.equal(aiTokenState({ data: { configured: true, state: 'ready', product: null } }), 'unreadable');
  for (const bad of [{ price_id: 'prod_1' }, { currency: 'eur' }, { unit_amount: 0 }, { unit_amount: 2.5 }, { unit_amount: -1 }]) {
    assert.equal(aiTokenState({ data: { ...D750_READY, product: { ...PRICE, ...bad } } }), 'unreadable', JSON.stringify(bad));
  }
  // CR2's shape (#1919).
  assert.equal(aiTokenState({ data: CR2_READY }), 'ready');
  assert.equal(aiTokenState({ data: { ...CR2_READY, configured: false, product: null } }), 'ready', 'CR2 packs supersede the deprecated product switch');
  assert.equal(topUpLine({ ...CR2_READY, product: PRICE }), CR2_READY.packs[0], 'the current pack list supersedes the legacy product');
  assert.equal(aiTokenState({ data: { state: 'ready', packs: [], product: PRICE } }), 'unreadable', 'a stale legacy product cannot sell a pack');
  assert.equal(aiTokenState({ data: { state: 'unset', packs: [] } }), 'not_ready');
  assert.equal(aiTokenState({ data: { state: 'not_ready', packs: [] } }), 'not_ready');
  assert.equal(aiTokenState({ data: { state: 'ready', packs: [] } }), 'unreadable', 'ready with nothing sellable');
  assert.equal(aiTokenState({ data: { state: 'ready', packs: [{ ...PRICE, currency: 'eur' }] } }), 'unreadable');
  assert.equal(aiTokenState({ data: { state: 'paused', packs: CR2_READY.packs } }), 'unreadable', 'an unknown state is not on sale');
  // The line the checkout adds: D750's product first, else the first pack on sale.
  assert.equal(topUpLine(D750_READY), PRICE);
  assert.equal(topUpLine({ state: 'ready', packs: [{ ...PRICE, currency: 'eur' }, CR2_READY.packs[0]] }), CR2_READY.packs[0]);
  assert.equal(topUpLine({ state: 'ready', packs: [] }), null);
});

test('purchaseState: each state, overdue after an hour of waiting, and null until CR2 sends latest', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  for (const latest of [undefined, null, {}, { state: 'pending' }, 'credited']) assert.equal(purchaseState(latest, now), null, JSON.stringify(latest));
  for (const state of ['credited', 'overdue', 'refunded', 'disputed']) assert.equal(purchaseState({ state, at: '2026-10-19 11:59:00' }, now), state);
  assert.equal(purchaseState({ state: 'waiting', at: '2026-10-19 11:30:00Z' }, now), 'waiting');
  assert.equal(purchaseState({ state: 'waiting', at: '2026-10-19T10:59:00Z' }, now), 'overdue', 'paid more than an hour ago, not credited');
  assert.equal(purchaseState({ state: 'waiting', at: '2026-10-19T11:00:00Z' }, now), 'waiting', 'exactly an hour is not yet overdue');
  assert.equal(purchaseState({ state: 'waiting' }, now), 'waiting', 'no time recorded: not called overdue');
});

test('packLabel and the moved constants: the same strings, one home, re-exported where they were', () => {
  assert.equal(packLabel(2500), '$25 of tokens');
  assert.equal(packLabel(100000), '$1,000 of tokens');
  assert.equal(packLabel(1050), '$10.50 of tokens');
  for (const bad of [0, -100, 12.5, null, '2500']) assert.equal(packLabel(bad), null, String(bad));
  assert.equal(TOPUP_UNAVAILABLE, "Top-up isn't available yet.");
  assert.equal(TOPUP_UNAVAILABLE_RUNS, "Top-up isn't available yet. Runs use your included allowance only.");
  assert.equal(TOKENS_LINE, '$1 of tokens buys $1 of AI use. Tokens never expire.');
  assert.equal(PHONE_TOKENS_LINE, TOKENS_LINE);
  assert.equal(card.TOPUP_UNAVAILABLE, TOPUP_UNAVAILABLE);
  assert.equal(card.microMoney, microMoney);
  assert.equal(card.usageMoney, usageMoney);
  assert.equal(microMoney(29536), '$0.029536');
  assert.equal(usageMoney(29536), '$0.03');
  assert.equal(ADD_TOKENS_PATH, '/pricing/products#token-packs');
});

test('one sentence: no file in frontend/src still says "Top-ups are not available yet" or types the sentence by hand', () => {
  const offenders = [];
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    const rel = relative(SRC, file);
    if (/Top-ups are not available yet/.test(text)) offenders.push(`${rel}: Top-ups are not available yet`);
    if (rel !== 'lib/aiTokens.js' && /Top-up isn't available yet/.test(text)) offenders.push(`${rel}: the sentence typed by hand`);
  }
  assert.deepEqual(offenders, []);
});

test('one path: every Add tokens link reads ADD_TOKENS_PATH, and no file but lib/aiTokens.js names the path', () => {
  const offenders = [];
  for (const file of sources()) {
    const rel = relative(SRC, file);
    if (rel === 'lib/aiTokens.js') continue;
    const text = readFileSync(file, 'utf8');
    if (/\/pricing\/products#token-packs|\/checkout\?ai_topup=1/.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
  const sites = { 'ui/WorkerRail.jsx': 1, 'ui/AiBudgetUsage.jsx': 1, 'pages/account/AccountUsage.jsx': 3, 'pages/account/PricingPhone.jsx': 1 };
  for (const [rel, n] of Object.entries(sites)) {
    const uses = read(rel).match(/(href=\{|href: )ADD_TOKENS_PATH/g) || [];
    assert.equal(uses.length, n, `${rel} reads ADD_TOKENS_PATH at each of its ${n} Add tokens links`);
  }
});

const html = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/account/usage'] }, el));
const ready = (data) => ({ status: 'ready', data, reload() {} });
const BUDGET = {
  licence: 'founder:growth', source: 'environment', daily_microusd: 2_000_000, monthly_microusd: 40_000_000,
  day_spend_microusd: 420_000, month_spend_microusd: 6_100_000, day_reserved_microusd: 0, month_reserved_microusd: 50_000,
  topup_reserved_microusd: 0, balance_microusd: 10_000_000, held_for_review: [],
};
const NOTHING = { configured: false };
const words = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

test('the banners: with packs on sale, "Runs use your top-up balance" and Add tokens; with none, "Runs wait until your allowance resets" and no Add tokens', () => {
  const now = new Date('2026-10-08T18:48:00Z');
  const cases = {
    none: { ...BUDGET, daily_microusd: 0, monthly_microusd: 0 },
    day: { ...BUDGET, day_spend_microusd: 2_000_000 },
    month: { ...BUDGET, month_spend_microusd: 40_000_000 },
    noDaily: { ...BUDGET, daily_microusd: 0 },
  };
  for (const [name, budget] of Object.entries(cases)) {
    const onSale = html(h(AllowanceCard, { budget: ready(budget), product: ready(D750_READY), now }));
    const off = html(h(AllowanceCard, { budget: ready(budget), product: ready(NOTHING), now }));
    assert.match(words(onSale), /Runs use your top-up balance/, name);
    assert.match(onSale, /data-testid="usage-add-tokens"/, name);
    assert.doesNotMatch(words(off), /Runs use your top-up balance/, name);
    assert.match(words(off), /Runs wait until your allowance resets\./, name);
    assert.doesNotMatch(off, /usage-add-tokens|Add tokens/, name);
  }
  assert.match(words(html(h(AllowanceCard, { budget: ready(cases.day), product: ready(D750_READY), now }))), /Runs use your top-up balance until then\./);
  // A failed read is not knowledge that nothing is on sale: the line stays.
  const unread = html(h(AllowanceCard, { budget: ready(cases.none), product: { status: 'unreadable', data: null, reload() {} }, now }));
  assert.match(words(unread), /Runs use your top-up balance\./);
  assert.doesNotMatch(unread, /usage-add-tokens/);
  // The phone's group says the same.
  const phoneOff = allowanceGroup({ budget: ready(cases.day), product: ready(NOTHING), now });
  assert.ok(phoneOff.rows.some(r => /Runs wait until your allowance resets\./.test(r.description || '')));
  assert.equal(phoneOff.cta, undefined);
  const phoneOn = allowanceGroup({ budget: ready(cases.day), product: ready(D750_READY), now });
  assert.ok(phoneOn.rows.some(r => /Runs use your top-up balance until then\./.test(r.description || '')));
  assert.equal(phoneOn.cta.href, ADD_TOKENS_PATH);
  assert.equal(pastAllowanceLine(true), 'Runs wait until your allowance resets.');
  assert.equal(pastAllowanceLine(false, { untilThen: true }), 'Runs use your top-up balance until then.');
});

test('D755 guards: aiTokens.js never calls the balance "credits", and holds no 1.25 or "markup"', () => {
  const text = read('lib/aiTokens.js');
  const strings = [...text.matchAll(/(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map(m => m[2]);
  assert.ok(!strings.some(s => /\bcredits?\b/i.test(s)), 'no member-facing string says credits');
  assert.doesNotMatch(text, /1\.25|markup/i);
});

test('CR7 shared-model mutations: current packs and the central purchase destination win, restored in both directions', async () => {
  const original = read('lib/aiTokens.js');
  let n = 0;
  const load = async source => import('data:text/javascript;base64,' + Buffer.from(source + '\n// instance ' + n++).toString('base64'));
  const check = model => {
    assert.equal(model.ADD_TOKENS_PATH, '/pricing/products#token-packs');
    assert.equal(model.aiTokenState({data:{...CR2_READY,configured:false,product:null}}),'ready');
    assert.equal(model.topUpLine({...CR2_READY,product:PRICE}).price_id,CR2_READY.packs[0].price_id);
    assert.equal(model.topUpLine({...CR2_READY,packs:[],product:PRICE}),null);
  };
  for (const [before,after] of [
    ["(!Array.isArray(data.packs) && data.configured === false)","data.configured === false"],
    ["if (Array.isArray(data?.packs))","if (false)"],
    ["export const ADD_TOKENS_PATH = TOKEN_PACKS_PATH;","export const ADD_TOKENS_PATH = '/checkout?ai_topup=1';"],
  ]) {
    assert.ok(original.includes(before),'mutation target exists');
    check(await load(original));
    const mutated = await load(original.replace(before,()=>after));
    assert.throws(()=>check(mutated),{name:'AssertionError'});
    check(await load(original));
  }
});

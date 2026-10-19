/**
 * D769 (#2088, PR 1; D720 §1, §6, §8, §11) — the rail matches the "AIRail ·
 * every page" canvas: each model's price as the Worker bills it, "Turn off AI
 * assistance on this page" on every page, Add tokens always drawn, and the
 * Llama Guard sentence.
 *
 * Every read is stubbed on its client object: the rate card (`/api/ai/rates`),
 * the pricing routes, the allowance and top-up, and the preferences. The rail
 * is mounted through the stub DOM where a click or an effect must run, and
 * rendered with react-dom/server where a first paint is enough.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/airail_d720_rail.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { codeOnly } from './_codeOnly.mjs';
import { installDocument } from './_contracts_dom.mjs';
import WorkerRail, { AI_SWITCH_LABEL, MANUAL_LINE, SAFETY_LINE, RailUsage } from '../src/ui/WorkerRail.jsx';
import { NEW_MODELS, railSuggestions } from '../src/ui/railModels.js';
import {
  NOT_AVAILABLE, PRICE_NOTE, PRICE_UNREADABLE, guardSentence, modelPrice, priceSuggestions, priceText, railRates, usd,
} from '../src/ui/railPrices.js';
import { RailCrumbsProvider } from '../src/ui/railCrumbs.js';
import { __resetEadwynPanelForTest } from '../src/ui/eadwynPanel.js';
import { __resetRailPrefsSyncForTest } from '../src/ui/railModelChoice.js';
import { __resetAssistModeForTest } from '../src/hooks/useAssistMode.js';
import { api } from '../src/lib/api.js';
import { aiBudgetApi } from '../src/lib/api/aiBudget.js';
import { railPrefsApi } from '../src/lib/api/railPrefs.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const h = React.createElement;

const L70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const L8 = '@cf/meta/llama-3.1-8b-instruct-fp8';
const L3 = '@cf/meta/llama-3.2-3b-instruct';
const L8F = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const QWEN = '@cf/qwen/qwen2.5-coder-32b-instruct';
const DSV4 = '@cf/deepseek-ai/deepseek-v4-flash-0731';
const BGE = '@cf/baai/bge-base-en-v1.5';
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
const WHISPER_BASE = '@cf/openai/whisper';
const NOVA = '@cf/deepgram/nova-3';
const GUARD = '@cf/meta/llama-guard-3-8b';

/** The router's routes, as `/api/ai/pricing` answers them (only the fields the rail reads). */
const PRICING = {
  ok: true,
  routes: {
    safety: { model: GUARD, fallback_chain: [], alternates: [] },
    tool_call: { model: QWEN, fallback_chain: [L70, L8], alternates: [] },
    embed: { model: BGE, fallback_chain: [], alternates: [] },
    workspace_explain: { model: L70, fallback_chain: [L8], alternates: [L70, L3] },
    validate_tag_pains: { model: L70, fallback_chain: [L8], alternates: [L70, L8, L3] },
    transcribe: { model: WHISPER, fallback_chain: [WHISPER], alternates: [WHISPER, NOVA, WHISPER_BASE] },
    structure_interview: { model: L70, fallback_chain: [L8], alternates: [L70, L8F, DSV4] },
  },
};

/**
 * A rate card as D760 serves it: `cost` and `billed` units on every row, the
 * billed figures deliberately 1.25 × cost so a test can tell which one the rail
 * drew. `billing` says which the Worker charges.
 */
const row = (id, cost) => ({ id, cost, billed: Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Number((v * 1.25).toPrecision(6))])) });
function rates(billing = 'cost', extra = {}) {
  return {
    ok: true,
    billing,
    ...extra,
    models: [
      row(L70, { tokens_in: 0.293, tokens_out: 2.253 }),
      row(L8, { tokens_in: 0.152, tokens_out: 0.287 }),
      row(L3, { tokens_in: 0.051, tokens_out: 0.335 }),
      row(L8F, { tokens_in: 0.045, tokens_out: 0.384 }),
      row(QWEN, { tokens_in: 0.66, tokens_out: 1 }),
      row(DSV4, { tokens_in: 0.44, tokens_cached: 0.014, tokens_out: 1.32 }),
      row(BGE, { tokens_in: 0.067 }),
      row(WHISPER, { audio_minutes: 0.0005 }),
      row(WHISPER_BASE, { audio_minutes: 0.0005 }),
      row(NOVA, { audio_minutes: 0.0052, audio_minutes_websocket: 0.0092 }),
      row(GUARD, { tokens_in: 0.484, tokens_out: 0.03 }),
    ],
  };
}

const BUDGET = {
  licence: 'founder:growth', daily_microusd: 1000000, monthly_microusd: 5000000,
  day_spend_microusd: 420000, month_spend_microusd: 3100000, balance_microusd: 10000000,
  day_reserved_microusd: 20000, month_reserved_microusd: 30000, topup_reserved_microusd: 20000,
  held_for_review: [],
};
const TOPUP = { configured: true, state: 'ready', product: { price_id: 'price_TestTopUp1', currency: 'usd', unit_amount: 1000 } };

function stubReads(over = {}) {
  const calls = { setMode: [] };
  const answer = (v) => () => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  const real = {
    myAiSpend: api.myAiSpend, aiPricing: api.aiPricing, mine: aiBudgetApi.mine, topUp: aiBudgetApi.topUp, rates: aiBudgetApi.rates,
    read: railPrefsApi.read, setMode: railPrefsApi.setMode, setModel: railPrefsApi.setModel,
  };
  api.myAiSpend = answer({ recorded: true, month: { spend_usd: 3.1, calls: 12 }, by_task: [] });
  api.aiPricing = answer('pricing' in over ? over.pricing : PRICING);
  aiBudgetApi.mine = answer(BUDGET);
  aiBudgetApi.topUp = answer('topUp' in over ? over.topUp : TOPUP);
  aiBudgetApi.rates = answer('rates' in over ? over.rates : rates());
  railPrefsApi.read = answer({ ok: true, modes: {}, models: {} });
  railPrefsApi.setMode = (section, mode) => { calls.setMode.push([section, mode]); return Promise.resolve({ ok: true }); };
  railPrefsApi.setModel = () => Promise.resolve({ ok: true });
  calls.restore = () => {
    Object.assign(api, { myAiSpend: real.myAiSpend, aiPricing: real.aiPricing });
    Object.assign(aiBudgetApi, { mine: real.mine, topUp: real.topUp, rates: real.rates });
    Object.assign(railPrefsApi, { read: real.read, setMode: real.setMode, setModel: real.setModel });
  };
  return calls;
}

function resetStores() {
  __resetEadwynPanelForTest();
  __resetAssistModeForTest();
  __resetRailPrefsSyncForTest();
}

function fullStorage(seed) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}

async function mount(el, { reads, storage = {} } = {}) {
  resetStores();
  const restore = installDocument();
  fullStorage(storage);
  const stub = stubReads(reads);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(el); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const nodes = () => walk(document.body);
  const all = (prefix) => nodes().filter((n) => String(pr(n)['data-testid'] || '').startsWith(prefix));
  const by = (id) => nodes().find((n) => pr(n)['data-testid'] === id);
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  return {
    by, all, pr, stub, nodes,
    text: (n = document.body) => txt(n).replace(/\s+/g, ' ').trim(),
    async click(id) { const n = by(id); if (!n) throw new Error(`Missing ${id}`); await act(async () => { await pr(n).onClick?.({ preventDefault() {} }); }); await settle(); },
    async unmount() { await act(async () => root.unmount()); stub.restore(); restore(); resetStores(); },
  };
}

const AI_ON_VALIDATE = { 'assist_mode:validate': true };
const tail = (id) => id.split('/').pop();

// ── prices ───────────────────────────────────────────────────────────────

test('priceText prints each unit as the canvas does: tokens, embeddings, speech, voice and images', () => {
  // The canvas's examples, at the figure given (no × 1.25 here).
  assert.equal(priceText({ tokens_in: 0.3662, tokens_out: 2.816 }, true), '$0.3662 in · $2.816 out per 1M tokens');
  assert.equal(priceText({ tokens_in: 0.3662, tokens_out: 2.816 }, false), '$0.3662 · $2.816');
  assert.equal(priceText({ tokens_in: 0.44, tokens_cached: 0.014, tokens_out: 1.32 }, true), '$0.44 in · $0.014 cached · $1.32 out per 1M tokens');
  assert.equal(priceText({ tokens_in: 0.067 }, true), '$0.067 per 1M tokens');
  assert.equal(priceText({ tokens_in: 0.067, tokens_out: 0 }, false), '$0.067');
  assert.equal(priceText({ audio_minutes: 0.0005 }, true), '$0.0005 / min');
  assert.equal(priceText({ audio_minutes: 0.0052, audio_minutes_websocket: 0.0092 }, true), '$0.0052 / min · $0.0092 / min live');
  assert.equal(priceText({ audio_minutes: 0.0052, audio_minutes_websocket: 0.0092 }, false), '$0.0052 / min');
  assert.equal(priceText({ audio_minutes_websocket: 0.0077 }, false), '$0.0077 / min live');
  assert.equal(priceText({ characters: 0.03 }, true), '$0.03 per 1k characters');
  assert.equal(priceText({ characters: 0.03 }, false), '$0.03 / 1k chars');
  assert.equal(priceText({ tiles: 0.0000528, steps: 0.0001056 }, true), '$0.0000528 per tile · $0.0001056 per step');
  assert.equal(priceText({ tiles: 0.0000528, steps: 0.0001056 }, false), '$0.0000528 / tile + steps', 'the short image price names its steps (D720 §1)');
  assert.equal(priceText({ input_tiles: 0.000059, output_tiles: 0.000287 }, false), '$0.000287 / tile');
  assert.equal(priceText({ input_tile_steps: 0.00021, output_tile_steps: 0.00041 }, true), '$0.00021 per input tile · $0.00041 per output tile, per step');
  assert.equal(priceText({ first_megapixels: 0.015, subsequent_megapixels: 0.002 }, true), '$0.015 first megapixel · $0.002 each more');
  assert.equal(priceText({ first_megapixels: 0.015, subsequent_megapixels: 0.002 }, false), '$0.015 / MP');
  assert.equal(priceText({}, true), NOT_AVAILABLE);
  assert.equal(NOT_AVAILABLE, 'Not available');
  // Four significant figures, at least two decimals.
  assert.deepEqual([usd(0.05), usd(1), usd(0.36625), usd(2.253)], ['$0.05', '$1.00', '$0.3663', '$2.253']);
});

test('the price is the Worker\'s: cost while billing is cost, billed once it is billed, never multiplied here', () => {
  const cost = railRates({ loading: false, data: rates('cost') });
  assert.equal(modelPrice(cost, L70, true), '$0.293 in · $2.253 out per 1M tokens');
  const billed = railRates({ loading: false, data: rates('billed') });
  // The stub's billed figures are 0.36625 and 2.81625, printed as the canvas does.
  assert.equal(modelPrice(billed, L70, true), '$0.3663 in · $2.816 out per 1M tokens');
  // A rate card from before D760: its per-1M and per-minute fields are the cost.
  const legacy = railRates({ loading: false, data: { ok: true, models: [{ id: L70, in_per_1m_usd: 0.293, out_per_1m_usd: 2.253 }, { id: WHISPER, per_audio_minute_usd: 0.0005 }] } });
  assert.equal(modelPrice(legacy, L70, false), '$0.293 · $2.253');
  assert.equal(modelPrice(legacy, WHISPER, false), '$0.0005 / min');
  // No price, a failed read and a read in flight never print a figure.
  assert.equal(modelPrice(cost, '@cf/no/such-model', true), NOT_AVAILABLE);
  assert.equal(modelPrice(railRates({ loading: false, error: true }), L70, true), PRICE_UNREADABLE);
  assert.equal(modelPrice(railRates({ loading: true }), L70, true), '…');
  // The margin is never in the client.
  for (const f of ['frontend/src/ui/railPrices.js', 'frontend/src/ui/WorkerRail.jsx', 'frontend/src/ui/railModels.js']) {
    assert.doesNotMatch(codeOnly(read(f)), /1\.25|AI_MARKUP/, `${f} applies the margin in the client`);
  }
});

test('every suggested card and All models row prints its price in its unit', async () => {
  const m = await mount(h(RailCrumbsProvider, { section: 'Validate', module: 'Customer research' },
    h(WorkerRail, { workspace: 'Validate', fills: true })), { storage: AI_ON_VALIDATE });
  try {
    // Customer research: Whisper Turbo, Nova-3 and the 70B (D698's three cards).
    assert.equal(m.text(m.by(`text-worker-rail-price-${tail(WHISPER)}`)), '$0.0005 / min');
    assert.equal(m.text(m.by(`text-worker-rail-price-${tail(NOVA)}`)), '$0.0052 / min · $0.0092 / min live');
    assert.equal(m.text(m.by(`text-worker-rail-price-${tail(L70)}`)), '$0.293 in · $2.253 out per 1M tokens');
    const cards = m.all('card-worker-rail-model-');
    assert.ok(cards.length >= 3);
    for (const c of cards) assert.ok(m.all(`text-worker-rail-price-${String(m.pr(c)['data-testid']).replace('card-worker-rail-model-', '')}`).length === 1);
    // All models: every row has its short price, under the canvas's note.
    await m.click('button-worker-rail-all-models');
    assert.equal(m.text(m.by('text-worker-rail-price-note')), PRICE_NOTE);
    const rowPrices = m.all('text-worker-rail-row-price-');
    assert.ok(rowPrices.length >= 9, `only ${rowPrices.length} rows priced`);
    assert.equal(m.text(m.by(`text-worker-rail-row-price-${tail(L70)}`)), '$0.293 · $2.253');
    assert.equal(m.text(m.by(`text-worker-rail-row-price-${tail(BGE)}`)), '$0.067');
    assert.equal(m.text(m.by(`text-worker-rail-row-price-${tail(DSV4)}`)), '$0.44 · $1.32');
    assert.equal(m.text(m.by(`text-worker-rail-row-price-${tail(GUARD)}`)), '$0.484 · $0.03');
    for (const p of rowPrices) assert.match(m.text(p), /^\$\d/, 'a row prints no figure');
  } finally { await m.unmount(); }
});

test('a model with no price prints "Not available", and a failed read "Unreadable", never a zero', async () => {
  const noL70 = rates();
  noL70.models = noL70.models.filter((r) => r.id !== L70);
  const m = await mount(h(RailCrumbsProvider, { section: 'Validate', module: 'Problem discovery' },
    h(WorkerRail, { workspace: 'Validate', fills: true })), { storage: AI_ON_VALIDATE, reads: { rates: noL70 } });
  try {
    assert.equal(m.text(m.by(`text-worker-rail-price-${tail(L70)}`)), 'Not available');
    await m.click('button-worker-rail-all-models');
    assert.equal(m.text(m.by(`text-worker-rail-row-price-${tail(L70)}`)), 'Not available');
    assert.equal(m.text(m.by(`text-worker-rail-row-price-${tail(L8)}`)), '$0.152 · $0.287');
  } finally { await m.unmount(); }
  const bad = await mount(h(RailCrumbsProvider, { section: 'Validate', module: 'Problem discovery' },
    h(WorkerRail, { workspace: 'Validate', fills: true })), { storage: AI_ON_VALIDATE, reads: { rates: new Error('rates down') } });
  try {
    assert.equal(bad.text(bad.by(`text-worker-rail-price-${tail(L70)}`)), 'Unreadable');
    assert.doesNotMatch(bad.text(), /\$0\.00/);
  } finally { await bad.unmount(); }
});

test('the New badge follows the canvas\'s list, less BGE Base EN v1.5 and FLUX.1 Schnell', async () => {
  assert.ok(!NEW_MODELS.has('BGE Base EN v1.5') && !NEW_MODELS.has('FLUX.1 Schnell'));
  const data = JSON.parse(read('design/incoming/airail-every-page-data/canvas.json'));
  assert.deepEqual([...NEW_MODELS].sort(), data.new_models.filter((n) => n !== 'BGE Base EN v1.5' && n !== 'FLUX.1 Schnell').sort());
  const v = priceSuggestions(railSuggestions({ section: 'Validate', module: 'Problem discovery', pricing: PRICING }), railRates({ data: rates() }));
  const rowsAll = v.groups.flatMap((g) => g.chips);
  assert.equal(rowsAll.find((c) => c.id === BGE).isNew, false, 'BGE Base runs in production and is badged New');
  assert.ok(rowsAll.every((c) => typeof c.price === 'string'));
});

// ── the switch ────────────────────────────────────────────────────────────

test('the switch is drawn on a page with no fills; turning AI off hides the suggestions and saves the mode row', async () => {
  const m = await mount(h(WorkerRail, { workspace: 'Build' }));
  try {
    const sw = m.by('switch-worker-rail-ai-off');
    assert.ok(sw, 'no switch on a page with no fills');
    assert.equal(m.text(sw), AI_SWITCH_LABEL);
    assert.equal(AI_SWITCH_LABEL, 'Turn off AI assistance on this page');
    assert.equal(m.pr(sw)['aria-checked'], false, 'a page with no fills starts with AI off');
    assert.match(m.text(), /Suggested for this page/);
    await m.click('switch-worker-rail-ai-off');
    assert.equal(m.pr(m.by('switch-worker-rail-ai-off'))['aria-checked'], true);
    assert.equal(m.text(m.by('text-worker-rail-mode')), MANUAL_LINE);
    assert.equal(MANUAL_LINE, 'Eadwyn won’t suggest or draft on this page. Your work saves as usual.');
    assert.doesNotMatch(m.text(), /Suggested for this page|All models/);
    assert.equal(m.all('card-worker-rail-model-').length, 0);
    assert.deepEqual(m.stub.setMode, [['build', 'manual']], 'the mode row was not saved');
    assert.equal(JSON.parse(localStorage.getItem('assist_mode:build')), false);
  } finally { await m.unmount(); }
  // The rail no longer says a page has no switch.
  assert.doesNotMatch(codeOnly(read('frontend/src/ui/WorkerRail.jsx')), /NO_SWITCH_LINE|No switch here/);
});

test('a page with fills starts off; a stored choice wins over either default', async () => {
  const m = await mount(h(WorkerRail, { workspace: 'Validate', fills: true }));
  try {
    assert.equal(m.pr(m.by('switch-worker-rail-ai-off'))['aria-checked'], true);
  } finally { await m.unmount(); }
  const off = await mount(h(WorkerRail, { workspace: 'Build' }), { storage: { 'assist_mode:build': false } });
  try {
    assert.equal(off.pr(off.by('switch-worker-rail-ai-off'))['aria-checked'], true, 'a stored off did not win on a page that defaults on');
  } finally { await off.unmount(); }
});

// ── Add tokens ────────────────────────────────────────────────────────────

const usage = (product, productError = false) => renderToStaticMarkup(h(RailUsage, {
  reading: { budget: BUDGET, product, loading: false, budgetError: false, productError, reload: () => {} },
}));

test('Add tokens is drawn in all three top-up states, enabled only when a pack is on sale', () => {
  const ready = usage(TOPUP);
  assert.match(ready, /<a href="\/plans-and-pricing#token-packs" class="fwr-add-tokens"[^>]*>Add tokens<\/a>/);
  assert.doesNotMatch(ready, /disabled/);
  const none = usage({ configured: true, state: 'not_ready' });
  assert.match(none, /<button type="button" class="fwr-add-tokens" disabled=""[^>]*>Add tokens<\/button>/);
  assert.match(none, /Top-up isn&#x27;t available yet\./);
  assert.doesNotMatch(none, /href="\/plans-and-pricing/);
  const bad = usage(null, true);
  assert.match(bad, /<button type="button" class="fwr-add-tokens" disabled=""[^>]*>Add tokens<\/button>/);
  assert.match(bad, /Retry<\/button>/);
  assert.doesNotMatch(bad, /href="\/plans-and-pricing/);
});

// ── the guard sentence ───────────────────────────────────────────────────

test('the guard sentence follows guard.every_run, with the guard\'s price from the same read', async () => {
  assert.equal(guardSentence(railRates({ data: rates() })),
    'Llama Guard 3 8B checks every run ($0.484 in · $0.03 out per 1M tokens). Eadwyn drafts; you send.');
  // No price for the guard: the sentence names none.
  assert.equal(guardSentence(railRates({ error: true })), 'Llama Guard 3 8B checks every run. Eadwyn drafts; you send.');
  const on = await mount(h(WorkerRail, { workspace: 'Build' }), { reads: { rates: rates('cost', { guard: { every_run: true } }) } });
  try {
    assert.equal(on.text(on.by('text-worker-rail-safety')), 'Llama Guard 3 8B checks every run ($0.484 in · $0.03 out per 1M tokens). Eadwyn drafts; you send.');
  } finally { await on.unmount(); }
  const off = await mount(h(WorkerRail, { workspace: 'Build' }), { reads: { rates: rates('cost', { guard: { every_run: false } }) } });
  try {
    assert.equal(off.text(off.by('text-worker-rail-safety')), SAFETY_LINE);
    assert.doesNotMatch(off.text(), /Llama Guard 3 8B checks every run/);
  } finally { await off.unmount(); }
  // The rate card on `main` says nothing about the guard: D763 part 2 makes it true, so it is drawn.
  const unsaid = await mount(h(WorkerRail, { workspace: 'Build' }));
  try {
    assert.match(unsaid.text(unsaid.by('text-worker-rail-safety')), /^Llama Guard 3 8B checks every run/);
  } finally { await unsaid.unmount(); }
});

test('the canvas\'s bracketed placeholder figures appear in no rail file (D720 §1)', () => {
  for (const f of ['frontend/src/ui/WorkerRail.jsx', 'frontend/src/ui/railPrices.js', 'frontend/src/ui/railModels.js', 'frontend/src/ui/workerRail.css']) {
    assert.doesNotMatch(read(f), /\[\$(0\.42|1\.00|3\.10|5\.00|0\.05|10\.00)\]/, f);
  }
});

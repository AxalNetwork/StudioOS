// D4597 (#4597, Pitch audit 3/5) — pricing confirmation: a missing price is never "free".
//
//   1. The price is a state: loading, unavailable, confirmed no-cost, metered (with its pinned quote), stale.
//      "Free" / "at no cost" is drawn only for an explicit no-cost answer (`ai: false` with assist_off or
//      not_switched_on); a failed read, a `pricing_unavailable` answer and a metered answer with no pinned
//      quote are a retryable pricing state in which nothing can be confirmed.
//   2. Both creation paths send the exact accepted `quote_uid`: the one-click Build, and the guided
//      outline generation and deck build separately; the quotes carry the round the runs carry.
//   3. Changing a price-relevant input drops the old quote and reads a new one; a stale quote asks again.
//
// Every venture, card and figure is synthetic.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pricing_confirmation_d4597.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { newDeckApi } from '../src/lib/api/newDeck.js';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckImagesApi } from '../src/lib/api/deckImages.js';
import NewDeck from '../src/pages/raise/pitch/NewDeck.jsx';
import {
  PRICE_LOADING, PRICE_STALE, canConfirm, priceState, quoteUidOf, NEW_PATH, buildSentence, estimateLine, fastPathLine, outlineSentence, regenerateSentence,
} from '../src/pages/raise/pitch/newDeckModel.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

/* ------------------------------------------------------------------ *
 * Fixtures, in the shapes the Worker sends
 * ------------------------------------------------------------------ */

const CATALOGUE = [
  { card: 'title', title: 'Title', purpose: 'The venture and what it does, in a line', sources: [], appendix: false },
  { card: 'traction', title: 'Traction', purpose: 'Revenue and customers from your records', sources: ['grow.mrr', 'grow.paying_customers'], appendix: false },
  { card: 'team', title: 'Team', purpose: 'The founders and what they bring', sources: ['team.founders'], appendix: false },
  { card: 'every_figure', title: 'Appendix · Every figure', purpose: 'Each recorded figure with its source', sources: [], appendix: true },
];
const CONTEXT = {
  project_id: 1,
  audiences: [['angel', 'Angel', 'short, personal'], ['pre_seed_fund', 'Pre-seed fund', 'problem and team'], ['seed_fund', 'Seed fund', 'traction and market'],
    ['series_a_fund', 'Series A fund', 'metrics and plan'], ['strategic', 'Strategic', 'fit and integration'], ['grant', 'Grant', 'impact and budget'], ['other', 'Other', 'you choose']]
    .map(([id, label, line]) => ({ id, label, line })),
  lengths: [{ id: 'short', label: 'Short (6)' }, { id: 'standard', label: 'Standard (10-12)' }, { id: 'full', label: 'Full (15 + appendix)' }],
  cards: CATALOGUE,
  standard: { short: [], standard: [{ card: 'title', title: 'Title', purpose: 'The venture and what it does, in a line' }, { card: 'team', title: 'Team', purpose: 'The founders and what they bring' }], full: [] },
  round: { uid: 'round-1', name: 'Synthetic seed', target_amount: 1500000, close_date: '2026-12-15', instrument: 'safe', reviewed: true },
  averages: { outline: null, build: { runs: 6, average_microusd: 5200 } },
  fast_path: { audience: 'seed_fund', length: 'standard' },
  prompt_max: 500,
};
const ITEMS = [
  { source_key: 'grow.paying_customers', area: 'grow', module: 'Grow › Revenue and traction', label: 'Paying customers', value: 42, unit: 'count', as_of: '2026-10-10', grade: 'Stated', source: 'Typed', href: '/grow/revenue-and-traction?project=1', record_ref: 'project_metrics:1', snapshot_hash: 'a'.repeat(24), state: 'recorded' },
  { source_key: 'grow.mrr', area: 'grow', module: 'Grow › Revenue and traction', label: 'MRR', value: null, unit: 'usd', as_of: null, grade: 'Not recorded', source: null, href: '/grow/revenue-and-traction?project=1', record_ref: null, snapshot_hash: null, state: 'not_recorded' },
  { source_key: 'team.founders', area: 'team', module: 'Build › Founding team', label: 'Founders on the cap table', value: 2, unit: 'count', as_of: '2026-10-01', grade: 'Measured', source: 'Recorded', href: '/build/founding-team?project=1', record_ref: 'cap_table_holders:2', snapshot_hash: 'b'.repeat(24), state: 'recorded' },
];
const COVERAGE = { slots: 3, filled: 2, by_grade: { Measured: 1, Reviewed: 0, Sourced: 0, Stated: 1 }, not_recorded: 1, unreadable: 0 };
const ROWS = [
  { card: 'title', title: 'Title', purpose: 'Who we are' },
  { card: 'traction', title: 'Traction', purpose: 'Customers on record' },
  { card: 'team', title: 'Team', purpose: 'The founders' },
];
const metric = (key, label, value, grade) => ({ kind: 'metric', label, value, binding: { source_key: key, record_ref: null, as_of: null, grade, snapshot_hash: grade === 'Not recorded' ? null : 'a'.repeat(24) } });
const SLIDES = [
  { title: 'Title', spec_id: 'new:title', blocks: [{ kind: 'text', style: 'heading', text: 'Close the books in a day.' }] },
  { title: 'Traction', spec_id: 'new:traction', blocks: [{ kind: 'text', style: 'heading', text: 'Customers keep coming.' }, metric('grow.mrr', 'MRR', null, 'Not recorded'), metric('grow.paying_customers', 'Paying customers', '42', 'Stated')] },
  { title: 'Team', spec_id: 'new:team', blocks: [{ kind: 'text', style: 'heading', text: 'Team' }, metric('team.founders', 'Founders on the cap table', '2', 'Measured')] },
];

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */










/* ------------------------------------------------------------------ *
 * The drawn page
 * ------------------------------------------------------------------ */

const ORIGINAL = { api: { ...api }, newDeck: { ...newDeckApi }, sources: { ...deckSourcesApi }, editor: { ...deckEditorApi }, images: { ...deckImagesApi } };

const BUILT_SLIDES = [
  ...SLIDES,
  // The Worker's own card for a slot nothing records: its heading, and the one not-recorded line.
  { title: 'Market', spec_id: 'new:market', blocks: [{ id: 'h', kind: 'text', style: 'heading', text: 'A crowded market.' }, { id: 'n', kind: 'text', style: 'paragraph', text: 'Not recorded on StudioOS yet: Competitors.' }],
    fields: [{ key: 'validate.competitors', label: 'Competitors', kind: 'auto', source: 'placeholder', binding: { source_key: 'validate.competitors' } }] },
];

async function mount(url, over = {}) {
  const calls = [];
  const stub = (target, name, fn) => { target[name] = (...a) => { calls.push([name, ...a]); return fn(...a); }; };
  stub(api, 'listProjects', async () => [{ id: 1, name: 'Synthetic venture' }]);
  stub(api, 'deckListVersions', over.versions || (async () => ({ versions: [{ id: 9, version: 3, is_current: true, theme: null }], proposal: null })));
  stub(api, 'deckMethods', async () => ({ methods: [{ id: 'yc_seed', label: 'YC seed' }, { id: 'sequoia', label: 'Sequoia', locked: true }] }));
  stub(api, 'deckRecommend', async () => ({}));
  stub(api, 'deckUpdate', async (id, body) => ({ id: 13, version: 5, title: body.title, slides: body.slides, theme: body.theme }));
  stub(api, 'getMe', async () => null);
  stub(newDeckApi, 'context', over.context || (async () => CONTEXT));
  stub(newDeckApi, 'quote', over.quote || (async (b) => ({ step: b.step, ai: true, hold_microusd: b.step === 'outline' ? 1100 : 6000, model: 'synthetic', quote_uid: `dq_${b.step}` })));
  stub(newDeckApi, 'outline', over.outline || (async () => ({ proposal: { id: 77, slides: [], outline: { rows: ROWS } }, outline: { rows: ROWS, proposed_by: 'Eadwyn' }, cost: { charged_microusd: 900 } })));
  stub(newDeckApi, 'build', over.build || (async () => ({
    proposal: { id: 77, base_deck_id: 9, slides: BUILT_SLIDES, kept: null, outline: { audience: 'series_a_fund', rows: ROWS } },
    progress: [], wording: { by: 'Eadwyn', dropped: 1 }, cost: { charged_microusd: 3200 },
  })));
  stub(newDeckApi, 'keepSlides', over.keepSlides || (async (_id, b) => (b.save ? { deck: { id: 12, version: 4, title: 'Pitch deck', slides: BUILT_SLIDES.slice(0, 3), theme: null } } : { proposal: { id: 77, slides: BUILT_SLIDES } })));
  stub(newDeckApi, 'regenerateCard', over.regenerateCard || (async () => { throw new Error('not stubbed'); }));
  stub(deckSourcesApi, 'list', async () => ({ project_id: 1, items: ITEMS, coverage: COVERAGE }));
  stub(deckEditorApi, 'brandKit', over.kit || (async () => ({ project_id: 1, kit: null })));
  stub(deckImagesApi, 'plan', async () => ({ capability: { available: false, reason: 'Image generation is not available on this deployment.' }, cards: [] }));
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { rootEl.render(h(MemoryRouter, { initialEntries: [url] }, h(NewDeck))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const button = (label) => walk(container).find((n) => n.tagName === 'BUTTON' && (n.textContent || '').trim().startsWith(label));
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, button, pr, all: () => walk(container),
    text: (n = container) => text(n).replace(/\s+/g, ' '),
    async press(node) { assert.ok(node, 'the control is drawn'); await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async change(node, value) { await act(async () => { pr(node).onChange?.({ target: { value, checked: value } }); }); await settle(); },
    async unmount() {
      await act(async () => rootEl.unmount()); restore();
      Object.assign(api, ORIGINAL.api); Object.assign(newDeckApi, ORIGINAL.newDeck); Object.assign(deckSourcesApi, ORIGINAL.sources);
      Object.assign(deckEditorApi, ORIGINAL.editor); Object.assign(deckImagesApi, ORIGINAL.images);
    },
  };
}


const live = (b) => ({ step: b.step, ai: true, hold_microusd: b.step === 'outline' ? 1100 : 6000, model: 'synthetic', quote_uid: `dq_${b.step}_${b.audience}_${b.length}` });

test('1. the price is a state, and only an explicit no-cost answer is free', () => {
  assert.equal(priceState({ status: 'loading' }).kind, 'loading');
  assert.equal(priceState(null).kind, 'loading');
  assert.equal(priceState({ status: 'failed' }).kind, 'unavailable', 'a failed read is not free');
  assert.equal(priceState({ status: 'ok', quote: null }).kind, 'unavailable');
  assert.equal(priceState({ status: 'stale' }).kind, 'stale');
  assert.equal(priceState({ status: 'ok', quote: { ai: false, reason: 'pricing_unavailable', message: 'x' } }).kind, 'unavailable', 'pricing_unavailable is not free');
  assert.equal(priceState({ status: 'ok', quote: { ai: false, reason: 'misconfigured', message: 'x' } }).kind, 'unavailable');
  assert.equal(priceState({ status: 'ok', quote: { ai: false } }).kind, 'unavailable', 'a refusal with no reason is not free');
  for (const reason of ['assist_off', 'not_switched_on']) assert.equal(priceState({ status: 'ok', quote: { ai: false, reason } }).kind, 'free', reason);
  const metered = priceState({ status: 'ok', quote: live({ step: 'build', length: 'short' }) });
  assert.deepEqual([metered.kind, metered.hold, metered.quoteUid], ['metered', 6000, 'dq_build_undefined_short']);
  assert.equal(priceState({ status: 'ok', quote: { ai: true, hold_microusd: 6000 } }).kind, 'unavailable', 'a metered price that could not be pinned cannot be accepted');
  assert.equal(priceState({ status: 'ok', quote: { ai: true, hold_microusd: 6000 } }, { pinned: false }).kind, 'metered', 'a card quote is shown, not pinned');
  assert.deepEqual(['loading', 'unavailable', 'stale', 'free', 'metered'].map((kind) => canConfirm({ kind })), [false, false, false, true, true]);
  assert.equal(quoteUidOf(metered), 'dq_build_undefined_short');
  assert.equal(quoteUidOf({ kind: 'free' }), undefined);
  // The words: "free" / "at no cost" appear only for the explicit no-cost answer.
  const words = (price) => [outlineSentence(price, false), buildSentence(price, 3), fastPathLine(price), regenerateSentence(price, 'Team'), estimateLine(price, null) || ''].join(' ');
  for (const price of [null, { status: 'loading' }, { status: 'failed' }, { status: 'stale' }, { status: 'ok', quote: { ai: false, reason: 'pricing_unavailable', message: 'The price could not be worked out.' } }]) {
    assert.doesNotMatch(words(price && !price.quote && price.status ? priceState(price) : price?.quote ? price.quote : price), /no cost|free\b/i, JSON.stringify(price));
  }
  assert.match(words({ ai: false, reason: 'assist_off' }), /at no cost/);
  assert.match(buildSentence(priceState({ status: 'stale' }), 2), new RegExp(PRICE_STALE.slice(0, 30)));
  assert.match(buildSentence(priceState({ status: 'loading' }), 2), new RegExp(PRICE_LOADING));
});

test('2. guided path: outline generation and the build each send their own exact quote_uid, quoted with the round', async () => {
  const m = await mount(`${NEW_PATH}?project_id=1`, { quote: async (b) => live(b) });
  try {
    const quotes = m.calls.filter(([n]) => n === 'quote').map(([, b]) => b);
    assert.ok(quotes.every((b) => 'round_ref' in b), 'every quote carries the round the run will carry');
    await m.press(m.by('pitch-new-regenerate'));
    assert.ok(!m.pr(m.by('pitch-new-confirm')).disabled, 'a metered, pinned price can be confirmed');
    await m.press(m.by('pitch-new-confirm'));
    const [, outlineBody] = m.calls.filter(([n]) => n === 'outline').at(-1);
    assert.equal(outlineBody.quote_uid, 'dq_outline_seed_fund_standard', 'the outline run names the outline quote');
    await m.press(m.by('pitch-new-build'));
    await m.press(m.by('pitch-new-confirm'));
    const [, buildBody] = m.calls.filter(([n]) => n === 'build').at(-1);
    assert.equal(buildBody.quote_uid, 'dq_build_seed_fund_standard', 'the build names the build quote, not the outline\'s');
    assert.equal(buildBody.round_ref, outlineBody.round_ref);
  } finally { await m.unmount(); }
});

test('3. a failed quote read, pricing_unavailable and a loading price cannot be confirmed, never read as free, and retry works', async () => {
  for (const [name, quote] of [
    ['read failed', async () => { throw new Error('network'); }],
    ['pricing_unavailable', async (b) => ({ step: b.step, ai: false, reason: 'pricing_unavailable', message: 'The price could not be worked out.' })],
    ['never answers', () => new Promise(() => {})],
  ]) {
    const m = await mount(`${NEW_PATH}?project_id=1`, { quote });
    try {
      await m.press(m.by('pitch-new-build'));
      assert.equal(m.pr(m.by('pitch-new-confirm')).disabled, true, `${name}: Confirm is off`);
      assert.doesNotMatch(m.text(m.by('pitch-new-dialog')), /no cost|free\b/i, `${name}: nothing says free`);
      const before = m.calls.filter(([n]) => n === 'build').length;
      await m.pr(m.by('pitch-new-confirm')).onClick?.({ preventDefault() {} });
      assert.equal(m.calls.filter(([n]) => n === 'build').length, before, `${name}: no build is sent`);
      if (name !== 'never answers') {
        assert.ok(m.by('pitch-new-reprice'), `${name}: the retry is offered`);
        const reads = m.calls.filter(([n]) => n === 'quote').length;
        await m.press(m.by('pitch-new-reprice'));
        assert.ok(m.calls.filter(([n]) => n === 'quote').length > reads, `${name}: the price is read again`);
      }
    } finally { await m.unmount(); }
  }
});

test('4. a confirmed no-cost answer is the only "at no cost", and it may run without a quote', async () => {
  const m = await mount(`${NEW_PATH}?project_id=1`, { quote: async (b) => ({ step: b.step, ai: false, reason: 'assist_off', message: 'AI is off on this page.' }) });
  try {
    await m.press(m.by('pitch-new-build'));
    assert.match(m.text(m.by('pitch-new-dialog')), /AI is off on this page, so the cards carry their titles, at no cost/);
    assert.ok(!m.pr(m.by('pitch-new-confirm')).disabled);
    await m.press(m.by('pitch-new-confirm'));
    const [, body] = m.calls.filter(([n]) => n === 'build').at(-1);
    assert.equal(body.quote_uid, undefined, 'a no-cost run names no quote');
  } finally { await m.unmount(); }
});

test('5. changing a price-relevant input drops the old quote and reads a new one; the build sends the new quote_uid', async () => {
  const m = await mount(`${NEW_PATH}?project_id=1`, { quote: async (b) => live(b) });
  try {
    await m.press(m.by('pitch-new-audience-angel'));
    const quotes = m.calls.filter(([n]) => n === 'quote').map(([, b]) => b);
    assert.ok(quotes.some((b) => b.step === 'build' && b.audience === 'angel' && Array.isArray(b.outline)), 'the build is priced for the new audience');
    await m.press(m.by('pitch-new-build'));
    await m.press(m.by('pitch-new-confirm'));
    const [, body] = m.calls.filter(([n]) => n === 'build').at(-1);
    assert.equal(body.audience, 'angel');
    assert.equal(body.quote_uid, 'dq_build_angel_standard', 'the quote for the other audience is not sent for this one');
    // The quote and the run carry the same price-relevant inputs.
    const q = quotes.filter((b) => b.step === 'build' && Array.isArray(b.outline)).at(-1);
    for (const k of ['audience', 'length', 'round_ref', 'outline', 'exclude']) assert.deepEqual(q[k], body[k], k);
  } finally { await m.unmount(); }
  // While the new price is still being read, the old one cannot be confirmed.
  const slow = await mount(`${NEW_PATH}?project_id=1`, { quote: async (b) => (b.audience === 'angel' ? new Promise(() => {}) : live(b)) });
  try {
    await slow.press(slow.by('pitch-new-audience-angel'));
    await slow.press(slow.by('pitch-new-build'));
    assert.equal(slow.pr(slow.by('pitch-new-confirm')).disabled, true, 'the seed fund quote is not offered for the angel deck');
    assert.match(slow.text(slow.by('pitch-new-dialog')), new RegExp(PRICE_LOADING));
  } finally { await slow.unmount(); }
  // With no outline there is nothing to price: a quote for the old rows is not kept.
  const none = await mount(`${NEW_PATH}?project_id=1`, { quote: async (b) => live(b) });
  try {
    await none.press(none.by('pitch-new-length-short'));
    assert.equal(none.pr(none.by('pitch-new-build')).disabled, true, 'no rows, no build');
    assert.doesNotMatch(none.text(), /Estimated \$/, 'and the price of the old outline is not still on the page');
    await none.press(none.by('pitch-new-length-standard'));
    assert.ok(!none.pr(none.by('pitch-new-build')).disabled);
  } finally { await none.unmount(); }
});

test('6. a stale quote is refused by the Worker, the price is read again, and the build is not re-sent on its own', async () => {
  let n = 0;
  const build = async () => { const e = new Error('The price shown is no longer held.'); e.status = 409; e.code = 'quote_stale'; e.data = { error: 'quote_stale' }; throw e; };
  const m = await mount(`${NEW_PATH}?project_id=1`, { quote: async (b) => ({ ...live(b), quote_uid: `dq_${b.step}_${(n += 1)}` }), build });
  try {
    await m.press(m.by('pitch-new-build'));
    await m.press(m.by('pitch-new-confirm'));
    assert.equal(m.calls.filter(([c]) => c === 'build').length, 1, 'one attempt');
    assert.ok(!m.by('pitch-new-dialog'), 'the dialog is closed: the person confirms again');
    await m.press(m.by('pitch-new-build'));
    assert.equal(m.calls.filter(([c]) => c === 'build').length, 1, 'nothing was re-sent by itself');
    await m.press(m.by('pitch-new-confirm'));
    const builds = m.calls.filter(([c]) => c === 'build');
    assert.equal(builds.length, 2);
    assert.notEqual(builds[0][1].quote_uid, builds[1][1].quote_uid, 'the second attempt names the refreshed quote');
  } finally { await m.unmount(); }
});

test('7. one-click Build sends the exact quote_uid, will not run on an unread or unpinned price, and re-prices on a stale one', async () => {
  const src = readFileSync(resolve(root, 'frontend/src/pages/raise/pitch/OneClickBuild.jsx'), 'utf8');
  assert.match(src, /if \(!brief \|\| !canConfirm\(price\)\) return;/, 'the press is guarded');
  assert.match(src, /quote_uid: quoteUidOf\(price\)/, 'and names the accepted quote');
  assert.match(src, /why\?\.code === 'quote_stale' \|\| why\?\.code === 'quote_required'/, 'and asks again on a stale or missing quote');
  assert.match(src, /setSlot\(\{ status: 'loading' \}\);\n\s+newDeckApi\.quote/, 'an input change drops the old quote before the new read');
  const m = await mount(`${NEW_PATH}?project_id=1`, { quote: async (b) => live(b) });
  try {
    await m.press(m.by('pitch-new-fast-build'));
    assert.ok(!m.pr(m.by('pitch-new-fast-run')).disabled);
    await m.press(m.by('pitch-new-fast-run'));
    const [, body] = m.calls.filter(([n]) => n === 'build').at(-1);
    assert.equal(body.one_click, true);
    assert.match(body.quote_uid, /^dq_build_/, 'the one-click names the build quote it was shown');
  } finally { await m.unmount(); }
  const off = await mount(`${NEW_PATH}?project_id=1`, { quote: async () => { throw new Error('network'); } });
  try {
    await off.press(off.by('pitch-new-fast-build'));
    assert.equal(off.pr(off.by('pitch-new-fast-run')).disabled, true, 'a failed read cannot be confirmed');
    assert.doesNotMatch(off.text(off.by('pitch-new-fast-dialog')), /no cost|free\b/i);
    assert.ok(off.by('pitch-new-fast-reprice'));
  } finally { await off.unmount(); }
});

/**
 * D897 (#2677, part 3 of #2434) — New deck at /raise/pitch/new (PD3–PD6) and
 * the studio's fast path (PD2).
 *
 * What this file holds New deck to:
 *   · every figure is from a read (context, sources, a quote, the proposal);
 *     an empty slot reads "Not recorded on StudioOS" with its module link;
 *   · a prompt or an outline row that states a figure is flagged before it is
 *     sent, and the Worker's refusal is drawn with the module that records it;
 *   · every write opens a dialog that says what it changes, Regenerate and
 *     Build deck show their cost first, and each run names its rail option;
 *   · the studio's New deck and fast path open it; the route is static.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/new_deck_d897.test.mjs
 */
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
import NewDeck from '../src/pages/raise/pitch/NewDeck.jsx';
import {
  NEW_PATH, addRow, aiTokens, buildSentence, chipsFor, costRows, editRow, estimateLine, fastPathLine, keepSentence, moveRow,
  numberIn, outlineSentence, progressRows, promptWarning, proposalCards, refusalOf, removeRow, roundLine, rowWarning, saveSentence, startOptions,
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
  standard: {},
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

test('AI tokens print as the receipt does: four places under a dollar', () => {
  assert.equal(aiTokens(6000), '$0.0060');
  assert.equal(aiTokens(1_250_000), '$1.25');
  assert.equal(aiTokens(0), '$0.0000');
  assert.equal(aiTokens(null), null);
  assert.equal(aiTokens('x'), null);
});

test('the prompt is flagged as the Worker would refuse it, and "one" is not a figure', () => {
  assert.ok(promptWarning('Say we have 200 customers'));
  assert.ok(promptWarning('Fourteen of twenty-three said yes'));
  assert.equal(promptWarning('Lead with one ledger and the team'), null);
  // The same rule as services/decks/newDeck.ts: the word list is copied, so both must change together.
  const worker = read('cloudflare-worker/src/services/decks/newDeck.ts');
  const words = (src) => JSON.stringify(src.match(/NUMBER_WORDS = \[([^\]]+)\]/)[1].match(/'[a-z]+'/g));
  assert.equal(words(read('frontend/src/pages/raise/pitch/newDeckModel.js')), words(worker));
  for (const t of ['$5', '40%', 'a dozen', '3x']) assert.ok(numberIn(t), t);
});

test('a refused press reads its sentence and links the module that records the figure', () => {
  const e = Object.assign(new Error('Figures come from your records, never from the prompt. Record paying customers in Grow › Revenue and traction, and the deck reads it from there.'), {
    status: 422, code: 'figure_in_prompt', data: { error: 'figure_in_prompt', module: 'Grow › Revenue and traction', href: '/grow/revenue-and-traction?project=1' },
  });
  assert.deepEqual(refusalOf(e).link, { text: 'Open Grow › Revenue and traction ›', href: '/grow/revenue-and-traction?project=1' });
  assert.equal(refusalOf(Object.assign(new Error('x'), { status: 422, code: 'figure_in_prompt', data: { href: 'https://evil.example' } })).link, null, 'only an app path');
  assert.equal(refusalOf(Object.assign(new Error('Out of tokens'), { status: 402, code: 'budget_user_month' })).topUp.text, 'Add tokens');
  assert.equal(refusalOf(Object.assign(new Error('Plan'), { status: 402, code: 'tier_required' })).topUp, null);
});

test('the round line says what is recorded, and Not recorded for the rest', () => {
  assert.equal(roundLine(CONTEXT.round), 'Synthetic seed · SAFE · $1,500,000 · close 15 Dec 2026');
  assert.equal(roundLine({ name: null, target_amount: null, close_date: null, instrument: null }), 'Round · instrument not recorded · amount not recorded · close not recorded');
  assert.equal(roundLine(null), null);
});

test('Start from: blank, each past version, then the templates with their plan lock', () => {
  const o = startOptions([{ id: 9, version: 3 }], [{ id: 'yc_seed', label: 'YC seed' }, { id: 'sequoia', label: 'Sequoia', locked: true }]);
  assert.deepEqual(o.map((x) => [x.kind, x.label, Boolean(x.locked)]), [['blank', 'Blank', false], ['version', 'Past version v3', false], ['template', 'YC seed', false], ['template', 'Sequoia', true]]);
});

test('outline rows reorder, edit, delete and add from the catalogue; a numbered row is flagged', () => {
  assert.deepEqual(moveRow(ROWS, 0, 2).map((r) => r.card), ['traction', 'team', 'title']);
  assert.equal(moveRow(ROWS, 0, 9), ROWS);
  assert.deepEqual(removeRow(ROWS, 1).map((r) => r.card), ['title', 'team']);
  assert.equal(editRow(ROWS, 1, { title: 'Momentum' })[1].title, 'Momentum');
  assert.deepEqual(addRow(ROWS, 'every_figure', CATALOGUE).at(-1), { card: 'every_figure', title: 'Appendix · Every figure', purpose: 'Each recorded figure with its source' });
  assert.equal(addRow(ROWS, 'nope', CATALOGUE), ROWS);
  assert.match(rowWarning(editRow(ROWS, 1, { title: '200 customers' })), /Row 2 names a figure/);
  assert.equal(rowWarning(ROWS), null);
});

test('chips are the card\'s slots as recorded now, less the ones unticked at PD4', () => {
  assert.deepEqual(chipsFor(ROWS[1], CATALOGUE, ITEMS).map((c) => [c.label, c.recorded]), [['MRR', false], ['Paying customers', true]]);
  assert.deepEqual(chipsFor(ROWS[1], CATALOGUE, ITEMS, new Set(['grow.mrr'])).map((c) => c.key), ['grow.paying_customers']);
  assert.deepEqual(chipsFor({ card: 'every_figure' }, CATALOGUE, ITEMS).map((c) => c.key), ['grow.paying_customers', 'team.founders'], 'the appendix lists what is recorded');
});

test('the estimate is the quote, beside the member\'s own average', () => {
  assert.equal(estimateLine({ ai: true, hold_microusd: 6000 }, CONTEXT.averages.build), 'Estimated $0.0060 · Your average $0.0052 over 6 runs');
  assert.equal(estimateLine({ ai: true, hold_microusd: 6000 }, null), 'Estimated $0.0060');
  assert.match(estimateLine({ ai: false, reason: 'assist_off' }), /AI is off on this page/);
  assert.equal(estimateLine(null, null), null);
});

test('every write\'s dialog says what it changes and what it costs', () => {
  assert.match(outlineSentence({ ai: true, hold_microusd: 1100 }, false), /holds up to \$0\.0011 in AI tokens.*replaces any deck proposal you have not kept; no deck version changes/);
  assert.match(outlineSentence({ ai: true, hold_microusd: 1100 }, true), /a new outline in place of this one/);
  assert.match(buildSentence({ ai: true, hold_microusd: 6000 }, 12), /builds 12 cards from your records.*up to \$0\.0060.*nothing is a version until you keep cards and save/);
  assert.match(buildSentence({ ai: false, reason: 'assist_off' }, 1), /builds 1 card .*AI is off/);
  assert.match(keepSentence({ n: '03', title: 'Team' }), /Card 03 · Team joins the cards you keep/);
  assert.match(saveSentence(3, 12, 'Seed fund'), /The 3 cards you kept, of 12, become the new current version for Seed fund/);
  assert.match(fastPathLine({ ai: true, hold_microusd: 6000 }), /^Twelve cards from everything on record, for a seed fund\. Review sources afterwards\. About \$0\.0060 in AI tokens\.$/);
  for (const s of [outlineSentence(null, false), buildSentence(null, 2), fastPathLine(null)]) assert.doesNotMatch(s, /credit/i);
});

test('a proposal card draws its words and each figure from its own binding; empty is Not recorded', () => {
  const cards = proposalCards({ slides: SLIDES, kept: [2] }, ITEMS);
  assert.equal(cards[1].headline, 'Customers keep coming.');
  assert.deepEqual(cards[1].figures.map((f) => [f.label, f.value, f.grade]), [['MRR', null, 'Not recorded'], ['Paying customers', '42', 'Stated']]);
  assert.equal(cards[1].missing[0].href, '/grow/revenue-and-traction?project=1');
  assert.deepEqual(cards.map((c) => c.kept), [false, false, true]);
  assert.deepEqual(proposalCards(null), []);
  assert.deepEqual(progressRows([{ n: 2, title: 'Traction', filled: 1, slots: 2, missing: ['grow.mrr'], worded: true }, { n: 1, title: 'Title', filled: 0, slots: 0, missing: [], worded: false }]).map((p) => [p.n, p.status, p.words]),
    [['02', 'Filled from records · 1 of 2', 'Eadwyn wrote the words'], ['01', 'No figures on this card', 'Title only']]);
  assert.deepEqual(costRows({ charged_microusd: 3200 }, { ai: true, hold_microusd: 6000 }).map((r) => r.value), ['$0.0032', '$0.0000', '$0.0060']);
  assert.equal(costRows({ charged_microusd: null }, null)[0].value, 'Not known yet', 'a hold waiting for review is not 0');
});

/* ------------------------------------------------------------------ *
 * The drawn page
 * ------------------------------------------------------------------ */

const ORIGINAL = { api: { ...api }, newDeck: { ...newDeckApi }, sources: { ...deckSourcesApi } };

async function mount(url, over = {}) {
  const calls = [];
  const stub = (target, name, fn) => { target[name] = (...a) => { calls.push([name, ...a]); return fn(...a); }; };
  stub(api, 'listProjects', async () => [{ id: 1, name: 'Synthetic venture' }]);
  stub(api, 'deckListVersions', over.versions || (async () => ({ versions: [{ id: 9, version: 3, is_current: true }], proposal: null })));
  stub(api, 'deckMethods', async () => ({ methods: [{ id: 'yc_seed', label: 'YC seed' }, { id: 'sequoia', label: 'Sequoia', locked: true }] }));
  stub(api, 'getMe', async () => null);
  stub(newDeckApi, 'context', async () => CONTEXT);
  stub(newDeckApi, 'quote', async (b) => ({ step: b.step, ai: true, hold_microusd: b.step === 'outline' ? 1100 : 6000, model: 'synthetic' }));
  stub(newDeckApi, 'outline', over.outline || (async () => ({ proposal: { id: 77, slides: [], outline: { rows: ROWS } }, outline: { rows: ROWS, proposed_by: 'Eadwyn' }, cost: { charged_microusd: 900 } })));
  stub(newDeckApi, 'build', async () => ({
    proposal: { id: 77, slides: SLIDES, kept: null, outline: { rows: ROWS } },
    progress: [{ n: 1, title: 'Title', filled: 0, slots: 0, missing: [], worded: true }, { n: 2, title: 'Traction', filled: 1, slots: 2, missing: ['grow.mrr'], worded: true }, { n: 3, title: 'Team', filled: 1, slots: 1, missing: [], worded: false }],
    wording: { by: 'Eadwyn', dropped: 1 }, cost: { charged_microusd: 3200 },
  }));
  stub(newDeckApi, 'keepSlides', async (_id, b) => (b.save ? { deck: { id: 12 } } : { proposal: { id: 77, slides: SLIDES, kept: b.all ? [0, 1, 2] : b.indexes } }));
  stub(deckSourcesApi, 'list', async () => ({ project_id: 1, items: ITEMS, coverage: COVERAGE }));
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
    calls, by, button, pr,
    text: () => text(container).replace(/\s+/g, ' '),
    async press(node) { assert.ok(node, 'the control is drawn'); await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(node, value) { await act(async () => { pr(node).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() {
      await act(async () => rootEl.unmount()); restore();
      Object.assign(api, ORIGINAL.api); Object.assign(newDeckApi, ORIGINAL.newDeck); Object.assign(deckSourcesApi, ORIGINAL.sources);
    },
  };
}

test('PD3 → PD6: audience and round, sources, the outline, the build, and keeping card by card', async () => {
  const m = await mount(`${NEW_PATH}?project_id=1`);
  try {
    // PD3: the seven audiences, the round with its Reviewed chip, the lengths, Start from.
    assert.ok(m.by('pitch-new-step-1'));
    const t1 = m.text();
    for (const a of CONTEXT.audiences) assert.ok(t1.includes(a.label), a.label);
    assert.match(t1, /Synthetic seed · SAFE · \$1,500,000 · close 15 Dec 2026/);
    assert.match(t1, /Reviewed · counsel approved/);
    assert.match(t1, /Past version v3/);
    assert.match(t1, /Sequoia Plan/);
    // A prompt that states a figure is flagged and stops the step.
    await m.type(m.by('pitch-new-prompt'), 'Say we have 200 customers');
    assert.ok(m.by('pitch-new-prompt-warning'));
    assert.equal(m.pr(m.by('pitch-new-continue')).disabled, true);
    await m.type(m.by('pitch-new-prompt'), 'Lead with the team');
    await m.press(m.by('pitch-new-audience-series_a_fund'));
    await m.press(m.by('pitch-new-continue'));
    // PD4: the sources, and the outline's price before it runs.
    assert.ok(m.by('sources-step'));
    assert.ok(m.calls.some(([n, b]) => n === 'quote' && b.step === 'outline' && b.audience === 'series_a_fund'));
    await m.press(m.button('Continue to outline'));
    assert.ok(m.by('pitch-new-dialog'), 'Propose opens a dialog');
    assert.match(m.text(), /holds up to \$0\.0011 in AI tokens/);
    assert.equal(m.calls.filter(([n]) => n === 'outline').length, 0, 'nothing runs before Confirm');
    await m.press(m.by('pitch-new-confirm'));
    const [, outlineBody, outlineHeaders] = m.calls.find(([n]) => n === 'outline');
    assert.deepEqual([outlineBody.audience, outlineBody.prompt, outlineBody.round_ref, outlineBody.start], ['series_a_fund', 'Lead with the team', 'round-1', { kind: 'blank' }]);
    assert.equal(outlineHeaders['X-Rail-Option'], encodeURIComponent('deck:outline'));
    // PD5: the outline, its chips, its estimate beside the member's average.
    assert.ok(m.by('pitch-new-step-3'));
    assert.match(m.text(), /Proposed by Eadwyn/);
    assert.match(m.text(), /MRR · Not recorded on StudioOS/);
    assert.match(m.by('pitch-new-estimate') ? m.text() : '', /Estimated \$0\.0060 · Your average \$0\.0052 over 6 runs/);
    await m.press(m.by('pitch-new-build'));
    assert.match(m.text(), /builds 3 cards from your records/);
    await m.press(m.by('pitch-new-confirm'));
    const [, buildBody, buildHeaders] = m.calls.find(([n]) => n === 'build');
    assert.equal(buildBody.proposal_id, 77);
    assert.deepEqual(buildBody.outline, ROWS);
    assert.deepEqual(buildBody.exclude, [], 'every recorded source was left ticked');
    assert.equal(buildHeaders['X-Rail-Option'], encodeURIComponent('deck:build'));
    // PD6: what each card was filled from, the cost, and the cards to keep.
    assert.ok(m.by('pitch-new-step-4'));
    const t4 = m.text();
    assert.match(t4, /Filled from records · 1 of 2/);
    assert.match(t4, /Used so far \$0\.0032/);
    assert.match(t4, /Not recorded on StudioOS · Add it in Grow › Revenue and traction ›/);
    assert.match(t4, /42 · Stated/);
    await m.press(m.by('pitch-new-keep-1'));
    assert.match(m.text(), /Card 02 · Traction joins the cards you keep/);
    await m.press(m.by('pitch-new-confirm'));
    assert.deepEqual(m.calls.find(([n]) => n === 'keepSlides').slice(1), [77, { indexes: [1] }]);
    await m.press(m.by('pitch-new-save'));
    assert.match(m.text(), /The 1 card you kept, of 3, become the new current version for Series A fund/);
    await m.press(m.by('pitch-new-confirm'));
    assert.deepEqual(m.calls.filter(([n]) => n === 'keepSlides').at(-1).slice(1), [77, { save: true }]);
  } finally { await m.unmount(); }
});

test('the Worker\'s refusal is drawn with its module; nothing moves on', async () => {
  const refused = async () => { throw Object.assign(new Error('Figures come from your records, never from the prompt.'), { status: 422, code: 'figure_in_prompt', data: { module: 'Grow › Revenue and traction', href: '/grow/revenue-and-traction?project=1' } }); };
  const m = await mount(`${NEW_PATH}?project_id=1`, { outline: refused });
  try {
    await m.press(m.by('pitch-new-continue'));
    await m.press(m.button('Continue to outline'));
    await m.press(m.by('pitch-new-confirm'));
    assert.ok(m.by('pitch-new-refusal'));
    assert.match(m.text(), /Open Grow › Revenue and traction ›/);
    assert.ok(m.by('pitch-new-step-2'), 'still on the sources step');
  } finally { await m.unmount(); }
});

test('?proposal= reopens the fast path\'s proposal on step 4', async () => {
  const m = await mount(`${NEW_PATH}?project_id=1&proposal=77`, {
    versions: async () => ({ versions: [], proposal: { id: 77, slides: SLIDES, kept: [0], outline: { audience: 'seed_fund', length: 'standard', rows: ROWS, proposed_by: 'StudioOS' } } }),
  });
  try {
    assert.ok(m.by('pitch-new-step-4'));
    assert.match(m.text(), /Kept/);
    assert.match(m.text(), /Save as version \(\s*1\s*\)/);
    await m.press(m.by('pitch-new-keep-all'));
    assert.match(m.text(), /All 3 cards join the cards you keep/);
  } finally { await m.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The wiring
 * ------------------------------------------------------------------ */

test('the route is static, the studio opens it, and the fast path builds a proposal', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.indexOf('path="/raise/pitch/new"') > 0 && app.indexOf('path="/raise/pitch/new"') < app.indexOf('path="/raise/:slug/new"'));
  const studio = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  assert.match(studio, /to=\{`\$\{NEW_PATH\}\$\{q\}`\} className=\{PRIMARY\} data-testid="pitch-studio-new"/);
  assert.match(studio, /to=\{`\$\{NEW_PATH\}\$\{q\}`\} className=\{PRIMARY\} data-testid="pitch-studio-empty-new"/);
  assert.match(studio, /newDeckApi\.build\(\{ project_id: projectId, audience: 'seed_fund', length: 'standard' \}, railPressHeaders\('deck:build'\)\)/);
  for (const f of ['frontend/src/pages/raise/pitch/NewDeck.jsx', 'frontend/src/pages/raise/pitch/newDeckModel.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\[\$[\d.,]+\]|\[Northwind|\[Seed\]|\[\d+\] runs/, `${f}: no canvas sample reaches the page`);
    assert.doesNotMatch(src, /\bcredits?\b/i, `${f}: AI tokens, never credits`);
  }
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /export \* from '\.\/api\/newDeck\.js';/);
});

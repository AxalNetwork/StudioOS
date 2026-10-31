/**
 * D897 (#2677, part 3 of #2434) — New deck at /raise/pitch/new and the
 * studio's fast path (PD2). D1604 (#3716, pd2, plan §11 step 14) put New deck
 * on one page: Audience and stage, Sources, Outline, with the one-click on
 * top and no prompt field; Build lands on the review shared with the
 * one-click (`OneClickBuild.jsx`, pinned in `pitch_v2_oneclick_d1604`).
 *
 * What this file holds New deck to:
 *   · every figure is from a read (context, sources, a quote, the proposal);
 *     an empty slot reads "Not recorded on StudioOS" with its module link;
 *   · the brief starts from the context read, never a literal of the client's;
 *   · no field takes typed instructions: those live in the editor only;
 *   · an outline row that states a figure is flagged before it is sent, and
 *     the Worker's refusal is drawn with the module that records it;
 *   · Regenerate and Build deck show their cost first in a dialog, and each
 *     run names its rail option;
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
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckImagesApi } from '../src/lib/api/deckImages.js';
import NewDeck from '../src/pages/raise/pitch/NewDeck.jsx';
import {
  NEW_PATH, addRow, aiTokens, buildSentence, chipsFor, editRow, estimateLine, fastBrief, fastPathLine, moveRow,
  numberIn, outlineSentence, promptWarning, refusalOf, removeRow, roundLine, rowWarning, startOptions,
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
  assert.match(buildSentence({ ai: true, hold_microusd: 6000 }, 12), /builds 12 cards from your records.*up to \$0\.0060.*nothing is saved until you accept it/);
  assert.match(buildSentence({ ai: false, reason: 'assist_off' }, 1), /builds 1 card .*AI is off/);
  // D1604 (#3716, §3.2): the one-click's line names the brief the context read gave, never a guessed one.
  const brief = fastBrief({ fast_path: { audience: 'pre_seed_fund', length: 'short' }, audiences: [{ id: 'pre_seed_fund', label: 'Pre-seed fund' }], standard: { short: [1, 2, 3, 4, 5, 6] } });
  assert.deepEqual(brief, { audience: 'pre_seed_fund', length: 'short', label: 'Pre-seed fund', cards: 6, why: null });
  assert.match(fastPathLine({ ai: true, hold_microusd: 6000 }, brief), /^6 cards from everything on record, for the Pre-seed fund audience\. Review sources afterwards\. About \$0\.0060 in AI tokens\.$/);
  assert.equal(fastPathLine(null), 'A deck from everything on record. Review sources afterwards.', 'before the read, no audience is named');
  assert.match(buildSentence(null, null), /^StudioOS builds the deck from your records\./);
  // #3877's inferred brief wins over fast_path when the read carries it.
  const inferred = fastBrief({ fast_path: { audience: 'seed_fund', length: 'standard' }, inferred: { audience: 'angel', length: 'short', why: 'Your venture is at idea stage.' }, audiences: [{ id: 'angel', label: 'Angel' }] });
  assert.deepEqual([inferred.audience, inferred.length, inferred.why], ['angel', 'short', 'Your venture is at idea stage.']);
  assert.equal(fastBrief(null), null, 'no read, no brief');
  assert.equal(fastBrief({ audiences: [] }), null, 'a read without fast_path gives no brief');
  for (const s of [outlineSentence(null, false), buildSentence(null, 2), fastPathLine(null)]) assert.doesNotMatch(s, /credit/i);
});

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
  stub(newDeckApi, 'quote', async (b) => ({ step: b.step, ai: true, hold_microusd: b.step === 'outline' ? 1100 : 6000, model: 'synthetic' }));
  stub(newDeckApi, 'outline', over.outline || (async () => ({ proposal: { id: 77, slides: [], outline: { rows: ROWS } }, outline: { rows: ROWS, proposed_by: 'Eadwyn' }, cost: { charged_microusd: 900 } })));
  stub(newDeckApi, 'build', async () => ({
    proposal: { id: 77, base_deck_id: 9, slides: BUILT_SLIDES, kept: null, outline: { audience: 'series_a_fund', rows: ROWS } },
    progress: [], wording: { by: 'Eadwyn', dropped: 1 }, cost: { charged_microusd: 3200 },
  }));
  stub(newDeckApi, 'keepSlides', async (_id, b) => (b.save ? { deck: { id: 12, version: 4, title: 'Pitch deck', slides: BUILT_SLIDES.slice(0, 3), theme: null } } : { proposal: { id: 77, slides: BUILT_SLIDES } }));
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

test('pd2, one page: Audience and stage, Sources and Outline together, the brief from the read, and no prompt', async () => {
  const m = await mount(`${NEW_PATH}?project_id=1`);
  try {
    for (const id of ['pitch-new-page', 'pitch-new-fast', 'pitch-new-audience', 'pitch-new-sources', 'pitch-new-outline', 'sources-step']) assert.ok(m.by(id), id);
    assert.ok(!m.by('pitch-new-step-1') && !m.all().some((n) => m.pr(n)['aria-label'] === 'Steps'), 'no step bar: one page');
    const t = m.text();
    for (const a of CONTEXT.audiences) assert.ok(t.includes(a.label), a.label);
    assert.match(t, /Synthetic seed · SAFE · \$1,500,000 · close 15 Dec 2026/);
    assert.match(t, /Reviewed · counsel approved/);
    assert.match(t, /Past version v3/);
    assert.match(t, /Sequoia Plan/);
    // The owner's rule: typed instructions live only in the editor. Mutation checked: put the prompt back → this fails.
    assert.ok(!m.all().some((n) => n.tagName === 'TEXTAREA'), 'no free-text field on New deck');
    assert.ok(!m.by('pitch-new-prompt'));
    // The brief is the context read's (its fast_path here), never a literal of the page's.
    assert.equal(m.pr(m.by('pitch-new-audience-seed_fund'))['aria-checked'], true);
    assert.equal(m.pr(m.by('pitch-new-length-standard'))['aria-checked'], true);
    // The outline is the length's standard outline at once, free, each row with its why line.
    assert.ok(m.by('pitch-new-row-1'));
    assert.match(m.text(m.by('pitch-new-why-1')), /The founders and what they bring/);
    // Stage: the plan by stage waits on #3774, drawn greyed with its reason.
    assert.match(m.text(m.by('pitch-new-stage')), /Pre-seed Seed Series A Series B\+ Coming later/);
    assert.equal(m.pr(m.by('pitch-new-stage')).title, 'Not switched on yet.');
    assert.equal(m.pr(m.by('pitch-new-reorder'))['aria-disabled'], 'true', 'Reorder for stage waits on #3808');
  } finally { await m.unmount(); }
});

test('#3877: the inferred brief and its reason preset the page; stale connectors offer Sync now', async () => {
  const ctx = { ...CONTEXT, inferred: { stage: 'pre_seed', audience: 'pre_seed_fund', length: 'short', round: null, why: 'Synthetic: the venture records a pre-seed stage.' },
    freshness: [{ provider: 'stripe', as_of: '2026-10-12', stale: true, sync: { method: 'POST', path: '/api/connectors/con_1/sync' } }] };
  const m = await mount(`${NEW_PATH}?project_id=1`, { context: async () => ctx });
  try {
    assert.equal(m.pr(m.by('pitch-new-audience-pre_seed_fund'))['aria-checked'], true);
    assert.equal(m.pr(m.by('pitch-new-length-short'))['aria-checked'], true);
    assert.match(m.text(m.by('pitch-new-inferred')), /From your records: Synthetic: the venture records a pre-seed stage\./);
    const pressed = m.all().filter((n) => m.pr(n)['aria-pressed'] === true && /Pre-seed/.test(n.textContent || ''));
    assert.ok(pressed.length >= 1, 'the inferred stage is the chip pressed');
    assert.match(m.text(m.by('pitch-new-fresh-stripe')), /Stripe · as of 12 Oct · out of date Sync now/);
  } finally { await m.unmount(); }
});

test('Regenerate and Build show their cost first; Build lands on the shared review, and Accept keeps the ticked cards', async () => {
  const m = await mount(`${NEW_PATH}?project_id=1`);
  try {
    await m.press(m.by('pitch-new-audience-series_a_fund'));
    assert.ok(m.calls.some(([n, b]) => n === 'quote' && b.step === 'outline' && b.audience === 'series_a_fund'));
    await m.press(m.by('pitch-new-regenerate'));
    assert.ok(m.by('pitch-new-dialog'), 'Regenerate opens a dialog');
    assert.match(m.text(), /holds up to \$0\.0011 in AI tokens/);
    assert.equal(m.calls.filter(([n]) => n === 'outline').length, 0, 'nothing runs before Confirm');
    await m.press(m.by('pitch-new-confirm'));
    const [, outlineBody, outlineHeaders] = m.calls.find(([n]) => n === 'outline');
    assert.deepEqual([outlineBody.audience, outlineBody.round_ref, outlineBody.start], ['series_a_fund', 'round-1', { kind: 'blank' }]);
    assert.ok(!('prompt' in outlineBody), 'no prompt is sent');
    assert.equal(outlineHeaders['X-Rail-Option'], encodeURIComponent('deck:outline'));
    assert.match(m.text(), /Proposed by Eadwyn/);
    assert.match(m.text(), /MRR · Not recorded on StudioOS/);
    assert.match(m.text(m.by('pitch-new-estimate')), /Estimated \$0\.0060 · Your average \$0\.0052 over 6 runs/);
    await m.press(m.by('pitch-new-build'));
    assert.match(m.text(), /builds 3 cards from your records/);
    assert.match(m.text(m.by('pitch-new-dialog-hold')), /^Holds up to \$0\.0060 · you pay what it uses$/);
    await m.press(m.by('pitch-new-confirm'));
    const [, buildBody, buildHeaders] = m.calls.find(([n]) => n === 'build');
    assert.equal(buildBody.proposal_id, 77);
    assert.deepEqual(buildBody.outline, ROWS);
    assert.deepEqual(buildBody.exclude, [], 'every recorded source was left ticked');
    assert.ok(!('prompt' in buildBody));
    assert.equal(buildHeaders['X-Rail-Option'], encodeURIComponent('deck:build'));
    // The shared review: the not-recorded-only card is left out, the others ticked.
    assert.ok(m.by('pitch-new-proposal'));
    assert.match(m.text(m.by('pitch-review-ready')), /^Ready to present: 3 cards, 1 left out\.$/);
    assert.match(m.text(m.by('pitch-review-left-3')), /Market/);
    await m.press(m.by('pitch-review-accept'));
    assert.deepEqual(m.calls.filter(([n]) => n === 'keepSlides').at(-1).slice(1), [77, { indexes: [0, 1, 2], save: true }]);
    assert.ok(m.by('pitch-review-saved'));
    assert.match(m.text(), /Saved as v4\./);
  } finally { await m.unmount(); }
});

test('an outline row that states a figure stops Build; the Worker\'s refusal is drawn with its module', async () => {
  const refused = async () => { throw Object.assign(new Error('Figures come from your records, never from the prompt.'), { status: 422, code: 'figure_in_prompt', data: { module: 'Grow › Revenue and traction', href: '/grow/revenue-and-traction?project=1' } }); };
  const m = await mount(`${NEW_PATH}?project_id=1`, { outline: refused });
  try {
    const title = m.all().find((n) => m.pr(n)['aria-label'] === 'Title of card 1');
    await m.change(title, '200 customers');
    assert.match(m.text(), /Row 1 names a figure/);
    assert.equal(m.pr(m.by('pitch-new-build')).disabled, true);
    await m.change(title, 'Title');
    await m.press(m.by('pitch-new-regenerate'));
    await m.press(m.by('pitch-new-confirm'));
    assert.ok(m.by('pitch-new-refusal'));
    assert.match(m.text(), /Open Grow › Revenue and traction ›/);
    assert.ok(m.by('pitch-new-page'), 'still on the page');
  } finally { await m.unmount(); }
});

test('?proposal= reopens the fast path\'s proposal on the review; one no longer open says so', async () => {
  const m = await mount(`${NEW_PATH}?project_id=1&proposal=77`, {
    versions: async () => ({ versions: [], proposal: { id: 77, slides: SLIDES, kept: [0], outline: { audience: 'seed_fund', length: 'standard', rows: ROWS, proposed_by: 'StudioOS' } } }),
  });
  try {
    assert.ok(m.by('pitch-new-review'));
    assert.ok(!m.by('pitch-new-page'), 'the review, not the form');
    assert.match(m.text(), /For Seed fund\./);
    assert.match(m.text(m.by('pitch-review-accept')), /Accept all \(\s*3\s*\)/);
  } finally { await m.unmount(); }
  const gone = await mount(`${NEW_PATH}?project_id=1&proposal=5`);
  try { assert.ok(gone.by('pitch-new-proposal-gone')); } finally { await gone.unmount(); }
});

/* ------------------------------------------------------------------ *
 * The wiring
 * ------------------------------------------------------------------ */

test('the route is static, the studio opens it, and the fast path builds a proposal', () => {
  const app = read('frontend/src/App.jsx');
  assert.ok(app.indexOf('path="/raise/pitch/new"') > 0 && app.indexOf('path="/raise/pitch/new"') < app.indexOf('path="/raise/:slug/new"'));
  const studio = read('frontend/src/pages/raise/pitch/PitchStudio.jsx');
  assert.match(studio, /to=\{`\$\{NEW_PATH\}\$\{q\}`\} className=\{PRIMARY\} data-testid="pitch-studio-new"/);
  // D1604 (#3716, pd1): the empty state is the home's (`StudioHome.jsx`); its one-click is `OneClickBuild.jsx`.
  const home = read('frontend/src/pages/raise/pitch/StudioHome.jsx');
  assert.match(home, /to=\{`\$\{NEW_PATH\}\$\{q\}`\} className=\{PRIMARY\} data-testid="pitch-studio-empty-new"/);
  assert.match(home, /<OneClickBuild key=\{it\.id\} projectId=\{projectId\} q=\{q\} \/>/);
  // D1604 (#3716, §3.2): the brief is the context read's, never a literal of the client's.
  const one = read('frontend/src/pages/raise/pitch/OneClickBuild.jsx');
  assert.match(one, /newDeckApi\.context\(projectId\)/);
  assert.match(one, /newDeckApi\.build\(\{ project_id: projectId, audience: brief\.audience, length: brief\.length, \.\.\.\(ex\.length \? \{ exclude: ex \} : \{\}\) \}, railPressHeaders\('deck:build'\)\)/);
  assert.match(one, /newDeckApi\.quote\(\{ project_id: projectId, step: 'build', audience: brief\.audience, length: brief\.length/);
  assert.match(one, /disabled=\{!brief\}[^>]*data-testid=\{`\$\{testId\}-build`\}/, 'Build waits for the read, never a guessed brief');
  for (const f of ['StudioHome.jsx', 'PitchStudio.jsx', 'newDeckModel.js', 'NewDeck.jsx', 'OneClickBuild.jsx', 'oneClickModel.js']) {
    assert.doesNotMatch(read(`frontend/src/pages/raise/pitch/${f}`), /seed_fund|'standard'/, `${f}: no hard-coded audience or length`);
  }
  // pd2 (owner rule): no prompt field and no step bar on New deck.
  const nd = read('frontend/src/pages/raise/pitch/NewDeck.jsx');
  assert.doesNotMatch(nd, /<textarea|PROMPT_HINT|STEPS|setPrompt/);
  for (const f of ['frontend/src/pages/raise/pitch/NewDeck.jsx', 'frontend/src/pages/raise/pitch/newDeckModel.js']) {
    const src = read(f);
    assert.doesNotMatch(src, /\[\$[\d.,]+\]|\[Northwind|\[Seed\]|\[\d+\] runs/, `${f}: no canvas sample reaches the page`);
    assert.doesNotMatch(src, /\bcredits?\b/i, `${f}: AI tokens, never credits`);
  }
  const api = read('frontend/src/lib/api.js');
  assert.match(api, /export \* from '\.\/api\/newDeck\.js';/);
});

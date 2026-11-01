// D1604 (#3716, pd29, plan §7, §11 step 15) — the templates gallery at
// /raise/pitch/templates.
//
// What this file holds the gallery to:
//   · the Gallery is main's methods read, the recommended template first with
//     its reason, a locked one marked and not usable;
//   · Use this template fills it as a proposal and lands on the shared review,
//     so nothing is saved before Accept;
//   · the Stage, Audience and Style filters and Yours draw unavailable from the
//     adapter until #3782, never an empty list or a working-looking chip;
//   · Audience offers New deck's seven audiences;
//   · the route sits behind the studio's own boundary.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_v2_templates_d1604.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { api } from '../src/lib/api.js';
import TemplatesGallery from '../src/pages/raise/pitch/TemplatesGallery.jsx';
import { AUDIENCE_LABELS } from '../src/pages/raise/pitch/editorModel.js';
import { SURFACES } from '../src/pages/raise/pitch/deckV2Adapter.js';
import { DIRECT_SENTENCE, FILTERS, TEMPLATES_PATH, USE_SENTENCE, cardCount, galleryTiles, templateSentence } from '../src/pages/raise/pitch/templatesModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const PITCH = 'frontend/src/pages/raise/pitch';

const METHODS = [
  { id: 'yc_seed', label: 'YC seed', best_for: 'A first institutional round', slide_count: 10, locked: false,
    slides: [{ id: 's1', title: 'Problem' }, { id: 's2', title: 'Solution' }, { id: 's3', title: 'Appendix', appendix: true }] },
  { id: 'minimal_seed', label: 'Minimal seed', slide_count: 8, locked: false, slides: [{ id: 's1', title: 'Title' }] },
  { id: 'sequoia', label: 'Sequoia', slide_count: 12, locked: true, slides: [{ id: 's1', title: 'Purpose' }] },
];
const REC = { method_id: 'minimal_seed', stage: 'seed', sector: '', source: 'stage_default' };

test('the gallery\'s tiles: the recommended one first with its reason, counts never 0, and the lock', () => {
  const tiles = galleryTiles(METHODS, REC);
  assert.deepEqual(tiles.map((t) => [t.id, t.recommended, t.locked, t.count]), [
    ['minimal_seed', true, false, '8 cards'], ['yc_seed', false, false, '10 cards'], ['sequoia', false, true, '12 cards'],
  ]);
  assert.equal(tiles[0].reason, 'The usual template at seed.');
  assert.deepEqual(tiles[1].titles, ['Problem', 'Solution'], 'the appendix is not on the thumbnail');
  assert.equal(cardCount({ slide_count: 0, slides: [] }), null, 'no count is drawn, never "0 cards"');
  assert.deepEqual(galleryTiles(METHODS, null).map((t) => t.recommended), [false, false, false], 'a failed recommend marks nothing');
  // Audience is New deck's seven, not the canvas's three.
  const audience = FILTERS.find((f) => f.id === 'audience');
  assert.deepEqual(audience.chips, Object.values(AUDIENCE_LABELS));
  assert.equal(audience.chips.length, 7);
  assert.deepEqual(FILTERS.map((f) => f.id), ['stage', 'audience', 'style']);
  assert.equal(TEMPLATES_PATH, '/raise/pitch/templates');
  // Filters and Yours wait on #3782 through the adapter.
  for (const k of ['templates', 'myTemplates', 'saveAsTemplate']) assert.equal(SURFACES[k].issue, 3782, k);
});

const ORIGINAL = { ...api };
function Where() {
  const at = useLocation();
  return h('span', { 'data-testid': 'landed' }, `${at.pathname}${at.search}`);
}

async function mount(over = {}) {
  const calls = [];
  const stub = (name, fn) => { api[name] = (...a) => { calls.push([name, ...a]); return fn(...a); }; };
  stub('getMe', async () => null);
  stub('listProjects', async () => [{ id: 1, name: 'Synthetic venture' }]);
  stub('deckMethods', over.methods || (async () => ({ methods: METHODS })));
  stub('deckRecommend', async () => REC);
  stub('deckApplyMethod', over.apply || (async () => ({ proposal: { id: 55, slides: [{ title: 'Problem' }] }, method_id: 'yc_seed' })));
  const restore = installDocument();
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => {
    root.render(h(MemoryRouter, { initialEntries: [`${TEMPLATES_PATH}?project_id=1`] },
      h(Routes, null, h(Route, { path: TEMPLATES_PATH, element: h(TemplatesGallery) }), h(Route, { path: '*', element: h(Where) }))));
  });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, pr, all: () => walk(container),
    text: (n = container) => text(n).replace(/\s+/g, ' ').trim(),
    async press(node) { assert.ok(node, 'the control is drawn'); await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); Object.assign(api, ORIGINAL); },
  };
}

test('the Gallery reads the methods; Use this template fills a proposal and lands on the shared review', async () => {
  const m = await mount();
  try {
    const gallery = m.by('pitch-templates-gallery');
    assert.ok(gallery);
    assert.match(m.text(gallery), /^Title Minimal seed 8 cards Recommended for your stage/, 'the recommended template first');
    assert.match(m.text(m.by('pitch-templates-tile-sequoia')), /Part of a paid plan/);
    // A locked template previews, and offers no Use.
    await m.press(m.by('pitch-templates-tile-sequoia'));
    assert.ok(!m.by('pitch-templates-use'), 'a locked template is not usable');
    await m.press(m.by('pitch-templates-tile-yc_seed'));
    assert.equal(m.pr(m.by('pitch-templates-tile-yc_seed'))['aria-pressed'], true);
    assert.match(m.text(m.by('pitch-templates-preview')), /Preview · YC seed A first institutional round 01 Problem 02 Solution Use this template/);
    await m.press(m.by('pitch-templates-use'));
    assert.ok(m.by('pitch-templates-dialog'), 'Use opens a dialog that says what it does');
    assert.equal(m.text(m.by('pitch-templates-dialog-sentence')), USE_SENTENCE, 'a model-filled template is a proposal');
    assert.equal(m.calls.filter(([n]) => n === 'deckApplyMethod').length, 0, 'nothing runs before Confirm');
    await m.press(m.by('pitch-templates-confirm'));
    const [, projectId, methodId, headers] = m.calls.find(([n]) => n === 'deckApplyMethod');
    assert.deepEqual([projectId, methodId], [1, 'yc_seed']);
    assert.equal(headers['X-Rail-Option'], encodeURIComponent('form:deck-template'));
    // Mutation checked: navigate to the editor on a proposal → this lands on /raise/pitch/edit and fails.
    assert.equal(m.text(m.by('landed')), '/raise/pitch/new?project_id=1&proposal=55', 'the review, where nothing is saved before Accept');
  } finally { await m.close(); }
});

test('filters and Yours wait on #3782: greyed, titled with the reason, never an empty list', async () => {
  const m = await mount();
  try {
    const filters = m.by('pitch-templates-filters');
    const chips = m.all().filter((n) => n.tagName === 'BUTTON' && m.pr(n)['aria-pressed'] === 'false');
    assert.equal(chips.length, 4 + 7 + 3, 'Stage, the seven audiences and Style');
    for (const c of chips) {
      assert.equal(m.pr(c)['aria-disabled'], 'true');
      assert.equal(m.pr(c).title, 'Not switched on yet.');
    }
    assert.match(m.text(filters), /Coming later$/);
    assert.match(m.text(m.by('pitch-templates-filter-audience')), /Angel Pre-seed fund Seed fund Series A fund Strategic Grant Other/);
    await m.press(m.by('pitch-templates-tab-yours'));
    const yours = m.by('pitch-templates-yours');
    assert.match(m.text(yours), /Not switched on yet\./);
    assert.doesNotMatch(m.text(yours), /No templates of yours yet/, 'an empty list is not claimed before the route exists');
    assert.equal(m.pr(m.by('pitch-templates-save-mine'))['aria-disabled'], 'true');
    assert.ok(!m.by('pitch-templates-gallery'));
  } finally { await m.close(); }
});

test('a failed methods read says so with Try again, and draws no tile', async () => {
  const m = await mount({ methods: async () => { throw new Error('synthetic'); } });
  try {
    assert.match(m.text(m.by('pitch-templates-error')), /The templates could not be read\. Try again/);
    assert.ok(!m.by('pitch-templates-gallery'));
  } finally { await m.close(); }
});

test('the route: lazy, behind the studio\'s boundary; the home\'s Browse templates opens it', () => {
  const app = read('frontend/src/App.jsx');
  assert.match(app, /const TemplatesGallery = lazy\(\(\) => import\('\.\/pages\/raise\/pitch\/TemplatesGallery'\)\);/);
  const at = app.indexOf('<Route path="/raise/pitch/templates"');
  assert.ok(at > 0);
  const route = app.slice(at, app.indexOf('/>)} />', at));
  assert.match(route, /labRoles\(\['admin', 'founder', 'advisor', 'partner', 'exploring'\]\)/);
  assert.match(route, /effectiveRole === 'exploring'\) && user\?\.spinout_lab_active !== 1\s*\? <PitchBoundary role=\{effectiveRole\} \/>/);
  const home = codeOnly(read(`${PITCH}/StudioHome.jsx`));
  assert.match(home, /\{ id: 'templates', label: 'Browse templates ›', line: 'Start from a template, by stage and audience', to: TEMPLATES_PATH \}/);
  // The gallery's own press is listed with its rail option.
  assert.match(read('frontend/src/lib/railOptions/founder.js'), /\[TEMPLATES, 'api\.deckApplyMethod\('\]/);
});

test('the Spin-Out demo day template says it writes a version at once, in the gallery and on New deck', async () => {
  // apply-method's axal_spinout_demoday branch copies Lab records, runs no model and answers { deck }, never a proposal.
  assert.match(read('cloudflare-worker/src/routes/decks.ts'), /if \(methodId === 'axal_spinout_demoday'\) \{[\s\S]*?const id = await insertVersion\(/);
  // Mutation checked: return USE_SENTENCE for every method → both asserts below fail.
  assert.equal(templateSentence('axal_spinout_demoday'), DIRECT_SENTENCE);
  assert.equal(DIRECT_SENTENCE, 'This template copies your Lab records into a new version straight away. No model runs. Your earlier versions stay.');
  assert.equal(templateSentence('yc_seed'), USE_SENTENCE);
  const m = await mount({
    methods: async () => ({ methods: [{ id: 'axal_spinout_demoday', label: 'Spin-Out demo day', slide_count: 14, locked: false, slides: [{ id: 's1', title: 'Cover' }] }] }),
    apply: async () => ({ deck: { id: 31, version: 6 }, method_id: 'axal_spinout_demoday' }),
  });
  try {
    await m.press(m.by('pitch-templates-tile-axal_spinout_demoday'));
    await m.press(m.by('pitch-templates-use'));
    assert.equal(m.text(m.by('pitch-templates-dialog-sentence')), DIRECT_SENTENCE, 'the gallery says what apply-method does');
    await m.press(m.by('pitch-templates-confirm'));
    assert.equal(m.text(m.by('landed')), '/raise/pitch/edit?project_id=1', 'the version it wrote, in the editor');
  } finally { await m.close(); }
  // New deck's dialog and line say the same, from the same words.
  // Mutation checked: put the literal proposal sentence back in NewDeck → this fails.
  const nd = codeOnly(read(`${PITCH}/NewDeck.jsx`));
  assert.match(nd, /sentence: templateSentence\(start\.id\)/);
  assert.match(nd, /\{templateStartLine\(start\.id\)\}/);
  assert.doesNotMatch(nd, /as a proposal beside your current version/, 'no literal sentence that is wrong for one template');
});

test('the gallery\'s refusal is the shared RefusalLine, and Gallery / Yours are pressed buttons, not an unfinished tab list', async () => {
  const src = codeOnly(read(`${PITCH}/TemplatesGallery.jsx`));
  // Mutation checked: render only refusal.message and refusal.topUp again → this fails.
  assert.match(src, /<RefusalLine refusal=\{refusal\} testId="pitch-templates-refusal" \/>/);
  assert.match(codeOnly(read(`${PITCH}/OneClickBuild.jsx`)), /export function RefusalLine\(/);
  // Mutation checked: put role="tab" back → this fails.
  assert.doesNotMatch(src, /role="tab(list|panel)?"/);
  const m = await mount({ apply: async () => { const e = new Error('Your balance is too low for this run.'); e.status = 402; e.code = 'insufficient_tokens'; throw e; } });
  try {
    assert.equal(m.pr(m.by('pitch-templates-tab-gallery'))['aria-pressed'], true);
    assert.equal(m.pr(m.by('pitch-templates-tab-yours'))['aria-pressed'], false);
    await m.press(m.by('pitch-templates-tile-yc_seed'));
    await m.press(m.by('pitch-templates-use'));
    await m.press(m.by('pitch-templates-confirm'));
    assert.match(m.text(m.by('pitch-templates-refusal')), /^Your balance is too low for this run\. Add tokens$/);
    await m.press(m.by('pitch-templates-tab-yours'));
    assert.equal(m.pr(m.by('pitch-templates-tab-yours'))['aria-pressed'], true);
  } finally { await m.close(); }
});

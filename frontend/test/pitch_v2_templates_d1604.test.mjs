// D1604 (#3716, pd29), wired to the template store by #3876 (pd29c, pd29s,
// pd29y) — the templates gallery at /raise/pitch/templates.
//
// What this file holds the gallery to:
//   · the Gallery is the template store's list (D1535), not v1's methods (Q5):
//     a cover per template on its swatch, "N cards" (never 0), stage, style;
//   · Stage, Audience (New deck's seven, from the store) and Style filter on the
//     Worker, one chip per group, pressing it again clears it;
//   · selecting a cover reads its cards for PREVIEW; Use this template writes a
//     proposal and lands on the shared review: nothing is saved before Accept;
//   · Yours lists the caller's own and saves the current version as one;
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
import { deckTemplatesApi } from '../src/lib/api/deckTemplates.js';
import TemplatesGallery from '../src/pages/raise/pitch/TemplatesGallery.jsx';
import {
  DIRECT_SENTENCE, NO_MATCH, STORE_SENTENCE, SWATCHES, TEMPLATES_PATH, USE_SENTENCE, previewTitles, storeTile, storeTiles, templateSentence, toggleFilter,
} from '../src/pages/raise/pitch/templatesModel.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const PITCH = 'frontend/src/pages/raise/pitch';

const FILTERS_READ = {
  stages: [{ key: 'pre_seed', label: 'Pre-seed' }, { key: 'seed', label: 'Seed' }, { key: 'series_a', label: 'Series A' }, { key: 'series_b_plus', label: 'Series B+' }],
  audiences: ['Angel', 'Pre-seed fund', 'Seed fund', 'Series A fund', 'Strategic', 'Grant', 'Other'].map((label, i) => ({ key: ['angel', 'pre_seed_fund', 'seed_fund', 'series_a_fund', 'strategic', 'grant', 'other'][i], label })),
  styles: [{ key: 'editorial', label: 'Editorial' }, { key: 'bold', label: 'Bold' }, { key: 'minimal', label: 'Minimal' }],
};
const META = [
  { uid: 'tpl_hq_pencil_margins', name: 'Pencil Margins', description: 'Hairlines and a serif.', stage: 'pre_seed', audience_tags: ['angel', 'seed_fund'], style: 'editorial', swatch: 'cream', card_count: 12 },
  { uid: 'tpl_hq_harbour_lights', name: 'Harbour Lights', description: null, stage: 'seed', audience_tags: ['angel'], style: 'bold', swatch: 'navy', card_count: 12, cover: { accent: '#F2C14E', display_font: 'Archivo' } },
];
const LIST = { templates: META, filters: FILTERS_READ };

test('store tiles: a cover on the swatch, counts never 0, labels from the store, accent and face only when valid', () => {
  const tiles = storeTiles(LIST);
  assert.deepEqual(tiles.map((t) => [t.id, t.label, t.count, t.stage, t.style]), [
    ['tpl_hq_pencil_margins', 'Pencil Margins', '12 cards', 'Pre-seed', 'Editorial'],
    ['tpl_hq_harbour_lights', 'Harbour Lights', '12 cards', 'Seed', 'Bold'],
  ]);
  assert.deepEqual(tiles[0].audiences, ['Angel', 'Seed fund']);
  assert.equal(tiles[0].cover.ground, SWATCHES.cream.ground);
  assert.equal(tiles[0].cover.accent, null, 'no accent is invented before the store gives one');
  assert.deepEqual([tiles[1].cover.accent, tiles[1].cover.font], ['#F2C14E', 'Archivo']);
  assert.equal(storeTile({ ...META[0], card_count: 0 }, FILTERS_READ).count, null, 'never "0 cards"');
  assert.equal(storeTile({ ...META[0], cover: { accent: 'red;x', display_font: 'x}{' } }, FILTERS_READ).cover.accent, null, 'a value that is not a hex never reaches a style');
  assert.equal(storeTile({ ...META[0], swatch: 'neon' }, FILTERS_READ).cover, null);
  assert.equal(storeTile({ name: 'No uid' }), null);
  assert.deepEqual(toggleFilter({ stage: null }, 'stage', 'seed'), { stage: 'seed' });
  assert.deepEqual(toggleFilter({ stage: 'seed' }, 'stage', 'seed'), { stage: null }, 'pressing the chosen chip clears it');
  assert.deepEqual(previewTitles({ cards: [{ title: 'Title' }, {}, { title: ' Problem ' }] }), ['Title', 'Card 2', 'Problem']);
  assert.equal(Object.keys(SWATCHES).length, 8);
  assert.equal(TEMPLATES_PATH, '/raise/pitch/templates');
});

const ORIGINAL = { api: { ...api }, tpl: { ...deckTemplatesApi } };
function Where() {
  const at = useLocation();
  return h('span', { 'data-testid': 'landed' }, `${at.pathname}${at.search}`);
}

async function mount(over = {}) {
  const calls = [];
  const stub = (obj, name, fn) => { obj[name] = (...a) => { calls.push([name, ...a]); return fn(...a); }; };
  stub(api, 'getMe', async () => null);
  stub(api, 'listProjects', async () => [{ id: 1, name: 'Synthetic venture' }]);
  stub(api, 'deckListVersions', over.versions || (async () => ({ versions: [{ id: 31, version: 3, is_current: true }] })));
  stub(deckTemplatesApi, 'templates', over.list || (async () => LIST));
  stub(deckTemplatesApi, 'myTemplates', over.mine || (async () => ({ templates: [] })));
  stub(deckTemplatesApi, 'template', async (uid) => ({ template: META.find((x) => x.uid === uid), cards: [{ title: 'Title' }, { title: 'Problem' }] }));
  stub(deckTemplatesApi, 'applyTemplate', over.apply || (async () => ({ proposal: { id: 55 }, template_id: 'tpl_hq_pencil_margins' })));
  stub(deckTemplatesApi, 'saveAsTemplate', over.save || (async () => ({ template: { uid: 'tpl_user_1', name: 'Mine' } })));
  stub(api, 'deckMethods', async () => { throw new Error('the gallery no longer reads v1 methods'); });
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
    async type(node, value) { await act(async () => { pr(node).onChange?.({ target: { value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); Object.assign(api, ORIGINAL.api); Object.assign(deckTemplatesApi, ORIGINAL.tpl); },
  };
}

test('the Gallery is the store: covers, PREVIEW from the template read, and Use this template lands on the review', async () => {
  const m = await mount();
  try {
    const gallery = m.by('pitch-templates-gallery');
    assert.match(m.text(gallery), /\[Venture name\] \[One-line pitch\] Pencil Margins 12 cards Pre-seed Editorial Angel/);
    assert.ok(!m.calls.some(([n]) => n === 'deckMethods'), 'v1 methods are not the Gallery (D1535 Q5)');
    await m.press(m.by('pitch-templates-tile-tpl_hq_pencil_margins'));
    assert.match(m.text(m.by('pitch-templates-preview')), /Preview · Pencil Margins Hairlines and a serif\. For: Angel, Seed fund 01 Title 02 Problem Use this template/);
    await m.press(m.by('pitch-templates-use'));
    assert.equal(m.text(m.by('pitch-templates-dialog-sentence')), STORE_SENTENCE, 'the store\'s apply runs no model, and says so');
    assert.match(STORE_SENTENCE, /No model runs\./);
    assert.equal(m.calls.filter(([n]) => n === 'applyTemplate').length, 0, 'nothing runs before Confirm');
    await m.press(m.by('pitch-templates-confirm'));
    assert.deepEqual(m.calls.find(([n]) => n === 'applyTemplate').slice(1), ['tpl_hq_pencil_margins', 1]);
    // Mutation checked: navigate to the editor instead → this lands on /raise/pitch/edit and fails.
    assert.equal(m.text(m.by('landed')), '/raise/pitch/new?project_id=1&proposal=55', 'the review, where nothing is saved before Accept');
  } finally { await m.close(); }
});

test('filters ask the Worker, one chip per group; pressing it again clears it; no match says so', async () => {
  let last = null;
  const m = await mount({ list: async (f) => { last = f; return f.stage === 'series_b_plus' ? { templates: [], filters: FILTERS_READ } : LIST; } });
  try {
    assert.match(m.text(m.by('pitch-templates-filter-audience')), /Angel Pre-seed fund Seed fund Series A fund Strategic Grant Other/);
    await m.press(m.by('pitch-templates-chip-stage-seed'));
    assert.deepEqual(last, { stage: 'seed', audience: null, style: null });
    assert.equal(m.pr(m.by('pitch-templates-chip-stage-seed'))['aria-pressed'], true);
    await m.press(m.by('pitch-templates-chip-style-bold'));
    assert.deepEqual(last, { stage: 'seed', audience: null, style: 'bold' });
    await m.press(m.by('pitch-templates-chip-stage-seed'));
    assert.deepEqual(last, { stage: null, audience: null, style: 'bold' }, 'pressing the chosen chip clears it');
    await m.press(m.by('pitch-templates-chip-stage-series_b_plus'));
    assert.equal(m.text(m.by('pitch-templates-gallery-empty')), NO_MATCH);
  } finally { await m.close(); }
});

test('Yours lists the caller\'s own and saves the current version under a name', async () => {
  const m = await mount();
  try {
    await m.press(m.by('pitch-templates-tab-yours'));
    assert.match(m.text(m.by('pitch-templates-mine-empty')), /No templates of yours yet\./);
    await m.press(m.by('pitch-templates-save-mine'));
    assert.ok(m.by('pitch-templates-save-dialog'));
    assert.equal(m.pr(m.by('pitch-templates-save-confirm')).disabled, true, 'a name first');
    await m.type(m.by('pitch-templates-save-name'), ' Synthetic house style ');
    await m.press(m.by('pitch-templates-save-confirm'));
    assert.deepEqual(m.calls.find(([n]) => n === 'saveAsTemplate').slice(1), [31, 'Synthetic house style'], 'the current version, the trimmed name');
    assert.equal(m.text(m.by('pitch-templates-saved')), 'Saved to Yours.');
    assert.ok(m.calls.filter(([n]) => n === 'myTemplates').length >= 2, 'Yours is read again');
  } finally { await m.close(); }
});

test('a venture with no deck yet cannot save, and says why', async () => {
  const m = await mount({ versions: async () => ({ versions: [] }) });
  try {
    await m.press(m.by('pitch-templates-tab-yours'));
    assert.equal(m.pr(m.by('pitch-templates-save-mine')).disabled, true);
    assert.match(m.text(m.by('pitch-templates-yours')), /Build a deck first/);
  } finally { await m.close(); }
});

test('a failed list read says so with Try again, and draws no tile', async () => {
  const m = await mount({ list: async () => { const e = new Error('synthetic'); e.status = 500; throw e; } });
  try {
    assert.match(m.text(m.by('pitch-templates-error')), /Try again/);
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
  // The store's apply runs no model, so the gallery presses no rail option; New deck's method start keeps it.
  const rail = read('frontend/src/lib/railOptions/founder.js');
  assert.match(rail, /at: \[\[NEW_DECK, 'api\.deckApplyMethod\('\]\],/);
  assert.doesNotMatch(rail, /TemplatesGallery/);
});

test('the gallery\'s refusal is the shared RefusalLine, and Gallery / Yours are pressed buttons, not an unfinished tab list', async () => {
  const src = codeOnly(read(`${PITCH}/TemplatesGallery.jsx`));
  assert.match(src, /<RefusalLine refusal=\{refusal\} testId="pitch-templates-refusal" \/>/);
  assert.doesNotMatch(src, /role="tab(list|panel)?"/);
  const m = await mount({ apply: async () => { const e = new Error('Only the venture\'s founders can start its deck.'); e.status = 403; e.code = 'forbidden'; throw e; } });
  try {
    await m.press(m.by('pitch-templates-tile-tpl_hq_pencil_margins'));
    await m.press(m.by('pitch-templates-use'));
    await m.press(m.by('pitch-templates-confirm'));
    assert.match(m.text(m.by('pitch-templates-refusal')), /^Only the venture's founders can start its deck\./);
  } finally { await m.close(); }
});

test('New deck keeps v1\'s methods and their sentences (D1535 Q5)', () => {
  assert.equal(templateSentence('axal_spinout_demoday'), DIRECT_SENTENCE);
  assert.equal(templateSentence('yc_seed'), USE_SENTENCE);
  const nd = codeOnly(read(`${PITCH}/NewDeck.jsx`));
  assert.match(nd, /sentence: templateSentence\(start\.id\)/);
  assert.match(nd, /\{templateStartLine\(start\.id\)\}/);
});

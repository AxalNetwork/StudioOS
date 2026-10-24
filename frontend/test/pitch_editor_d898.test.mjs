/**
 * D898 (#2676, part 4 of #2434) — the Pitch deck editor at /raise/pitch/edit.
 *
 *   · the model: what a save changes, layouts that carry a card's content and
 *     name what they drop, placement on the 12 × 6 grid, the standard sizes,
 *     stale cards, "Saved · …", a missing figure reading Not recorded;
 *   · the page, mounted on stubbed reads: the rail with its stale dot, the card
 *     on its blocks, notes, the save dialog listing what changes and the
 *     version it writes, a refused save showing the Worker's sentence;
 *   · each failed read says so and blanks nothing else;
 *   · an admin reads and writes nothing; the first-run callouts show once;
 *   · Add a block: a video link checked with the Worker, and a refused one;
 *   · a layout opens a dialog naming what leaves the card;
 *   · the page calls only mounted reads and draws no canvas sample.
 *
 * Every venture, card and figure is synthetic.
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
import { deckEditorApi } from '../src/lib/api/deckEditor.js';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';
import { AuthProvider } from '../src/hooks/useAuthSync.jsx';
import PitchEditor from '../src/pages/raise/pitch/PitchEditor.jsx';
import {
  CALLOUTS, FIRST_RUN_KEY, KIT_FAILED, NOT_RECORDED, READ_FAILED,
  addBlock, applyLayout, blockLabel, cardColours, changesOf, firstFree, firstRunSeen, keyMove, markFirstRunSeen, moveCard,
  placementProblem, saveState, standardSizes, staleCards, tileValue,
} from '../src/pages/raise/pitch/editorModel.js';

const h = React.createElement;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

/** GET /api/decks/model, in the Worker's shape (a subset of its twelve layouts). */
const MODEL = {
  grid: { cols: 12, rows: 6 }, max_blocks: 24, notes_max: 4000,
  layouts: [
    { id: 'statement', label: 'Statement', blocks: [{ kind: 'text', grid: { c1: 2, c2: 11, r1: 2, r2: 5 }, style: 'heading' }] },
    { id: 'chart_text', label: 'Chart + text', blocks: [{ kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading' }, { kind: 'chart', grid: { c1: 1, c2: 8, r1: 2, r2: 6 }, chart_type: 'line' }, { kind: 'text', grid: { c1: 9, c2: 12, r1: 2, r2: 6 }, style: 'list' }] },
    { id: 'title', label: 'Title', blocks: [{ kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 3 }, style: 'heading' }, { kind: 'text', grid: { c1: 1, c2: 12, r1: 4, r2: 4 }, style: 'paragraph' }] },
  ],
  block_kinds: ['text', 'chart', 'graphic', 'image', 'video', 'audio', 'link', 'metric'],
  chart_types: ['line'], chart_ranges: ['all'], text_styles: ['heading', 'paragraph', 'list'], image_tags: ['photo'],
  video_ratios: ['16:9', '9:16'], audiences: ['angel', 'seed_fund'], themes: ['brand', 'neutral_light', 'neutral_dark'],
};

const OLD_CARD = { title: 'Synthetic problem', fields: [{ key: 'problem_body', label: 'Problem', kind: 'paragraph', value: 'Synthetic pain', source: 'data' }] };
const GRID_CARD = {
  title: 'Synthetic traction', layout: 'title', notes: 'Synthetic note',
  blocks: [
    { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 3 }, style: 'heading', text: 'Synthetic heading' },
    { id: 'b2', kind: 'metric', grid: { c1: 1, c2: 3, r1: 5, r2: 6 }, label: 'Churn', value: null },
  ],
};
const DECK = { id: 31, project_id: 7, version: 3, title: 'Synthetic deck', created_at: '2026-10-24 10:00:00', audience: 'seed_fund', theme: null, slides: [OLD_CARD, GRID_CARD] };
const KIT = { project_id: 7, kit: { name: 'Synthetic Labs', palette: { bg: '#fbfaf7', ink: '#0f2a3d', accent: '#2bb39a', secondary: null }, fonts: 'Outfit + Space Grotesk', voice: ['plain'], logo: { light: null, dark: null, inline: false }, updated_at: null } };
const REFRESH = { deck_id: 31, version: 3, checked: 1, stale: 1, rows: [{ slide: 1, field: 'block:1', source_key: 'revenue.mrr', bound: { as_of: '2026-10-01' }, state: 'stale', current: null }] };
const SOURCES = { project_id: 7, items: [{ source_key: 'revenue.mrr', area: 'grow', label: 'MRR', value: 4200, unit: 'usd', as_of: '2026-10-01', grade: 'Measured', source: 'Connector', state: 'recorded', record_ref: 'synthetic:1', snapshot_hash: 'a1b2c3d4e5f6a1b2c3d4e5f6' }], coverage: { slots: 1, filled: 1, by_grade: {}, not_recorded: 0, unreadable: 0 } };

const FOUNDER = { id: 2, role: 'founder', founder_id: 20, name: 'Synthetic Founder' };
const ADMIN = { id: 21, role: 'admin', name: 'Synthetic Admin' };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('what a save changes, card by card, and for the whole version', () => {
  const base = { cards: [OLD_CARD, GRID_CARD], theme: null, audience: 'seed_fund' };
  assert.deepEqual(changesOf(base, base, MODEL), [], 'nothing changed is nothing to save');
  assert.deepEqual(changesOf(base, { ...base, cards: moveCard(base.cards, 0, 1) }, MODEL), ['The cards are in a new order.']);
  const noted = { ...base, cards: [OLD_CARD, { ...GRID_CARD, notes: 'Synthetic new note' }] };
  assert.deepEqual(changesOf(base, noted, MODEL), ['Card 2, Synthetic traction: the speaker notes change.']);
  const added = addBlock(GRID_CARD, { kind: 'text', grid: { c1: 7, c2: 12, r1: 5, r2: 5 }, text: 'x' }, MODEL).card;
  assert.deepEqual(changesOf(base, { ...base, cards: [OLD_CARD, added] }, MODEL), ['Card 2, Synthetic traction: adds a 6 × 1 text.']);
  const relaid = applyLayout(GRID_CARD, MODEL.layouts[1]).card;
  const said = changesOf(base, { ...base, cards: [OLD_CARD, relaid] }, MODEL);
  assert.ok(said.includes('Card 2, Synthetic traction: the layout becomes Chart + text.'), said.join(' | '));
  assert.deepEqual(changesOf(base, { ...base, theme: { kind: 'neutral_dark', background: null }, audience: 'angel' }, MODEL),
    ['The theme becomes Neutral dark.', 'The audience becomes Angel.']);
  assert.deepEqual(changesOf(base, { ...base, cards: [OLD_CARD, { ...OLD_CARD, title: 'Synthetic retitled' }] }, MODEL).slice(-1), ['Card 2, Synthetic retitled: its words change.']);
});

test('a layout carries what the card says, kind by kind, and names what leaves', () => {
  const { card, dropped } = applyLayout(GRID_CARD, MODEL.layouts[1]);
  assert.equal(card.layout, 'chart_text');
  assert.deepEqual(card.blocks.map((b) => [b.kind, b.grid.c1, b.grid.r1]), [['text', 1, 1], ['chart', 1, 2], ['text', 9, 2]]);
  assert.equal(card.blocks[0].text, 'Synthetic heading', 'the first text keeps the first text');
  assert.deepEqual(dropped.map(blockLabel), ['3 × 2 metric tile'], 'the tile has no place in Chart + text');
  assert.equal(GRID_CARD.blocks.length, 2, 'the card it was given is not mutated');
});

test('placement on the 12 × 6 grid, the standard sizes, the first free range', () => {
  assert.match(placementProblem(GRID_CARD, { c1: 1, c2: 13, r1: 1, r2: 1 }, MODEL), /12 × 6 grid/);
  assert.match(placementProblem(GRID_CARD, { c1: 3, c2: 1, r1: 1, r2: 1 }, MODEL), /12 × 6 grid/);
  assert.match(placementProblem(GRID_CARD, { c1: 2, c2: 4, r1: 3, r2: 4 }, MODEL), /overlaps the 12 × 2 text/);
  assert.equal(placementProblem(GRID_CARD, { c1: 4, c2: 12, r1: 5, r2: 6 }, MODEL), null);
  const full = { blocks: Array.from({ length: 24 }, (_, i) => ({ id: `x${i}`, kind: 'text', grid: { c1: (i % 12) + 1, c2: (i % 12) + 1, r1: Math.floor(i / 12) + 1, r2: Math.floor(i / 12) + 1 } })) };
  assert.match(placementProblem(full, { c1: 1, c2: 1, r1: 6, r2: 6 }, MODEL), /at most 24 blocks/);
  const v = standardSizes('video');
  assert.deepEqual(v.find((s) => s.label === '16:9'), { label: '16:9', cols: 4, rows: 2 }, 'a 16:9 video is twice as many columns as rows');
  assert.ok(v.some((s) => s.label === '9:16'));
  assert.deepEqual(standardSizes('graphic').map((s) => [s.cols, s.rows]), [[1, 1], [2, 2]]);
  assert.deepEqual(firstFree(GRID_CARD, 6, 1, MODEL), { c1: 1, c2: 6, r1: 1, r2: 1 });
  assert.deepEqual(firstFree(GRID_CARD, 12, 2, MODEL), null, 'no free 12 × 2 range');
  assert.equal(addBlock(GRID_CARD, { kind: 'text', grid: { c1: 1, c2: 12, r1: 2, r2: 2 } }, MODEL).error.startsWith('It overlaps'), true);
});

test('stale cards, Saved · …, a missing figure, the colours, the keys and the first run', () => {
  assert.deepEqual([...staleCards(REFRESH)], [1]);
  assert.deepEqual([...staleCards({ rows: [{ slide: 0, state: 'fresh' }, { slide: 2, state: 'unknown' }, { slide: 3, state: 'gone' }] })], [3]);
  assert.deepEqual([...staleCards(null)], []);
  const now = Date.parse('2026-10-24T10:02:00Z');
  assert.equal(saveState({ dirty: false, savedAt: '2026-10-24 10:00:00', now, version: 3 }), 'Saved · 2 min ago', 'a D1 stamp is UTC');
  assert.equal(saveState({ dirty: true, savedAt: '2026-10-24 10:00:00', now }), 'Unsaved changes');
  assert.equal(saveState({ readOnly: true, version: 3 }), 'Read only · v3');
  assert.equal(saveState({ dirty: false, savedAt: null, version: 3 }), 'Saved · v3');
  assert.equal(tileValue({ value: null }), NOT_RECORDED);
  assert.equal(tileValue({ value: '' }), NOT_RECORDED);
  assert.equal(tileValue({ value: '0' }), '0', 'a recorded zero is a zero');
  assert.equal(cardColours(null, KIT.kit).bg, '#fbfaf7');
  assert.equal(cardColours({ kind: 'neutral_dark' }, KIT.kit).bg, '#111827');
  assert.equal(cardColours(null, null).bg, '#ffffff', 'no kit is neutral light');
  assert.equal(keyMove('ArrowUp', 0, 3), null);
  assert.equal(keyMove('ArrowDown', 0, 3), 1);
  const store = new Map();
  const ok = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(firstRunSeen(ok), false);
  markFirstRunSeen(ok);
  assert.equal(firstRunSeen(ok), true);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(firstRunSeen(blocked), false, 'blocked storage reads as not seen');
  assert.doesNotThrow(() => markFirstRunSeen(blocked));
});

/* ------------------------------------------------------------------ *
 * The page, mounted
 * ------------------------------------------------------------------ */

const ORIGINAL = { api: { ...api }, editor: { ...deckEditorApi }, sources: { ...deckSourcesApi } };

async function mount(answers, user = FOUNDER, { seen = true } = {}) {
  const calls = [];
  const stub = (name, fn) => (...a) => { calls.push([name, ...a]); return fn(...a); };
  const reads = {
    listProjects: async () => [{ id: 7, name: 'Synthetic Labs' }],
    deckListVersions: async () => ({ versions: [{ id: 31, version: 3, is_current: true }] }),
    deckGet: async () => DECK,
    'editor.model': async () => MODEL,
    'editor.brandKit': async () => KIT,
    'sources.refresh': async () => REFRESH,
    'sources.list': async () => SOURCES,
    getMe: async () => user,
    ...answers,
  };
  for (const [name, fn] of Object.entries(reads)) {
    if (name.startsWith('editor.')) deckEditorApi[name.slice(7)] = stub(name, fn);
    else if (name.startsWith('sources.')) deckSourcesApi[name.slice(8)] = stub(name, fn);
    else api[name] = stub(name, fn);
  }
  const restore = installDocument();
  localStorage.setItem('user', JSON.stringify(user));
  if (seen) localStorage.setItem(FIRST_RUN_KEY, '1');
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); n.focus = () => { document.activeElement = n; }; return n; };
  const container = document.createElement('div'); document.body.appendChild(container);
  const rootEl = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { rootEl.render(h(MemoryRouter, { initialEntries: ['/raise/pitch/edit?project_id=7'] }, h(AuthProvider, null, h(PitchEditor)))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    calls, by, settle, pr,
    text: (n = container) => text(n).replace(/\s+/g, ' '),
    async press(node) { await act(async () => { await pr(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(node, value) { await act(async () => { pr(node).onChange?.({ target: { value } }); }); await settle(); },
    async unmount() {
      await act(async () => rootEl.unmount()); restore();
      Object.assign(api, ORIGINAL.api); Object.assign(deckEditorApi, ORIGINAL.editor); Object.assign(deckSourcesApi, ORIGINAL.sources);
    },
  };
}

test('the editor draws the rail with its stale dot, the card on its blocks, and saves a version that keeps the notes', async () => {
  let saved = null;
  const m = await mount({ deckUpdate: async (id, body) => { saved = { id, body }; return { ...DECK, id: 32, version: 4, slides: body.slides, created_at: '2026-10-24 10:05:00' }; } });
  try {
    assert.match(m.text(m.by('pitch-editor-rail')), /01 Synthetic problem.*02 Synthetic traction/);
    assert.ok(m.by('pitch-editor-stale-1'), 'card 2 has a figure its store moved past');
    assert.ok(!m.by('pitch-editor-stale-0'));
    assert.match(m.text(m.by('pitch-editor-card')), /Synthetic pain/, 'a card from before D898 draws its fields');
    assert.match(m.text(m.by('pitch-editor-bar')), /Synthetic Labs · v3.*Seed fund/);
    assert.equal(m.pr(m.by('pitch-editor-save')).disabled, true, 'nothing to save yet');
    await m.press(m.by('pitch-editor-rail-1'));
    assert.match(m.text(m.by('pitch-editor-card')), /Synthetic heading/);
    assert.match(m.text(m.by('pitch-editor-block-b2')), new RegExp(`Churn ${NOT_RECORDED}`), 'a tile with no figure reads Not recorded');
    await m.type(m.by('pitch-editor-notes'), 'Synthetic revised note');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
    await m.press(m.by('pitch-editor-save'));
    assert.match(m.text(m.by('pitch-editor-save-changes')), /Card 2, Synthetic traction: the speaker notes change\./, 'the dialog says what changes');
    assert.equal(saved, null, 'opening the dialog writes nothing');
    await m.press(m.by('pitch-editor-save-run'));
    assert.equal(saved.id, 31);
    assert.equal(saved.body.slides[1].notes, 'Synthetic revised note');
    assert.deepEqual(saved.body.slides[1].blocks, GRID_CARD.blocks, 'the blocks go back whole');
    assert.equal(saved.body.audience, 'seed_fund');
    assert.ok(!m.by('pitch-editor-save-dialog'), 'the dialog closes on success');
  } finally { await m.unmount(); }
});

test('a refused save shows the Worker\'s sentence and keeps the changes', async () => {
  const m = await mount({ deckUpdate: async () => { throw new Error('Card 2, block 1: it overlaps another block.'); } });
  try {
    await m.type(m.by('pitch-editor-notes'), 'Synthetic note');
    await m.press(m.by('pitch-editor-save'));
    await m.press(m.by('pitch-editor-save-run'));
    assert.match(m.text(m.by('pitch-editor-save-error')), /it overlaps another block/);
    assert.ok(m.by('pitch-editor-save-dialog'), 'the dialog stays open');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
  } finally { await m.unmount(); }
});

test('each failed read says so and blanks nothing else', async () => {
  const fail = async () => { throw new Error('synthetic failure'); };
  let m = await mount({ deckGet: fail });
  try {
    assert.match(m.text(m.by('pitch-editor-deck-error')), new RegExp(READ_FAILED));
    assert.match(m.text(m.by('pitch-editor-deck-error')), /Try again/);
  } finally { await m.unmount(); }
  m = await mount({ 'editor.brandKit': fail, 'sources.refresh': fail });
  try {
    assert.ok(m.by('pitch-editor-card'), 'the card still draws');
    assert.match(m.text(), new RegExp(KIT_FAILED.slice(0, 30)));
    assert.ok(m.by('pitch-editor-refresh-error'), 'the stale read says it failed');
    assert.ok(!m.by('pitch-editor-stale-1'), 'and no dot is guessed');
  } finally { await m.unmount(); }
  m = await mount({ 'editor.model': fail });
  try { assert.ok(m.by('pitch-editor-model-error')); } finally { await m.unmount(); }
});

test('an admin reads the deck and writes nothing', async () => {
  const m = await mount({}, ADMIN);
  try {
    assert.ok(!m.by('pitch-editor-save'), 'no Save');
    assert.ok(!m.by('pitch-editor-add-block'), 'no Add a block');
    assert.ok(!m.by('pitch-editor-add-card'));
    assert.match(m.text(m.by('pitch-editor-save-state')), /Read only · v3/);
    assert.match(m.text(m.by('pitch-editor-bar')), /Leave a note/);
    assert.equal(m.pr(m.by('pitch-editor-notes')).readOnly, true);
  } finally { await m.unmount(); }
});

test('the first-run callouts show once', async () => {
  const m = await mount({}, FOUNDER, { seen: false });
  try {
    const box = m.by('pitch-editor-callouts');
    assert.ok(box);
    for (const k of CALLOUTS) assert.match(m.text(box), new RegExp(k.t));
    const gotIt = (function find(n) { return n && (m.pr(n).onClick && /Got it/.test(m.text(n)) ? n : (n.childNodes || []).map(find).find(Boolean)); })(box);
    await m.press(gotIt);
    assert.ok(!m.by('pitch-editor-callouts'));
    assert.equal(localStorage.getItem(FIRST_RUN_KEY), '1');
  } finally { await m.unmount(); }
});

test('Add a block: a video link is checked with the Worker before it is placed; a refused one says why', async () => {
  const m = await mount({
    'editor.videoLink': async (url) => (url.includes('youtu')
      ? { state: 'ok', provider: 'youtube', video_id: 'AbCdEfGhIjK', url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK', title: 'Synthetic demo', poster_url: 'https://i.ytimg.com/vi/AbCdEfGhIjK/hqdefault.jpg' }
      : Promise.reject(new Error('Paste a YouTube or Vimeo link.'))),
  });
  try {
    await m.press(m.by('pitch-editor-rail-1'));
    await m.press(m.by('pitch-editor-add-block'));
    await m.press(m.by('pitch-editor-kind-video'));
    assert.equal(m.pr(m.by('pitch-editor-add-run')).disabled, true, 'nothing to add before the check');
    await m.type(m.by('pitch-editor-video-url'), 'https://example.com/v.mp4');
    await m.press(m.by('pitch-editor-video-check'));
    assert.match(m.text(m.by('pitch-editor-video-error')), /YouTube or Vimeo/);
    await m.type(m.by('pitch-editor-video-url'), 'https://youtu.be/AbCdEfGhIjK');
    await m.press(m.by('pitch-editor-video-check'));
    assert.match(m.text(m.by('pitch-editor-video-ok')), /Synthetic demo · YouTube/);
    assert.match(m.text(m.by('pitch-editor-add-says')), /Adds a 4 × 2 video link at column \d+, row \d+/);
    await m.press(m.by('pitch-editor-add-run'));
    assert.ok(!m.by('pitch-editor-add-dialog'));
    assert.match(m.text(m.by('pitch-editor-card')), /Synthetic demo/);
    await m.press(m.by('pitch-editor-save'));
    assert.match(m.text(m.by('pitch-editor-save-changes')), /adds a 4 × 2 video link/);
  } finally { await m.unmount(); }
});

test('a layout opens a dialog naming what leaves the card, and nothing changes until it is confirmed', async () => {
  const m = await mount({});
  try {
    await m.press(m.by('pitch-editor-rail-1'));
    await m.press(m.by('pitch-editor-tab-design'));
    await m.press(m.by('pitch-editor-layout-chart_text'));
    const dialog = m.by('pitch-editor-layout-dialog');
    assert.match(m.text(dialog), /no place for: 3 × 2 metric tile/);
    assert.ok(m.by('pitch-editor-block-b2'), 'the tile is still on the card');
    await m.press(m.by('pitch-editor-layout-dialog-confirm'));
    assert.doesNotMatch(m.text(m.by('pitch-editor-card')), /Churn/, 'the tile left the card');
    assert.match(m.text(m.by('pitch-editor-card')), /Synthetic heading/, 'the heading moved with it');
    assert.match(m.text(m.by('pitch-editor-save-state')), /Unsaved changes/);
  } finally { await m.unmount(); }
});

test('the editor calls only mounted reads, is mounted at /raise/pitch/edit, and draws no canvas sample', () => {
  const src = read('frontend/src/pages/raise/pitch/PitchEditor.jsx');
  for (const call of ['api.listProjects()', 'api.deckListVersions(', 'api.deckGet(', 'deckEditorApi.model()', 'deckEditorApi.brandKit(', 'deckSourcesApi.refresh(', 'api.deckUpdate(', 'deckEditorApi.videoLink(']) {
    assert.ok(src.includes(call), call);
  }
  for (const sample of ['Northwind', '[$', '16,950', '[12 Oct]', 'FLUX']) assert.ok(!src.includes(sample), `a canvas sample reached the page: ${sample}`);
  assert.ok(!/window\.(confirm|alert|prompt)\(/.test(src), 'no browser pop-up');
  const worker = read('cloudflare-worker/src/routes/decks.ts');
  const at = (p) => worker.indexOf(`decks.get('${p}'`);
  for (const p of ['/model', '/video-link', '/brand-kit']) assert.ok(at(p) > 0 && at(p) < at('/:id'), `${p} is registered before /:id`);
});

/**
 * D1112 (#2992, part of #2434) — the frontend half of the Pitch deck gaps S1's
 * check confirmed on D894:
 *
 *   1. PD2: "New in your data since vN", from D896's refresh read, with
 *      "Refresh the deck"; the versions table's Shared links column, its
 *      Audience filter and its Sort control;
 *   2. D898's blocks drawn outside the editor: Present, and the print page
 *      the PDF and PowerPoint exports photograph;
 *   3. PD17: "Include speaker notes" and "Include a Sources appendix" for every
 *      format the dialog offers.
 *
 * Mounted on stubbed module clients; React props read through `__reactProps$`.
 * Every venture and figure is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_deck_gaps_d1112.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { api } from '../src/lib/api.js';
import { deckSourcesApi } from '../src/lib/api/deckSources.js';
import { newDeckApi } from '../src/lib/api/newDeck.js';
import { StudioDecks } from '../src/pages/raise/pitch/PitchStudio.jsx';
import PitchPresent from '../src/pages/raise/pitch/PitchPresent.jsx';
import ExportDialog from '../src/pages/raise/pitch/ExportDialog.jsx';
import PitchDeckPrintPage from '../src/pages/PitchDeckPrintPage.jsx';
import {
  NOTHING_BOUND, REFRESH_THE_DECK, SHARED_LINKS_UNREAD, audienceOptions, newInData, versionRows,
} from '../src/pages/raise/pitch/pitchStudioModel.js';
import { cardOf, chartLabel, gridBlocks, optionsApply } from '../src/pages/raise/pitch/presentExportModel.js';
import { NOTES_PER_PAGE, notesPages } from '../src/pages/raise/pitch/PrintExtras.jsx';

const h = React.createElement;

const BINDING = { source_key: 'validate.interviews', as_of: '2026-10-12', grade: 'Measured', snapshot_hash: 'a'.repeat(64) };
const BLOCKS = [
  { id: 'h', kind: 'text', style: 'heading', text: 'Why we win', grid: { c1: 1, c2: 12, r1: 1, r2: 1 } },
  { id: 'm1', kind: 'metric', label: 'Interviews', value: '42', grid: { c1: 1, c2: 3, r1: 2, r2: 3 }, binding: BINDING },
  { id: 'm2', kind: 'metric', label: 'Paying customers', value: null, grid: { c1: 4, c2: 6, r1: 2, r2: 3 } },
  { id: 'c', kind: 'chart', chart_type: 'ranked_bars', series: [{ label: 'Signups', points: [{ x: 'Jan', y: 4 }] }], grid: { c1: 7, c2: 12, r1: 2, r2: 4 } },
  { id: 'v', kind: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc', title: 'Demo', grid: { c1: 1, c2: 4, r1: 4, r2: 5 } },
  { id: 'l', kind: 'link', url: 'https://example.test/data-room', label: 'Data room', grid: { c1: 5, c2: 7, r1: 5, r2: 5 } },
  { id: 'bad', kind: 'text', text: 'Off the grid', grid: { c1: 1 } },
];
const SLIDES = [
  { title: 'Traction', fields: [{ key: 'p', label: 'Pitch', kind: 'paragraph', value: 'We close books in a day.' }], notes: 'Lead with the pilots.' },
  { title: 'Grid', blocks: BLOCKS, notes: 'Point at the tile.' },
  { title: 'Ask', fields: [{ key: 'a', label: 'Ask', kind: 'paragraph', value: 'Raising $2M' }] },
];
const VERSIONS = [
  { id: 40, version: 4, title: 'Seed', audience: 'seed_fund', is_current: 1, created_at: '2026-10-20 10:00:00', shared_links: 3 },
  { id: 39, version: 3, title: 'Seed', audience: 'seed_fund', created_at: '2026-10-02 10:00:00', shared_links: 0 },
  { id: 38, version: 2, title: 'Angel', audience: 'angel', created_at: '2026-08-14 10:00:00', shared_links: 1 },
  { id: 37, version: 1, title: 'Old', audience: null, created_at: '2026-06-03 10:00:00', shared_links: null },
];
const REFRESH = {
  deck_id: 40, version: 4, checked: 5, stale: 2, rows: [
    { slide: 0, source_key: 'validate.interviews', state: 'stale', bound: { as_of: '2026-10-01' }, current: { label: 'Interviews', module: 'Customer interviews', as_of: '2026-10-18' } },
    { slide: 1, source_key: 'validate.interviews', state: 'stale', bound: { as_of: '2026-10-01' }, current: { label: 'Interviews', module: 'Customer interviews', as_of: '2026-10-18' } },
    { slide: 1, source_key: 'build.releases_90d', state: 'gone', bound: { as_of: '2026-09-01' }, current: null },
    { slide: 2, source_key: 'raise.mrr', state: 'fresh', bound: {}, current: { label: 'MRR' } },
    { slide: 2, source_key: 'raise.runway', state: 'unknown', bound: {}, current: null },
  ],
};

// ─────────────────────────────────────────────────────────────── mounting

const ORIGINAL = { api: { ...api }, sources: { ...deckSourcesApi }, newDeck: { ...newDeckApi } };
async function mount(element, url = '/raise/pitch?project_id=7', path = null) {
  const restore = installDocument();
  globalThis.matchMedia ||= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  if (!window.matchMedia) window.matchMedia = globalThis.matchMedia;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const settle = () => act(async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  const tree = path ? h(Routes, null, h(Route, { path, element })) : element;
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, tree)); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const text = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(text).join(' ') : n.textContent || '');
  return {
    by, pr, settle,
    has: (id) => Boolean(by(id)),
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n).replace(/\s+/g, ' ').trim(); },
    text: () => text(container).replace(/\s+/g, ' '),
    all: () => walk(container),
    async press(n) { await act(async () => { await pr(n).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async change(id, value) { await act(async () => { pr(by(id)).onChange({ target: { value, checked: value } }); }); await settle(); },
    async unmount() {
      await act(async () => root.unmount()); restore();
      Object.assign(api, ORIGINAL.api); Object.assign(deckSourcesApi, ORIGINAL.sources); Object.assign(newDeckApi, ORIGINAL.newDeck);
    },
  };
}

const ok = (data) => ({ status: 'ok', data });
const reads = (over = {}) => ({
  projects: ok([{ id: 7, name: 'Acme' }]), project: { id: 7, name: 'Acme' }, requested: '7',
  versions: ok({ versions: VERSIONS }), module: ok({ card: { state: 'empty', empty: { kind: 'no_views' } } }),
  deck: ok({ id: 40, version: 4, slides: SLIDES }), engagement: ok({ views: [], shares: [] }),
  setPage() {}, reload() {}, ...over,
});
function studioStubs(refresh) {
  newDeckApi.quote = async () => null;
  deckSourcesApi.list = async () => ({ items: [], coverage: null });
  const asked = [];
  deckSourcesApi.refresh = async (id) => { asked.push(id); return refresh(); };
  return asked;
}

// ─────────────────────────────────────────────────────────────── the model

test('the model: new in your data, the versions filter, sort and links, the blocks a card draws, the options', () => {
  const v = newInData(REFRESH);
  assert.deepEqual(v.items.map((i) => [i.key, i.t, i.v]), [
    ['validate.interviews', 'Interviews changed · Customer interviews', '18 Oct'],
    ['build.releases_90d', 'build.releases_90d is no longer recorded', 'was 1 Sept'],
  ], 'stale and gone, each once; a fresh figure is not new');
  assert.equal(v.unknown, 1, 'a figure that could not be read is counted apart, never as new');
  assert.equal(newInData({ checked: 0, rows: [] }).checked, 0);

  assert.deepEqual(versionRows(VERSIONS).map((r) => [r.label, r.links]), [['v4', '3'], ['v3', '0'], ['v2', '1'], ['v1', SHARED_LINKS_UNREAD]], 'a count not read is "Not read", never 0');
  assert.deepEqual(versionRows(VERSIONS, { sort: 'oldest' }).map((r) => r.label), ['v1', 'v2', 'v3', 'v4']);
  assert.deepEqual(versionRows(VERSIONS, { audience: 'seed_fund' }).map((r) => r.label), ['v4', 'v3']);
  assert.deepEqual(versionRows(VERSIONS, { audience: 'none' }).map((r) => r.label), ['v1']);
  assert.deepEqual(audienceOptions(VERSIONS).map((o) => o.t), ['All', 'Angel', 'Seed fund', 'Not recorded']);

  assert.deepEqual(gridBlocks(SLIDES[1]).map((b) => b.id), ['h', 'm1', 'm2', 'c', 'v', 'l'], 'a block with no whole range is not drawn');
  assert.equal(cardOf(SLIDES[1], 1).blocks.length, 6);
  assert.equal(cardOf(SLIDES[1], 1).empty, false, 'a card of blocks is not empty');
  assert.deepEqual(cardOf(SLIDES[0], 0).blocks, []);
  assert.equal(chartLabel('ranked_bars'), 'Ranked bars');
  assert.ok(['pdf', 'pptx', 'html'].every(optionsApply));

  const pages = notesPages(Array.from({ length: NOTES_PER_PAGE + 1 }, (_, i) => ({ title: `C${i}`, notes: i ? 'Say this.' : '' })));
  assert.equal(pages.length, 2);
  assert.equal(pages[0][0].notes, null, 'a card with no notes says so on the page');
});

test('PD2 mounted: New in your data since v4, Refresh the deck, a failed read, and nothing to compare', async () => {
  const asked = studioStubs(async () => REFRESH);
  let v = await mount(h(StudioDecks, { reads: reads(), readOnly: false, q: '?project_id=7' }));
  try {
    assert.deepEqual(asked, [40], 'the current version is compared');
    assert.match(v.of('pitch-studio-new-data'), /New in your data since v4/);
    assert.match(v.of('pitch-studio-new-data-validate.interviews'), /Interviews changed · Customer interviews 18 Oct/);
    assert.match(v.of('pitch-studio-new-data-build.releases_90d'), /no longer recorded/);
    assert.match(v.of('pitch-studio-new-data'), /1 figure could not be read for you/);
    assert.ok(!v.has('pitch-studio-new-data-raise.mrr'), 'a fresh figure is not listed');
    const refresh = v.by('pitch-studio-refresh-deck');
    assert.equal(v.pr(refresh).href, '/raise/pitch/edit?project_id=7');
    assert.match(v.of('pitch-studio-refresh-deck'), new RegExp(REFRESH_THE_DECK.replace('›', '.')));
  } finally { await v.unmount(); }

  studioStubs(async () => { throw new Error('down'); });
  v = await mount(h(StudioDecks, { reads: reads(), readOnly: false, q: '?project_id=7' }));
  try {
    assert.match(v.of('pitch-studio-new-data'), /could not be read. That is not the same as nothing. Try again/);
    assert.ok(!v.has('pitch-studio-refresh-deck'));
  } finally { await v.unmount(); }

  studioStubs(async () => ({ checked: 0, rows: [] }));
  v = await mount(h(StudioDecks, { reads: reads(), readOnly: false, q: '?project_id=7' }));
  try { assert.equal(v.of('pitch-studio-new-data-unbound'), NOTHING_BOUND); } finally { await v.unmount(); }

  studioStubs(async () => ({ checked: 2, rows: [{ source_key: 'x', state: 'fresh' }] }));
  v = await mount(h(StudioDecks, { reads: reads(), readOnly: false, q: '?project_id=7' }));
  try { assert.match(v.of('pitch-studio-new-data-none'), /Nothing in your data has changed since v4/); } finally { await v.unmount(); }
});

test('PD2 mounted: the versions table\'s Shared links, its Audience filter and its Sort control', async () => {
  studioStubs(async () => REFRESH);
  const v = await mount(h(StudioDecks, { reads: reads(), readOnly: false, q: '?project_id=7' }));
  try {
    // D1604 (#3716, pd1): the table is ⋯ › Versions… on the home's deck card, no longer on the home itself.
    assert.ok(!v.has('pitch-studio-versions'), 'the home draws no versions table');
    await v.press(v.by('pitch-studio-more-open'));
    await v.press(v.by('pitch-studio-more-versions'));
    assert.ok(v.has('pitch-sheet-versions'), 'the sheet opens');
    assert.match(v.of('pitch-studio-versions'), /Shared links/);
    assert.equal(v.of('pitch-studio-version-links-40'), '3');
    assert.equal(v.of('pitch-studio-version-links-39'), '0');
    assert.equal(v.of('pitch-studio-version-links-37'), SHARED_LINKS_UNREAD);
    const order = () => v.all().filter((n) => /^pitch-studio-version-\d+$/.test(v.pr(n)['data-testid'] || '')).map((n) => v.pr(n)['data-testid'].slice(-2));
    assert.deepEqual(order(), ['40', '39', '38', '37']);
    await v.change('pitch-studio-versions-sort', 'oldest');
    assert.deepEqual(order(), ['37', '38', '39', '40']);
    await v.change('pitch-studio-versions-audience', 'angel');
    assert.deepEqual(order(), ['38']);
  } finally { await v.unmount(); }
});

test('Present mounted: a grid card draws its blocks, with live links and the tiles\' sources', async () => {
  // The grid card first, so it is the card on screen.
  api.deckGet = async () => ({ id: 40, version: 4, slides: [SLIDES[1], SLIDES[0]] });
  api.deckListVersions = async () => ({ versions: VERSIONS });
  const v = await mount(h(PitchPresent), '/raise/pitch/present?project_id=7&deck=40');
  try {
    assert.ok(v.has('pitch-present-blocks'), 'the grid is drawn');
    assert.ok(v.has('deck-block-h') && v.has('deck-block-c'));
    assert.match(v.of('deck-block-h'), /Why we win/);
    assert.match(v.of('deck-block-metric-m1'), /Interviews 42/);
    assert.match(v.of('deck-block-metric-m2'), /Paying customers Not recorded/, 'a tile with no figure is not 0');
    assert.match(v.of('deck-block-c'), /Ranked bars chart Signups ?: Jan 4/);
    const links = v.all().filter((n) => n.tagName === 'A' && /^https:/.test(v.pr(n).href || ''));
    assert.deepEqual(links.map((n) => v.pr(n).href).sort(), ['https://example.test/data-room', 'https://www.youtube.com/watch?v=abc']);
    assert.ok(links.every((n) => v.pr(n).target === '_blank' && /noopener/.test(v.pr(n).rel)));
    assert.ok(!v.has('deck-block-bad'), 'a block off the grid is not drawn');
    assert.doesNotMatch(v.of('deck-block-metric-m1'), /Source:/, 'sources off by default');
    await v.press(v.by('pitch-present-sources'));
    assert.match(v.of('deck-block-metric-m1'), /Source: Validate · Measured · 12 Oct/);
    assert.match(v.of('deck-block-metric-m2'), /Source: Not recorded/);
  } finally { await v.unmount(); }
});

test('the print page: grid cards, the notes pages and the Sources appendix, only when the export asked', async () => {
  const deck = (over = {}) => ({ id: 40, version: 4, title: 'Seed', slides: SLIDES, ...over });
  const appendix = { lines: [{ card: 2, title: 'Grid', figure: 'Interviews', line: 'Customer interviews · Measured · as of 2026-10-12' }], ai: [] };
  api.deckPrintExportRead = async () => deck({ export_options: { notes: true, sources: true }, sources_appendix: appendix, slides: SLIDES.map((s) => ({ ...s, notes: s.notes || null })) });
  let v = await mount(h(PitchDeckPrintPage, { exportMode: true }), '/deck/print-export/tok?print_mode=pdf', '/deck/print-export/:token');
  try {
    assert.equal(v.by('print-card-1') && v.pr(v.by('print-card-1'))['data-layout'], 'grid');
    assert.match(v.of('print-blocks-1'), /Why we win/);
    assert.match(v.of('print-card-0'), /We close books in a day/);
    assert.match(v.of('print-notes-0'), /Speaker notes 01 · Traction Lead with the pilots. 02 · Grid Point at the tile. 03 · Ask No notes on this card./);
    assert.match(v.of('print-sources'), /Sources Card 2 \( ?Grid ?\) · Interviews Customer interviews · Measured · as of 2026-10-12/);
  } finally { await v.unmount(); }

  api.deckPrintExportRead = async () => deck({ export_options: { notes: false, sources: true }, sources_appendix: appendix });
  v = await mount(h(PitchDeckPrintPage, { exportMode: true }), '/deck/print-export/tok?print_mode=single&slide=3', '/deck/print-export/:token');
  try {
    assert.ok(v.has('print-sources'), 'PowerPoint\'s last slide is the appendix');
    assert.ok(!v.has('print-card-0') && !v.has('print-notes-0'));
  } finally { await v.unmount(); }

  api.deckPrintExportRead = async () => deck({ export_options: { notes: false, sources: false } });
  v = await mount(h(PitchDeckPrintPage, { exportMode: true }), '/deck/print-export/tok?print_mode=pdf', '/deck/print-export/:token');
  try {
    assert.ok(v.has('print-card-2'));
    assert.ok(!v.has('print-notes-0') && !v.has('print-sources'), 'nothing asked, nothing drawn');
  } finally { await v.unmount(); }
});

test('PD17 mounted: the two options apply to PowerPoint and PDF, and travel with the export', async () => {
  const sent = [];
  api.deckExportList = async () => ({ exports: [] });
  api.deckExport = async (id, format, opts) => { sent.push([id, format, opts]); return new Response(new Uint8Array([1]), { status: 200 }); };
  const v = await mount(h(ExportDialog, { versions: VERSIONS, current: VERSIONS[0], onClose() {} }));
  globalThis.URL.createObjectURL ||= () => 'blob:x';
  globalThis.URL.revokeObjectURL ||= () => {};
  const make = document.createElement.bind(document);
  document.createElement = (tag) => { const n = make(tag); if (tag === 'a') { n.click = () => {}; n.remove ||= () => {}; } return n; };
  try {
    await v.press(v.by('pitch-export-format-pptx'));
    assert.equal(v.pr(v.by('pitch-export-notes')).disabled, false, 'the option is open for PowerPoint');
    assert.match(v.of('pitch-export-where'), /each card's notes are its speaker notes/);
    await v.press(v.by('pitch-export-run'));
    await v.press(v.by('pitch-export-format-pdf'));
    await act(async () => { v.pr(v.by('pitch-export-sources')).onChange({ target: { checked: false } }); });
    await v.settle();
    await v.press(v.by('pitch-export-run'));
    assert.deepEqual(sent, [[40, 'pptx', { notes: true, sources: true }], [40, 'pdf', { notes: true, sources: false }]]);
  } finally { await v.unmount(); }
});

// D1541 (#3779, deck v2 B3, pd28) — the elements library panel: opened from the
// selection tools (one area selected), Icons · Shapes · Dividers · Textures,
// "Search icons", "Open licence · recorded", "[n] of 16 decor items", the 17th
// refused, "Snapped to the baseline", and "Generate an icon" greyed "Coming
// later". Decor is drawn as an image of the Worker's sanitised SVG.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_elements_d1541.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installDocument } from './_contracts_dom.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { DECOR_MAX, DecorPanel, decorId, decorSrc, libraryDecor } from '../src/pages/raise/pitch/GridStage.jsx';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import { deckElementsApi } from '../src/lib/api/deckElements.js';

const h = React.createElement;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="var(--deck-ink)"><path d="M1 1h2"/></svg>';
const LIB = {
  available: true,
  value: {
    licence: { id: 'lucide', name: 'Lucide', version: '1.55.0', spdx: 'ISC' }, decor_max: 16, generate: { available: false, reason: 'Coming later' },
    shapes: [{ kind: 'shape', ref: 'circle', label: 'Circle', svg: SVG }], dividers: [{ kind: 'divider', ref: 'wave', label: 'Wave', svg: SVG }],
    textures: [{ kind: 'texture', ref: 'dots', label: 'Dots', svg: SVG }],
    icons: { total: 1, offset: 0, items: [{ kind: 'icon', ref: 'rocket', label: 'rocket', svg: SVG }] },
  },
};

async function mount(el) {
  const restore = installDocument();
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(el));
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const textOf = (n) => (n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const byId = (id) => walk(document.body).find((n) => props(n)?.['data-testid'] === id);
  return {
    text: () => textOf(document.body), node: byId, props: (id) => props(byId(id)),
    click: async (id) => { await act(async () => { props(byId(id)).onClick(); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('the panel: four segments, Search icons, the licence recorded, the count, and Generate greyed Coming later', async () => {
  const picked = [];
  const v = await mount(h(DecorPanel, { library: LIB, count: 14, snapped: false, onPick: (x) => picked.push(x), onSearch: () => {}, onClose: () => {} }));
  try {
    for (const s of ['icons', 'shapes', 'dividers', 'textures']) assert.ok(v.node(`pitch-decor-seg-${s}`), s);
    assert.ok(v.node('pitch-decor-search'), 'Search icons');
    assert.match(v.text(), /Open licence · recorded · Lucide ISC/);
    assert.match(v.text(), /14 of 16 decor items on this card/);
    assert.equal(v.props('pitch-decor-generate').disabled, true);
    assert.match(v.text(), /Generate an icon · Coming later/);
    await v.click('pitch-decor-item-icon-rocket');
    assert.deepEqual(picked.map((x) => [x.kind, x.ref]), [['icon', 'rocket']]);
    await v.click('pitch-decor-seg-shapes');
    assert.ok(v.node('pitch-decor-item-shape-circle'));
  } finally { await v.close(); }
});

test('the 17th is refused: at 16 the tiles are off and the card says it holds the most it can', async () => {
  // Mutation checked: `full` ignored → the disabled assert fails.
  const v = await mount(h(DecorPanel, { library: LIB, count: DECOR_MAX, snapped: true, onPick: () => assert.fail('no 17th'), onSearch: () => {}, onClose: () => {} }));
  try {
    assert.equal(v.props('pitch-decor-item-icon-rocket').disabled, true);
    assert.match(v.text(), /This card holds 16 decor items, the most it can\./);
    assert.match(v.text(), /Snapped to the baseline/);
  } finally { await v.close(); }
});

test('an unread library says so, never an empty grid', async () => {
  const v = await mount(h(DecorPanel, { library: { available: false, unreadable: true }, count: 0, snapped: false, onPick: () => {}, onSearch: () => {}, onClose: () => {} }));
  try {
    assert.match(v.text(), /The library could not be read\./);
    assert.equal(v.node('pitch-decor-grid'), undefined);
  } finally { await v.close(); }
});

test('decor is an image of the Worker\'s SVG in the card\'s tones; ids and library items', () => {
  // Mutation checked: the svg inlined as markup instead of an image → the data: URI assert fails.
  const src = decorSrc(SVG, { ink: '#112233' });
  assert.match(src, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.ok(decodeURIComponent(src).includes('stroke="#112233"'), 'the tone is the card\'s ink');
  assert.equal(decorSrc(null), null);
  assert.equal(decorId({ decor: [{ id: 'd1' }, { id: 'd3' }] }), 'd4');
  assert.equal(decorId({}), 'd1');
  assert.deepEqual(libraryDecor({ decor: [{ id: 'd1', kind: 'icon', ref: 'rocket' }, { id: 'd2', kind: 'sparkle' }, { id: 'd3', kind: 'shape' }] }).map((d) => d.id), ['d1']);
});

test('the panel opens from the selection tools only, places on the selected area\'s cells, and the adapter is swapped', async () => {
  const src = codeOnly(readFileSync('frontend/src/pages/raise/pitch/GridStage.jsx', 'utf8'));
  // Graphics sits in the one-area selection tools beside Ask, never a toolbar or a right panel.
  assert.match(src, /askButton\(1, 'pitch-editor-ask-area'\)\}\s*\{!readOnly && onDecor \?/);
  assert.match(src, /onDecor\(\{ id: decorId\(card\), kind: item\.kind, ref: item\.ref, tone: 'ink', grid: \{ \.\.\.one\.grid \} \}\)/, 'on the selected area\'s cells: the 8 px baseline');
  assert.match(src, /\(card\?\.decor \|\| \[\]\)\.length >= DECOR_MAX\) return;/, 'the 17th is never placed');
  assert.match(codeOnly(readFileSync('frontend/src/pages/raise/pitch/PitchEditor.jsx', 'utf8')), /onDecor=\{\(item\) => setCard\(sel, \{ \.\.\.card, decor: \[\.\.\.\(card\.decor \|\| \[\]\), item\] \}\)\}/);
  assert.ok(adapter.SWAPPED.includes('elementsLibrary'));
  const real = { library: deckElementsApi.library, icons: deckElementsApi.icons };
  try {
    deckElementsApi.library = async () => ({ licence: LIB.value.licence, decor_max: 16, shapes: [], dividers: [], textures: [], generate: LIB.value.generate });
    deckElementsApi.icons = async (o) => ({ total: 1, offset: 0, icons: [{ kind: 'icon', ref: o.q || 'x', label: 'x', svg: SVG }], licence: { set: 'lucide', version: '1.55.0', spdx: 'ISC' } });
    const r = await adapter.elementsLibrary({ q: 'rocket' });
    assert.equal(r.available, true);
    assert.deepEqual(r.value.icons.items.map((i) => i.ref), ['rocket']);
    assert.equal(r.value.decor_max, 16);
  } finally { Object.assign(deckElementsApi, real); }
});

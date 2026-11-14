/**
 * D1545 (#3788, deck v2 B12) — media and structure in the editor.
 *
 *   · the seam: `deckV2Adapter.media` is swapped, so Hide, Move to section,
 *     Recorded video and Button are live; Embeds stays Coming later;
 *   · the Cards strip: Hide / Show, a hidden card dimmed and tagged, a
 *     section's name on its card, image blocks fetched lazily, and 40 cards
 *     rendered (virtualised past 24) in under 2.5 s;
 *   · the blocks: an uploaded MP4 plays with its poster and loop, a button is
 *     a link whose press the share page counts;
 *   · Present leaves a hidden card out; the editor keeps it.
 *
 * Every card, link and id is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_media_structure_d1545.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { installDocument } from './_contracts_dom.mjs';
import CardsStrip, { VIRTUALIZE_AT, cardMenuItems } from '../src/pages/raise/pitch/CardsStrip.jsx';
import { BlockView } from '../src/pages/raise/pitch/BlockGrid.jsx';
import * as adapter from '../src/pages/raise/pitch/deckV2Adapter.js';
import { ELEMENTS, elementOnMain } from '../src/pages/raise/pitch/deckV2Model.js';
import { rowPlan } from '../src/pages/raise/pitch/areaLightboxModel.js';
import { cardsOf as presentCards } from '../src/pages/raise/pitch/presentExportModel.js';
import { ADDABLE_KINDS, KIND_LABELS, VIDEO_PROVIDER_LABELS, sectionsOf, visibleCards } from '../src/pages/raise/pitch/editorModel.js';
import { deckMediaApi } from '../src/lib/api/deckMedia.js';

const h = React.createElement;
const read = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
const COLOURS = { ink: '#111111', accent: '#5b3df5', muted: '#666666', ground: '#ffffff' };
const VID = '0b7e3a52-6d1f-4c3a-9e2b-5f4d8c7a1b20';

/* ------------------------------------------------------------------ *
 * The seam
 * ------------------------------------------------------------------ */

test('the media surface is swapped: it reaches its client, and Recorded video and Button are on main; Embeds waits', async () => {
  assert.equal(adapter.availability('media'), null, 'a swapped surface answers no availability');
  assert.equal(adapter.SURFACES.media.issue, 3788);
  const real = deckMediaApi.uploadVideo;
  const calls = [];
  deckMediaApi.uploadVideo = async (id, file) => { calls.push([id, file.name]); return { video: { provider: 'mp4', video_id: VID, url: `https://axal.vc/api/decks/videos/${VID}/file` } }; };
  try {
    const r = await adapter.media(41, { name: 'synthetic.mp4' });
    assert.deepEqual(calls, [[41, 'synthetic.mp4']]);
    assert.equal(r.available, true);
    assert.equal(r.value.video.video_id, VID);
  } finally { deckMediaApi.uploadVideo = real; }
  const el = (id) => ELEMENTS.find((e) => e.id === id);
  assert.equal(elementOnMain(el('recorded_video')), true);
  assert.equal(elementOnMain(el('button')), true);
  assert.equal(elementOnMain(el('embeds')), false, 'Embeds is not part of B12');
  assert.ok(ADDABLE_KINDS.includes('button'));
  assert.equal(KIND_LABELS.button, 'Button');
  assert.equal(VIDEO_PROVIDER_LABELS.loom, 'Loom');
});

test('an area offers Recorded video as the Add block dialog on its upload, and Button as its button', () => {
  const area = { id: 'free:1-1', kind: 'free', grid: { c1: 1, r1: 1, c2: 6, r2: 3 } };
  const card = { uid: 'r1', title: 'Synthetic card', blocks: [] };
  const rec = rowPlan({ area, element: 'recorded_video', card, cardIndex: 0 });
  assert.deepEqual([rec.run, rec.open, rec.kind, rec.from], ['dialog', 'add-block', 'video', 'file']);
  const btn = rowPlan({ area, element: 'button', card, cardIndex: 0 });
  assert.deepEqual([btn.run, btn.open, btn.kind], ['dialog', 'add-block', 'button']);
  assert.match(read('pages/raise/pitch/PitchEditor.jsx'), /initial: plan\.kind, from: plan\.from \|\| null/, 'the editor opens the dialog on the upload');
});

/* ------------------------------------------------------------------ *
 * The Cards strip
 * ------------------------------------------------------------------ */

test('the card menu offers Hide, or Show on a hidden card, and Move to section, none of them waiting', () => {
  const hide = (card) => cardMenuItems(0, 3, card, adapter.availability).find((i) => i.id === 'hide');
  assert.deepEqual([hide({}).label, hide({}).later, hide({}).why], ['Hide', false, null]);
  assert.equal(hide({ hidden: true }).label, 'Show');
  const sec = (card) => cardMenuItems(0, 3, card, adapter.availability).find((i) => i.id === 'section');
  assert.deepEqual([sec({}).label, sec({}).later], ['Move to section', false]);
  assert.equal(sec({ section: 'Synthetic market' }).label, 'Change section');
});

async function strip(cards, props = {}) {
  const restore = installDocument('', { focus: true });
  // react-window reads a node's element `children` and marks rows with attributes; the suite's DOM keeps `childNodes`.
  const make = document.createElement.bind(document);
  document.createElement = (tag) => {
    const n = make(tag);
    const attrs = new Map();
    Object.defineProperty(n, 'children', { configurable: true, get() { return this.childNodes.filter((c) => c.nodeType === 1); } });
    Object.assign(n, { setAttribute: (k, v) => attrs.set(k, String(v)), getAttribute: (k) => attrs.get(k) ?? null, hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k) });
    return n;
  };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(h(CardsStrip, { cards, sel: 0, stale: new Set(), readOnly: false, onSelect() {}, move() {}, onAdd() {}, onCardAction() {}, ...props })); });
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const all = () => walk(container);
  const by = (id) => all().find((n) => pr(n)['data-testid'] === id);
  const rails = () => all().map((n) => pr(n)['data-testid']).filter((id) => /^pitch-editor-rail-\d+$/.test(id || ''));
  return {
    by, pr, all, rails,
    async press(id) { await act(async () => { pr(by(id)).onClick?.({ preventDefault() {} }); }); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}

test('a hidden card is dimmed and tagged Hidden, a card in a section carries its name, and an image block loads lazily', async () => {
  const t = await strip([
    { uid: 'a1', title: 'Synthetic cover', blocks: [{ id: 'b1', kind: 'image', image_url: 'https://axal.vc/api/decks/images/x/file', grid: { c1: 1, r1: 1, c2: 6, r2: 6 } }] },
    { uid: 'a2', title: 'Synthetic problem', hidden: true, blocks: [] },
    { uid: 'a3', title: 'Synthetic market', section: 'Synthetic story', blocks: [] },
  ]);
  try {
    assert.ok(t.by('pitch-editor-card-hidden-1'), 'the hidden card is tagged');
    assert.equal(t.by('pitch-editor-card-hidden-0'), undefined, 'a shown card is not');
    const row = t.all().find((n) => t.pr(n)['data-hidden'] === 'true');
    assert.ok(row, 'the hidden card\'s row says so');
    assert.ok(t.all().some((n) => /opacity-50/.test(t.pr(n).className || '')), 'and its thumbnail is dimmed');
    const sec = t.by('pitch-editor-card-section-2');
    assert.equal(sec?.childNodes?.length ? sec.childNodes.map((c) => c.textContent).join('') : sec?.textContent, 'Synthetic story');
    const img = t.by('pitch-editor-thumb-image');
    assert.deepEqual([t.pr(img).loading, t.pr(img).decoding], ['lazy', 'async'], 'a thumbnail\'s picture waits until it scrolls into view');
  } finally { await t.close(); }
});

const deck = (n) => Array.from({ length: n }, (_, i) => ({
  uid: `c${i}`, title: `Synthetic card ${i + 1}`, ...(i % 7 === 3 ? { hidden: true } : {}), ...(i % 5 === 0 ? { section: `Synthetic part ${i / 5}` } : {}),
  blocks: [
    { id: 'b1', kind: 'text', text: 'Synthetic words', grid: { c1: 1, r1: 1, c2: 12, r2: 2 } },
    { id: 'b2', kind: 'image', image_url: `https://axal.vc/api/decks/images/s${i}/file`, grid: { c1: 1, r1: 3, c2: 6, r2: 6 } },
    { id: 'b3', kind: 'metric', label: 'Synthetic figure', value: null, grid: { c1: 7, r1: 3, c2: 12, r2: 6 } },
  ],
}));

test('40 cards render in under 2.5 s, and past 24 on screen the column strip draws only the cards in view', async () => {
  const started = performance.now();
  const t = await strip(deck(40));
  try {
    assert.equal(t.rails().length, 8, 'folded: the first eight');
    await t.press('pitch-editor-more-cards');
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 2500, `40 cards took ${Math.round(elapsed)} ms`);
    assert.ok(40 >= VIRTUALIZE_AT);
    const drawn = t.rails().length;
    assert.ok(drawn > 0 && drawn < 40, `virtualised: ${drawn} of 40 cards drawn`);
    assert.equal(t.all().filter((n) => n.tagName?.toLowerCase?.() === 'li' || n.nodeName?.toLowerCase?.() === 'li').length, 0, 'no <li> outside a list');
  } finally { await t.close(); }
});

test('the row (below 1024 px) stays one scrolling row and is not virtualised', async () => {
  const t = await strip(deck(30), { orientation: 'row' });
  try {
    await t.press('pitch-editor-more-cards');
    assert.equal(t.rails().length, 30);
  } finally { await t.close(); }
});

/* ------------------------------------------------------------------ *
 * The blocks
 * ------------------------------------------------------------------ */

test('an uploaded MP4 plays in place, with its poster, its loop and no autoplay; a Loom link names Loom', () => {
  const mp4 = renderToStaticMarkup(h(BlockView, { colours: COLOURS, block: { id: 'v', kind: 'video', provider: 'mp4', video_id: VID, url: `https://axal.vc/api/decks/videos/${VID}/file`, poster_url: 'https://axal.vc/p.jpg', loop: true, title: 'Synthetic demo' }, live: true }));
  assert.match(mp4, /<video[^>]*data-testid="deck-block-video-file"/);
  assert.match(mp4, /poster="https:\/\/axal\.vc\/p\.jpg"/);
  assert.match(mp4, /loop=""/);
  assert.doesNotMatch(mp4, /autoplay/i);
  const loom = renderToStaticMarkup(h(BlockView, { colours: COLOURS, block: { id: 'v', kind: 'video', provider: 'loom', url: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef', title: '' }, live: false }));
  assert.match(loom, /Loom/);
});

test('a button is its words and a link; pressed on a share page it is counted, never on the editor\'s face', () => {
  const b = { id: 'k', kind: 'button', url: 'https://example.com/book', label: 'Book a call', style: 'primary' };
  const live = renderToStaticMarkup(h(BlockView, { colours: COLOURS, block: b, live: true }));
  assert.match(live, /<a[^>]*href="https:\/\/example\.com\/book"[^>]*target="_blank"/);
  assert.match(live, /Book a call/);
  assert.match(live, /rel="noopener noreferrer"/);
  const share = read('pages/PitchDeckPrintPage.jsx');
  assert.match(share, /deckMediaApi\.click\(token, \{ cardUid: slide\.uid, blockId: block\.id, viewId: viewIdRef\.current \}\)/);
  assert.match(share, /if \(!shareMode \|\| !token \|\| !slide\?\.uid \|\| !block\?\.id\) return;/, 'only a share link counts a press');
});

/* ------------------------------------------------------------------ *
 * Present and the editor
 * ------------------------------------------------------------------ */

test('Present leaves a hidden card out; the editor keeps it; sections are read in order', () => {
  const cards = [{ uid: 'p1', title: 'One', section: 'Synthetic A' }, { uid: 'p2', title: 'Two', hidden: true, section: 'Synthetic B' }, { uid: 'p3', title: 'Three', section: 'Synthetic A' }];
  assert.deepEqual(presentCards({ slides: cards }).map((c) => c.title), ['One', 'Three']);
  assert.deepEqual(visibleCards(cards).map((c) => c.uid), ['p1', 'p3']);
  assert.deepEqual(sectionsOf(cards), ['Synthetic A', 'Synthetic B']);
  const editor = read('pages/raise/pitch/PitchEditor.jsx');
  assert.match(editor, /else if \(id === 'hide' && cards\[i\]\) setDialog\(\{ kind: 'hide', index: i \}\);/, 'Hide opens its in-page dialog');
  assert.match(editor, /edit\(\{ type: 'hideCard', index: i, hidden: !hidden \}/);
  assert.match(editor, /edit\(\{ type: 'setFlag', index: dialog\.index, key: 'section', value: name \|\| undefined \}/);
  assert.match(editor, /uploadVideoAdapter\(deckId, file\)/, 'an MP4 goes through the adapter');
  assert.doesNotMatch(editor, /window\.(confirm|alert|prompt)\(/, 'never a browser pop-up');
});

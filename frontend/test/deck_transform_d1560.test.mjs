/**
 * D1560 (#3807, deck v2 C12): the Speaker notes element runs the transform
 * route (`deckTransformApi`) for its card, and Accept places the notes only
 * while the card's notes are still what the proposal read.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_transform_d1560.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ELEMENT_GROUPS, elementOnMain } from '../src/pages/raise/pitch/deckV2Model.js';
import { charged, placeResult, rowPlan, runnable } from '../src/pages/raise/pitch/areaLightboxModel.js';
import { deckTransformApi } from '../src/lib/api/deckTransform.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const CARD = { uid: 'c-team', title: 'Team', notes: 'Old notes.', blocks: [{ id: 'p2', kind: 'text', style: 'paragraph', text: 'Two founders.', grid: { c1: 1, c2: 12, r1: 2, r2: 3 } }] };
const AREA = { kind: 'block', block: CARD.blocks[0], grid: CARD.blocks[0].grid };

test('Speaker notes is on main, routed to the transform route under deck:notes', () => {
  const el = ELEMENT_GROUPS.flatMap((g) => g.items).find((i) => i.id === 'speaker_notes');
  assert.equal(el.route, 'POST /api/decks/:id/transform');
  assert.equal(el.option, 'deck:notes');
  assert.equal(el.adapter, undefined);
  assert.equal(elementOnMain(el), true);
});

test('its plan is one charged notes run for this card, never a replacement of the area', () => {
  const plan = rowPlan({ area: AREA, element: 'speaker_notes', card: CARD, cardIndex: 1 });
  assert.deepEqual(plan, { run: 'notes', action: 'speaker_notes', option: 'deck:notes', cardKey: 'c-team', body: { action: 'speaker_notes', cards: ['c-team'] } });
  assert.equal(runnable(plan), true);
  assert.equal(charged(plan), true);
});

test('Accept places the notes only while the card\'s notes are still the proposal\'s before', () => {
  const placed = placeResult(CARD, { kind: 'notes', area: AREA, before: 'Old notes.', after: 'Say who the founders are.' });
  assert.equal(placed.card.notes, 'Say who the founders are.');
  assert.deepEqual(placed.card.blocks, CARD.blocks, 'the area is untouched');
  const stale = placeResult({ ...CARD, notes: 'Edited since.' }, { kind: 'notes', area: AREA, before: 'Old notes.', after: 'x' });
  assert.match(stale.error, /speaker notes changed/);
});

test('the client posts to the transform route; the lightbox quotes and runs it, the results draw it', async () => {
  const previous = globalThis.fetch;
  const previousStore = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push([new URL(String(url), 'http://x').pathname, init.method, JSON.parse(init.body)]); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); };
  try {
    await deckTransformApi.quote(7, { action: 'speaker_notes', cards: ['c-team'] });
    await deckTransformApi.run(7, { action: 'proofread' });
  } finally { globalThis.fetch = previous; globalThis.localStorage = previousStore; }
  assert.deepEqual(calls.map(([p, m, b]) => [p.replace(/^\/api/, ''), m, b.action]), [['/decks/7/transform/quote', 'POST', 'speaker_notes'], ['/decks/7/transform', 'POST', 'proofread']]);
  const lightbox = src('pages/raise/pitch/AreaLightbox.jsx');
  assert.match(lightbox, /r\.plan\.run === 'notes' \? deckTransformApi\.quote\(deckId, r\.plan\.body\)/);
  assert.match(lightbox, /deckTransformApi\.run\(deckId, plan\.body, railPressHeaders\(plan\.option\)\)/);
  assert.match(src('pages/raise/pitch/AreaResults.jsx'), /r\.kind === 'text' \|\| r\.kind === 'notes'/);
  assert.match(src('lib/api.js'), /export \* from '\.\/api\/deckTransform\.js';/);
});

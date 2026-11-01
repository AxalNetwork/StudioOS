/**
 * D1500 (#3750) — the deck document model v2 in the editor: card uids end to
 * end, the chrome strip set once in `theme.chrome`, and rich text drawn
 * read-only. Every card, venture and figure is synthetic.
 *
 *   1. A result made for a card lands on that card after a reorder (by uid,
 *      never by place); a duplicate or a new card gets a uid of its own.
 *   2. A header Ask edit finds its card by uid; a removed card is never
 *      replaced by the one that took its place.
 *   3. The area lightbox names its card by uid on every call.
 *   4. AreaResults keeps the card it was made for when the founder reorders
 *      and selects another card mid-run.
 *   5. The chrome and the v2 flags; rich text runs drawn read-only.
 *   6. Every save sends model version 2; the card list keys on uid.
 *
 * Run: node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_model_v2_d1500.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDocument } from './_contracts_dom.mjs';
import {
  DECK_MODEL_VERSION, cardFlags, cardIndexByUid, chromeOf, newCardUid, pageNumberOf, replaceCard, runsOf, withNewUid,
} from '../src/pages/raise/pitch/editorModel.js';
import { cardEdit, editIndex, placeTextEdit } from '../src/pages/raise/pitch/deckV2Model.js';
import { assistBody, cardKeyOf, rowPlan } from '../src/pages/raise/pitch/areaLightboxModel.js';
import { BlockView } from '../src/pages/raise/pitch/BlockGrid.jsx';
import { CardChrome } from '../src/pages/raise/pitch/GridStage.jsx';
import AreaResults from '../src/pages/raise/pitch/AreaResults.jsx';
import { railProposalsApi } from '../src/lib/api/railProposals.js';

const h = React.createElement;
const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, '..', p), 'utf8');

const text = (id, words) => ({ id, kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 1 }, style: 'heading', text: words });
const A = { uid: 'card-a', title: 'Synthetic problem', blocks: [text('h', 'Synthetic pain')] };
const B = { uid: 'card-b', title: 'Synthetic traction', blocks: [text('h', 'Synthetic growth')] };
const C = { uid: 'card-c', title: 'Synthetic team', blocks: [text('h', 'Synthetic people')] };

test('1. a result lands on the card it was made for after a reorder; a new or duplicate card gets its own uid', () => {
  const before = [A, B, C];
  const after = [C, A, B]; // the founder moved the team card first while a run on B was out
  const edited = { ...B, title: 'Synthetic traction, rewritten' };
  // Mutation checked: placing by the place the run started at (1) puts it on A.
  assert.deepEqual(replaceCard(after, edited, 1).map((c) => c.title), ['Synthetic team', 'Synthetic problem', 'Synthetic traction, rewritten']);
  assert.equal(replaceCard(before.filter((c) => c !== B), edited, 1), null, 'a card removed since takes no result');
  assert.deepEqual(replaceCard([{ title: 'Legacy' }, { title: 'Other' }], { title: 'Legacy, edited' }, 0).map((c) => c.title), ['Legacy, edited', 'Other'], 'a card with no uid falls back to its place');
  assert.equal(cardIndexByUid(after, 'card-b'), 2);
  const u1 = newCardUid(), u2 = newCardUid();
  assert.match(u1, /^k[0-9a-z]{8,23}$/);
  assert.notEqual(u1, u2);
  const dup = withNewUid(JSON.parse(JSON.stringify(B)));
  assert.notEqual(dup.uid, B.uid, 'a duplicate never shares its original\'s uid');
  assert.equal(dup.title, B.title);
});

test('2. a header Ask edit finds its card by uid, and never the card that took its place', () => {
  const row = (payload) => ({ uid: 'p1', status: 'proposed', rail_option: 'deck:shorten', payload });
  const edit = cardEdit(row({ deck_id: 31, card: 1, card_uid: 'card-b', action: 'shorten', before: 'Synthetic growth', after: 'Growth' }), 31);
  assert.equal(edit.card_uid, 'card-b');
  assert.equal(editIndex([C, A, B], edit), 2, 'B moved to the end');
  const placed = placeTextEdit([C, A, B], edit);
  assert.equal(placed.card.uid, 'card-b');
  assert.equal(placed.card.blocks[0].text, 'Growth');
  // B was removed and A now sits at place 1: the edit is refused, not put on A.
  assert.match(placeTextEdit([A, A], edit).error, /no longer in this deck/);
  assert.equal(editIndex([A, C], edit), -1);
  // An edit made before uids still reads by place.
  const old = cardEdit(row({ deck_id: 31, card: 0, action: 'shorten', before: 'Synthetic pain', after: 'Pain' }), 31);
  assert.equal(old.card_uid, null);
  assert.equal(editIndex([A, B], old), 0);
  assert.equal(cardEdit(row({ deck_id: 31, card: 0, card_uid: 'bad uid!', action: 'shorten', before: 'x', after: 'y' }), 31).card_uid, null, 'a malformed uid is not trusted');
});

test('3. the area lightbox names its card by uid on every call, with its place only as a fallback', () => {
  const area = { id: 'h', kind: 'block', block: A.blocks[0], grid: A.blocks[0].grid };
  const plan = rowPlan({ area, element: 'title', card: A, cardIndex: 4 });
  assert.equal(plan.run, 'assist');
  assert.equal(plan.cardKey, 'card-a');
  assert.deepEqual(assistBody(plan, 4), { ...plan.body, card_index: 4 }, 'the place rides along for a card not saved yet');
  assert.equal(cardKeyOf({ title: 'Legacy' }, 2), 2);
  const legacy = rowPlan({ area, element: 'title', card: { ...A, uid: undefined }, cardIndex: 2 });
  assert.equal(legacy.cardKey, 2);
  assert.equal(assistBody(legacy, 2), legacy.body, 'a card named by place sends no extra field');
  const photo = rowPlan({ area: { id: 'free', kind: 'free', grid: { c1: 1, c2: 6, r1: 2, r2: 6 } }, element: 'photo', card: A, cardIndex: 4 });
  assert.equal(photo.body.card_uid, 'card-a');
  assert.equal(photo.body.card, 4);
  const src = read('src/pages/raise/pitch/AreaLightbox.jsx');
  assert.match(src, /deckAssistApi\.quote\(deckId, r\.plan\.cardKey, assistBody\(r\.plan, cardIndex\)\)/);
  assert.match(src, /deckAssistApi\.run\(deckId, plan\.cardKey, assistBody\(plan, cardIndex\)/);
  assert.match(src, /card_uid: cardKeyOf\(card, cardIndex\)/, 'an upload names the card by uid too');
});

test('4. AreaResults keeps the card it was made for when the founder reorders and selects another mid-run', async () => {
  const restore = installDocument();
  const original = { ...railProposalsApi };
  railProposalsApi.decide = async () => ({ ok: true });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const placed = [];
  const area = { id: 'h', kind: 'block', block: B.blocks[0], grid: B.blocks[0].grid };
  const results = [{ key: 'h', status: 'proposed', kind: 'text', uid: 'p1', area, before: 'Synthetic growth', after: 'Growth' }];
  const props = (card, cards) => ({ results, card, cards, model: null, items: [], onPlace: (c) => placed.push(c), onProposals: () => {} });
  try {
    await act(async () => { root.render(h(AreaResults, props(B, [A, B, C]))); });
    // Mid-run: the founder moves B to the end and selects C.
    await act(async () => { root.render(h(AreaResults, props(C, [C, A, B]))); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const pr = (n) => Object.entries(n || {}).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
    const accept = walk(container).find((n) => /-accept$/.test(pr(n)['data-testid'] || '') && !/accept-all/.test(pr(n)['data-testid'] || ''));
    assert.ok(accept, 'an Accept is drawn');
    await act(async () => { await pr(accept).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
    assert.equal(placed.length, 1);
    // Mutation checked: reading the selected card (C) instead of the run's card by uid places nothing on B.
    assert.equal(placed[0].uid, 'card-b', 'placed on the card it was made for');
    assert.equal(placed[0].blocks[0].text, 'Growth');
  } finally {
    await act(async () => root.unmount());
    Object.assign(railProposalsApi, original);
    restore();
  }
});

test('5. the chrome is set once on the theme and drawn on every card; rich text runs are drawn read-only', () => {
  assert.equal(chromeOf(null), null);
  assert.equal(chromeOf({ chrome: { page_number: false } }), null, 'nothing on draws nothing');
  const chrome = chromeOf({ chrome: { page_number: true, footer_text: ' Synthetic Labs · Seed 2026 ', logo_corner: false, confidential: true } });
  assert.deepEqual(chrome, { page_number: true, footer_text: 'Synthetic Labs · Seed 2026', logo_corner: false, confidential: true });
  const cards = [A, { ...B, hidden: true }, C];
  assert.equal(pageNumberOf(cards, 2), '2 / 2', 'a hidden card is not counted');
  assert.equal(pageNumberOf(cards, 1), null, 'a hidden card has no page number');
  assert.deepEqual(cardFlags({ hidden: true, section: ' Appendix A ', appendix: true }), { hidden: true, section: 'Appendix A', appendix: true });
  const html = renderToStaticMarkup(h(CardChrome, { chrome, pageLabel: '2 / 2', colours: { muted: '#666666' } }));
  assert.match(html, /data-testid="pitch-chrome-page"[^>]*>2 \/ 2</);
  assert.match(html, /Confidential/);
  assert.match(html, /Synthetic Labs · Seed 2026/);
  assert.doesNotMatch(html, /pitch-chrome-logo/, 'the logo corner is off');
  assert.equal(renderToStaticMarkup(h(CardChrome, { chrome: null, colours: {} })), '');
  const stage = read('src/pages/raise/pitch/GridStage.jsx');
  assert.match(stage, /<CardChrome chrome=\{chromeOf\(theme\)\} pageLabel=\{pageLabel\}/);
  assert.match(read('src/pages/raise/pitch/PitchEditor.jsx'), /pageLabel=\{pageNumberOf\(cards, sel\)\}/);

  const rich = { id: 't', kind: 'text', style: 'paragraph', text: 'Synthetic bold and a link',
    paras: [{ runs: [{ text: 'Synthetic ' }, { text: 'bold', b: true }, { text: ' and ' }, { text: 'a link', href: 'https://example.com/report', accent: '#1a4f8b' }] }] };
  assert.equal(runsOf(rich).length, 1);
  assert.equal(runsOf({ kind: 'text', text: 'plain' }), null);
  const drawn = renderToStaticMarkup(h(BlockView, { block: rich, colours: { muted: '#666666' } }));
  assert.match(drawn, /data-testid="deck-block-rich"/);
  assert.match(drawn, /<span style="font-weight:800">bold<\/span>/);
  assert.match(drawn, /<a href="https:\/\/example.com\/report" target="_blank" rel="noopener noreferrer"[^>]*style="color:#1a4f8b">a link<\/a>/);
  assert.doesNotMatch(drawn, /contenteditable/i, 'read-only here; editing is A4c\'s');
  const unsafe = { kind: 'text', text: 'x', paras: [{ runs: [{ text: 'a script link', href: 'javascript:alert(1)' }] }] };
  const unsafeDrawn = renderToStaticMarkup(h(BlockView, { block: unsafe, colours: {} }));
  assert.doesNotMatch(unsafeDrawn, /<a |javascript:/, 'a link that is not https is drawn as plain text');
  assert.match(unsafeDrawn, /a script link/);
});

test('6. every save sends model version 2, and the card list keys on the card uid', () => {
  assert.equal(DECK_MODEL_VERSION, 2);
  assert.match(read('src/lib/api.js'), /deckUpdate: \(id, payload\) => request\(`\/decks\/\$\{id\}`, \{ method: 'PUT', body: JSON\.stringify\(\{ model_version: 2, \.\.\.payload \}\) \}\)/);
  const strip = read('src/pages/raise/pitch/CardsStrip.jsx');
  // Mutation checked: `key={i}` turns this red.
  assert.match(strip, /<li key=\{c\?\.uid \?\? `card-\$\{i\}`\}/);
  const editor = read('src/pages/raise/pitch/PitchEditor.jsx');
  assert.match(editor, /const copyCard = \(c\) => withNewUid\(/);
  assert.match(editor, /const placeCard = \(c\) => setCards\(\(cs\) => replaceCard\(cs, c, sel\) \?\? cs\);/);
  assert.doesNotMatch(editor, /onPlace=\{\(c\) => setCard\(sel, c\)\}/, 'no result is placed by the selection\'s place');
});

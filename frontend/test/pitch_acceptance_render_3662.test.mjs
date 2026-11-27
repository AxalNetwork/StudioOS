// #3662: the Pitch acceptance harness, render part. Each synthetic fixture deck
// (fixtures/pitch_acceptance_decks.mjs) drawn the way the print page draws it — BlockGrid at
// `size="print"`, `live`, the page the PDF and the PowerPoint pictures photograph (D1112) —
// keeps every word a reader should see, a missing figure reads "Not recorded", never 0, and the
// image keeps its alt text. The live, screenshot half is scripts/pitch-acceptance-live.mjs.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_acceptance_render_3662.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlockGrid, gridBlocks } from '../src/pages/raise/pitch/BlockGrid.jsx';
import { cardColours } from '../src/pages/raise/pitch/editorModel.js';
import { DECKS, NOT_RECORDED, missingTexts, readerTexts } from './fixtures/pitch_acceptance_decks.mjs';

const h = React.createElement;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const print = (deck) => deck.slides.map((s) => renderToStaticMarkup(h(BlockGrid, { blocks: gridBlocks(s), colours: cardColours(deck.theme, null), live: true, sources: true, size: 'print' }))).join('\n');

for (const name of ['complete', 'sparse', 'multilingual']) {
  test(`${name}: the print page keeps every word a reader should see`, () => {
    const deck = DECKS[name];
    assert.deepEqual(missingTexts(readerTexts(deck), print(deck), esc), []);
  });
}

test('sparse: "Not recorded" for the figure nobody recorded, and nothing drawn for an image never chosen', () => {
  const html = print(DECKS.sparse);
  assert.ok(html.includes(NOT_RECORDED));
  assert.ok(!/>0</.test(html));
  assert.ok(!/<img/.test(html), 'no broken image');
});

test('complete: the image keeps its alt text and the link is a real link', () => {
  const html = print(DECKS.complete);
  assert.match(html, /alt="Two synthetic founders at a whiteboard"/);
  assert.match(html, /href="https:\/\/example\.test\/data-room"/);
});

test('the oracle asks for every kind of word: list lines, figures (or "Not recorded"), chart series, link labels', () => {
  const words = (d) => readerTexts(d).map((e) => e.text);
  const complete = words(DECKS.complete);
  for (const w of ['Founder A, operations', 'Founder B, software & data', 'Pilots', '3', '$4,200', 'Pilots by quarter', 'Read the data room']) assert.ok(complete.includes(w), w);
  assert.ok(words(DECKS.sparse).includes(NOT_RECORDED));
});

test('every fixture is synthetic: no real company, address or figure source', () => {
  const all = JSON.stringify(DECKS);
  assert.ok(!/axal\.vc|@gmail|@[a-z]+\.(com|io)\b/i.test(all), 'no real address');
  assert.ok(/example\.test/.test(all), 'links stay on the reserved test domain');
});

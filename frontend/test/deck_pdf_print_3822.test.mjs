/**
 * D1575 (#3822, deck v2 E2) — what the PDF is printed from: the print card
 * draws words as text and every link live, at 16:9 and at 4:3, so Chrome's PDF
 * carries real text and URI links. The Worker's check
 * (`cloudflare-worker/src/services/decks/pdfExport.ts`) refuses a PDF without
 * them; `expectedLinks` there names exactly the anchors drawn here.
 *
 * Every word and URL is made up.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deck_pdf_print_3822.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioPrintCard } from '../src/pages/raise/pitch/PrintExtras.jsx';

const h = React.createElement;
const SLIDE = { title: 'Projection', blocks: [
  { id: 'b1', kind: 'text', grid: { c1: 1, c2: 12, r1: 1, r2: 2 }, style: 'heading', text: 'Projection' },
  { id: 'b2', kind: 'text', grid: { c1: 1, c2: 12, r1: 3, r2: 4 }, style: 'paragraph', text: 'Read the pilot',
    paras: [{ runs: [{ text: 'Read the ' }, { text: 'pilot', href: 'https://example.test/pilot' }, { text: ' plain', href: 'http://example.test/plain' }] }] },
  { id: 'b3', kind: 'link', grid: { c1: 1, c2: 4, r1: 5, r2: 5 }, label: 'Open the model', url: 'https://example.test/model' },
  { id: 'b4', kind: 'video', provider: 'mp4', grid: { c1: 5, c2: 8, r1: 5, r2: 6 }, url: 'https://example.test/upload.mp4' },
] };

test('the print card draws words as text and the links the Worker expects, at 16:9 and at 4:3', () => {
  // Mutation checked: the run drawn as a span → the pilot anchor is missing; the page left at 1920 for 4:3 → the width check fails.
  for (const [aspect, width] of [['16:9', 1920], ['4:3', 1440]]) {
    const html = renderToStaticMarkup(h(StudioPrintCard, { slide: SLIDE, index: 0, aspect }));
    assert.match(html, new RegExp(`width:${width}px`), `${aspect}: the page is the slide`);
    assert.match(html, />Projection</, 'the heading is text, not a picture');
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(hrefs, ['https://example.test/model', 'https://example.test/pilot'], `${aspect}: only https runs and linked blocks; an uploaded video plays in place`);
    assert.doesNotMatch(html, /<canvas|<img [^>]*data-slide/, 'no card is drawn as a picture');
  }
});

test('the print page prints each studio deck at its own page size', () => {
  const src = readFileSync(new URL('../src/pages/PitchDeckPrintPage.jsx', import.meta.url), 'utf8');
  assert.match(src, /const pageW = studioDeck \? SLIDE_SIZES\[aspectOf\(deck\.theme\?\.aspect\)\]\.width : INNER_W;/);
  assert.match(src, /@page \{ size: \$\{pageW\}px 1080px; margin: 0; \}/);
});

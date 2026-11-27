// D8772 (#8772) Q3, the owner's answer A (2026-11-27): when a figure's source has no recorded date,
// what the recipient reads says "date not recorded" with that figure's source, as the HTML export's
// appendix does. It is the recipient-side counterpart of the preflight warning "The source's date is
// not recorded". Three cases, on every place a recipient reads a source line:
//   - an undated source:  "Source: Grow · Measured · date not recorded";
//   - a dated source:     "Source: Grow · Measured · 20 Nov", and no "date not recorded";
//   - no source:          "Source: Not recorded" (or nothing), and no "date not recorded".
// Present and its phone viewer draw `sourceOf` (a grid card's tile through `BlockGrid`, a fielded
// card's figures through `cardOf`); the investor's link viewer draws `figureChips` (`FigureSources`).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_viewer_undated_source_8772.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import {
  SOURCE_DATE_NOT_RECORDED, SOURCE_NOT_ON_STUDIOOS, cardOf, sourceDayOf, sourceOf, undatedSource,
} from '../src/pages/raise/pitch/presentExportModel.js';
import { figureChips } from '../src/pages/raise/pitch/shareModel.js';
import { PresentCard } from '../src/pages/raise/pitch/PitchPresent.jsx';
import { FigureSources } from '../src/pages/raise/pitch/ShareViewerParts.jsx';

/** Synthetic only: no real company, person or figure. */
const h = React.createElement;
const draw = (el) => renderedText(renderToStaticMarkup(h(MemoryRouter, null, el)));
const g = (c1, c2, r1, r2) => ({ c1, c2, r1, r2 });
const UNDATED = { source_key: 'grow.mrr', snapshot_hash: 'h-mrr', grade: 'Measured', as_of: null };
const DATED = { source_key: 'grow.paying_customers', snapshot_hash: 'h-pay', grade: 'Measured', as_of: '2026-11-20' };
const NOT_A_DAY = { source_key: 'grow.burn', grade: 'Measured', as_of: 'not a day' };

test('sourceOf: an undated source says "date not recorded"; a dated one shows its day; no source says nothing of a date', () => {
  assert.equal(SOURCE_DATE_NOT_RECORDED, 'date not recorded');
  assert.equal(sourceOf(UNDATED), 'Source: Grow · Measured · date not recorded', 'the canvas\'s words (PTF08, v7 proposed)');
  assert.equal(sourceOf({ ...UNDATED, as_of: undefined }), 'Source: Grow · Measured · date not recorded', 'a missing as_of');
  assert.equal(sourceOf(NOT_A_DAY), 'Source: Grow · Measured · date not recorded', 'an as_of that is not a day is not a date');
  assert.equal(sourceOf(DATED), 'Source: Grow · Measured · 20 Nov');
  assert.equal(sourceOf(null), null, 'no binding: no source line of its own');
  assert.equal(sourceOf({ grade: 'Measured' }), null, 'no source key: no source');
  assert.equal(sourceOf({ source_key: 'grow.mrr', grade: 'Excellent' }), SOURCE_NOT_ON_STUDIOOS, 'not on StudioOS: no date line');
  assert.equal(sourceDayOf(DATED), '20 Nov');
  assert.equal(sourceDayOf(UNDATED), null);
  assert.deepEqual([UNDATED, NOT_A_DAY, DATED, null, {}, { source_key: 'grow.mrr', grade: 'Excellent' }].map(undatedSource), [true, true, false, false, false, false]);
});

test('Present, a grid card with sources on: the undated tile says "date not recorded", the dated and the unbound tiles do not', () => {
  const slide = { title: 'Synthetic traction', blocks: [
    { id: 'm1', kind: 'metric', grid: g(1, 3, 1, 2), label: 'MRR', value: '$34.2k', binding: UNDATED },
    { id: 'm2', kind: 'metric', grid: g(5, 7, 1, 2), label: 'Paying customers', value: '38', binding: DATED },
    { id: 'm3', kind: 'metric', grid: g(9, 11, 1, 2), label: 'Typed figure', value: '12' },
  ] };
  const card = cardOf(slide, 2);
  const html = renderToStaticMarkup(h(MemoryRouter, null, h(PresentCard, { card, sources: true })));
  const tile = (id) => renderedText(html.split(`data-testid="deck-block-metric-${id}"`)[1].split('</span></span>')[0]);
  assert.match(tile('m1'), /Source: Grow · Measured · date not recorded/);
  assert.match(tile('m2'), /Source: Grow · Measured · 20 Nov/);
  assert.doesNotMatch(tile('m2'), /date not recorded/);
  assert.match(tile('m3'), /Source: Not recorded/);
  assert.doesNotMatch(tile('m3'), /date not recorded/);
  assert.equal(renderedText(html).match(/date not recorded/g).length, 1, 'once, under the undated tile only');
  // Sources off (the audience view, the deck preview): no source line at all.
  assert.doesNotMatch(draw(h(PresentCard, { card, sources: false })), /Source:|date not recorded/);
});

test('Present, a fielded card: each figure\'s line follows its own source', () => {
  const slide = { title: 'Synthetic traction', fields: [{ kind: 'metric_grid', label: 'Traction', value: [
    { label: 'MRR', value: '$34.2k', binding: UNDATED },
    { label: 'Paying customers', value: '38', binding: DATED },
    { label: 'Pilots', value: '3' },
  ] }] };
  const card = cardOf(slide, 2);
  assert.deepEqual(card.figures.map((f) => f.source), ['Source: Grow · Measured · date not recorded', 'Source: Grow · Measured · 20 Nov', null]);
  const t = draw(h(PresentCard, { card, sources: true }));
  assert.match(t, /MRR\$34\.2kSource: Grow · Measured · date not recorded/);
  assert.match(t, /Paying customers38Source: Grow · Measured · 20 Nov/);
  assert.match(t, /Pilots3Source: Not recorded/);
  assert.equal(t.match(/date not recorded/g).length, 1);
});

test('the investor\'s link viewer: the undated figure\'s chip says "date not recorded"; the dated and unsourced ones do not', () => {
  const slides = [{ title: 'Synthetic opening', fields: [] }, { title: 'Synthetic traction', fields: [
    { kind: 'metric_grid', label: 'Traction', binding: UNDATED, value: [{ label: 'MRR', value: '$34.2k' }] },
    { kind: 'metric_grid', label: 'Customers', binding: DATED, value: [{ label: 'Paying customers', value: '38' }] },
    { kind: 'metric_grid', label: 'Pilots', source: 'data', value: [{ label: 'Pilots', value: '3' }] },
  ] }];
  assert.deepEqual(figureChips(slides).map((r) => r.chip), ['Measured · date not recorded', 'Measured', 'From records']);
  const t = draw(h(FigureSources, { slides }));
  assert.match(t, /MRR · \$34\.2kCard 02 · Measured · date not recorded/);
  assert.match(t, /Paying customers · 38Card 02 · Measured(?! · date)/);
  assert.match(t, /Pilots · 3Card 02 · From records/);
  assert.equal(t.match(/date not recorded/g).length, 1, 'once, under the undated figure only');
  // A cell's own dated binding wins over its field's undated one, as Present reads it.
  const own = [{ fields: [{ kind: 'metric_grid', binding: UNDATED, value: [{ label: 'MRR', value: '$34.2k', binding: DATED }] }] }];
  assert.deepEqual(figureChips(own).map((r) => r.chip), ['Measured']);
});

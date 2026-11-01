// D1538 (#3787, deck v2 B11) — typed figures in the editor, Present and print:
// the table block, market circles, the projection line (dashed past today,
// with S1's one Projection label), the "✎ Stated" chip and pd24's hover line,
// and the typed-values client.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/pitch_typed_data_d1538.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BlockView } from '../src/pages/raise/pitch/BlockGrid.jsx';
import { STATED_CHIP, TYPED_LINE, PROJECTION_NOTE, figureCard } from '../src/pages/raise/pitch/figuresModel.js';
import { TYPED_CHART_TYPES, isTypedChart, marketCircles, marketShape, projectionLines, tableView, compactUsd } from '../src/pages/raise/pitch/typedChartsModel.js';
import { deckTypedValuesApi } from '../src/lib/api/deckTypedValues.js';

const h = React.createElement;
const COLOURS = { bg: '#fff', ink: '#111', accent: '#6d28d9', muted: '#6b7280' };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const MARKET = [{ x: 'TAM', y: 40e9 }, { x: 'SAM', y: 6e9 }, { x: 'SOM', y: 120e6 }];

test('market circles: TAM, SAM and SOM nest, each area in proportion, resting on one bottom; a market that does not nest is words', () => {
  // Mutations checked: r ∝ value instead of √value → the area ratio assert fails; the SOM ≤ SAM ≤ TAM check dropped →
  // the out-of-order market draws circles.
  const block = { id: 'm', kind: 'chart', chart_type: 'market_circles', series: [{ label: 'Market', points: MARKET }] };
  const c = marketCircles(block);
  assert.deepEqual(c.map((x) => x.text), ['TAM $40B', 'SAM $6B', 'SOM $120M']);
  const area = (x) => Math.PI * x.r * x.r;
  assert.ok(Math.abs(area(c[1]) / area(c[0]) - 6 / 40) < 0.01, 'SAM\'s area is its share of TAM');
  assert.ok(c.every((x) => Math.abs(x.cy + x.r - 98) < 0.02), 'every circle rests on the same bottom');
  assert.ok(c[0].r > c[1].r && c[1].r > c[2].r);
  assert.equal(marketShape([{ x: 'TAM', y: 1 }, { x: 'SAM', y: 6 }, { x: 'SOM', y: 1 }]), null);
  const html = renderToStaticMarkup(h(BlockView, { block, colours: COLOURS, live: true }));
  assert.match(html, /data-testid="deck-market-circles-m"/);
  assert.match(html, /aria-label="TAM \$40B, SAM \$6B, SOM \$120M"/);
  const bad = renderToStaticMarkup(h(BlockView, { block: { ...block, series: [{ points: [{ x: 'TAM', y: 1 }, { x: 'SAM', y: 6 }, { x: 'SOM', y: 1 }] }] }, colours: COLOURS, live: true }));
  assert.match(bad, /Market circles need TAM, SAM and SOM, each inside the one before\./);
  assert.doesNotMatch(bad, /<circle/);
  assert.equal(compactUsd(null), '', 'a missing figure is blank, never $0');
});

test('the projection chart: solid to today, dashed after, with the one Projection label and its footnote in every format', () => {
  // Mutations checked: the split at the first future point instead of the point before → the lines no longer meet;
  // the Projection component dropped from the typed branch → the label assert fails in each format.
  const today = '2026-11-01';
  const block = { id: 'p', kind: 'chart', chart_type: 'projection', series: [{ label: 'Revenue', points: [
    { x: '2026-09', y: 10 }, { x: '2026-10', y: 12 }, { x: '2026-11', y: 15 }, { x: '2026-12', y: 19 }, { x: '2027-01', y: 24 },
  ] }] };
  const l = projectionLines(block, today);
  assert.equal(l.from, '2026-12');
  assert.equal(l.solid.split(' ').length, 3, 'September to November, solid');
  assert.equal(l.dashed.split(' ').length, 3, 'from November on, dashed: the two lines meet');
  assert.equal(l.solid.split(' ').at(-1), l.dashed.split(' ')[0]);
  assert.deepEqual(projectionLines({ ...block, series: [{ points: [{ x: '2026-01', y: 1 }, { x: '2026-02', y: 2 }] }] }, today).dashed, '', 'nothing past today: no dashed line');
  assert.equal(projectionLines({ ...block, series: [{ points: [{ x: '2026-01', y: 1 }] }] }, today), null);
  const far = { ...block, series: [{ label: 'Revenue', points: [{ x: '2026-01', y: 1 }, { x: '2099-01', y: 9 }] }] };
  for (const live of [false, true]) {
    const html = renderToStaticMarkup(h(BlockView, { block: far, colours: COLOURS, live, renderChart: () => h('i', null, 'editor chart') }));
    assert.match(html, /data-testid="deck-projection-chart-p"/, `live=${live}: drawn here, not by the editor's bound-series chart`);
    assert.match(html, /data-testid="deck-projection-dashed-p"/);
    assert.equal((html.match(/data-testid="deck-projection-p"/g) || []).length, 1, 'one Projection label, S1\'s');
    assert.ok(html.includes(PROJECTION_NOTE));
    assert.doesNotMatch(html, /editor chart/);
  }
  assert.deepEqual(TYPED_CHART_TYPES, ['market_circles', 'projection']);
  assert.equal(isTypedChart({ kind: 'chart', chart_type: 'line' }), false);
});

test('the table block: a head row, then its rows; a check is ✓ or ✗, a bound cell names its source, a blank stays blank', () => {
  // Mutation checked: tableView ignoring header:false → the first row is drawn as a head.
  const block = { id: 't', kind: 'table', header: true, rows: [
    [{ text: 'Plan' }, { text: 'SSO' }, { text: 'MRR' }],
    [{ text: 'Pro' }, { check: true }, { binding: { source_key: 'grow.mrr' } }],
    [{ text: 'Free' }, { check: false }, { text: '' }],
  ] };
  assert.deepEqual(tableView(block), { head: ['Plan', 'SSO', 'MRR'], body: [['Pro', '✓', 'grow.mrr'], ['Free', '✗', '']] });
  assert.deepEqual(tableView({ ...block, header: false }).head, null);
  const html = renderToStaticMarkup(h(BlockView, { block, colours: COLOURS, live: true }));
  assert.match(html, /<table[^>]*data-testid="deck-table-t"><thead><tr><th scope="col"[^>]*>Plan<\/th>/);
  assert.match(html, /<td[^>]*>Free<\/td><td[^>]*>✗<\/td><td[^>]*><\/td>/, 'a blank cell is blank, never 0');
  assert.doesNotMatch(html, />0</);
});

test('pd24: a typed tile reads "✎ Stated" in the editor, and its hover line says who typed it; Present and print draw no badge', () => {
  // Mutations checked: TYPED_LINE without the name → the "Typed by" assert fails; the chip drawn when live → the Present assert fails.
  assert.equal(STATED_CHIP, '✎ Stated');
  assert.equal(TYPED_LINE('Avery Stone'), 'Typed by Avery Stone · not linked to a record');
  assert.equal(TYPED_LINE(), 'Typed on the card · not linked to a record');
  const tile = { id: 'k', kind: 'metric', label: 'Customers', value: '42' };
  const editor = renderToStaticMarkup(h(BlockView, { block: tile, colours: COLOURS }));
  assert.match(editor, /title="Typed on the card · not linked to a record"[^>]*>✎ Stated</);
  assert.doesNotMatch(renderToStaticMarkup(h(BlockView, { block: tile, colours: COLOURS, live: true })), /Stated/);
  assert.doesNotMatch(renderToStaticMarkup(h(BlockView, { block: { ...tile, value: null }, colours: COLOURS })), /Stated/, 'Not recorded is not a typed figure');
  assert.deepEqual(figureCard({ ...tile, typed_by: { name: 'Avery Stone' } }, []).lines, ['Typed by Avery Stone · not linked to a record']);
  const typedSeries = { id: 'c', kind: 'chart', chart_type: 'line', series: [{ label: 'Pipeline', points: [{ x: '2026-01', y: 1 }] }] };
  assert.match(renderToStaticMarkup(h(BlockView, { block: typedSeries, colours: COLOURS })), /Pipeline · ✎ Stated/, 'not "Typed · Stated"');
  assert.doesNotMatch(read('src/pages/raise/pitch/BlockGrid.jsx'), /Typed · Stated|' · Typed'/);
});

test('the typed-values client: one module under lib/api, re-exported by one line, on the Worker\'s paths', async () => {
  // Mutation checked: the api.js export line removed → the re-export assert fails.
  assert.match(read('src/lib/api.js'), /^export \* from '\.\/api\/deckTypedValues\.js';$/m);
  const src = read('src/lib/api/deckTypedValues.js');
  assert.match(src, /`\/decks\/\$\{encodeURIComponent\(deckId\)\}\/typed-values/);
  assert.match(read('../cloudflare-worker/src/routes/deck_typed_values.ts'), /r\.(get|put|delete)\('\/:id\{\[0-9\]\+\}\/typed-values/);
  assert.deepEqual(Object.keys(deckTypedValuesApi).sort(), ['list', 'remove', 'set']);
});

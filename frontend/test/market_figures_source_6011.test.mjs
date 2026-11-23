/**
 * D6011 (#6011) — the market band names each figure's source and date, the
 * History part lists each change with who and when, and the Lab sizing save
 * says where its figures came from.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/market_figures_source_6011.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { CARDS, marketBandSource } from '../src/pages/cycles/adapters/validate.js';
import MarketFigureHistory, { historyLine } from '../src/pages/cycles/MarketFigureHistory.jsx';
import { sizingProvenance, sizingSourceSeed } from '../src/pages/SpinoutLabMarketPage.jsx';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (part) => renderedText(renderToStaticMarkup(createElement(MarketFigureHistory, { part })));

test('a figure saved with a source shows that source and its date on the band', () => {
  assert.equal(marketBandSource({ value: 5e9, source: 'Synthetic industry report 2026', as_of: '2026-11-15' }), 'Synthetic industry report 2026 · as of 2026-11-15');
  assert.equal(marketBandSource({ value: 5e9, source: null, as_of: '2026-11-15' }), 'no source named · as of 2026-11-15');
});

test('a figure saved before market_figures still reads source not recorded', () => {
  assert.equal(marketBandSource({ value: 4.2e9, source: null, reason: 'No source recorded for this figure', as_of: null }), 'source not recorded');
  assert.equal(marketBandSource({ value: 4.2e9, source: null, as_of: 'not a date' }), 'source not recorded');
});

test('the market chart carries the band text the Worker read gives', () => {
  const series = {
    tam: { value: 5e9, source: 'Synthetic industry report 2026', reason: null, as_of: '2026-11-15', source_url: null, method: 'top_down' },
    sam: { value: 7e8, source: null, reason: 'No source recorded for this figure', as_of: null, source_url: null, method: null },
    som: { value: null, source: null, reason: 'No figure entered', as_of: null, source_url: null, method: null },
    competitors_tracked: 0,
  };
  const bands = CARDS['market-intelligence'](series).find((s) => s?.kind === 'bands');
  assert.ok(bands, 'the bands spec is drawn');
  assert.deepEqual(bands.items.map((i) => i.source), ['Synthetic industry report 2026 · as of 2026-11-15', 'source not recorded', undefined]);
});

test('History lists each change with who and when, and says so when it cannot', () => {
  const rows = [
    { id: 2, sizing_version: 4, figure: 'tam', value: 5.5e9, method: 'typed', source_title: null, source_url: null, set_by_name: 'Ada Admin', set_at: '2026-11-15 10:02:00' },
    { id: 1, figure: 'tam', value: 5e9, method: 'top_down', source_title: 'Synthetic industry report 2026', source_url: 'https://example.com/r', set_by_name: 'Fay Founder', set_at: '2026-11-14 09:00:00' },
  ];
  const text = html({ rows });
  assert.match(text, /History/);
  assert.match(text, /Version 4/);
  assert.match(text, /Total addressable · \$5\.5B/);
  assert.match(text, /Typed · No source named · Ada Admin · 2026-11-15/);
  assert.match(text, /Top-down · Synthetic industry report 2026 · Fay Founder · 2026-11-14/);
  assert.deepEqual(historyLine({ figure: 'som', value: null, method: 'x', set_by_name: null, set_at: null }),
    { figure: 'Obtainable', value: 'Cleared', how: 'Not recorded', source: 'No source named', sourceUrl: null, who: 'Not recorded', when: 'Not recorded' });
  assert.match(html(null), /Unreadable/);
  assert.match(html({ rows: [] }), /No change recorded yet/);
  assert.equal(html(undefined), '', 'an older read draws nothing');
  assert.equal(historyLine({ source_url: 'javascript:alert(1)' }).sourceUrl, null, 'only an http link is drawn');
});

test('the Lab sizing save names its method and a stored source by id, never by title', () => {
  assert.deepEqual(sizingProvenance('Bottom-up', '7'), { method: 'bottom_up', market_source_id: 7 });
  assert.deepEqual(sizingProvenance('Top-down', ''), { method: 'top_down', market_source_id: null });
  assert.equal(sizingSourceSeed({ figures: { tam: { market_source_id: 7 } }, sources: [{ id: 7 }] }), '7');
  assert.equal(sizingSourceSeed({ figures: { tam: { market_source_id: 7 } }, sources: [] }), '', 'a removed source is not offered');
  assert.equal(sizingSourceSeed({ sources: [{ id: 7 }] }), '');
  const page = codeOnly(raw('frontend/src/pages/SpinoutLabMarketPage.jsx'));
  assert.match(page, /marketFigureSource: sizingProvenance\(assumptions\.methodology, sourceId\)/);
  assert.match(page, /marketSizingApi\.saveVersion\(id, request\)/);
  assert.match(page, /data-testid="select-sizing-source"/);
  const defs = codeOnly(raw('frontend/src/pages/cycles/defs/validate.jsx'));
  assert.match(defs, /<MarketFigureHistory part=\{data\?\.parts\?\.market_history\} \/>/);
});

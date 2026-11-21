/** #6178: sourced ARR/retention in the founder's existing sheet and investor Traction tiles. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRACTION_TILES, tractionView } from '../src/pages/deal/dealInsightsModel.js';
import { metricText, ShareUpdateView } from '../src/pages/founder/ShareUpdateSheet.jsx';

const metrics = [
  { key: 'arr', label: 'ARR', value: 123400, unit: 'usd', source: 'manual', as_of: '2026-10-20' },
  { key: 'net_retention', label: 'Net revenue retention', value: 112.5, unit: 'pct', source: 'typed', as_of: '2026-10-20' },
];
const read = (figures) => ({ history: { state: 'recorded', data: [{ month: '2026-10', state: 'reported', figures }] } });
const tiles = (r) => Object.fromEntries(tractionView(r).tiles.map((t) => [t.key, t]));

test('recorded ARR and canonical retention become sourced dated tiles, with no parallel nrr metric', () => {
  assert.ok(TRACTION_TILES.some((t) => t.key === 'arr'));
  assert.ok(TRACTION_TILES.some((t) => t.key === 'net_retention'));
  assert.equal(TRACTION_TILES.some((t) => t.key === 'nrr'), false);
  const result = tiles(read(metrics));
  assert.deepEqual([result.arr.value, result.arr.source, result.arr.asOf], ['$123,400', 'Typed · the founder’s own figure', 'As of 20 Oct 2026']);
  assert.deepEqual([result.net_retention.value, result.net_retention.source], ['112.5%', 'Typed · the founder’s own figure']);
  assert.equal(tiles(read(metrics.map((m) => ({ ...m, source: 'stripe' })))).arr.source, 'From stripe');
});

test('ARR/retention distinguish zero from missing, never annualise MRR, and do not read values outside history', () => {
  const zero = tiles(read(metrics.map((m) => ({ ...m, value: 0 }))));
  assert.deepEqual([zero.arr.value, zero.net_retention.value], ['$0', '0%']);
  const missing = tiles(read([{ key: 'mrr', value: 100, unit: 'usd', source: 'stripe' }]));
  assert.equal(missing.arr.value, null); assert.equal(missing.net_retention.value, null);
  assert.match(missing.arr.reason, /MRR is not annualised/);
  const failed = tractionView({ history: { state: 'unreadable' }, arr: { value: 123400 }, net_retention: { value: 112.5 } });
  assert.equal(failed.state, 'unreadable');
  assert.ok(failed.tiles.every((t) => t.value === null));
});

test('the existing founder Metrics step draws both fields with typed attribution; retention is a level, not growth', () => {
  assert.deepEqual(metricText(metrics[0]), { value: '$123,400', detail: 'Typed · the founder’s own figure · 2026-10-20' });
  assert.equal(metricText(metrics[1]).value, '112.5%');
  assert.equal(metricText({ ...metrics[1], key: 'growth', value: 5 }).value, '+5% month on month');
  const html = renderToStaticMarkup(React.createElement(ShareUpdateView, { s: { step: 1, context: { no_metrics: false }, metrics,
    removedMetrics: [], now: new Date('2026-11-14T12:00:00Z') }, on: {} }));
  assert.match(html, /ARR/); assert.match(html, /Net revenue retention/);
  assert.match(html, /the founder’s own figure/); assert.match(html, /2026-10-20/);
  assert.doesNotMatch(html, /\+112\.5%/);
});

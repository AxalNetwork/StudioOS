// D4619 (#4619, Studio audit 1/5): IRR is a fraction from the Worker and is drawn as a percent.
//
//   · `formatRate` (frontend/src/lib/rate.js) turns 0.1 into "10%"; negative and zero rates are recorded rates;
//     a missing one is null, never "0%";
//   · the investor Studio's Portfolio at a glance draws IRR with it, and TVPI and MOIC stay multiples;
//   · the Worker's own calculation, 100 invested and 110 NAV one year later, reaches the tile as "10%", not "0.1%".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { formatRate } from '../src/lib/rate.js';
import { PortfolioRows } from '../src/pages/studio/tiles/investorTiles.jsx';
import { computeFundMetrics } from '../../cloudflare-worker/src/services/portfolioMetrics.ts';

const text = (html) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const rows = (data) => text(renderToStaticMarkup(h(MemoryRouter, null, h(PortfolioRows, { data }))));

test('formatRate reads a fraction: 0.1 is 10%, and negative, zero and missing are each themselves', () => {
  // Mutation checked: dropping the ×100 (`Math.round(n * 10) / 10`) gives "0.1%" here; restored, it passes.
  assert.equal(formatRate(0.1), '10%');
  assert.equal(formatRate(0.1234), '12.3%');
  assert.equal(formatRate(1), '100%');
  // Mutation checked: formatting Math.abs(n) gives "25%" here; restored, it passes.
  assert.equal(formatRate(-0.25), '-25%');
  // Mutation checked: treating 0 as missing (`!fraction`) returns null here; restored, it passes.
  assert.equal(formatRate(0), '0%');
  // Mutation checked: removing the missing-value guard and answering "0%" for a non-number fails here; restored, it passes.
  for (const missing of [null, undefined, '', 'n/a', Number.NaN, Infinity, true]) assert.equal(formatRate(missing), null, `${String(missing)} is not a rate`);
  assert.equal(formatRate('0.1'), '10%', 'a numeric string from JSON is still a fraction');
});

test('Portfolio at a glance draws IRR as a percent; TVPI and MOIC stay multiples; a missing IRR is Not recorded', () => {
  // Mutation checked: restoring `${source.irr}%` in investorTiles.jsx gives "IRR|0.1%" here; restored, it passes.
  assert.match(rows({ analytics: { irr: 0.1, tvpi: 1.1, moic: 1.1 } }), /\|IRR\|10%\|TVPI\|1\.1×\|MOIC\|1\.1×\|/);
  assert.match(rows({ irr: -0.25, tvpi: 0.75, moic: 0.75 }), /\|IRR\|-25%\|TVPI\|0\.75×\|/);
  assert.match(rows({ irr: 0 }), /\|IRR\|0%\|/, 'a zero IRR is a recorded rate');
  // Mutation checked: rendering `formatRate(source.irr) ?? '0%'` gives "IRR|0%" here; restored, it passes.
  assert.match(rows({ irr: null, tvpi: 1.1 }), /\|IRR\|Not recorded\|/);
  assert.match(rows({}), /\|IRR\|Not recorded\|TVPI\|Not recorded\|MOIC\|Not recorded\|/);
});

test('the Worker\'s one-year 100 → 110 calculation reaches the tile as 10%', () => {
  const metrics = computeFundMetrics([{ kind: 'contribution', amount: 100, date: '2025-01-01' }], 110, '2026-01-01');
  assert.equal(metrics.irr, 0.1, 'the solver returns a fraction');
  assert.equal(metrics.tvpi, 1.1);
  const drawn = rows({ analytics: metrics });
  // Mutation checked: restoring `${source.irr}%` gives "0.1%"; restored, it passes.
  assert.match(drawn, /\|IRR\|10%\|/);
  assert.doesNotMatch(drawn, /0\.1%/);
  assert.match(drawn, /\|TVPI\|1\.1×\|MOIC\|1\.1×\|/);
});

/**
 * D9199 (#9199) — HQ Revenue's Financial position with no currency to name:
 * the three placeholder tiles say what each read actually did. A read still
 * out is Loading; a failed read is Unavailable (never Loading forever), and
 * its Retry stays. Every figure here is synthetic.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_revenue_placeholder_states_9199.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { UNAVAILABLE, placeholderTiles } from '../src/pages/hq/revenue/revenueModel.js';
import { ExecutiveSummary } from '../src/pages/hq/revenue/ExecutiveSummary.jsx';

const SUMMARY = { licence_fees: { available: true, by_currency: [], active_without_fee: 0 }, temporal: {} };
const REFUNDS = { available: true, by_currency: [] };
const DISPUTES = { disputes: [] };
const render = (props) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
  React.createElement(ExecutiveSummary, { period: '2026-Q4', onRetrySummary() {}, onRetryRefunds() {}, onRetryDisputes() {}, ...props })));

/** The placeholder grid's markup: from its test id to the Retry row that follows it. */
function tilesOf(h) {
  const at = h.indexOf('data-testid="hq-revenue-placeholder-tiles"');
  assert.ok(at >= 0, 'the placeholder tiles are drawn');
  return h.slice(at, h.indexOf('Subscription receipts and AI margin', at));
}
/** Each tile's state: the first value-state mark inside each tile (a Loading figure carries two). */
const states = (fragment) => fragment.split('class="col-span-2"').slice(1).map((tile) => tile.match(/data-value-state="([a-z_]+)"/)?.[1]);
const words = (fragment) => fragment.replace(/<[^>]+>/g, ' ');

test('one failed read and no currency: no placeholder tile is Loading, the failed one is Unavailable, Retry stays', () => {
  const h = render({ summary: SUMMARY, refunds: REFUNDS, disputes: UNAVAILABLE });
  const tiles = tilesOf(h);
  const s = states(tiles);
  assert.equal(s.length, 3);
  assert.ok(!s.includes('loading'), `a tile is still Loading: ${s}`);
  assert.equal(s[2], 'unavailable', 'Open disputes failed and says so');
  assert.match(words(tiles), /Open disputes\s+Unavailable/);
  assert.doesNotMatch(words(tiles), /Loading/);
  assert.match(h, /Retry disputes/);
  assert.doesNotMatch(h, /hq-revenue-no-currency/, 'a failed read is not "nothing in any currency"');
  // Every read failed: all three Unavailable, all three Retry buttons.
  const all = render({ summary: UNAVAILABLE, refunds: UNAVAILABLE, disputes: UNAVAILABLE });
  assert.deepEqual(states(tilesOf(all)), ['unavailable', 'unavailable', 'unavailable']);
  for (const r of ['Retry the revenue summary', 'Retry refunds', 'Retry disputes']) assert.match(all, new RegExp(r));
});

test('while the reads are out the tiles say Loading, and no Retry is offered', () => {
  const h = render({ summary: null, refunds: null, disputes: null });
  const tiles = tilesOf(h);
  assert.deepEqual(states(tiles), ['loading', 'loading', 'loading']);
  assert.match(words(tiles), /Contracted run-rate[\s\S]*Loading/);
  assert.doesNotMatch(h, /Retry/);
  // One out, one failed: each tile in its own read's state.
  assert.deepEqual(placeholderTiles({ summary: null, refunds: UNAVAILABLE, disputes: DISPUTES }).map((t) => t.figure.state), ['loading', 'unavailable', 'zero']);
});

test('every read answered with nothing: no placeholder tiles, the page says there is nothing in any currency', () => {
  assert.equal(placeholderTiles({ summary: SUMMARY, refunds: REFUNDS, disputes: DISPUTES }), null);
  const h = render({ summary: SUMMARY, refunds: REFUNDS, disputes: DISPUTES });
  assert.match(h, /hq-revenue-no-currency/);
  assert.doesNotMatch(h, /hq-revenue-placeholder-tiles/);
  // An answered read that could not see its source is Unavailable, not a zero.
  assert.deepEqual(placeholderTiles({ summary: { licence_fees: { available: false } }, refunds: { available: false }, disputes: null }).map((t) => t.figure.state), ['unavailable', 'unavailable', 'loading']);
});

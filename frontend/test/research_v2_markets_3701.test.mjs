/**
 * D3701 (Research v2, #3701), part 5 — Markets (RS-03): the view is kept in
 * the URL, and an empty result says so with a way out (RS-11 "Empty search").
 *
 * D7171 (#7171) widened the URL to the whole directory view (tab, filters,
 * view, page, open row, thesis) and made grouping the `group=1` toggle (owner
 * answer Q2 A); `research_markets_directory_7171.test.mjs` holds the rest.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_v2_markets_3701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { MARKET_SORTS, readMarketQuery, writeMarketQuery } from '../src/pages/research/MarketDirectoryZone.jsx';
import { DirectoryBody } from '../src/pages/research/MarketDirectory.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;

test('the view reads from the URL; an unknown sort falls back; defaults stay out of it', () => {
  const p = (s) => new URLSearchParams(s);
  const plain = readMarketQuery(p(''));
  assert.equal(plain.sort, MARKET_SORTS[0].value);
  assert.equal(plain.grouped, false, 'Q2 A: flat by default');
  const v = readMarketQuery(p('q=robot&sort=name:asc&group=1'));
  assert.deepEqual([v.q, v.sort, v.grouped], ['robot', 'name:asc', true]);
  // Mutation checked: accept any sort → 'drop table' reaches the request.
  assert.equal(readMarketQuery(p('sort=drop%20table')).sort, MARKET_SORTS[0].value);
  assert.equal(readMarketQuery(p(`q=${'x'.repeat(500)}`)).q.length, 120);
  assert.equal(writeMarketQuery(p('other=x'), plain).toString(), 'other=x');
  assert.equal(writeMarketQuery(p(''), v).toString(), 'q=robot&sort=name%3Aasc&group=1');
});

test('a search that matches nothing says so, and Clear filters is wired', async () => {
  const view = readMarketQuery(new URLSearchParams('q=quantum'));
  let cleared = 0;
  const markup = renderToStaticMarkup(h(MemoryRouter, null, h(DirectoryBody, {
    markets: { status: 'ready', data: { total: 0, directory_total: 82, items: [] } }, view, onPatch: () => {}, onClear: () => { cleared += 1; },
  })));
  assert.match(markup, /data-testid="markets-no-match"/);
  assert.match(markup, /No market matches “quantum”\./);
  assert.match(markup, /Clear filters/);
  // A successful empty directory is a different state from a search with no match.
  const empty = renderToStaticMarkup(h(MemoryRouter, null, h(DirectoryBody, {
    markets: { status: 'ready', data: { total: 0, directory_total: 0, items: [] } }, view, onPatch: () => {},
  })));
  assert.match(empty, /No markets are in the directory yet/);
  assert.doesNotMatch(empty, /No market matches/);

  // Mutation checked: Clear filters wired to nothing → no call.
  const m = await mountContracts(h(DirectoryBody, {
    markets: { status: 'ready', data: { total: 0, directory_total: 82, items: [] } }, view, onPatch: () => {}, onClear: () => { cleared += 1; },
  }), '/research/markets?q=quantum');
  try {
    const btn = m.nodes().find((n) => m.props(n)?.['data-testid'] === 'markets-clear-filters');
    await act(async () => { m.props(btn).onClick(); });
    assert.equal(cleared, 1);
  } finally { await m.unmount(); }
});

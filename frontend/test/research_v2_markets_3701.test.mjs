/**
 * D3701 (Research v2, #3701), part 5 — Markets (RS-03): the search, the sort
 * and the grouping are kept in the URL, and an empty search says so with a
 * Clear search (RS-11 "Empty search").
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_v2_markets_3701.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { MARKET_SORTS, PrivatePanel, readMarketQuery, writeMarketQuery } from '../src/pages/research/MarketDirectoryZone.jsx';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const MARKETS = {
  status: 'ready',
  data: { total: 2, items: [
    { name: 'FinTech', slug: 'fintech', supplied_count: 40, mi_sector: null },
    { name: 'Robotics', slug: 'robotics', supplied_count: 12, mi_sector: null },
  ] },
};

test('the view reads from the URL; an unknown sort falls back; defaults stay out of it', () => {
  const p = (s) => new URLSearchParams(s);
  assert.deepEqual(readMarketQuery(p('')), { q: '', sort: MARKET_SORTS[0].value, grouped: true });
  assert.deepEqual(readMarketQuery(p('q=robot&sort=name:asc&group=0')), { q: 'robot', sort: 'name:asc', grouped: false });
  // Mutation checked: accept any sort → 'drop table' reaches the comparator.
  assert.equal(readMarketQuery(p('sort=drop%20table')).sort, MARKET_SORTS[0].value);
  assert.equal(readMarketQuery(p(`q=${'x'.repeat(500)}`)).q.length, 120);
  assert.equal(writeMarketQuery(p('tab=x'), { q: '', sort: MARKET_SORTS[0].value, grouped: true }).toString(), 'tab=x');
  assert.equal(writeMarketQuery(p(''), { q: 'robot', sort: 'name:asc', grouped: false }).toString(), 'q=robot&sort=name%3Aasc&group=0');
});

test('a search from the URL that matches nothing says so, and Clear search brings the list back', async () => {
  const m = await mountContracts(h(PrivatePanel, { markets: MARKETS }), '/research/markets?q=quantum&group=0');
  try {
    // Mutation checked: `useState('')` for the query again → the URL's search is ignored and both markets show.
    const none = byTid(m, 'markets-no-match');
    assert.ok(none, 'the empty search is its own state');
    assert.match(m.text(), /No market matches “quantum”\./);
    assert.doesNotMatch(m.text(), /Robotics/);
    await act(async () => { m.props(byTid(m, 'markets-clear-search')).onClick(); });
    await m.flush();
    // Mutation checked: Clear search wired to nothing → the empty state stays.
    assert.equal(byTid(m, 'markets-no-match'), null);
    assert.match(m.text(), /FinTech/);
    assert.match(m.text(), /Robotics/);
  } finally { await m.unmount(); }
});

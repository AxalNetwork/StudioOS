// D6171 (#6171) — the deal page's Market tab draws each market's readiness
// (demand, regulation, partners and cost, each with its source or Not
// recorded, never 0 for a missing one) and each sizing figure's source and date.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/deal_market_readiness_6171.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { DealMarket } from '../src/pages/deal/DealInsightTabs.jsx';
import { NOT_RECORDED, marketRow, readinessPart, sizingView } from '../src/pages/deal/dealInsightsModel.js';

const h = React.createElement;
const response = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const CANADA = { name: 'Canada', state: 'entering', decision: 'enter', decided_on: '2026-10-09',
  demand_score: 8, demand_source: 'Pilot waitlist', regulation_score: 0, regulation_source: 'Provincial filing',
  partners_score: null, partners_source: null, cost_score: 6, cost_source: 'typed' };
const GERMANY = { name: 'Germany', state: 'considering', decision: null, decided_on: null,
  demand_score: null, demand_source: null, regulation_score: null, regulation_source: null, partners_score: null, partners_source: null, cost_score: null, cost_source: null };

const MARKET = {
  masked: false,
  sizing: { state: 'recorded', data: {
    tam: { value: 5000000000, source: 'typed', as_of: '2026-11-01', reason: null },
    sam: { value: 700000000, source: 'Synthetic grid report 2026', as_of: '2026-11-02', reason: null },
    som: { value: 77000000, source: null, as_of: null, reason: 'No source recorded for this figure' },
  } },
  sources: { state: 'recorded', data: [] },
  who_pays: { state: 'recorded', data: [] },
  company_markets: { state: 'recorded', data: [CANADA, GERMANY] },
  competitors: { state: 'recorded', data: [] },
  geography: { state: 'not_recorded', reason: 'Not recorded here' },
  evidence: { state: 'not_recorded', reason: 'Not available' },
};

test('a readiness part is its score with its source, Not recorded without one, and a recorded 0 stays 0', () => {
  assert.deepEqual(readinessPart(CANADA, 'demand', 'Demand'), { key: 'demand', label: 'Demand', score: 8, source: 'From Pilot waitlist', text: 'Demand 8/10 · From Pilot waitlist' });
  assert.equal(readinessPart(CANADA, 'regulation', 'Regulation').text, 'Regulation 0/10 · From Provincial filing');
  assert.equal(readinessPart(CANADA, 'partners', 'Partners').text, `Partners ${NOT_RECORDED}`);
  assert.equal(readinessPart(CANADA, 'cost', 'Cost').text, 'Cost 6/10 · Typed · the founder’s own figure');
  assert.equal(readinessPart({ demand_score: 11 }, 'demand', 'Demand').score, null, 'off the 0–10 scale reads as not recorded');
  const row = marketRow(CANADA);
  assert.deepEqual(row.readiness.map((p) => p.score), [8, 0, null, 6]);
  assert.equal(row.where, 'Entering');
  assert.equal(marketRow(GERMANY).readinessText, ['Demand', 'Regulation', 'Partners', 'Cost'].map((l) => `${l} ${NOT_RECORDED}`).join(' · '));
});

test('a sizing figure names its source and its date; a typed one is the founder’s own figure', () => {
  const v = sizingView(MARKET.sizing);
  assert.deepEqual(v.tiles.map((t) => [t.source, t.asOf, t.reason]), [
    ['Typed · the founder’s own figure', 'As of 1 Nov 2026', null],
    ['From Synthetic grid report 2026', 'As of 2 Nov 2026', null],
    [null, null, 'No source recorded for this figure'],
  ]);
});

test('the Market tab draws a readiness line per market and each figure’s date', async () => {
  const restore = installDocument();
  const previous = globalThis.fetch;
  globalThis.fetch = async (u) => (/\/api\/deals\/4\/market$/.test(String(u)) ? response(MARKET) : response({}));
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(MemoryRouter, null, h(DealMarket, { deal: { id: 4 } }))));
    await act(async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); });
    const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
    const text = (n) => (n?.nodeType === 3 ? n.textContent : n?.childNodes?.length ? n.childNodes.map(text).join('') : n?.textContent || '');
    const props = (n) => Object.entries(n).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
    const all = (id) => walk(container).filter((n) => props(n)['data-testid'] === id).map(text);
    const lines = all('deal-market-readiness');
    assert.equal(lines.length, 2, 'one line per market');
    assert.equal(lines[0], `Readiness: Demand 8/10 · From Pilot waitlist · Regulation 0/10 · From Provincial filing · Partners ${NOT_RECORDED} · Cost 6/10 · Typed · the founder’s own figure`);
    assert.ok(lines[1].includes(`Demand ${NOT_RECORDED}`) && !/\d\/10/.test(lines[1]), 'a market with no scores is Not recorded, never 0');
    assert.ok(all('deal-market-tam')[0].includes('Typed · the founder’s own figure'));
    assert.ok(all('deal-market-tam')[0].includes('As of 1 Nov 2026'));
    assert.ok(all('deal-market-sam')[0].includes('From Synthetic grid report 2026'));
    assert.ok(all('deal-market-som')[0].includes('No source recorded for this figure'));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
    restore();
  }
});

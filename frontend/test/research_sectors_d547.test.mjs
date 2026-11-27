import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { SectorProfileView, resolveSectorPage, sectorChartPoints } from '../src/pages/research/SectorProfile.jsx';
import { researchSectorsApi } from '../src/lib/api.js';
import { windowText, windowDay } from '../src/pages/research/indexWindow.js';

const dims = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];
const empty = {
  name: 'Fintech / DeFi', slug: 'fintech-defi', company_count: 0, fund_count: 0,
  dimensions: Object.fromEntries(dims.map((d) => [d, { value: null, change: null, period: null,
    computed_at: null, reason: 'No live source yet for this sector', points: [{ period: '2026-10', value: null, reason: 'No live source yet for this sector', latest_point: true }] }])),
  companies: [], companies_by_country: [], funds: [], sub_markets: [], signals: [],
  source_mix_basis: "Each provider's share of the weight the score used over its window, with its count of distinct observations. Stored when the score was computed.",
};
const populated = {
  ...empty, company_count: 60, fund_count: 100,
  // D7708 — each point names its window; a change names the previous point's; the mix is the stored one.
  dimensions: { ...empty.dimensions,
    research: { value: 62, change: 4, period: '2026-10', computed_at: '2026-10-05',
      window_start: '2026-09-05T04:00:00.000Z', window_end: '2026-10-05T04:00:00.000Z', window_reason: null, context_only: false,
      change_against: { period: '2026-09', window_start: '2026-08-06T04:00:00.000Z', window_end: '2026-09-05T04:00:00.000Z', window_reason: null },
      points: [{ period: '2026-09', value: null, reason: 'No live source' }, { period: '2026-10', value: 62, sources: 2, latest_point: true,
        window_start: '2026-09-05T04:00:00.000Z', window_end: '2026-10-05T04:00:00.000Z',
        source_mix: [{ source_key: 'openalex', name: 'OpenAlex', share: 0.75, observations: 3, scope: 'sector' },
          { source_key: 'crossref', name: 'Crossref', share: 0.25, observations: 1, scope: 'sector' }] }] },
    capital: { value: 48, change: null, period: '2026-10', computed_at: '2026-10-05',
      window_start: '2026-09-05T04:00:00.000Z', window_end: '2026-10-05T04:00:00.000Z', window_reason: null, context_only: true,
      points: [{ period: '2026-10', value: 48, sources: 1, latest_point: true, window_start: '2026-09-05T04:00:00.000Z', window_end: '2026-10-05T04:00:00.000Z',
        source_mix: [{ source_key: 'world_bank', name: 'World Bank', share: 1, observations: 1, scope: 'context', coverage_area: 'World', period_from: '2024', period_to: '2024' }] }] } },
  companies: [{ uid: 'alpha', name: 'Alpha Bank', sector: 'fintech', country: 'United Kingdom', founded_year: null, employee_count: null, as_of: '2026-09-30' }],
  companies_by_country: [{ code: 'GB', name: 'United Kingdom', count: 60 }],
  funds: [{ uid: 'known', name: 'Known Fund', hq: 'London', fund_size_cents: 50_000_000_00, size_currency: 'EUR', fund_year: 2024, eif: true, eifo: false, sector_focus: 'Fintech', as_of: '2026-09-30' },
    { uid: 'unknown', name: 'Unknown Currency Fund', hq: null, fund_size_cents: 999_000_000_00, size_currency: null, size_reason: 'Currency is not recorded', fund_year: null, eif: null, eifo: null }],
  sub_markets: [{ slug: 'fintech', name: 'FinTech', company_count: 3, supplied_count: 900, as_of: '2026-09-30' }],
  signals: [{ id: 'signal', type: 'Opportunity', title: 'Payment rails', why_now: 'New rules', region: 'Europe', country: 'UK', confidence_score: 82, updated_at: '2026-10-05',
    build_opportunity: JSON.stringify({ headline: 'Payment reconciliation', wedge: 'Reconcile once', icp: 'Treasurers', risks: 'Integration cost' }) }],
};
function view(props) {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(SectorProfileView, props)));
  return { html, text: renderedText(html) };
}
test('loading, failed read, missing and empty are distinct rendered states', () => {
  assert.match(view({ loading: true }).text, /Loading sector data/);
  const failure = view({ error: true, data: populated });
  assert.match(failure.text, /Unreadable/); assert.match(failure.text, /Retry/);
  assert.ok(!failure.text.includes('Alpha Bank'));
  assert.match(view({}).text, /Sector or market not found/);
  const { text } = view({ data: empty });
  assert.match(text, /0 directory companies/);
  assert.match(text, /No directory companies/); assert.match(text, /No funds/); assert.match(text, /No signals/);
  assert.match(text, /Not recorded.*No live source/);
  assert.match(text, /No build opportunity/);
});
test('all six dimensions, gaps, provenance, source mix and recorded values render', () => {
  const { text, html } = view({ data: populated });
  for (const d of dims) assert.match(html, new RegExp(`aria-label="${d.charAt(0).toUpperCase() + d.slice(1)} monthly index"`));
  assert.match(text, /62/);
  // D7708 — a change names the window it compares against; no rolling figure is called a month.
  assert.match(text, /\+4% against 6 Aug 2026 to 5 Sep 2026/);
  assert.doesNotMatch(text, /vs previous month|month to date/);
  assert.match(text, /2026-09: Not recorded/); assert.match(text, /latest point, recomputed by each refresh/);
  assert.match(text, /2026-10: 62 · 2 providers · 5 Sep 2026 to 5 Oct 2026/);
  assert.match(text, /Latest point 2026-10 · 5 Sep 2026 to 5 Oct 2026 · computed 2026-10-05/);
  // Share of weight and distinct observations are two labelled figures.
  assert.match(text, /OpenAlexShare of weight 75% · Distinct observations 3/);
  assert.match(text, /CrossrefShare of weight 25% · Distinct observations 1/);
  // A dimension fed only by a copied macro figure says so, with the coverage and period that figure has.
  assert.match(html, /data-testid="sector-global-context"/);
  assert.equal((html.match(/data-testid="sector-global-context"/g) || []).length, 1, 'only capital is copied context');
  assert.match(text, /Global context · the same figure for every sector/);
  assert.match(text, /Copied to every sector · covers World · period 2024/);
  assert.deepEqual(sectorChartPoints(populated.dimensions.research).map((p) => p.value), [null, 62]);
});
test('a point written before D7708 reads window not recorded, never a derived date', () => {
  const old = { ...populated, dimensions: { ...populated.dimensions, research: { ...populated.dimensions.research,
    window_start: null, window_end: null, window_reason: 'Window not recorded', change_against: { period: '2026-09', window_start: null, window_end: null, window_reason: 'Window not recorded' },
    points: [{ period: '2026-10', value: 62, sources: 2, latest_point: true, window_start: null, window_end: null, source_mix: [] }] } } };
  const { text } = view({ data: old });
  assert.match(text, /\+4% against the previous point \(window not recorded\)/);
  assert.match(text, /2026-10: 62 · 2 providers · Window not recorded/);
  assert.match(text, /No source mix is stored for this point/);
});
test('directory totals are independent of the visible rows, and company countries have a linked list', () => {
  const { text, html } = view({ data: populated });
  assert.match(text, /Showing 1 of 60 directory companies/); assert.match(text, /Showing 2 of 100 funds/);
  assert.match(text, /Alpha Bank/); assert.match(text, /United Kingdom/); assert.match(html, /href="\/research\/geographies\/GB"/);
  assert.match(text, /900 supplied by the taxonomy source/); assert.match(text, /not market size/);
});
test('unknown currency is never formatted as euros and build copy comes from the signal', () => {
  const { text } = view({ data: populated });
  assert.match(text, /€50M/); assert.ok(!text.includes('€999'));
  assert.match(text, /Currency is not recorded/); assert.match(text, /LPs not recorded/);
  assert.match(text, /New rules/); assert.match(text, /82%/);
  for (const value of ['Payment reconciliation', 'Reconcile once', 'Treasurers', 'Integration cost']) assert.ok(text.includes(value));
});
test('an old market link redirects to its mapped sector and highlights that market', async () => {
  const notFound = Object.assign(new Error('missing'), { status: 404 });
  const result = await resolveSectorPage('fintech', { get: async () => { throw notFound; } }, { get: async () => ({ sector: { mi_sector: 'Fintech / DeFi' } }) });
  assert.deepEqual(result, { kind: 'redirect', to: '/research/markets/sector/fintech-defi?market=fintech#submarkets' });
  const html = view({ data: populated, highlightedMarket: 'fintech' }).html;
  assert.match(html, /data-highlighted="true"/); assert.match(html, /aria-current="true"/);
  assert.match(view({ data: populated, highlightedMarket: 'different' }).html, /data-highlighted="false"/);
});
test('an unmapped market keeps the existing page; a read failure never triggers that fallback', async () => {
  const notFound = Object.assign(new Error('missing'), { status: 404 });
  const sectors = { get: async () => { throw notFound; } };
  assert.equal((await resolveSectorPage('fashion', sectors, { get: async () => ({ sector: { mi_sector: null } }) })).kind, 'legacy');
  assert.equal((await resolveSectorPage('missing', sectors, { get: async () => { throw notFound; } })).kind, 'missing');
  let marketReads = 0;
  await assert.rejects(resolveSectorPage('fintech', { get: async () => { throw Object.assign(new Error('failed'), { status: 503 }); } },
    { get: async () => { marketReads++; return {}; } }), /failed/);
  assert.equal(marketReads, 0);
  await assert.rejects(resolveSectorPage('fintech', sectors, { get: async () => { throw new Error('market read failed'); } }), /market read failed/);
  assert.equal((await resolveSectorPage('fintech-defi', { get: async () => populated }, { get: async () => { throw new Error('unneeded'); } })).kind, 'sector');
});

test('the re-exported sector client calls the mounted reads and encodes the slug', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const calls = [];
  globalThis.localStorage = { getItem: () => null };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    return new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await researchSectorsApi.list(), { items: [] });
    await researchSectorsApi.get('fintech / defi');
    assert.deepEqual(calls, [
      { url: '/api/research/sectors', method: 'GET' },
      { url: '/api/research/sectors/fintech%20%2F%20defi', method: 'GET' },
    ]);
  } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});

test('a window is printed only when both of its dates are recorded (D7708)', () => {
  assert.equal(windowText({ window_start: '2026-09-05T04:00:00.000Z', window_end: '2026-10-05T04:00:00.000Z' }), '5 Sep 2026 to 5 Oct 2026');
  assert.equal(windowText({ window_start: '2026-09-05T04:00:00.000Z', window_end: null }), 'Window not recorded');
  assert.equal(windowText({ window_start: null, window_end: '2026-10-05T04:00:00.000Z' }), 'Window not recorded');
  assert.equal(windowText(null), 'Window not recorded');
  assert.equal(windowDay('not a date'), null);
  assert.equal(windowDay('2026-13-01'), null);
});

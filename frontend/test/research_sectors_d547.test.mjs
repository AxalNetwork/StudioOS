import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { SectorProfileView, resolveSectorPage, sectorChartPoints } from '../src/pages/research/SectorProfile.jsx';
import { researchSectorsApi } from '../src/lib/api.js';

const dims = ['demand', 'supply', 'capital', 'talent', 'research', 'sentiment'];
const empty = {
  name: 'Fintech / DeFi', slug: 'fintech-defi', company_count: 0, fund_count: 0,
  dimensions: Object.fromEntries(dims.map((d) => [d, { value: null, change: null, period: null,
    computed_at: null, reason: 'No live source yet for this sector', points: [{ period: '2026-10', value: null, reason: 'No live source yet for this sector', month_to_date: true }] }])),
  companies: [], companies_by_country: [], funds: [], sub_markets: [], signals: [],
  source_mix_basis: 'Cited live observations by calendar month; shares count rows, not index weights.',
};
const populated = {
  ...empty, company_count: 60, fund_count: 100,
  dimensions: { ...empty.dimensions, research: { value: 62, change: 4, period: '2026-10', computed_at: '2026-10-05',
    points: [{ period: '2026-09', value: null, reason: 'No live source' }, { period: '2026-10', value: 62, sources: 2, month_to_date: true,
      source_mix: [{ source_key: 'openalex', name: 'OpenAlex', rows: 2, share: 1, latest: '2026-10-05' }] }] } },
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
  assert.match(text, /62/); assert.match(text, /\+4% vs previous month/);
  assert.match(text, /2026-09: Not recorded/); assert.match(text, /month to date/);
  assert.match(text, /computed 2026-10-05/); assert.match(text, /OpenAlex.*2 rows.*100%/);
  assert.deepEqual(sectorChartPoints(populated.dimensions.research).map((p) => p.value), [null, 62]);
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

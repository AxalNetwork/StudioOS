/**
 * D534 (#1079) — the `/research/companies` and `/research/companies/company/:uid`
 * pages, built to the Research · Companies and Research · Company canvases.
 *
 * Pins: the page prints the API's numbers (total, coverage, facets), never a
 * count of its own; loading, no result, Unreadable and Not recorded as the
 * canvases draw them; the bundled directory JSON is no longer read; and
 * `/build/competitors` keeps the company prefill.
 *
 * The Worker half is pinned in cloudflare-worker/test/research_company_directory_d534.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import {
  EMPTY_FILTERS, activeFilters, buildCompetitorsRedirect, directoryParams, employees, indexRows, lastRound,
  latestOnly, listState, money, pageList, pageWindow, relatedSignals, withoutFilter,
} from '../src/lib/companyDirectoryView.js';
import { CoverageCard, DirectoryFilters, DirectoryResults } from '../src/pages/research/CompanyDirectoryZone.jsx';
import { CompanyHeader, Competitors, KeyMetrics, MarketContext, SourcesTable } from '../src/pages/research/CompanyProfile.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const render = (C, props) => renderedText(renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props))));
const noop = () => {};

const row = (k, extra = {}) => ({ uid: `c${k}`, name: `Company ${k}`, website: `https://c${k}.example`, country: 'Germany', founded_year: 2010, sector: 'robotics', ...extra });
const page = (over = {}) => ({
  items: Array.from({ length: 25 }, (_, k) => row(k)), total: 300, limit: 25, offset: 0,
  coverage: { of: 300, fields: { website: 298, country: 251, founded_year: 240, sector: 251, funding: 16, last_round: 18, revenue: 27, headcount: 52 } },
  facets: { sector_labels: [{ label: 'robotics', count: 9 }, { label: 'software industry', count: 4 }], sector_none: 49,
    countries: [{ country: 'France', code: 'FR', count: 20 }, { country: 'Germany', code: 'DE', count: 31 }], has: { funding: 16, revenue: 27, headcount: 52 } },
  ...over,
});

test('the pages no longer read the bundled directory JSON', () => {
  for (const f of ['frontend/src/pages/research/CompanyDirectoryZone.jsx', 'frontend/src/pages/research/CompanyProfile.jsx']) {
    assert.doesNotMatch(read(f), /from\s+['"][^'"]*companyDirectory\.json['"]/, f);
    assert.match(read(f), /researchCompaniesApi/, `${f} reads the API`);
  }
});

test('UI state becomes the list call: empty values left out, has joined, page to offset', () => {
  assert.deepEqual(directoryParams({ ...EMPTY_FILTERS }), {
    q: undefined, sector_label: undefined, country: undefined, founded_from: undefined, founded_to: undefined,
    has: undefined, sort: undefined, limit: 25, offset: 0,
  });
  const p = directoryParams({ ...EMPTY_FILTERS, q: '  acme ', sector_label: 'none', has: ['funding', 'headcount'], sort: '-founded', limit: 50, page: 3 });
  assert.deepEqual([p.q, p.sector_label, p.has, p.sort, p.limit, p.offset], ['acme', 'none', 'funding,headcount', '-founded', 50, 100]);
  assert.equal(directoryParams({ ...EMPTY_FILTERS, limit: 7 }).limit, 25, 'only the sizes the menu offers');
});

test('"1–25 of 300" and the page buttons come from the API total', () => {
  assert.deepEqual(pageWindow(300, 25, 0), { from: 1, to: 25, total: 300, page: 1, pages: 12 });
  assert.deepEqual(pageWindow(300, 25, 275), { from: 276, to: 300, total: 300, page: 12, pages: 12 });
  assert.equal(pageWindow(301, 25, 0).pages, 13, 'a part page is a page');
  assert.deepEqual(pageWindow(0, 25, 0), { from: 0, to: 0, total: 0, page: 1, pages: 1 });
  assert.deepEqual(pageList(1, 12), [1, 2, '…', 12]);
  assert.deepEqual(pageList(6, 12), [1, '…', 5, 6, 7, '…', 12]);
  assert.deepEqual(pageList(2, 3), [1, 2, 3]);
});

test('money, last round and employees: a value with its currency, or null — never a zero', () => {
  assert.equal(money(7_000_000, 'USD'), 'USD 7M');
  assert.equal(money(1_250_000_000, 'EUR'), 'EUR 1.3B');
  assert.equal(money(0, 'USD'), 'USD 0', 'a recorded zero is shown as recorded');
  assert.equal(money(null, 'USD'), null);
  assert.deepEqual(lastRound({ last_funding_amount: 7e6, last_funding_currency: 'USD', last_funding_type: 'Series A', last_funding_date: '2026-03-01' }),
    { amount: 'USD 7M', detail: 'Series A · 2026-03-01' });
  assert.equal(lastRound({ last_funding_amount: null }), null);
  assert.deepEqual(employees({ employee_count: 1200, employee_growth_pct: -3 }), { count: '1,200', growth: '−3% growth' });
  assert.equal(employees({ employee_count: null }), null);
});

test('a failed read is unreadable, not an empty directory', () => {
  assert.equal(listState({ loading: true }), 'loading');
  assert.equal(listState({ loading: false, error: new Error('x'), data: null }), 'unreadable');
  assert.equal(listState({ loading: false, error: null, data: { items: [] } }), 'empty');
  assert.equal(listState({ loading: false, error: null, data: { items: [row(1)] } }), 'ready');
});

test('the results print the API total and the coverage counts, not the rows on the page', () => {
  const t = render(DirectoryResults, { state: 'ready', data: page(), filters: { ...EMPTY_FILTERS }, onChange: noop, onRetry: noop });
  assert.match(t, /1–25 of 300 companies/);
  assert.match(t, /Last round\s*recorded for 18/);
  assert.match(t, /Employees\s*recorded for 52/);
  assert.match(t, /Page 1 of 12/);
  const c = render(CoverageCard, { coverage: page().coverage });
  assert.match(c, /of 300/);
  assert.match(c, /Revenue\s*27\s*\/ 300/);
});

test('a missing value in a row reads Not recorded', () => {
  const data = page({ items: [row(1, { sector: null, country: null, founded_year: null })], total: 1 });
  const t = render(DirectoryResults, { state: 'ready', data, filters: { ...EMPTY_FILTERS }, onChange: noop, onRetry: noop });
  assert.equal((t.match(/Not recorded/g) || []).length, 5, 'sector, country, founded, last round, employees');
});

test('loading shows no count; Unreadable shows no rows and no count', () => {
  const loading = render(DirectoryResults, { state: 'loading', data: null, filters: { ...EMPTY_FILTERS }, onChange: noop, onRetry: noop });
  assert.match(loading, /Loading companies…/);
  assert.doesNotMatch(loading, /\d+ companies/);
  const bad = render(DirectoryResults, { state: 'unreadable', data: null, filters: { ...EMPTY_FILTERS }, onChange: noop, onRetry: noop });
  assert.match(bad, /Read failed/);
  assert.match(bad, /a failed read is not zero companies/);
  assert.match(bad, /Try again/);
  assert.doesNotMatch(bad, /of \d+ companies|0 companies/);
});

test('No results names the search and each filter, with a way to remove it', () => {
  const filters = { ...EMPTY_FILTERS, q: 'zeta', country: 'France', has: ['revenue'] };
  const t = render(DirectoryResults, { state: 'empty', data: { items: [], total: 0 }, filters, onChange: noop, onRetry: noop });
  assert.match(t, /No company matches “zeta” with these filters\./);
  assert.match(t, /Country: France/);
  assert.match(t, /Revenue recorded/);
  assert.match(t, /Clear all filters/);
  assert.deepEqual(activeFilters(filters).map((c) => c.key), ['country', 'has:revenue']);
  const less = withoutFilter({ ...filters, page: 4 }, 'has:revenue');
  assert.deepEqual([less.has, less.country, less.page], [[], 'France', 1]);
});

test('filter options carry the facet counts, including the unlabelled', () => {
  const t = render(DirectoryFilters, { filters: { ...EMPTY_FILTERS }, facets: page().facets, onChange: noop, onToggle: noop });
  assert.match(t, /All sector labels \(2\)/);
  assert.match(t, /robotics \(9\)/);
  assert.match(t, /No sector label \(49\)/);
  assert.match(t, /All countries \(2\)/);
  assert.match(t, /Germany \(31\)/);
  assert.match(t, /Headcount recorded\s*52/);
});

test('/build/competitors keeps the company prefill, on the Saved analyses tab', () => {
  assert.equal(buildCompetitorsRedirect('?market=Acme&website=https%3A%2F%2Facme.example'),
    '/research/companies?tab=analyses&market=Acme&website=https%3A%2F%2Facme.example');
  assert.equal(buildCompetitorsRedirect(''), '/research/companies?tab=analyses');
  assert.match(read('frontend/src/App.jsx'), /buildCompetitorsRedirect\(location\.search\)/);
});

test('the company: a metric no source holds reads Not recorded with why, never a zero', () => {
  const metrics = {
    funding_total: { status: 'recorded', value: 5e7, currency: 'USD', source_name: 'Company filings', as_of: '2026-09-30' },
    last_funding: { status: 'not_recorded', value: null },
    valuation: { status: 'not_recorded', value: null },
    revenue: { status: 'not_recorded', value: null },
    headcount: { status: 'recorded', value: 120, as_of: '2026-06-01', growth_pct: null, source_name: 'Company filings' },
    market_share_pct: { status: 'not_recorded', value: null },
    confidence: 'medium',
  };
  const t = render(KeyMetrics, { metrics });
  assert.match(t, /USD 50M/);
  assert.match(t, /Company filings · as of 2026-09-30/);
  assert.match(t, /Confidence: medium/);
  assert.match(t, /Valuation\s*Not recorded\s*No source lists a valuation/);
  assert.match(t, /Employee growth\s*Not recorded/, 'a headcount without growth is not a growth of zero');
  assert.doesNotMatch(t, /USD 0|\b0%/);
});

test('competitors print the API total beyond the eight shown', () => {
  const peers = { status: 'ok', total: 11, rows: [{ uid: 'p', name: 'Peer', country: 'Germany', same_country: 1, founded_year: 2001 }] };
  const t = render(Competitors, { item: { sector: 'robotics' }, peers });
  assert.match(t, /11 companies share this label/);
  assert.match(t, /Same country/);
  assert.match(t, /See all 11 with this label in Companies/);
  const none = render(Competitors, { item: { sector: null }, peers: { status: 'not_recorded', rows: [], total: null } });
  assert.match(none, /Not recorded\. This company has no sector label/);
});

test('market context: a dimension with no live point is Not recorded with the reason, never 50', () => {
  const index = { series: { demand: { status: 'recorded', points: [{ period: '2026-09', value: 61, change: 2.5 }, { period: '2026-10', value: 64, change: 3, month_to_date: true }] },
    supply: { status: 'not_recorded', reason: 'No live source', points: [] } } };
  const rows = indexRows(index);
  assert.deepEqual([rows[0].value, rows[0].change, rows[0].month_to_date], [64, '+3%', true]);
  assert.deepEqual([rows[1].state, rows[1].reason], ['not_recorded', 'No live source']);
  const t = render(MarketContext, { tracked: { status: 'ok', slug: 'autotech', name: 'AutoTech', method: 'rule' }, market: { loading: false, error: null, data: { index } } });
  assert.match(t, /Market context: AutoTech/);
  assert.match(t, /Open AutoTech →/);
  const none = render(MarketContext, { tracked: { status: 'not_recorded', reason: 'Not recorded: the crosswalk maps no market to this sector label' }, market: {} });
  assert.match(none, /Not recorded\. the crosswalk maps no market/);
});

test('signals: sector matches first, each signal once, labelled with what it matched', () => {
  const s = relatedSignals([{ id: 1, title: 'A' }, { id: 2, title: 'B' }], [{ id: 2, title: 'B' }, { id: 3, title: 'C' }]);
  assert.deepEqual(s.map((x) => [x.id, x.match]), [[1, 'Sector'], [2, 'Sector and country'], [3, 'Country']]);
});

test('sources: a failed evidence table is Unreadable on its own row; statuses read as stored or Not recorded', () => {
  const t = render(SourcesTable, {
    item: { as_of: '2026-09-30', source_url: 'https://www.wikidata.org/wiki/Q1', sector: 'robotics', competitor_status: 'tracked', diligence_status: null },
    metrics: { funding_total: { status: 'not_recorded' } },
    financials: { status: 'unreadable', rows: [] }, employment: { status: 'ok', rows: [{}, {}] }, sources: { status: 'ok', rows: [] },
  });
  assert.match(t, /Financial statements\s*Unreadable: read failed/);
  assert.match(t, /Headcount history\s*2 rows/);
  assert.match(t, /Field sources\s*Not recorded/);
  assert.match(t, /Competitor status\s*tracked/);
  assert.match(t, /Diligence status\s*Not recorded/);
});

test('description, logo and investors read Not recorded, because no source holds them', () => {
  const t = render(CompanyHeader, { item: { name: 'Acme', website: 'https://acme.example', sector: 'robotics', country: 'Germany', founded_year: 2015 },
    tracked: { status: 'not_recorded' } });
  assert.match(t, /Description\s*Not recorded · no source holds one/);
  assert.match(t, /Logo\s*Not recorded/);
  assert.match(t, /Investors\s*Not recorded · no source lists them/);
  assert.match(t, /Tracked sector: Not recorded/);
  assert.match(t, /Run competitor analysis/);
});

test('only the newest read lands: an older list or profile read is dropped', () => {
  const reads = latestOnly();
  const first = reads.next();
  const second = reads.next();
  assert.equal(reads.isCurrent(first), false, 'a read that started before the newest one must not land');
  assert.equal(reads.isCurrent(second), true);
  for (const f of ['frontend/src/pages/research/CompanyDirectoryZone.jsx', 'frontend/src/pages/research/CompanyProfile.jsx']) {
    const src = read(f);
    assert.match(src, /const id = reads\.next\(\);/, `${f} does not start a guarded read`);
    assert.ok((src.match(/reads\.isCurrent\(id\)/g) || []).length >= 2, `${f} commits a read without checking it is the newest`);
  }
});

test('sources: funding rounds are listed, and a failed rounds read is Unreadable on its own row', () => {
  const base = { item: { as_of: '2026-09-30', sector: null }, metrics: {},
    financials: { status: 'ok', rows: [] }, employment: { status: 'ok', rows: [] }, sources: { status: 'ok', rows: [] } };
  assert.match(render(SourcesTable, { ...base, fundingRounds: { status: 'ok', rows: [{}, {}, {}] } }), /Funding rounds\s*3 rows/);
  assert.match(render(SourcesTable, { ...base, fundingRounds: { status: 'unreadable', rows: [] } }), /Funding rounds\s*Unreadable: read failed/);
  assert.match(read('frontend/src/pages/research/CompanyProfile.jsx'), /fundingRounds=\{d\.funding_rounds\}/);
});

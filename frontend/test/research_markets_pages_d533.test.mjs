/**
 * D533 (#1080) — the Markets and Geographies pages, to the D546 canvases.
 *
 * Each section is rendered in each state of its read: loading, unreadable
 * (the read failed), empty (it worked and holds nothing) and ready. The
 * distinction the pages exist to hold is the one between the middle two: a
 * failed read must never print as "none", and nothing a source does not hold
 * may print as a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  PrivatePanel, PublicPanel, GovernmentPanel, WhereBased, LatestSignals, Readings,
  groupMarkets, sectorSlug,
} from '../src/pages/research/MarketDirectoryZone.jsx';
import { GeographiesList } from '../src/pages/research/GeographiesZone.jsx';
import { GeographyBody, GeographyState, euroMillions, backingLabel } from '../src/pages/research/GeographyProfile.jsx';
import { researchMarketsApi } from '../src/lib/api/researchMarkets.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const text = (el) => html(el).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const loading = { status: 'loading', data: null };
const unreadable = { status: 'unreadable', data: null };
const ready = (data) => ({ status: 'ready', data });

const MARKETS = {
  total: 3,
  items: [
    { slug: 'fintech', name: 'FinTech', mi_sector: 'Fintech / DeFi', company_count: 3, supplied_count: 900, as_of: '2026-09-30' },
    { slug: 'payments', name: 'Payments', mi_sector: 'Fintech / DeFi', company_count: 0, supplied_count: 10, as_of: '2026-09-30' },
    { slug: 'fashion', name: 'Fashion', mi_sector: null, company_count: 0, supplied_count: 50, as_of: '2026-09-30' },
  ],
};

// ---- Markets ---------------------------------------------------------------

test('markets group by tracked sector, the unmapped last and said so; counts are summed per group', () => {
  const g = groupMarkets(MARKETS.items);
  // D593 — the unmapped group takes the canvas M1 wording.
  assert.deepEqual(g.map((x) => [x.name, x.markets.length, x.companies, x.mapped]), [
    ['Fintech / DeFi', 2, 910, true],
    ['Not mapped yet', 1, 50, false],
  ]);
  assert.equal(g[0].slug, 'fintech-defi');
  assert.equal(g[1].slug, null, 'an unmapped group has no sector page to open');
  assert.equal(sectorSlug('Data / Analytics'), 'data-analytics');
});

test('the private tab: each state, and the totals the API sends', () => {
  assert.match(text(h(PrivatePanel, { markets: loading })), /Loading the markets/);
  const bad = text(h(PrivatePanel, { markets: unreadable }));
  assert.match(bad, /could not be read/);
  assert.doesNotMatch(bad, /No markets/, 'a failed read is not "none"');
  assert.match(text(h(PrivatePanel, { markets: ready({ total: 0, items: [] }) })), /No markets are in the directory yet/);
  const ok = text(h(PrivatePanel, { markets: ready(MARKETS) }));
  assert.match(ok, /3 markets holding 960 companies, as the taxonomy source counts them/);
  assert.match(ok, /not independently verified/);
  assert.match(ok, /Not mapped yet 1 markets · no index applies/);
  assert.match(ok, /Fintech \/ DeFi 2 markets · 910 companies/);
  const markup = html(h(PrivatePanel, { markets: ready(MARKETS) }));
  // D593 — #1139's per-sector page landed (D547), so a sector group opens it.
  // The unmapped group has no sector page, and no link.
  assert.match(markup, /href="\/research\/markets\/sector\/fintech-defi"/, 'a sector group opens its own page');
  assert.equal((markup.match(/Open sector/g) || []).length, 1, 'one link, on the one sector group');
  assert.match(markup, /href="\/research\/markets\/sector\/payments"/, 'a market opens its own page');
});

test('the public tab: listed companies with bands as sent, unknown values Not recorded; failed read is not empty', () => {
  const bad = text(h(PublicPanel, { listed: unreadable }));
  assert.match(bad, /could not be read/);
  assert.doesNotMatch(bad, /No listed companies/);
  assert.match(text(h(PublicPanel, { listed: ready({ total: 0, items: [] }) })), /No listed companies are recorded yet/);
  const ok = text(h(PublicPanel, { listed: ready({
    total: 2, as_of: '2026-10-02 00:00:00',
    items: [
      { symbol: 'NU', name: 'Nu Holdings', exchange: 'NYSE', country: 'Brazil', market_cap_band: 'large', employee_band: '5k-20k' },
      { symbol: 'ZZZ', name: 'Quiet Co', exchange: null, country: null, market_cap_band: null, employee_band: null },
    ],
  }) }));
  assert.match(ok, /These 2 are known to be listed\. The company directory/);
  assert.match(ok, /NU Nu Holdings NYSE Brazil large 5k-20k/);
  assert.match(ok, /ZZZ Quiet Co Not recorded Not recorded Not recorded Not recorded/);
  assert.match(ok, /signal_companies · 2 listed companies · bands as the source sets them · as of 2026-10-02/);
});

test('D595: the public tab labels each row by source, prints the API\'s counts and source lines, and pages on the Worker', () => {
  const EDGAR_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
  const data = {
    total: 10234, offset: 50, limit: 50, as_of: '2026-10-02 00:00:00',
    items: [
      { source: 'signal_companies', symbol: 'NU', name: 'Nu Holdings', exchange: 'NYSE', country: 'Brazil', market_cap_band: 'large', employee_band: '5k-20k' },
      { source: 'sec_edgar', symbol: 'AAPL', name: 'Apple Inc.', exchange: 'Nasdaq', cik: '0000320193', source_url: EDGAR_URL },
      { source: 'sec_edgar', symbol: 'QQQX', name: 'Quiet Trust', exchange: null, cik: '0000000009', source_url: EDGAR_URL },
    ],
    sources: [
      { key: 'signal_companies', label: 'StudioOS signal companies', total: 21, as_of: '2026-10-02 00:00:00' },
      { key: 'sec_edgar', label: 'SEC EDGAR', total: 10213, as_of: '2026-10-06', url: EDGAR_URL,
        licence: 'US government work, not subject to copyright in the United States (17 U.S.C. § 105)', also_signal_companies: 7 },
    ],
  };
  const out = html(h(PublicPanel, { listed: ready(data), onPage: () => {} }));
  const t = text(h(PublicPanel, { listed: ready(data), onPage: () => {} }));
  assert.match(t, /These 10,234 are known to be listed: 21 signal companies, with bands, and 10,213 from SEC EDGAR\./);
  assert.match(t, /NU Nu Holdings NYSE Brazil large 5k-20k Signal companies/);
  assert.match(t, /AAPL Apple Inc\. CIK 0000320193 Nasdaq Not recorded Not recorded Not recorded SEC EDGAR/);
  assert.match(t, /QQQX Quiet Trust CIK 0000000009 Not recorded Not recorded Not recorded Not recorded SEC EDGAR/);
  assert.match(t, /51–53 of 10,234 Previous Next/);
  assert.match(t, /signal_companies · 21 listed companies · bands as the source sets them · as of 2026-10-02/);
  assert.match(t, /SEC EDGAR · 10,213 companies · read 2026-10-06 · US government work, not subject to copyright in the United States \(17 U\.S\.C\. § 105\)/);
  assert.match(t, /7 of its tickers are also a signal company, listed once per source/);
  // Counted as an exact string, so no pattern is built from the URL (CodeQL: incomplete hostname regex).
  assert.equal(out.split(`href="${EDGAR_URL}"`).length - 1, 3, 'each EDGAR row and the source line link the file');
  assert.doesNotMatch(out, /disabled="" [^>]*>Previous/, 'Previous is live past the first page');
  const first = text(h(PublicPanel, { listed: ready({ ...data, offset: 0, items: data.items.slice(0, 1), total: 1, sources: [] }) }));
  assert.doesNotMatch(first, /Previous|Next/, 'one page needs no pager');

  const src = read('frontend/src/pages/research/MarketDirectoryZone.jsx');
  assert.match(src, /listedCompanies\(\{ limit: LISTED_PAGE, offset: listedOffset \|\| undefined \}\), listedOffset\)/, 'the page asks the Worker for one page at a time');
  assert.doesNotMatch(src, /10,?2\d\d|10213/, 'no count is written into the page');
});

test('the government tab reads Not recorded with the reason, never a figure', () => {
  const gov = text(h(GovernmentPanel));
  assert.match(gov, /Not recorded/);
  assert.match(gov, /No source lists government-owned companies/);
  assert.doesNotMatch(gov, /\d/);
});

test('where companies are based: totals from the API, unmapped said, failed read not empty', () => {
  assert.match(text(h(WhereBased, { geos: unreadable })), /could not be read/);
  assert.match(text(h(WhereBased, { geos: ready({ total: 0, items: [] }) })), /No directory company has a country that maps yet/);
  const items = Array.from({ length: 14 }, (_, i) => ({ code: `C${i}`, name: `Country ${i}`, company_count: 20 - i, fund_count: 0 }));
  // A country with funds and no company is in /geographies but not in this card.
  items.push({ code: 'FO', name: 'Funds Only', company_count: 0, fund_count: 9 });
  const ok = text(h(WhereBased, { geos: ready({ total: 15, items, companies_unmapped: 4 }) }));
  assert.doesNotMatch(ok, /Funds Only/);
  assert.match(text(h(WhereBased, { geos: ready({ total: 1, items: [items.at(-1)], companies_unmapped: 0 }) })),
    /No directory company has a country that maps yet/, 'fund-only countries are not a company footprint');
  const placed = items.reduce((s, k) => s + k.company_count, 0);
  assert.match(ok, new RegExp(`${placed + 4} companies in 14 countries, and 4 whose country does not map`));
  assert.match(ok, /2 more countries →/);
  assert.doesNotMatch(ok, /Country 12/, 'twelve are shown');
});

test('latest signals: illustrative seed signals say so; a failed read is not empty', () => {
  assert.match(text(h(LatestSignals, { sigs: unreadable })), /could not be read/);
  assert.match(text(h(LatestSignals, { sigs: ready({ signals: [], total: 0 }) })), /No signals are recorded yet/);
  const seed = text(h(LatestSignals, { sigs: ready({ total: 10, data_state: 'illustrative', signals: [
    { id: 'a', title: 'Payments rails', sector: 'Financial Services', region: 'Europe', confidence_score: 0.62, updated_at: '2026-10-01T00:00:00Z' },
  ] }) }));
  assert.match(seed, /Illustrative/);
  assert.match(seed, /Payments rails Financial Services · Europe · confidence 62% · updated 2026-10-01/);
  assert.match(seed, /1 of 10/);
  assert.match(seed, /Top-ranked signals/);
  assert.match(seed, /Ordered by the signals engine’s rank, not by date/);
  assert.doesNotMatch(seed, /Latest signals/, 'the card is ranked, not by recency');
  const live = text(h(LatestSignals, { sigs: ready({ total: 1, data_state: 'live', signals: [{ id: 'a', title: 'T', sector: 'S', region: 'R' }] }) }));
  assert.doesNotMatch(live, /Illustrative/);
});

test('market readings are the way back into /research/markets/:uid; a never-run row has no link', () => {
  const markup = html(h(Readings, { readings: ready({ items: [
    { uid: 'r-1', metric: 'Advisory day rate', ran_at: '2026-09-02T00:00:00Z' },
    { uid: null, metric: 'Never run', ran_at: null },
  ] }) }));
  assert.match(markup, /href="\/research\/markets\/r-1"/);
  assert.doesNotMatch(markup, /Never run/);
  assert.match(text(h(Readings, { readings: ready({ items: [] }) })), /You have not run a market reading yet/);
  assert.match(text(h(Readings, { readings: unreadable })), /could not be read/);
});

test('the Markets page reads the Worker, not the bundled directory or the red-always ETF tiles', () => {
  const src = read('frontend/src/pages/research/MarketDirectoryZone.jsx');
  assert.doesNotMatch(src, /from '[^']*(marketDirectory|financialSnapshots)\.json'/);
  assert.doesNotMatch(src, /text-red-700/);
  assert.doesNotMatch(src, /advisor_note/);
});

// ---- Geographies ------------------------------------------------------------

test('the countries list: each state, and the unmapped counted out loud', () => {
  assert.match(text(h(GeographiesList, { geos: loading })), /Loading the countries/);
  const bad = text(h(GeographiesList, { geos: unreadable }));
  assert.match(bad, /could not be read/);
  assert.doesNotMatch(bad, /No directory company/);
  assert.match(text(h(GeographiesList, { geos: ready({ total: 0, items: [], companies_unmapped: 0, funds_unmapped: 0 }) })), /No directory company or fund has a country that maps yet/);
  const data = ready({ total: 2, companies_unmapped: 3, funds_unmapped: 5, items: [
    { code: 'GB', name: 'United Kingdom', region: 'Europe', company_count: 2, fund_count: 1 },
    { code: 'US', name: 'United States', region: 'North America', company_count: 1, fund_count: 0 },
  ] });
  const ok = text(h(GeographiesList, { geos: data }));
  assert.match(ok, /2 countries hold a directory company or fund\. 3 companies and 5 funds name no country/);
  assert.match(ok, /United Kingdom Europe 2 1/);
  assert.match(html(h(GeographiesList, { geos: data })), /href="\/research\/geographies\/GB"/);
  assert.match(text(h(GeographiesList, { geos: data, query: 'us' })), /United States/);
  assert.doesNotMatch(text(h(GeographiesList, { geos: data, query: 'us' })), /United Kingdom/);
});

const COUNTRY = {
  item: { code: 'GB', name: 'United Kingdom', region: 'Europe' },
  totals: { companies: 300, funds: 2032, signals: 10 },
  as_of: { companies: '2026-09-30', funds: '2026-09-29', signals: '2026-10-02 00:00:00' },
  company_count: 2,
  companies_by_label: [{ label: 'bank', count: 1 }],
  companies_without_label: 1,
  companies: [
    { uid: 'c6', name: 'Zeta Labs', sector: null, founded_year: null, employee_count: 4000, last_round: null },
    { uid: 'c4', name: 'Delta Group', sector: 'bank', founded_year: 1999, employee_count: 120,
      last_round: { amount: 5000000, currency: 'GBP', date: '2026-03-01', type: 'Series A' } },
    { uid: 'c1', name: 'Alpha Bank', sector: 'bank', founded_year: 2001, employee_count: null, last_round: null },
  ],
  fund_count: 3,
  fund_aggregates: {
    count: 3, with_size: 2, with_vintage: 1, with_focus: 2, no_focus: 1, size_not_recorded: 1,
    size_bands: [{ key: 'lt50', label: 'Under €50M', count: 1 }, { key: 'gte500', label: '€500M and over', count: 1 }],
    focus_keywords: [{ label: 'AI', count: 2 }], as_of: '2026-09-30',
  },
  funds: [
    { uid: 'g2', name: 'London Growth', hq: 'London', fund_size_cents: 60000000000, fund_year: null, sector_focus: 'AI', eif: false, eifo: false },
    { uid: 'g1', name: 'London Seed', hq: 'London', fund_size_cents: 3000000000, fund_year: 2021, sector_focus: 'AI', eif: true, eifo: null },
    { uid: 'g3', name: 'London Other', hq: 'London', fund_size_cents: null, size_reason: 'Not recorded: this list records no size in a known currency', fund_year: null, sector_focus: '', eif: null, eifo: null },
  ],
  signals: [
    { id: 's1', title: 'Payments rails', sector: 'Financial Services', why_now: 'Open banking', build_headline: null, confidence_score: 0.5, updated_at: '2026-10-01', match: 'country' },
    { id: 'r1', title: 'Europe-wide ops', sector: 'Technology', why_now: '', build_headline: 'Ops for EU SMBs', confidence_score: 0.7, updated_at: '2026-10-02', match: 'region' },
  ],
  demand: { status: 'not_recorded', reason: 'Demand data is global only. The sector indexes are computed worldwide, so no per-country demand is stored.' },
};

test('one country: totals of the whole directory, demand Not recorded with its reason', () => {
  const t = text(h(GeographyBody, { data: COUNTRY }));
  assert.match(t, /Directory companies 2 of 300 · research_company_directory · as of 2026-09-30/);
  assert.match(t, /Funds headquartered here 3 of 2,032/);
  assert.match(t, /Signals naming it 2 of 10 · by country or by region · as of 2026-10-02/);
  assert.match(t, /Demand in United Kingdom Not recorded Demand data is global only/);
});

test('one country: companies by headcount, unknowns Not recorded, the unlabelled counted', () => {
  const t = text(h(GeographyBody, { data: COUNTRY }));
  assert.match(t, /Zeta Labs Not recorded Not recorded 4,000 Not recorded/);
  assert.match(t, /Delta Group bank 1999 120 5,000,000 GBP · Series A/);
  assert.match(t, /Alpha Bank bank 2001 Not recorded Not recorded/, 'no headcount is Not recorded, never 0');
  assert.match(t, /No sector label Not recorded 1/);
  const founder = html(h(GeographyBody, { data: COUNTRY, role: 'founder' }));
  assert.match(founder, /href="\/research\/companies\/company\/c6"/);
  const investor = html(h(GeographyBody, { data: COUNTRY, role: 'investor' }));
  assert.doesNotMatch(investor, /\/research\/companies\/company\//, 'no link to a page the licence cannot open');
});

test('one country: fund sizes only in euros, EIF/EIFO yes, no or LPs not recorded', () => {
  assert.equal(euroMillions(60000000000), '€600M');
  assert.equal(euroMillions(3000000000), '€30M');
  assert.equal(euroMillions(50000000), '€0.5M');
  assert.equal(euroMillions(null), null);
  assert.equal(backingLabel({ eif: true, eifo: null }), 'EIF');
  assert.equal(backingLabel({ eif: true, eifo: true }), 'EIF, EIFO');
  assert.equal(backingLabel({ eif: false, eifo: false }), 'Neither named');
  assert.equal(backingLabel({ eif: null, eifo: null }), null);
  assert.equal(backingLabel({ eif: false, eifo: null }), null, 'one unknown is not "neither"');
  const t = text(h(GeographyBody, { data: COUNTRY }));
  assert.match(t, /London Growth London €600M Not recorded AI Neither named/);
  assert.match(t, /London Seed London €30M 2021 AI EIF/);
  assert.match(t, /London Other London Not recorded Not recorded Not recorded LPs not recorded/);
  assert.match(t, /2 with a size, 1 with a vintage, 2 with a stated focus/);
  assert.match(t, /1 with no size in a known currency/);
  assert.match(t, /1 funds state no focus/);
  assert.match(html(h(GeographyBody, { data: COUNTRY })), /title="Not recorded: this list records no size in a known currency"/);
});

test('one country: a regional signal says it names the region, not the country', () => {
  const markup = html(h(GeographyBody, { data: COUNTRY }));
  const matches = [...markup.matchAll(/data-testid="signal-match"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(matches, ['Names United Kingdom', 'Names Europe']);
  const t = text(h(GeographyBody, { data: COUNTRY }));
  assert.match(t, /Why now Not recorded/);
  assert.match(t, /What a founder could build Not recorded/);
  assert.match(t, /What a founder could build Ops for EU SMBs/);
});

test('one country: not found is an answer; a failed read is not', () => {
  const nf = text(h(GeographyState, { geo: { status: 'not_found', data: null }, code: 'ZZ' }));
  assert.match(nf, /No country has the code ZZ/);
  const bad = text(h(GeographyState, { geo: unreadable, code: 'GB' }));
  assert.match(bad, /could not be read/);
  assert.doesNotMatch(bad, /No country has/);
  assert.match(text(h(GeographyState, { geo: loading, code: 'GB' })), /Loading GB/);
});

test('the client calls the Worker routes, listed companies included', async () => {
  const calls = [];
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.document ??= { cookie: '' };
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    await researchMarketsApi.listedCompanies({ q: 'nu', sort: 'name', country: '' });
    await researchMarketsApi.geography('gb');
  } finally { globalThis.fetch = orig; }
  assert.match(calls[0], /\/api\/research\/listed-companies\?q=nu&sort=name$/);
  assert.match(calls[1], /\/api\/research\/geographies\/gb$/);
});

test('Geographies is a zone pill beside Markets, and both routes are guarded like Markets', () => {
  const shell = read('frontend/src/workspaces/shellConfig.js');
  assert.equal((shell.match(/\{ slug: 'markets', label: 'Markets', archetype: A\.ANALYTICS \},\n\s+\{ slug: 'geographies', label: 'Geographies', archetype: A\.ANALYTICS \}/g) || []).length, 4);
  const app = read('frontend/src/App.jsx');
  const guard = "guard(labRoles(['admin', 'founder', 'partner', 'investor', 'advisor'])";
  assert.ok(app.includes(`<Route path="/research/geographies" element={${guard}, <ResearchWorkspace`));
  assert.ok(app.includes(`<Route path="/research/geographies/:code" element={${guard}, <GeographyProfile`));
});

test('one country: a capped list says it is the first rows of the whole count', () => {
  const many = { ...COUNTRY, fund_count: 344, company_count: 120 };
  const t = text(h(GeographyBody, { data: many }));
  assert.match(t, /The first 3 of 344 funds are listed here; the counts above cover all 344/);
  assert.match(t, /The first 3 of 120 companies are listed here/);
  const exact = text(h(GeographyBody, { data: { ...COUNTRY, fund_count: 3, company_count: 3 } }));
  assert.doesNotMatch(exact, /are listed here/, 'a complete list carries no notice');
});

/**
 * D7166 (#7166) — Research › Funds directory to its canvas (boards RFD-00 to
 * RFD-05): one row per vehicle, sizes in each list's own currency, results
 * first with coverage in a disclosure below, the size filter in one currency
 * that says what it leaves out, chips and the facet hint, phone cards, "Save
 * to shortlist", the "opened from a link" line, the sign-in return to Funds,
 * and Back to results. Rendered with react-dom/server; wiring read as source.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_funds_directory_7166.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';

const read = await import('../src/pages/research/fundDirectoryRead.js');
const { FundDirectoryView } = await import('../src/pages/research/FundDirectory.jsx');
const { FundCatalogView } = await import('../src/pages/research/FundCatalogProfile.jsx');
const next = await import('../src/lib/pendingNext.js');
const src = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));

const EUR = 'EuroTech VC Funds (public spreadsheet)';
const USD = 'Shai Goldman — new VC funds at/below $200M';
const M = 100_000_000; // one million, in cents
const row = (o) => ({
  website: null, linkedin: null, hq: 'UK', fund_number: null, fund_size_cents: null, fund_date: '2023-09-25', quarter: null,
  fund_year: 2023, sector_focus: 'B2B-Software', notable_lps: null, eif: null, eifo: null, size_currency: null,
  source_name: EUR, source_url: 'https://example.org/eurotech', as_of: '2026-11-18', ...o,
});
const OPP = row({ uid: 'dawncapital-opp', name: 'Dawn Capital', fund_number: 'Opp', fund_size_cents: 75 * M, size_currency: 'EUR' });
const FIVE = row({ uid: 'dawncapital-v', name: 'Dawn Capital', fund_number: 'V', fund_size_cents: 582 * M, size_currency: 'EUR' });
const AFORE = row({ uid: 'aforeiv', name: 'Afore IV', fund_number: 'IV', fund_size_cents: 185 * M, size_currency: 'USD',
  hq: 'Bay Area', fund_year: 2025, sector_focus: null, source_name: USD });
const NOSIZE = row({ uid: 'outliergrove-i', name: 'Outlier Grove', fund_number: 'I', size_reason: 'Not recorded' });
const DATA = {
  items: [AFORE, OPP, FIVE, NOSIZE], total: 4, limit: 25, offset: 0, sort: 'name', size_currency: 'EUR',
  coverage: { total: 1966, as_of: '2026-11-18', fields: { size_eur: 1000, size_usd: 700, size_unknown_currency: 0, hq: 1881,
    website: 1000, linkedin: 0, sector_focus: 1018, fund_year: 1640, notable_lps: 412, fund_number: 1900 } },
  sources: [{ name: EUR, rows: 1076, size_currency: 'EUR' }, { name: USD, rows: 890, size_currency: 'USD' }],
  facets: {
    hq_country: [], focus: [], vintage: [{ value: '2023', label: '2023', count: 3 }, { value: 'none', label: 'Vintage not recorded', count: 0 }],
    size_band: [{ value: '50-100', label: '€50–100M', count: 1 }, { value: '500+', label: '€500M and over', count: 1 }],
    size_not_comparable: 2, eif: { backed: 0, not_backed: 0, unknown: 4 }, eifo: { backed: 0, not_backed: 0, unknown: 4 },
  },
};
const view = (props = {}) => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDirectoryView, {
    query: read.EMPTY_QUERY, onQuery() {}, search: '', onSearch() {}, facets: DATA.facets, selected: null,
    onSelect() {}, onClose() {}, result: { loading: false, error: null, data: DATA }, ...props,
  })));
  return { html, text: renderedText(html) };
};

test('a row is one vehicle: the label comes from fund_number, the manager sits under it', () => {
  assert.deepEqual(read.vehicleLabel(OPP), { vehicle: 'Dawn Capital Opp', manager: 'Dawn Capital' });
  assert.deepEqual(read.vehicleLabel(FIVE), { vehicle: 'Dawn Capital V', manager: 'Dawn Capital' });
  assert.equal(read.vehicleLabel(AFORE).vehicle, 'Afore IV', 'a name that already carries its number is not given it twice');
  assert.equal(read.vehicleLabel({ name: 'Ivy Partners', fund_number: 'I' }).vehicle, 'Ivy Partners I', 'a number is a token, not a substring');
  assert.equal(read.vehicleLabel({ name: 'Solo', fund_number: null }).vehicle, 'Solo');
  const { text } = view();
  assert.match(text, /Dawn Capital OppDawn Capital/);
  assert.match(text, /Dawn Capital VDawn Capital/);
});

test('a size reads in its list’s own currency with the code; no size reads Not recorded', () => {
  assert.deepEqual(read.sizeOf(AFORE), { text: 'US$185M', currency: 'USD', reason: null });
  assert.deepEqual(read.sizeOf(FIVE), { text: '€582M', currency: 'EUR', reason: null });
  assert.deepEqual(read.sizeOf({ ...AFORE, size_currency: 'GBP' }), { text: null, currency: null, reason: 'Not recorded' });
  const { text } = view();
  assert.match(text, /US\$185MUSD/);
  assert.match(text, /€75MEUR/);
});

test('the size filter: from/to in millions of one currency, sent as size_min/size_max with size_currency', () => {
  const q = { ...read.EMPTY_QUERY, size_min: '50', size_max: '200.5', size_currency: 'USD' };
  const p = read.toParams(q);
  assert.deepEqual([p.size_min, p.size_max, p.size_currency, p.size_band], [50_000_000, 200_500_000, 'USD', undefined]);
  assert.equal(read.toParams({ ...read.EMPTY_QUERY, size_min: '50' }).size_currency, undefined, 'euros are the default and not sent');
  assert.equal(read.toParams({ ...read.EMPTY_QUERY, size_min: 'x1' }).size_min, undefined, 'a value that is not a number is no filter');
  assert.equal(read.toParams({ ...q, size_band: '500+' }).size_min, undefined, 'a band from a link is never combined with from/to');
  assert.deepEqual(read.activeFilters(q, null).map((f) => f.label), ['Size: US$50M to US$200.5M (USD)']);
  assert.deepEqual(read.activeFilters({ ...read.EMPTY_QUERY, size_min: '50' }, null).map((f) => f.label), ['Size: from €50M (EUR)']);
  // It round-trips through the address (D4612).
  const back = read.queryFromSearch(read.searchFromQuery(q, 'view=directory'));
  assert.deepEqual([back.size_min, back.size_max, back.size_currency], ['50', '200.5', 'USD']);
  assert.equal(read.searchFromQuery(read.EMPTY_QUERY, '').toString(), '', 'the default currency is not written');
  assert.deepEqual(read.removeFilter('size'), { size_band: '', size_min: '', size_max: '' });
  // A band from a link (directoryHref) is named in its currency too.
  assert.deepEqual(read.activeFilters({ ...read.EMPTY_QUERY, size_band: '500+', size_currency: 'USD' }, null).map((f) => f.label),
    ['Size: US$500M and over (USD)']);
});

test('the size filter says how many funds it leaves out, and only while it is on', () => {
  const q = { ...read.EMPTY_QUERY, size_min: '50' };
  assert.equal(read.sizeExclusion(q, DATA.facets), '2 funds have no size in euros, so the size filter leaves them out.');
  assert.equal(read.sizeExclusion({ ...q, size_currency: 'USD' }, { size_not_comparable: 1 }), '1 fund has no size in US dollars, so the size filter leaves it out.');
  assert.equal(read.sizeExclusion(read.EMPTY_QUERY, DATA.facets), null);
  assert.match(view({ query: q }).text, /2 funds have no size in euros, so the size filter leaves them out\./);
  assert.doesNotMatch(view().text, /leaves them out/);
});

test('results first: search, chips, the count beside the unfiltered total, the rows, then the closed disclosure', () => {
  const q = { ...read.EMPTY_QUERY, size_min: '50', eif: true };
  const { html, text } = view({ query: q });
  assert.match(text, /4 fund vehicles matchof 1,966 in the directory, unfiltered/);
  assert.match(html, /<h3 id="fd-results"[^>]*aria-live="polite"/);
  assert.match(text, /Active filtersSize: from €50M \(EUR\)×EIF×Clear all/);
  const at = (needle) => html.indexOf(needle);
  const order = ['id="fd-q"', 'data-testid="fund-directory-chips"', 'data-testid="fund-directory-results"', 'data-testid="fund-directory-disclosure"', 'data-testid="fund-directory-coverage"'].map(at);
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), `out of order: ${order}`);
  assert.match(html, /<details data-testid="fund-directory-disclosure"/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/, 'the disclosure starts closed');
  assert.match(text, /Source coverage and where the money is/);
  assert.match(text, /Size in a known currency1,700 \/ 1,966/);
});

test('phone: cards, and nothing that scrolls sideways', () => {
  const { html } = view();
  assert.match(html, /<ul class="[^"]*sm:hidden[^"]*" aria-labelledby="fd-results" data-testid="fund-directory-cards">/);
  assert.match(html, /<div class="hidden sm:block"><table class="w-full table-fixed/);
  assert.doesNotMatch(html, /min-w-\[760px\]|overflow-x-auto/);
  assert.equal((html.match(/data-fund-uid="dawncapital-v"/g) || []).length, 2, 'the card and the table row both carry the uid focus returns to');
});

test('zero results: removable chips and a hint from the facet counts', () => {
  const data = { ...DATA, items: [], total: 0, facets: { ...DATA.facets, size_band: [{ value: '50-100', label: '€50–100M', count: 3 }], size_not_comparable: 4 } };
  const q = { ...read.EMPTY_QUERY, size_min: '50', vintage: '2019' };
  const hint = read.zeroHint(q, data.facets);
  assert.deepEqual([hint.key, hint.count], ['size', 7]);
  assert.equal(hint.text, 'Removing the size filter would show 7 fund vehicles.');
  assert.equal(read.zeroHint({ ...read.EMPTY_QUERY, hq_country: 'DE' }, data.facets), null, 'HQ counts can overlap, so they give no hint');
  const { text } = view({ query: q, facets: data.facets, result: { loading: false, error: null, data } });
  assert.match(text, /No fund vehicle matches with these 2 filters\./);
  assert.match(text, /Removing the size filter would show 7 fund vehicles\. Remove it/);
});

test('the drawer: Save to shortlist, the vehicle as title, Investment geography Not recorded, Open full profile keeps the list', () => {
  const { html, text } = view({ selected: FIVE, drawer: { loading: false, error: null, data: { item: FIVE, reports: [], reports_status: 'ok' } },
    onAdd() {}, backTo: '/research/funds?view=directory&size_min=50' });
  assert.match(html, /<h2 id="[^"]+"[^>]*>Dawn Capital V<\/h2>/);
  assert.match(text, /Save to shortlist/);
  assert.match(text, /Investment geographyNot recordedNo list records where a fund invests\./);
  assert.match(text, /Manager HQUKWhere the manager is based, not where it invests/);
  assert.match(text, /VehicleDawn Capital V · managed by Dawn Capital/);
  // D7167: the Sheet's size is the dated reported size (fundProfileRead.reportedSize).
  assert.match(text, /Reported size€582m EUR/);
  const dir = src('frontend/src/pages/research/FundDirectory.jsx');
  assert.match(dir, /state=\{\{ back: backTo, selected: item\.uid \}\}/);
  assert.match(dir, /opened=\{opened\} backTo=\{`\$\{location\.pathname\}\$\{location\.search\}`\}/);
});

test('opened from a link: the line names the filters; a dropped long link says so', () => {
  assert.match(view({ query: { ...read.EMPTY_QUERY, eif: true }, opened: 'link' }).text, /Opened from a link, with 1 filter applied\./);
  assert.doesNotMatch(view({ opened: 'link' }).text, /Opened from a link/, 'no filters, no line');
  assert.match(view({ opened: 'dropped' }).text, /The link was too long to keep its filters, so this is the Directory without them\./);
});

test('Back to results returns to the same query and names the row; without one it is the Directory', () => {
  const fund = { loading: false, error: null, status: 200, data: { item: FIVE, reports: [], reports_status: 'ok' } };
  const out = (backTo) => renderToStaticMarkup(React.createElement(MemoryRouter, null,
    React.createElement(FundCatalogView, { fund, list: { loading: false, error: null, existing: null }, onAdd() {}, backTo })));
  assert.match(out({ path: '/research/funds?view=directory&size_min=50', selected: 'dawncapital-v' }),
    /<a[^>]*href="\/research\/funds\?view=directory&amp;size_min=50"[^>]*>[\s\S]*?Back to results<\/a>/);
  assert.match(out(null), /href="\/research\/funds\?view=directory"[^>]*>[\s\S]*?Fund directory<\/a>/);
  assert.doesNotMatch(out({ path: 'https://evil.example/', selected: 'x' }), /evil/, 'only a Funds path is a way back');
});

test('signed out: a Funds link returns to the same search after sign-in, and the page names Funds', () => {
  assert.ok(next.RETURN_AFTER_LOGIN_PREFIXES.includes('/research/funds'));
  const search = '?view=directory&hq_country=GB&size_min=50&sort=-size&offset=25';
  assert.equal(next.loginRedirectFor({ pathname: '/research/funds', search }),
    `/login?next=${encodeURIComponent(`/research/funds${search}`)}`);
  assert.equal(next.loginRedirectFor({ pathname: '/research/funds/catalog/dawncapital-v', search: '' }),
    `/login?next=${encodeURIComponent('/research/funds/catalog/dawncapital-v')}`);
  assert.equal(next.loginRedirectFor({ pathname: '/research/fundsx', search: '' }), '/login');
  // Longer than the 200-character cap: the Directory without its filters, said on arrival (option A as drawn).
  const long = `?view=directory&q=${'a'.repeat(220)}`;
  assert.equal(next.loginRedirectFor({ pathname: '/research/funds', search: long }),
    `/login?next=${encodeURIComponent(`/research/funds?view=directory&${next.FUNDS_FILTERS_DROPPED}=1`)}`);
  const area = next.destinationArea('/research/funds?view=directory');
  assert.equal(area.name, 'Funds');
  assert.equal(area.who, 'You need a founder account.');
  assert.equal(next.signInContextFor('/research/funds').area.name, 'Funds');
});

test('My funds, empty: Browse fund directory and Add a fund by hand, and no row of zero counters', () => {
  const zone = src('frontend/src/pages/research/FundsZone.jsx');
  assert.match(zone, />Browse fund directory</);
  assert.match(zone, />Add a fund by hand</);
  assert.match(zone, /const browse = \(\) => \{ pick\('directory'\); setTimeout\(\(\) => document\.getElementById\('fd-q'\)\?\.focus\(\), 0\); \};/);
  assert.match(zone, /<div className=\{listState === 'ok' && !items\.length \? 'hidden' : 'grid grid-cols-2 gap-3 lg:grid-cols-4'\}>/);
  assert.match(zone, /<input id="fz-add-name"/);
});

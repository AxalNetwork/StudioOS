/**
 * D535 (#1081), steps 4–5 — the Funds pages, rendered with react-dom/server
 * (no DOM): the four states of the directory, the API's total and source list
 * printed, "1–25 of N", sizes only in a known currency, stage and unknown
 * EIF/EIFO as "Not recorded", and the catalog profile saying "Unreadable"
 * when its read fails instead of swallowing the error.
 *
 * Run with:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_fund_pages_d535.test.mjs
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
import { FundDirectoryView } from '../src/pages/research/FundDirectory.jsx';
import FundCatalogProfile, { FundCatalogView } from '../src/pages/research/FundCatalogProfile.jsx';
import {
  EMPTY_QUERY, STAGE_REASON, backingOf, pageList, rangeLabel, sizeOf, toParams,
} from '../src/pages/research/fundDirectoryRead.js';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const EUR = 'EuroTech VC Funds (public spreadsheet)';
const DEEP = 'Deep Tech Investors Mapping (public spreadsheet)';
const UNKNOWN_CCY = 'Not recorded: this list records no size in a known currency';

const row = (o) => ({
  website: null, linkedin: null, hq: null, fund_number: null, fund_size_cents: null, fund_date: null, quarter: null,
  fund_year: null, sector_focus: null, notable_lps: null, eif_flag: 0, eifo_flag: 0, eif: null, eifo: null,
  size_currency: null, source_name: EUR, source_url: 'https://example.org/eurotech', as_of: '2026-10-04', ...o,
});
const ALPHA = row({ uid: 'alpha', name: 'Alpha Ventures', website: 'https://alpha.example', hq: 'Berlin', fund_size_cents: 50_000_000_00,
  size_currency: 'EUR', fund_year: 2021, sector_focus: 'Fintech · AI', notable_lps: 'EIF', eif: true, eifo: false });
const BETA = row({ uid: 'beta', name: 'Beta Capital', hq: 'Germany', fund_size_cents: 300_000_000_00, size_currency: 'EUR',
  notable_lps: 'Family offices', eif: false, eifo: false, size_reason: undefined });
// A Deep Tech row: the column may hold a number, but its currency is not recorded.
const ZETA = row({ uid: 'zeta', name: 'Zeta Deep Tech', hq: 'Berlin', fund_size_cents: null, size_reason: UNKNOWN_CCY,
  source_name: DEEP, source_url: 'https://example.org/deep', as_of: '2026-09-01' });
const FILLER = Array.from({ length: 22 }, (_, k) => row({ uid: `f${k}`, name: `Filler ${k}`, size_reason: 'Not recorded' }));

const DATA = {
  items: [ALPHA, BETA, ZETA, ...FILLER], total: 2616, limit: 25, offset: 0, sort: 'name',
  size_basis: 'Sizes are compared and sorted in euros, on the EuroTech list only; other lists record no size in a known currency.',
  source: 'Public fund spreadsheets', source_boundary: 'Reported fund-size snapshots and discovery metadata only.',
  coverage: { total: 2616, as_of: '2026-10-04', fields: { size_eur: 1001, size_unknown_currency: 3, hq: 2500, website: 1200,
    linkedin: 0, sector_focus: 1300, fund_year: 1100, notable_lps: 800, fund_number: 0 } },
  sources: [
    { name: EUR, url: 'https://example.org/eurotech', rows: 1076, as_of: '2026-10-04', size_currency: 'EUR' },
    { name: DEEP, url: 'https://example.org/deep', rows: 1540, as_of: '2026-09-01', size_currency: null },
  ],
  facets: {
    hq_country: [{ value: 'DE', label: 'Germany', count: 412 }, { value: 'none', label: 'HQ not recorded', count: 29 }],
    focus: [{ value: 'fintech', label: 'Fintech', count: 210 }, { value: 'none', label: 'Focus not recorded', count: 996 }],
    vintage: [{ value: '2024', label: '2024', count: 88 }, { value: 'none', label: 'Vintage not recorded', count: 1059 }],
    size_band: [{ value: 'lt25', label: 'Under €25M', count: 120 }],
    size_not_comparable: 1615,
    eif: { backed: 140, not_backed: 600, unknown: 1876 },
    eifo: { backed: 12, not_backed: 728, unknown: 1876 },
  },
};

function directory(props) {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDirectoryView, {
    query: EMPTY_QUERY, onQuery: () => {}, search: '', onSearch: () => {}, facets: DATA.facets, selected: null,
    onSelect: () => {}, onClose: () => {}, ...props,
  })));
  return { html, text: renderedText(html) };
}
const populated = () => directory({ result: { loading: false, error: null, data: DATA } });

test('the helpers: "1–25 of N", the page list, and the query sent', () => {
  assert.equal(rangeLabel(0, 25, 2616), '1–25 of 2,616');
  assert.equal(rangeLabel(25, 25, 2616), '26–50 of 2,616');
  assert.equal(rangeLabel(2600, 16, 2616), '2,601–2,616 of 2,616');
  assert.deepEqual(pageList(1, 105), [1, 2, '…', 105]);
  assert.deepEqual(pageList(50, 105), [1, '…', 49, 50, 51, '…', 105]);
  assert.deepEqual(toParams({ ...EMPTY_QUERY, hq_country: 'none', eif: true, eifo: false }),
    { q: undefined, hq_country: 'none', focus: undefined, size_band: undefined, vintage: undefined, eif: 1, eifo: undefined, sort: 'name', limit: 25, offset: 0 });
});

test('a size is printed only in a known currency; EIF/EIFO unknown is not "no"', () => {
  assert.deepEqual(sizeOf(ALPHA), { text: '€50M', reason: null });
  // Even if a number arrived for a list whose currency is not recorded, it is not printed.
  assert.deepEqual(sizeOf({ ...ZETA, fund_size_cents: 999_000_000_00 }), { text: null, reason: UNKNOWN_CCY });
  assert.deepEqual(backingOf(ALPHA), { kind: 'named', named: ['EIF'] });
  assert.equal(backingOf(BETA).kind, 'neither');
  assert.equal(backingOf(ZETA).kind, 'unknown');
});

test('populated: the API\'s total, "1–25 of N", and its source list are printed', () => {
  const { text } = populated();
  assert.match(text, /1–25 of 2,616 funds/);
  assert.match(text, /2,616 funds from 2 public fund lists/);
  assert.match(text, /Sources \(2\)/);
  assert.match(text, /EuroTech VC Funds \(public spreadsheet\) · 1,076 funds · as of 2026-10-04 · sizes in EUR/);
  assert.match(text, /Deep Tech Investors Mapping \(public spreadsheet\) · 1,540 funds · as of 2026-09-01 · size currency not recorded/);
  assert.match(text, /Page 1 of 105/);
  assert.doesNotMatch(text, /2,032/, 'the canvas\'s stale figure');
});

test('populated: euro sizes print; other sizes read "Not recorded" with the reason', () => {
  const { html, text } = populated();
  assert.match(text, /€50M/);
  assert.match(text, /€300M/);
  assert.match(html, /title="Not recorded: this list records no size in a known currency"[^>]*>Not recorded</);
  assert.match(text, /Size “Not recorded”: this list records no size in a known currency/);
  assert.match(text, /Size “Not recorded”: the source lists no size for these funds\./);
});

test('populated: EIF named, neither named, and unknown reads "Not recorded"', () => {
  const { html, text } = populated();
  assert.match(text, /Neither named/);
  assert.match(html, />EIF</);
  assert.match(html, /title="No notable LPs are recorded, so EIF and EIFO backing is unknown"[^>]*>Not recorded</);
});

test('populated: coverage from the API, and stage "Not recorded" with its reason', () => {
  const { text } = populated();
  assert.match(text, /What the fund lists record/);
  assert.match(text, /Funds with each field filled, of 2,616/);
  assert.match(text, /Size in euros1,001 \/ 2,616/);
  assert.match(text, /3 more funds hold a size from a list whose currency is not recorded/);
  assert.match(text, new RegExp(`StageNot recorded${STAGE_REASON.replace(/\./g, '\\.')}`));
});

test('populated: the filters, with counts and "not recorded" options', () => {
  const { html } = populated();
  for (const label of ['HQ country', 'Stated focus', 'Fund size, in euros', 'Vintage']) assert.match(html, new RegExp(`>${label}<`));
  assert.match(html, /<option value="none">HQ not recorded \(29\)<\/option>/);
  assert.match(html, /<option value="none">Focus not recorded \(996\)<\/option>/);
  assert.match(html, /<option value="none">Vintage not recorded \(1,059\)<\/option>/);
  assert.match(html, /<option value="lt25">Under €25M \(120\)<\/option>/);
  assert.match(html, /EIF \(European Investment Fund\)/);
  assert.match(html, /EIFO \(Denmark’s Export and Investment Fund\)/);
});

test('loading: no rows and no count until the read answers', () => {
  const { text } = directory({ result: { loading: true, error: null, data: null } });
  assert.match(text, /Loading funds…/);
  assert.match(text, /No count is shown until the read answers/);
  assert.doesNotMatch(text, /of 2,616/);
  assert.match(text, /Search/, 'search stays usable');
});

test('error: "Unreadable", never zero funds', () => {
  const { text } = directory({ result: { loading: false, error: 'The fund directory could not be read.', data: null } });
  assert.match(text, /Unreadable/);
  assert.match(text, /The fund directory did not answer\./);
  assert.match(text, /a failed read is not zero funds/);
  assert.doesNotMatch(text, /\b0 of\b|funds from/);
  assert.match(text, /Try again/);
});

test('empty: names the search and the filters, and offers to clear them', () => {
  const data = { ...DATA, items: [], total: 0 };
  const { text } = directory({ query: { ...EMPTY_QUERY, q: 'zzz', eif: true, vintage: 'none' }, result: { loading: false, error: null, data } });
  assert.match(text, /No fund matches “zzz” with these filters\./);
  assert.match(text, /Vintage: not recorded×Remove filter/);
  assert.match(text, /EIF×Remove filter/);
  assert.match(text, /Clear all filters/);
  assert.doesNotMatch(text, /1–/);
  assert.match(text, /2,616 funds from 2 public fund lists/, 'the directory\'s own total stays printed');
});

test('drawer: the fund\'s facts, stage and size "Not recorded" with reasons, reports "Unreadable"', () => {
  const { text } = directory({
    result: { loading: false, error: null, data: DATA }, selected: ZETA,
    drawer: { loading: false, error: null, data: { item: ZETA, reports: [], reports_status: 'unreadable' } },
  });
  assert.match(text, /Fund details/);
  assert.match(text, /SizeNot recordedNot recorded: this list records no size in a known currency/);
  assert.match(text, new RegExp(`StageNot recorded${STAGE_REASON.replace(/\./g, '\\.')}`));
  assert.match(text, /EIF \/ EIFONot recordedWith no LPs listed, EIF and EIFO backing is unknown, not absent\./);
  assert.match(text, /Unreadable The reports could not be read\. This is not a fund with no reports\./);
  assert.match(text, /Add to my list/);
  assert.match(text, /Open full profile/);
});

const catalog = (props) => renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null,
  React.createElement(FundCatalogView, props))));

test('catalog profile: a failed read says "Unreadable"; a missing fund says so; loading says so', () => {
  const failed = catalog({ fund: { loading: false, error: 'Unreadable', status: 503, data: null } });
  assert.match(failed, /Unreadable/);
  assert.match(failed, /This fund could not be read\./);
  assert.doesNotMatch(failed, /Fund not found/);
  const network = catalog({ fund: { loading: false, error: 'Network down', status: null, data: null } });
  assert.match(network, /UnreadableRead failed/);
  const missing = catalog({ fund: { loading: false, error: 'Not found', status: 404, data: null } });
  assert.match(missing, /Fund not found/);
  assert.doesNotMatch(missing, /Unreadable/);
  assert.match(catalog({ fund: { loading: true, error: null, status: null, data: null } }), /Loading this fund…/);
});

test('catalog profile: populated, with "Not recorded" sizes and stage, and an unreadable list said so', () => {
  const fund = { loading: false, error: null, status: 200, data: { item: ZETA, reports: [], reports_status: 'ok', source_boundary: 'Reported fund-size snapshots only.' } };
  const text = catalog({ fund, list: { loading: false, error: 'Unreadable', existing: null } });
  assert.match(text, /Zeta Deep Tech/);
  assert.match(text, /SizeNot recordedNot recorded: this list records no size in a known currency/);
  assert.match(text, new RegExp(`StageNot recorded${STAGE_REASON.replace(/\./g, '\\.')}`));
  assert.match(text, /Your list could not be read/);
  assert.doesNotMatch(text, /Add to my list/, 'no add while the list is unreadable: it might duplicate a row');
  const ok = catalog({ fund: { ...fund, data: { ...fund.data, item: ALPHA } }, list: { loading: false, error: null, existing: null } });
  assert.match(ok, /€50M/);
  assert.match(ok, /Add to my list/);
});

test('catalog profile sits inside WorkspaceShell and reads only the Worker', () => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: ['/research/funds/catalog/alpha'] },
    React.createElement(FundCatalogProfile, { role: 'founder' })));
  const text = renderedText(html);
  assert.match(text, /Loading this fund…/);
  assert.match(html, /data-testid="link-workspace-crumb"/, 'the shell\'s crumb');
  assert.match(text, /Research‹Funds/, 'the crumb names the Funds zone');
  const src = codeOnly(read('frontend/src/pages/research/FundCatalogProfile.jsx'));
  assert.match(src, /<WorkspaceShell/);
  assert.doesNotMatch(src, /catch \(_\) \{/, 'a swallowed error');
  assert.doesNotMatch(src, /fundDirectory\.json/);
  assert.doesNotMatch(src, /\.catch\(\(\) => \{\}\)/);
});

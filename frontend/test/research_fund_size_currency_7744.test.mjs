/**
 * D7744 (#7744) — the Funds pages print a size in the currency its row records.
 *
 *   - the row, its Sheet, the full profile and a comparison cell all print a
 *     GBP size in pounds (and a code with no mark as the code); none falls
 *     back to euros;
 *   - the size currency control offers exactly the currencies the answer lists
 *     (`size_currencies`), on the desktop select and the phone's radio group;
 *   - no sentence says "euros" when GBP is asked: the line under the filters,
 *     the exclusion line, "Show them", the active chip; the coverage sentence
 *     counts sizes with no recorded currency; each list's size text follows
 *     its `size_currencies`.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_fund_size_currency_7744.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { renderedText } from './_renderedText.mjs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const read = await import('../src/pages/research/fundDirectoryRead.js');
const profile = await import('../src/pages/research/fundProfileRead.js');
const { cellView } = await import('../src/pages/research/researchComparisons.js');
const { FundDirectoryView } = await import('../src/pages/research/FundDirectory.jsx');

const M = 100_000_000; // one million, in cents
const row = (o) => ({
  website: null, linkedin: null, hq: 'UK', fund_number: 'I', fund_size_cents: null, fund_date: '2024-05-01', quarter: null,
  fund_year: 2024, sector_focus: 'Fintech', notable_lps: null, eif: null, eifo: null, size_currency: null,
  source_name: 'Synthetic sterling list', source_url: 'https://example.org/gbp', as_of: '2026-11-27', ...o,
});
const GBP = row({ uid: 'gb-one', name: 'Sterling One', fund_size_cents: 120 * M, size_currency: 'GBP' });
const CHF = row({ uid: 'ch-one', name: 'Franc One', fund_size_cents: 40 * M, size_currency: 'CHF' });
const EUR = row({ uid: 'eu-one', name: 'Euro One', fund_size_cents: 582 * M, size_currency: 'EUR', source_name: 'EuroTech VC Funds (public spreadsheet)' });
const DATA = {
  items: [GBP, EUR], total: 2, limit: 25, offset: 0, sort: 'name', size_currency: 'GBP', size_currencies: ['EUR', 'GBP', 'USD'],
  coverage: { total: 9, as_of: '2026-11-27', fields: { size_eur: 3, size_usd: 1, size_unknown_currency: 1, size_by_currency: { EUR: 3, GBP: 1, USD: 1 },
    hq: 9, website: 0, sector_focus: 9, fund_year: 9, notable_lps: 0 } },
  sources: [
    { name: 'Synthetic sterling list', rows: 1, size_currency: 'GBP', size_currencies: ['GBP'] },
    { name: 'Synthetic mixed list', rows: 2, size_currency: null, size_currencies: ['CHF', 'EUR'] },
    { name: 'Synthetic manager list', rows: 3, size_currency: null, size_currencies: [] },
  ],
  facets: {
    hq_country: [], focus: [], vintage: [], kind: [],
    size_band: [{ value: '100-250', label: '£100–250M', count: 1 }], size_not_comparable: 8,
    eif: { backed: 0, not_backed: 0, unknown: 2 }, eifo: { backed: 0, not_backed: 0, unknown: 2 },
  },
};
const GBP_QUERY = { ...read.EMPTY_QUERY, size_currency: 'GBP', size_band: '100-250' };
const view = (props = {}) => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDirectoryView, {
    query: GBP_QUERY, onQuery() {}, search: '', onSearch() {}, facets: DATA.facets, selected: null,
    onSelect() {}, onClose() {}, result: { loading: false, error: null, data: DATA }, ...props,
  })));
  return { html, text: renderedText(html) };
};

test('the row, its Sheet, the profile and a comparison cell print a GBP size in pounds', () => {
  assert.deepEqual(read.sizeOf(GBP), { text: '£120M', currency: 'GBP', reason: null });
  assert.deepEqual(profile.reportedSize(GBP), { text: '£120m', currency: 'GBP', reason: null });
  assert.equal(profile.amount(120 * M, 'GBP'), '£120m');
  const cell = cellView('size', { status: 'recorded', value: 120 * M, currency: 'GBP', source: { name: 'Synthetic sterling list' }, as_of: '2026-11-27' },
    { state: 'listed', values: {} });
  assert.deepEqual([cell.state, cell.text, cell.detail], ['recorded', '£120m', 'GBP']);
  const { text } = view();
  assert.match(text, /£120M\s*GBP/, 'the row prints the pound size with its code');
  assert.match(text, /€582M\s*EUR/, 'a euro size that shows today still shows');
});

test('a code with no mark prints as the code, the same in the row and the profile; one the money layer does not list prints nowhere', () => {
  assert.deepEqual(read.sizeOf(CHF), { text: 'CHF 40M', currency: 'CHF', reason: null });
  assert.equal(profile.amount(40 * M, 'CHF'), 'CHF 40m');
  assert.equal(profile.amount(40 * M, 'ZZZ'), null);
  assert.deepEqual(read.sizeOf({ ...CHF, size_currency: 'ZZZ' }), { text: null, currency: null, reason: 'Not recorded' });
  assert.equal(read.moneyM(40 * M, 'GBP'), '£40M');
});

test('the size currency control offers exactly the currencies the answer lists', () => {
  assert.deepEqual(read.sizeCurrencyOptions(DATA, 'GBP').map(([c]) => c), ['EUR', 'GBP', 'USD']);
  assert.deepEqual(read.sizeCurrencyOptions({ size_currencies: ['EUR'] }, 'EUR').map(([c]) => c), ['EUR']);
  assert.deepEqual(read.sizeCurrencyOptions({ size_currencies: ['EUR', 'GBP', 'USD'] }, 'GBP')[1], ['GBP', 'Pounds sterling (GBP)']);
  assert.deepEqual(read.sizeCurrencyOptions(null, 'EUR').map(([c]) => c), ['EUR'], 'before an answer, only the asked currency');
  assert.deepEqual(read.sizeCurrencyOptions({ size_currencies: ['EUR'] }, 'CHF').map(([c]) => c), ['EUR', 'CHF'], 'the asked one stays shown');
  const { html } = view();
  const desktop = [...html.matchAll(/<option value="([A-Z]{3})"[^>]*>\1<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(desktop, ['EUR', 'GBP', 'USD']);
  const sheet = view({ filtersOpen: true }).html;
  const radios = [...sheet.matchAll(/name="fds-size-currency"[^>]*value="([A-Z]{3})"/g)].map((m) => m[1]);
  assert.deepEqual(radios, ['EUR', 'GBP', 'USD']);
  assert.match(sheet, /name="fds-size-currency" checked="" value="GBP"/);
});

test('no sentence says euros when GBP is asked', () => {
  const { text } = view();
  assert.match(text, /Sizes compare in GBP only: 8 matching funds have no size in pounds sterling and sit outside the size filter\./);
  assert.match(text, /Size: £100–250M \(GBP\)/, 'the active chip');
  assert.doesNotMatch(text, /euros/);
  assert.equal(read.sizeExclusion(GBP_QUERY, DATA.facets), '8 funds have no size in pounds sterling, so the size filter leaves them out.');
  assert.equal(read.showUnsizedLabel(GBP_QUERY, DATA.facets), 'Show them: the 8 funds with no size in pounds sterling');
  assert.equal(read.sizeCompareLine({ size_currency: 'CHF' }, { size_not_comparable: 1 }),
    'Sizes compare in CHF only: 1 matching fund has no size in CHF and sit outside the size filter.');
});

test('the coverage counts every currency, and each list says the currencies its sizes are in', () => {
  const sized = read.coverageRows(DATA.coverage).find((r) => r.label === 'Size in a known currency');
  assert.equal(sized.n, 5, 'EUR, GBP and USD sizes all count');
  assert.equal(read.unknownCurrencyLine(DATA.coverage), '1 more fund holds a size whose currency is not recorded. Those sizes are not shown, banded or sorted until the currency is known.');
  assert.equal(read.unknownCurrencyLine({ fields: { size_unknown_currency: 0 } }), null);
  assert.equal(read.listSizeText(DATA.sources[0]), 'sizes in GBP');
  assert.equal(read.listSizeText(DATA.sources[1]), 'sizes in CHF, EUR');
  assert.equal(read.listSizeText(DATA.sources[2]), 'size currency not recorded, so no size is shown');
  const { text } = view();
  assert.match(text, /1 more fund holds a size whose currency is not recorded/);
  assert.match(text, /Synthetic mixed list · 2 funds · as of an unrecorded date · sizes in CHF, EUR/);
});

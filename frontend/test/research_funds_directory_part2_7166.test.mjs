/**
 * D7166 part 2 (#7166) — Research › Funds directory, what part 1 left: the
 * phone's thumb bar and full-height filter sheet (RFD-03A, RFD-03B), "Show
 * them" on the size filter's line (RFD-02), "Signed in. This is the search you
 * opened." after the sign-in return (RFD-04B, RFD-06), the chip focus order
 * (RFD-06 row 5), and Investment geography reading Not recorded wherever the
 * boards draw it (RFD-02D, RFD-03C/D). Rendered with react-dom/server; wiring
 * read as source.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_funds_directory_part2_7166.test.mjs
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

// A Map-backed localStorage, so the sign-in marker is read and written as in a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const read = await import('../src/pages/research/fundDirectoryRead.js');
const { FundDirectoryView, FundDetails, showLabel } = await import('../src/pages/research/FundDirectory.jsx');
const next = await import('../src/lib/pendingNext.js');
const src = (p) => codeOnly(readFileSync(resolve(process.cwd(), p), 'utf8'));

const EUR = 'EuroTech VC Funds (public spreadsheet)';
const M = 100_000_000; // one million, in cents
const row = (o) => ({
  website: null, linkedin: null, hq: 'UK', fund_number: null, fund_size_cents: null, fund_date: '2023-09-25', quarter: null,
  fund_year: 2023, sector_focus: 'B2B-Software', notable_lps: null, eif: null, eifo: null, size_currency: null,
  source_name: EUR, source_url: 'https://example.org/eurotech', as_of: '2026-11-18', ...o,
});
const OPP = row({ uid: 'opp', name: 'Manager A', fund_number: 'Opp', fund_size_cents: 75 * M, size_currency: 'EUR' });
const NOSIZE = row({ uid: 'nosize', name: 'Manager B', fund_number: 'I', size_reason: 'Not recorded' });
const DATA = {
  items: [OPP, NOSIZE], total: 2, limit: 25, offset: 0, sort: 'name', size_currency: 'EUR',
  coverage: { total: 1966, as_of: '2026-11-18', fields: { size_eur: 1000, size_usd: 700, hq: 1881, website: 1000, sector_focus: 1018, fund_year: 1640, notable_lps: 412 } },
  sources: [{ name: EUR, rows: 1076, size_currency: 'EUR' }],
  facets: {
    hq_country: [{ value: 'GB', label: 'United Kingdom', count: 2 }], focus: [], vintage: [{ value: '2023', label: '2023', count: 2 }],
    size_band: [{ value: '50-100', label: '€50–100M', count: 1 }], size_not_comparable: 4,
    eif: { backed: 0, not_backed: 0, unknown: 2 }, eifo: { backed: 0, not_backed: 0, unknown: 2 },
  },
};
const ok = { loading: false, error: null, data: DATA };
const view = (props = {}) => {
  const html = renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDirectoryView, {
    query: read.EMPTY_QUERY, onQuery() {}, search: '', onSearch() {}, facets: DATA.facets, selected: null,
    onSelect() {}, onClose() {}, result: ok, ...props,
  })));
  return { html, text: renderedText(html) };
};

test('RFD-03A: on a phone, Sort and Filters sit in a bar in thumb reach; the desktop row keeps both', () => {
  const q = { ...read.EMPTY_QUERY, hq_country: 'GB', eif: true, sort: '-size' };
  const { html, text } = view({ query: q });
  const bar = html.match(/<div data-testid="fund-directory-phone-bar" class="([^"]*)">([\s\S]*?)<\/div>/);
  assert.ok(bar, 'the bar is drawn');
  assert.match(bar[1], /\bsticky\b/);
  assert.match(bar[1], /bottom-\[calc\(var\(--mobile-tabbar-h,0px\)\+12px\)\]/, 'above the phone tab bar');
  assert.match(bar[1], /\bsm:hidden\b/, 'a phone bar only');
  assert.match(bar[2], /aria-haspopup="dialog"[^>]*aria-label="Sort · Size ↓: Size, largest first"/);
  assert.match(renderedText(bar[2]), /Sort · Size ↓\s*Filters · 2/);
  assert.equal((bar[2].match(/min-h-\[48px\]/g) || []).length, 2, 'both targets are at least 44px');
  assert.match(text, /Filters · 2/);
  assert.match(view().html, /<\/svg> Filters<\/button>/, 'no filters, no count');
  // At 640px and up the sort select and the filter row are the page's; below it they are not drawn.
  assert.match(html, /<div class="hidden min-w-\[200px\] flex-\[0_1_260px\] sm:block"><label for="fd-sort"/);
  assert.match(html, /<div id="fd-filters" class="mt-3 hidden flex-wrap items-end gap-3 sm:flex">/);
  assert.equal(read.sortShort('-vintage'), 'Vintage ↓');
  assert.equal(read.sortShort('nonsense'), 'Name A–Z');
  assert.equal(read.sortLabel('size'), 'Size, smallest first');
});

test('RFD-03B: the full-height filter sheet holds every filter, one currency at a time, Clear all and Show N', () => {
  const q = { ...read.EMPTY_QUERY, hq_country: 'GB', size_min: '50' };
  assert.doesNotMatch(view({ query: q }).html, /fd-filter-sheet/, 'closed until Filters is pressed');
  const { html, text } = view({ query: q, filtersOpen: true });
  assert.match(html, /data-testid="fd-filter-sheet-layer" data-phone="full"/, 'a full-screen page on a phone');
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="[^"]+"[^>]*data-testid="fd-filter-sheet"/);
  assert.match(html, /<h2 id="[^"]+"[^>]*>Filters<\/h2>/);
  for (const id of ['fds-hq', 'fds-focus', 'fds-size-min', 'fds-size-max', 'fds-vint']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /role="radiogroup" aria-label="Size currency"/);
  assert.match(html, /<input type="radio" class="sr-only" name="fds-size-currency" checked="" value="EUR"\/>/);
  assert.match(html, /name="fds-size-currency" value="USD"\/>/, 'USD offered, not chosen');
  assert.match(text, /Size · one currency at a time/);
  assert.match(text, /EIF \(European Investment Fund\)/);
  assert.match(text, /Clear all/);
  assert.match(html, /data-testid="fd-filter-sheet-show"[^>]*>Show 2 fund vehicles<\/button>/);
  assert.match(html, /<p role="status" class="sr-only">2 fund vehicles match, of 1,966 in the directory, unfiltered\.<\/p>/,
    'the count is said inside the sheet, since the page behind it is inert');
  // The desktop ids stay the desktop's: one id each.
  assert.equal((html.match(/id="fd-hq"/g) || []).length, 1);
  assert.equal((html.match(/id="fds-hq"/g) || []).length, 1);
  // No filter in force: no Clear all in the sheet's head.
  assert.doesNotMatch(view({ filtersOpen: true }).html, /fd-filter-sheet-header[\s\S]*?>Clear all<\/button>[\s\S]*?fd-filter-sheet-close/);
  // Show N is the live answer, and no number before it or after a failed read.
  assert.equal(showLabel(ok), 'Show 2 fund vehicles');
  assert.equal(showLabel({ loading: false, error: null, data: { ...DATA, total: 1 } }), 'Show 1 fund vehicle');
  assert.equal(showLabel({ loading: true, error: null, data: DATA }), 'Show results');
  assert.equal(showLabel({ loading: false, error: 'Unavailable', data: null }), 'Show results');
});

test('RFD-03A: the phone sort is a sheet of the six orders', () => {
  const { html } = view({ query: { ...read.EMPTY_QUERY, sort: '-size' }, sortOpen: true });
  assert.match(html, /data-testid="fd-sort-sheet-layer" data-phone="sheet"/);
  assert.equal((html.match(/name="fd-sort-phone"/g) || []).length, 6);
  const checked = (html.match(/<input[^>]*name="fd-sort-phone"[^>]*>/g) || []).filter((t) => /checked=""/.test(t));
  assert.equal(checked.length, 1, 'one order is chosen');
  assert.match(checked[0], /value="-size"/);
});

test('RFD-02: "Show them" shows the funds the size filter leaves out, in the same currency', () => {
  const q = { ...read.EMPTY_QUERY, size_min: '50', hq_country: 'GB' };
  const { html, text } = view({ query: q });
  assert.match(text, /4 funds have no size in euros, so the size filter leaves them out\. Show them/);
  assert.match(html, /data-testid="fund-directory-show-unsized" aria-label="Show them: the 4 funds with no size in euros"/);
  assert.deepEqual(read.showUnsized(), { size_band: 'none', size_min: '', size_max: '' });
  // The query it makes keeps every other filter and asks the Worker for size_band=none.
  const shown = { ...q, ...read.showUnsized() };
  const p = read.toParams(shown);
  assert.deepEqual([p.size_band, p.size_min, p.size_max, p.hq_country], ['none', undefined, undefined, 'GB']);
  assert.equal(read.toParams({ ...shown, size_currency: 'USD' }).size_currency, 'USD');
  assert.deepEqual(read.activeFilters(shown, null).map((f) => f.label), ['HQ: GB', 'Size: not recorded in EUR']);
  assert.equal(read.showUnsizedLabel({ ...q, size_currency: 'USD' }, { size_not_comparable: 1 }), 'Show them: the 1 fund with no size in US dollars');
  // Once shown, the line is gone: there is nothing left out to count.
  assert.equal(read.sizeExclusion(shown, DATA.facets), null);
  assert.doesNotMatch(view({ query: shown }).text, /Show them/);
  // Removing its chip clears it like any size filter, and it round-trips through the address.
  assert.deepEqual(read.removeFilter('size_band'), { size_band: '', size_min: '', size_max: '' });
  assert.equal(read.queryFromSearch(read.searchFromQuery(shown, 'view=directory')).size_band, 'none');
  // The live page focuses the results heading once the new list answers.
  const dir = src('frontend/src/pages/research/FundDirectory.jsx');
  assert.match(dir, /onShowUnsized=\{\(\) => \{ focusResults\.current = true; change\(showUnsized\(\)\); \}\}/);
});

test('RFD-04B: back from sign-in at the same Directory link, the page says so once and focus goes to the results', () => {
  store.clear();
  const search = '?view=directory&hq_country=GB&size_min=50&sort=-size';
  // The guard keeps the link and remembers it; the redirect itself is unchanged.
  assert.equal(next.loginRedirectFor({ pathname: '/research/funds', search, hash: '#x' }),
    `/login?next=${encodeURIComponent(`/research/funds${search}#x`)}`);
  assert.equal(next.consumeFundsReturn(`/research/funds?view=directory`), false, 'another link is not the one opened');
  assert.equal(next.consumeFundsReturn(`/research/funds${search}`), true, 'the same link, signed in');
  assert.equal(next.consumeFundsReturn(`/research/funds${search}`), false, 'said once');
  // My funds, a profile and another area are not a Directory search: nothing is remembered.
  next.loginRedirectFor({ pathname: '/research/funds', search: '' });
  next.loginRedirectFor({ pathname: '/research/funds/catalog/opp', search: '?view=directory' });
  next.loginRedirectFor({ pathname: '/grow', search: '?view=directory' });
  assert.equal(store.size, 0);
  // A stale marker (older than a kept destination’s 24 hours; this one is from 2020) is cleared, never announced.
  localStorage.setItem('gvpn:funds-return', JSON.stringify({ path: `/research/funds${search}`, ts: Date.UTC(2020, 0, 1) }));
  assert.equal(next.consumeFundsReturn(`/research/funds${search}`), false);
  assert.equal(store.size, 0);
  // An unsafe one is never read.
  localStorage.setItem('gvpn:funds-return', JSON.stringify({ path: '//evil.example/research/funds', ts: Date.UTC(2020, 0, 1) }));
  assert.equal(next.consumeFundsReturn('//evil.example/research/funds'), false);
  // A link too long to keep returns without filters; its own line says so, and it is the one remembered.
  store.clear();
  next.loginRedirectFor({ pathname: '/research/funds', search: `?view=directory&q=${'a'.repeat(220)}` });
  assert.equal(next.consumeFundsReturn(`/research/funds?view=directory&${next.FUNDS_FILTERS_DROPPED}=1`), true);

  const q = { ...read.EMPTY_QUERY, hq_country: 'GB', size_min: '50', sort: '-size' };
  const { html, text } = view({ query: q, opened: 'restored' });
  assert.match(html, /<div role="status" data-testid="fund-directory-restored" class="mt-2 rounded-lg border border-emerald-200 bg-emerald-50[^"]*dark:bg-emerald-950\/30/);
  assert.match(text, /Signed in\. This is the search you opened\.Directory · 2 filters · Size, largest first · page 1 of 1/);
  assert.doesNotMatch(text, /Opened from a link/, 'one line, not two');
  // Before the list answers the region is already in the tree, empty, so its sentence is announced when it arrives.
  assert.match(view({ query: q, opened: 'restored', result: { loading: true, error: null, data: null } }).html,
    /<div role="status" data-testid="fund-directory-restored" class="sr-only"><\/div>/);
  assert.doesNotMatch(view({ query: q }).html, /fund-directory-restored/);
  assert.equal(read.restoredLine({ ...read.EMPTY_QUERY, q: 'dawn' }, null, { total: 60, limit: 25, offset: 25 }),
    'Directory · search “dawn” · no filters · Name, A to Z · page 2 of 3');
  assert.equal(read.restoredLine(q, null, null), null);
  // The heading takes focus, and the page reads the marker once, as it mounts.
  assert.match(html, /<h3 id="fd-results" tabindex="-1"/);
  const dir = src('frontend/src/pages/research/FundDirectory.jsx');
  assert.match(dir, /if \(consumeFundsReturn\(arrival\) && opened !== 'dropped'\) \{ setOpened\('restored'\); focusResults\.current = true; \}/);
  assert.match(dir, /\(document\.getElementById\('fd-results'\) \|\| document\.getElementById\('fd-q'\)\)\?\.focus\(\);/);
});

test('RFD-06 row 5: a removed chip hands focus to the next chip, else Clear all, else the search', () => {
  const dir = src('frontend/src/pages/research/FundDirectory.jsx');
  assert.match(dir, /onClick=\{\(\) => \{ onQuery\(removeFilter\(f\.key\)\); focusAfterChip\(i\); \}\}/);
  assert.match(dir, /\(buttons\[Math\.min\(index, buttons\.length - 1\)\] \|\| document\.getElementById\('fd-q'\)\)\?\.focus\(\);/);
});

test('Investment geography reads Not recorded wherever the boards draw it, and is no filter', () => {
  // The Sheet (desktop) and the bottom sheet (phone) draw the same facts (RFD-02B, RFD-03C/D).
  const sheet = renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDetails, { item: OPP }))));
  assert.match(sheet, /Investment geographyNot recordedNo list records where a fund invests\./);
  // With D7167's proposed fields, it reads that field's own Not recorded.
  const proposed = { investment_geography: { status: 'not_recorded', value: null, reason: 'No source states where this vehicle invests.' } };
  const withProposed = renderedText(renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(FundDetails, { item: { ...OPP, proposed } }))));
  assert.match(withProposed, /Investment geography/);
  assert.doesNotMatch(withProposed, /Investment geography(?!Not recorded)[A-Z][a-z]+ /, 'no place is shown');
  // The coverage disclosure (RFD-02D).
  const { html, text } = view();
  assert.match(html, /data-testid="fund-directory-geography"/);
  assert.match(text, /Investment geographyNot recordedNo list records it, so it is not offered as a filter\./);
  // No filter, no sort and no query key for it.
  assert.doesNotMatch(html, /id="fd-geo|geography=/);
  assert.equal(Object.keys(read.EMPTY_QUERY).some((k) => /geo/.test(k)), false);
});

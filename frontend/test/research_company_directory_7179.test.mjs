/**
 * D7179 (#7179) — Research › Companies directory built to the D7045 canvas
 * (`design/incoming/Research Companies Directory Search Page.dc.html`, boards
 * RS-17-00 to RS-17 F): results first, and Back returns to the same investigation.
 *
 * Pins: every list parameter round-trips through the URL (and nothing else
 * does); the year range is checked before anything is sent and the last valid
 * range is named; the funding total is shown through lib/money.js in its own
 * currency, grouped by currency with Not recorded last; the selection, the last
 * results and the return point live in this tab's session, keyed by member;
 * the page order; one link per row; the facet scope; the states; and the
 * profile's Back and breadcrumb. The Worker half (summary cost, whole-directory
 * facets, no refresh date) is cloudflare-worker/test/research_company_directory_summary_7179.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { researchCompaniesApi } from '../src/lib/api/researchCompanies.js';
import { renderedText } from './_renderedText.mjs';
import { EMPTY_FILTERS, listState } from '../src/lib/companyDirectoryView.js';
import {
  backToResults, countLine, filtersFromSearch, fundingGroups, fundingTotal, readLastResults, readSelection, restoredStatus,
  resultsHref, resultsSearch, resultsSummary, searchWithFilters, selectionKey, takeReturnPoint, writeLastResults,
  writeReturnPoint, writeSelection, yearMessage, yearRange,
} from '../src/pages/research/companyDirectoryState.js';
import CompanyDirectoryZone, {
  CoverageDisclosure, DirectoryCards, DirectoryFilters, DirectoryResults, DirectoryTable,
} from '../src/pages/research/CompanyDirectoryZone.jsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const html = (C, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(C, props)));
const text = (C, props) => renderedText(html(C, props));
const noop = () => {};

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
}

const co = (uid, extra = {}) => ({ uid, name: `Company ${uid}`, website: `${uid}.example`, country: 'Germany', founded_year: 2019, sector: 'robotics', ...extra });
const FUNDED = [
  co('e1', { funding_total: 4_200_000, funding_currency: 'EUR' }),
  co('e2', { funding_total: 900_000, funding_currency: 'EUR' }),
  co('u1', { funding_total: 18_000_000, funding_currency: 'USD' }),
  co('n1'),
  co('n2'),
];
const data = (items = FUNDED, over = {}) => ({
  items, total: 186, limit: 25, offset: 25,
  coverage: { of: 2480, fields: { website: 2214, country: 2391, founded_year: 2105, sector: 1876, funding: 412, last_round: 268, revenue: 96, headcount: 640 } },
  facets: { sector_labels: [{ label: 'robotics', count: 9 }], sector_none: 604, countries: [{ country: 'Germany', code: 'DE', count: 31 }], has: { funding: 412, revenue: 96, headcount: 640 } },
  ...over,
});
const funded = { ...EMPTY_FILTERS, founded_from: '2016', founded_to: '2024', sort: '-funding', page: 2 };

test('every list parameter round-trips through the URL, defaults left out, other keys kept', () => {
  const f = { ...EMPTY_FILTERS, q: 'grid', sector_label: 'none', country: 'Germany', founded_from: '2016', founded_to: '2024', has: ['funding', 'revenue'], sort: '-funding', page: 2, limit: 50 };
  const s = resultsSearch(f);
  assert.equal(s, '?q=grid&sector_label=none&country=Germany&founded_from=2016&founded_to=2024&has=funding%2Crevenue&sort=-funding&page=2&limit=50');
  assert.deepEqual(filtersFromSearch(s), f);
  assert.equal(resultsSearch({ ...EMPTY_FILTERS }), '', 'the defaults write nothing');
  assert.equal(resultsHref(funded), '/research/companies?founded_from=2016&founded_to=2024&sort=-funding&page=2');
  // A hand-edited link: unknown sort, size, page and has values fall back, never reach the Worker.
  assert.deepEqual(filtersFromSearch('?sort=price&limit=7&page=0&has=funding,cash&founded_from=20x6'),
    { ...EMPTY_FILTERS, has: ['funding'] });
  // The tab and the Saved analyses prefill stay beside the list parameters.
  const next = searchWithFilters('tab=analyses&market=Acme&q=old&page=4', { ...EMPTY_FILTERS, q: 'new' });
  assert.equal(next.toString(), 'tab=analyses&market=Acme&q=new');
});

test('a year range is checked before it is sent, and the message names the results that stay', () => {
  assert.deepEqual(yearRange('', ''), { ok: true });
  assert.deepEqual(yearRange('2016', '2024'), { ok: true });
  assert.deepEqual(yearRange('2016', '2016'), { ok: true });
  assert.equal(yearRange('201', '').reason, 'incomplete');
  assert.equal(yearRange('', '999').field, 'founded_to');
  assert.equal(yearRange('2101', '').reason, 'incomplete', 'above 2100 is refused by the Worker too');
  assert.equal(yearRange('0999', '').reason, 'incomplete');
  const reversed = yearRange('2024', '2016');
  assert.equal(reversed.reason, 'reversed');
  assert.equal(yearMessage(reversed, { from: '2016', to: '2024' }), '“From” is after “To”. Showing the last valid results (2016 – 2024) until the range is fixed.');
  assert.equal(yearMessage(yearRange('20', ''), { from: '', to: '' }), 'Type a four-digit year from 1000 to 2100. Showing the last valid results until the range is fixed.');
  assert.equal(yearMessage({ ok: true }, {}), null);
});

test('the zone reads what was applied: the last valid filters while the year range is invalid', () => {
  const zone = read('frontend/src/pages/research/CompanyDirectoryZone.jsx');
  assert.match(zone, /const applied = useMemo\(\(\) => \(\{ \.\.\.\(years\.ok \? filters : lastValid\), q \}\)/);
  assert.match(zone, /const params4api = useMemo\(\(\) => directoryParams\(applied\), \[applied\]\);/);
});

test('a funding total is shown through lib/money.js in its own currency, never as zero', () => {
  assert.equal(fundingTotal({ funding_total: 18_000_000, funding_currency: 'USD' }), 'USD 18,000,000');
  assert.equal(fundingTotal({ funding_total: 4_200_000.5, funding_currency: 'eur' }), 'EUR 4,200,000.50');
  assert.equal(fundingTotal({ funding_total: 120_000_000, funding_currency: 'JPY' }), 'JPY 120,000,000', 'JPY has no minor unit');
  assert.equal(fundingTotal({ funding_total: null, funding_currency: 'USD' }), null);
  assert.equal(fundingTotal({ funding_total: 5, funding_currency: 'ZZZ' }), 'ZZZ 5', 'an unlisted code is named, not converted');
  assert.equal(fundingTotal({ funding_total: 5, funding_currency: null }), '5 · currency not recorded');
  assert.match(read('frontend/src/pages/research/companyDirectoryState.js'), /import \{ codeAmount, currencyCode, majorToMinor \} from '\.\.\/\.\.\/lib\/money\.js';/);
});

test('sorted by funding, rows sit in currency groups in the Worker\'s order, Not recorded last, numbered in the whole result', () => {
  const g = fundingGroups(FUNDED, 25);
  assert.deepEqual(g.map((x) => [x.key, x.rows.map((r) => r.n)]), [['EUR', [26, 27]], ['USD', [28]], ['none', [29, 30]]]);
  assert.match(g[0].label, /^Euro · amounts compared only with each other$/);
  assert.match(g[1].label, /^US dollar · /);
  assert.equal(g[2].label, 'No funding recorded · sorted after every recorded amount');
});

test('the table: one link per company, a separate checkbox, group rows and the sort note under a funding sort', () => {
  const pick = { selected: new Map([['u1', 'Company u1']]), toggle: noop, onAdd: noop };
  const out = html(DirectoryResults, { state: 'ready', data: data(), filters: funded, onChange: noop, onRetry: noop, pick });
  assert.doesNotMatch(out, /role="link"/, 'no row is a link');
  const rows = out.split('<tr').slice(1).filter((r) => r.includes('data-company-link'));
  assert.equal(rows.length, 5);
  for (const r of rows) assert.equal((r.match(/<a /g) || []).length, 1, 'exactly one link in a row');
  assert.match(out, /data-testid="funding-group-EUR"/);
  assert.match(out, /scope="colgroup"/);
  assert.match(out, /aria-sort="descending"/);
  const t = renderedText(out);
  assert.match(t, /26–50 of 186 companies match · page 2 of 8 · of 2,480 in the directory/);
  assert.match(t, /Sorted by funding total within each currency\./);
  assert.match(t, /never ranked against another currency/);
  assert.match(t, /USD 18,000,000/);
  assert.equal((t.match(/Sorted last/g) || []).length, 2, 'each company with no funding says it sorts last');
  assert.match(t, /Funding total\s*recorded for 412 of 2,480/);
  // Not sorted by funding: no groups, no note, and the column stays.
  const byName = renderedText(html(DirectoryTable, { items: FUNDED, coverage: data().coverage, sort: 'name' }));
  assert.doesNotMatch(byName, /Sorted by funding|amounts compared only|Sorted last/);
  assert.match(byName, /EUR 4,200,000/);
});

test('phone and tablet cards: a 44px checkbox beside one link, the funding total with its currency', () => {
  const pick = { selected: new Map(), toggle: noop, onAdd: noop };
  const out = html(DirectoryCards, { items: FUNDED, pick, sort: '-funding', offset: 25 });
  const cards = out.split('<article').slice(1);
  assert.equal(cards.length, 5);
  for (const c of cards) {
    assert.equal((c.match(/<a /g) || []).length, 1);
    assert.match(c, /<label class="flex h-\[44px\] w-\[44px\][^"]*"><input type="checkbox"/, 'the checkbox has its own 44px target, apart from the link');
  }
  const t = renderedText(out);
  assert.match(t, /EUR · Euro · amounts compared only with each other/);
  assert.match(t, /USD 18,000,000\s*funding total/);
  const compact = html(DirectoryResults, { state: 'ready', data: data(), filters: funded, onChange: noop, onRetry: noop, pick, compact: true });
  assert.match(compact, /data-testid="company-cards"/);
  assert.doesNotMatch(compact, /<table/, 'no table wider than a phone');
});

test('results first: search, filters, active filters, results, selection, then coverage', () => {
  const zone = read('frontend/src/pages/research/CompanyDirectoryZone.jsx');
  const body = zone.slice(zone.indexOf('function Directory('), zone.indexOf('const TABS'));
  const at = (s) => { const i = body.indexOf(s); assert.ok(i >= 0, `missing ${s}`); return i; };
  const order = ['<SearchRow ', "{compact ? null : filterPanel(false)}", '<ActiveFilters ', '<DirectoryResults ', '<SelectionBar ', '<CoverageDisclosure '].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.doesNotMatch(body, /<CoverageCard /, 'coverage is no longer a card above the filters');
});

test('filter counts say they are the whole directory\'s; coverage is closed and its freshness is a dependency', () => {
  const f = text(DirectoryFilters, { filters: { ...EMPTY_FILTERS }, facets: data().facets, of: 2480, onChange: noop });
  assert.match(f, /Option counts are of the whole directory \(2,480\), not of your results/);
  assert.match(f, /Reset all filters/);
  const reversed = text(DirectoryFilters, { filters: { ...EMPTY_FILTERS, founded_from: '2024', founded_to: '2016' }, facets: null, onChange: noop, years: { message: 'From is after To.' } });
  assert.match(reversed, /From is after To\./);
  assert.match(html(DirectoryFilters, { filters: { ...EMPTY_FILTERS }, facets: null, onChange: noop, years: { message: 'x' } }), /aria-invalid="true" aria-describedby="company-year-error"/);
  const closed = html(CoverageDisclosure, { coverage: data().coverage });
  assert.match(closed, /aria-expanded="false"/);
  assert.match(renderedText(closed), /How many of all 2,480 companies have each field · not your results/);
  assert.match(closed, /<div id="company-coverage-body" hidden="">/);
  assert.doesNotMatch(renderedText(closed), /Website\s*2,214/, 'the counts are not drawn while it is closed');
  const open = renderedText(html(CoverageDisclosure, { coverage: data().coverage, initiallyOpen: true }));
  assert.match(open, /Last refreshed: not reported by the directory today/);
  assert.doesNotMatch(open, /Last refreshed: \d/, 'no refresh date is invented');
});

test('states: a first read has no count; a later read keeps the rows; a refusal and a failure say so', () => {
  assert.equal(listState({ loading: true, data: null }), 'loading');
  assert.equal(listState({ loading: true, data: { items: [co('a')] } }), 'updating');
  assert.equal(listState({ loading: true, data: { items: [] } }), 'loading', 'an empty last answer is not rows to keep');
  assert.equal(listState({ loading: false, error: Object.assign(new Error('x'), { status: 403 }), data: null }), 'refused');
  assert.equal(listState({ loading: false, error: Object.assign(new Error('x'), { status: 401 }), data: null }), 'refused');
  assert.equal(listState({ loading: false, error: Object.assign(new Error('x'), { status: 503 }), data: null }), 'unreadable');
  const updating = html(DirectoryResults, { state: 'updating', data: data(), filters: funded, onChange: noop, onRetry: noop });
  assert.match(updating, /aria-busy="true"/);
  assert.match(renderedText(updating), /Updating…/);
  assert.match(renderedText(updating), /Company u1/, 'the rows stay while the next read runs');
  const refused = text(DirectoryResults, { state: 'refused', data: null, filters: funded, onChange: noop, onRetry: noop });
  assert.match(refused, /Refused\s*The directory refused the read/);
  assert.doesNotMatch(refused, /companies match|Retry/);
  const zero = text(DirectoryResults, { state: 'empty', data: data([], { total: 0 }), filters: { ...funded, q: 'grid', has: ['revenue'] }, onChange: noop, onRetry: noop, facets: data().facets });
  assert.match(zero, /No matches\s*No company matches “grid” with these filters\./);
  assert.match(zero, /This is a true zero/);
  assert.match(zero, /Founded 2016 – 2024/);
  assert.match(zero, /Search all sectors and countries for “grid”/);
  assert.match(zero, /Revenue is recorded for 96 companies in the whole directory/);
});

test('the last valid results are labelled while the year range is invalid', () => {
  const t = text(DirectoryResults, { state: 'ready', data: data(), filters: funded, onChange: noop, onRetry: noop, yearsKept: 'Founded 2016 – 2024' });
  assert.match(t, /still Founded 2016 – 2024/);
  assert.match(t, /Last valid results/);
});

test('the selection lives in this tab\'s session, keyed by member, and never in the URL', () => {
  const s = memoryStore();
  writeSelection(s, 7, new Map([['hg', { name: 'Halden Grid', page: 2, sector: 'energy', country: 'NO' }], ['od', { name: 'Orchard Data', page: 1 }]]));
  // D7177: each pick keeps the page it was ticked on, for Review selection.
  assert.deepEqual([...readSelection(s, 7)], [
    ['hg', { name: 'Halden Grid', page: 2, sector: 'energy', country: 'NO' }],
    ['od', { name: 'Orchard Data', page: 1, sector: null, country: null }],
  ]);
  s.setItem(selectionKey(6), JSON.stringify([['hg', 'Halden Grid']]));
  assert.deepEqual([...readSelection(s, 6)], [['hg', { name: 'Halden Grid', page: null, sector: null, country: null }]], 'a pick kept as a bare name still reads');
  assert.equal(readSelection(s, 8).size, 0, 'another member starts with nothing selected');
  writeSelection(s, 7, new Map());
  assert.equal(s.getItem(selectionKey(7)), null, 'an empty selection leaves nothing behind');
  assert.equal(readSelection(null, 7).size, 0, 'blocked storage is an empty selection, not a crash');
  s.setItem(selectionKey(9), '{not json');
  assert.equal(readSelection(s, 9).size, 0);
  assert.doesNotMatch(resultsSearch({ ...funded, selected: ['hg'] }), /hg|select/);
});

test('Back to results names page, filters, sort and selection; the return point is taken once, for its own results', () => {
  assert.equal(resultsSummary(funded, 2), 'page 2 · Founded 2016 – 2024 · Funding total, highest first · 2 selected');
  assert.equal(resultsSummary({ ...EMPTY_FILTERS, q: 'grid', country: 'Germany' }, 0), 'page 1 · “grid” · Country: Germany · Name, A to Z');
  assert.equal(restoredStatus(funded, 2), 'Back to your results: page 2, 2 selected');
  assert.equal(restoredStatus({ ...EMPTY_FILTERS }, 0), 'Back to your results: page 1');
  const s = memoryStore();
  assert.deepEqual(backToResults(s), { href: '/research/companies', label: 'Companies', summary: null });
  writeLastResults(s, resultsHref(funded), resultsSummary(funded, 2));
  assert.deepEqual(backToResults(s), { href: resultsHref(funded), label: 'Back to results', summary: 'page 2 · Founded 2016 – 2024 · Funding total, highest first · 2 selected' });
  s.setItem('studioos.research.companies.results', JSON.stringify({ href: 'https://elsewhere.example/', summary: 'x' }));
  assert.equal(readLastResults(s), null, 'only a directory URL is a way back');
  writeReturnPoint(s, resultsHref(funded), 'hg');
  assert.equal(takeReturnPoint(s, '/research/companies'), null, 'other results do not take it');
  assert.deepEqual(takeReturnPoint(s, resultsHref(funded)), { href: resultsHref(funded), uid: 'hg' });
  assert.equal(takeReturnPoint(s, resultsHref(funded)), null, 'taken once');
});

test('the count line reads the API\'s numbers', () => {
  assert.deepEqual(countLine(data()), { range: '26–50', total: '186', page: 'page 2 of 8', directory: 'of 2,480 in the directory' });
  assert.equal(countLine(data([], { coverage: null })).directory, null, 'no directory size until one is read');
});

test('the profile\'s Back and breadcrumb go to this tab\'s last results', () => {
  const profile = read('frontend/src/pages/research/CompanyProfile.jsx');
  assert.match(profile, /const results = backToResults\(sessionStore\(\)\);/);
  assert.match(profile, /<Link to=\{results\.href\} data-testid="link-back-to-results"/);
  assert.match(profile, /<Link to=\{results\.href\} state=\{\{ via: 'breadcrumb' \}\} className="underline">Companies<\/Link>/);
  assert.doesNotMatch(profile, /to="\/research\/companies"/, 'no way back drops the investigation');
});

// ---- the zone, mounted: URL, history, year range, return point, selection ----

const h = createElement;
const textOf = (node) => (!node ? '' : node.nodeType === 3 ? node.textContent || ''
  : node.childNodes?.length ? node.childNodes.map(textOf).join('') : node.textContent || '');
const answer = (p) => ({ ...data(), offset: p.offset ?? 0, limit: p.limit ?? 25 });
const URL0 = '/research/companies?founded_from=2016&founded_to=2024&sort=-funding&page=2';

async function mountZone(url, { session = memoryStore(), list = answer } = {}) {
  const restore = installDocument('', { focus: true });
  globalThis.location.origin = 'https://axal.example';
  const had = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true, writable: true });
  const clip = [];
  const hadClip = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (s) => { clip.push(s); } }, configurable: true });
  const calls = [];
  const original = researchCompaniesApi.list;
  researchCompaniesApi.list = async (p) => { calls.push(p); return list(p); };
  const seen = {};
  function Probe() {
    const l = useLocation();
    seen.at = l.pathname + l.search;
    seen.type = useNavigationType();
    seen.navigate = useNavigate();
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, h(CompanyDirectoryZone, { role: 'founder' }), h(Probe))); });
  await settle();
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(container); };
  const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1];
  const by = (pred) => nodes().find((n) => { const p = props(n); return p && pred(p, n); });
  const button = (label) => nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  return {
    calls, seen, clip, session, nodes, props, by, button,
    text: () => textOf(container),
    async run(fn) { await act(async () => { fn(); }); await settle(); },
    async unmount() {
      await act(async () => root.unmount());
      researchCompaniesApi.list = original;
      if (had) Object.defineProperty(globalThis, 'sessionStorage', had); else delete globalThis.sessionStorage;
      if (hadClip) Object.defineProperty(globalThis.navigator, 'clipboard', hadClip); else delete globalThis.navigator.clipboard;
      restore();
    },
  };
}

test('mounted: the URL drives the read; sort replaces the URL, a page change pushes, and Back reads the earlier page', async () => {
  const ui = await mountZone(URL0);
  try {
    assert.deepEqual(ui.calls[0], { founded_from: '2016', founded_to: '2024', sort: '-funding', limit: 25, offset: 25 });
    assert.match(ui.text(), /26–50 of 186 companies match/);
    assert.match(ui.text(), /Sorted by funding total within each currency/);
    await ui.run(() => ui.props(ui.by((p) => p['aria-label'] === 'Sort companies')).onChange({ target: { value: 'name' } }));
    assert.equal(ui.seen.at, '/research/companies?founded_from=2016&founded_to=2024', 'the sort is written, back to page 1');
    assert.equal(ui.seen.type, 'REPLACE');
    assert.equal(ui.calls.at(-1).offset, 0);
    await ui.run(() => ui.props(ui.button('Next ›')).onClick());
    assert.equal(ui.seen.at, '/research/companies?founded_from=2016&founded_to=2024&page=2');
    assert.equal(ui.seen.type, 'PUSH', 'a page change is its own history entry');
    assert.equal(ui.calls.at(-1).offset, 25);
    const n = ui.calls.length;
    await ui.run(() => ui.seen.navigate(-1));
    assert.equal(ui.seen.at, '/research/companies?founded_from=2016&founded_to=2024', 'Back is the earlier page, not rewritten');
    assert.equal(ui.calls.length, n + 1);
    assert.equal(ui.calls.at(-1).offset, 0);
    await ui.run(() => ui.props(ui.button('Copy link to these results')).onClick());
    assert.deepEqual(ui.clip, ['https://axal.example/research/companies?founded_from=2016&founded_to=2024']);
  } finally { await ui.unmount(); }
});

test('mounted: a reversed or half-typed year sends nothing and keeps the last valid results', async () => {
  const ui = await mountZone(URL0);
  try {
    const n = ui.calls.length;
    const from = () => ui.nodes().find((x) => ui.props(x)?.['aria-label'] === 'Founded in or after');
    await ui.run(() => ui.props(from()).onChange({ target: { value: '2030' } }));
    assert.equal(ui.calls.length, n, 'nothing is sent for a reversed range');
    assert.equal(ui.seen.at, URL0, 'the URL keeps the last valid range');
    assert.match(ui.text(), /“From” is after “To”\. Showing the last valid results \(2016 – 2024\) until the range is fixed\./);
    assert.match(ui.text(), /Last valid results/);
    assert.match(ui.text(), /Company u1/, 'the rows stay');
    assert.equal(ui.props(from())['aria-invalid'], true);
    await ui.run(() => ui.props(from()).onChange({ target: { value: '201' } }));
    assert.equal(ui.calls.length, n, 'nothing is sent for a half-typed year');
    await ui.run(() => ui.props(from()).onChange({ target: { value: '2018' } }));
    assert.equal(ui.calls.length, n + 1);
    assert.equal(ui.calls.at(-1).founded_from, '2018');
    assert.equal(ui.seen.at, '/research/companies?founded_from=2018&founded_to=2024&sort=-funding');
    assert.doesNotMatch(ui.text(), /Last valid results/);
  } finally { await ui.unmount(); }
});

test('mounted: Back to the same results focuses the company link that was opened, says so, and keeps the selection', async () => {
  const session = memoryStore();
  const first = await mountZone(URL0, { session });
  try {
    await first.run(() => first.props(first.nodes().find((x) => first.props(x)?.['data-testid'] === 'pick-company-u1')).onChange());
    const link = first.nodes().find((x) => first.props(x)?.['data-company-link'] === 'u1');
    await first.run(() => first.props(link).onClick({ button: 0, defaultPrevented: true, preventDefault() {} }));
    assert.deepEqual(JSON.parse(session.getItem('studioos.research.companies.return')), { href: URL0, uid: 'u1' });
    assert.deepEqual(backToResults(session), { href: URL0, label: 'Back to results', summary: 'page 2 · Founded 2016 – 2024 · Funding total, highest first · 1 selected' });
    assert.doesNotMatch(first.seen.at, /u1/, 'the selection never reaches the URL');
  } finally { await first.unmount(); }
  const back = await mountZone(URL0, { session });
  try {
    const link = back.nodes().find((x) => back.props(x)?.['data-company-link'] === 'u1');
    assert.ok(link);
    assert.ok(document.activeElement === link, 'focus is on the link that was opened');
    assert.match(back.text(), /Back to your results: page 2, 1 selected/);
    assert.equal(back.props(back.nodes().find((x) => back.props(x)?.['data-testid'] === 'pick-company-u1')).checked, true, 'the selection is restored from this session');
    assert.equal(session.getItem('studioos.research.companies.return'), null, 'the return point is used once');
  } finally { await back.unmount(); }
});

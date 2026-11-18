/**
 * D7172 (#7172) — Research › Markets › Listed companies, built to the D7037
 * canvas (boards RML-00 to RML-11): search by ticker with Source and Sort in
 * the URL, two sources never merged, Details, folded columns, focus after
 * paging, and exports that say what they write.
 *
 * The pure readings are tested directly; the page is mounted against a stubbed
 * `fetch`, and the file the browser is handed is read back from the Blob.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_listed_companies_7172.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import MarketDirectoryZone from '../src/pages/research/MarketDirectoryZone.jsx';
import {
  LISTED_CSV_HEADER, LISTED_SORTS, MARKET_CSV_HEADER, allEdgar, changeListedQuery, clearListedFilters, collectMarkets,
  exportScope, filterMarkets, foldedColumns, headingContext, inBothOnPage, listedCsvCells, listedExport, listedRequest,
  marketCsvCells, marketExport, otherListingsText, pageInfo, pagerLine, readListedQuery, sourceFileName, writeListedQuery, writeTab,
} from '../src/pages/research/listedCompaniesRead.js';
import { exportFileName, stamp } from '../src/lib/csvExport.js';
import { makeZoneActions } from '../src/workspaces/zoneActionBuilder.js';

const h = React.createElement;
const p = (s) => new URLSearchParams(s);
const EDGAR_URL = 'https://www.sec.gov/files/company_tickers_exchange.json';
const LICENCE = 'US government work, not subject to copyright in the United States (17 U.S.C. § 105)';

// Fictional sample rows, as the canvas's are.
const SIG = { source: 'signal_companies', symbol: 'HLDN', name: 'Halden Storage Holdings', exchange: 'Nasdaq', country: 'United States', country_code: 'US', region: 'North America', sector: 'Energy storage', market_cap_band: '$1B–$10B', employee_band: '1,001–5,000', updated_at: '2026-11-12 00:00:00' };
const ED = { source: 'sec_edgar', symbol: 'HLDN', name: 'Halden Storage Holdings', exchange: 'Nasdaq', cik: '0001849203', other_listings: [], source_url: EDGAR_URL, licence: LICENCE, as_of: '2026-10-07' };
const edgarRow = (i) => ({ source: 'sec_edgar', symbol: `E${String(i).padStart(3, '0')}`, name: `Energy Co ${i}`, exchange: i === 3 ? null : 'NYSE', cik: String(1000000000 + i), other_listings: i === 5 ? [{ symbol: 'E005-PA', exchange: 'NYSE' }] : [], source_url: EDGAR_URL, licence: LICENCE, as_of: '2026-10-07' });
const SOURCES = (sig, ed) => [
  { key: 'signal_companies', label: 'StudioOS signal companies', total: sig, store_total: 412, as_of: '2026-11-12 00:00:00' },
  { key: 'sec_edgar', label: 'SEC EDGAR', total: ed, store_total: 7184, as_of: '2026-10-07', url: EDGAR_URL, licence: LICENCE, also_signal_companies: 38 },
];

// ---- the URL contract (RML-00) ----------------------------------------------------

test('the view reads from the URL; anything unknown is the default; defaults stay out of it', () => {
  assert.deepEqual(readListedQuery(p('')), { tab: 'directory', q: '', source: '', sort: '-market_cap', country: '', sector: '', page: 1 });
  assert.deepEqual(readListedQuery(p('tab=listed&q=energy&source=sec_edgar&sort=name&page=2&country=de&sector=Energy')),
    { tab: 'listed', q: 'energy', source: 'sec_edgar', sort: 'name', country: 'DE', sector: 'Energy', page: 2 });
  const junk = readListedQuery(p('tab=x&source=drop&sort=drop&country=Germany&page=-3'));
  assert.deepEqual([junk.tab, junk.source, junk.sort, junk.country, junk.page], ['directory', '', '-market_cap', '', 1]);
  assert.equal(readListedQuery(p(`q=${'x'.repeat(500)}`)).q.length, 120);
  assert.equal(readListedQuery(p('page=999999999')).page, 4001, 'capped where the Worker caps the offset');
  // The plain URL stays plain; the directory's own params are untouched.
  assert.equal(writeListedQuery(p('tab=listed&group=0'), readListedQuery(p(''))).toString(), 'tab=listed&group=0');
  assert.equal(writeListedQuery(p('tab=listed'), { q: 'energy', source: 'sec_edgar', sort: 'name', country: '', sector: '', page: 2 }).toString(),
    'tab=listed&q=energy&source=sec_edgar&sort=name&page=2');
});

test('any change but the page returns to page 1; Clear filters keeps the tab and the sort; tabs keep their params', () => {
  const at = p('tab=listed&q=energy&source=sec_edgar&sort=name&page=3');
  assert.equal(changeListedQuery(at, { page: 4 }).get('page'), '4', 'paging keeps the view');
  assert.equal(changeListedQuery(at, { page: 4 }).get('q'), 'energy');
  for (const patch of [{ q: 'oil' }, { source: '' }, { sort: '-name' }, { country: 'US' }, { sector: 'Energy' }]) {
    assert.equal(changeListedQuery(at, patch).get('page'), null, `${Object.keys(patch)[0]} drops page`);
  }
  assert.equal(clearListedFilters(p('tab=listed&q=x&source=sec_edgar&country=US&sector=Y&sort=name&page=2')).toString(), 'tab=listed&sort=name');
  assert.equal(writeTab(p('q=storage&sort=name%3Aasc'), 'listed').toString(), 'q=storage&sort=name%3Aasc&tab=listed');
  assert.equal(writeTab(p('tab=listed&q=storage&source=sec_edgar'), 'directory').toString(), 'q=storage&source=sec_edgar');
});

test('the Worker is asked for one page of the view: limit 50, offset from the page, default sort left out', () => {
  assert.deepEqual(listedRequest(readListedQuery(p('tab=listed'))),
    { q: undefined, source: undefined, sort: undefined, country: undefined, sector: undefined, limit: 50, offset: undefined });
  assert.deepEqual(listedRequest(readListedQuery(p('q=%20energy%20&source=sec_edgar&sort=name&page=2&country=us'))),
    { q: 'energy', source: 'sec_edgar', sort: 'name', country: 'US', sector: undefined, limit: 50, offset: 50 });
});

// ---- the readings the page prints ------------------------------------------------

test('two sources never merged: the page marks a ticker held by both, and nothing else', () => {
  assert.deepEqual([...inBothOnPage([SIG, ED, { ...ED, symbol: 'ONLY', cik: '2' }])], ['HLDN']);
  assert.equal(inBothOnPage([SIG, { ...SIG, name: 'again' }]).size, 0, 'two rows from one source are not two sources');
});

test('a column folds only when no row in view records it; EDGAR-only views get CIK and other listings', () => {
  const rows = Array.from({ length: 3 }, (_, i) => edgarRow(i + 1));
  assert.deepEqual(foldedColumns(rows).map((c) => c.label), ['Country', 'Sector', 'Market cap band', 'Employees']);
  assert.deepEqual(foldedColumns([SIG, ED]).map((c) => c.label), [], 'a mixed page keeps every column a signal row records');
  assert.deepEqual(foldedColumns([]), [], 'no rows, nothing folded');
  assert.equal(allEdgar(rows), true);
  assert.equal(allEdgar([SIG, ED]), false);
  assert.equal(otherListingsText([]), 'None');
  assert.equal(otherListingsText([{ symbol: 'A-PA', exchange: 'NYSE' }, { symbol: 'A-PB', exchange: null }]), 'A-PA (NYSE); A-PB');
  assert.equal(sourceFileName(EDGAR_URL), 'company_tickers_exchange.json');
});

test('counts, pages and scope come from the Worker\'s answer, never from the page', () => {
  const info = pageInfo({ total: 64, offset: 50, limit: 50, items: rowsOf(14) });
  assert.deepEqual(info, { total: 64, from: 51, to: 64, page: 2, pages: 2, limit: 50 });
  assert.equal(pagerLine(info), 'Rows 51–64 of 64 · page 2 of 2');
  assert.equal(pagerLine(pageInfo({ total: 2, items: [SIG, ED] })), 'Rows 1–2 of 2 · one page');
  const v = readListedQuery(p('tab=listed&q=energy&source=sec_edgar&sort=name&page=2'));
  assert.equal(headingContext(v, info), 'for “energy” · SEC EDGAR · rows 51–64, page 2 of 2');
  assert.equal(exportScope(v, info), 'Rows 51–64 · SEC EDGAR · “energy” · name, A to Z');
  const de = readListedQuery(p('tab=listed&country=DE'));
  assert.equal(headingContext(de, pageInfo({ total: 3, items: rowsOf(3) }), 'Germany'), 'in Germany · Signal companies only');
  assert.equal(exportScope(de, pageInfo({ total: 3, items: rowsOf(3) }), 'Germany'), 'Rows 1–3 · Signal companies · Germany · market cap, largest first');
});

function rowsOf(n) { return Array.from({ length: n }, (_, i) => edgarRow(i + 1)); }

test('the export says its scope in every state, and only a page of rows offers a file (RML-04B)', () => {
  const v = readListedQuery(p('tab=listed'));
  assert.deepEqual(listedExport({ status: 'loading', data: null }, v), { label: 'Export this page · loading', scope: 'Waits for the rows; no file of headers only', disabled: true });
  assert.deepEqual(listedExport({ status: 'unreadable', data: null }, v), { label: 'Export · not available', scope: 'The listed companies could not be read', disabled: true });
  assert.equal(listedExport({ status: 'ready', data: { total: 0, items: [] } }, v).label, 'Export this page · 0 rows');
  assert.equal(listedExport({ status: 'ready', data: { total: 0, items: [] } }, v).disabled, true);
  const ready = listedExport({ status: 'ready', data: { total: 64, offset: 50, limit: 50, items: rowsOf(14) } }, v);
  assert.deepEqual([ready.label, ready.disabled, ready.zone, ready.count], ['Export this page · 14 rows', false, 'listed-companies-page-2', 14]);
  assert.equal(listedExport({ status: 'ready', data: { total: 1, items: [SIG] } }, v).label, 'Export this page · 1 row');
  assert.equal(exportFileName({ zone: 'listed-companies-page-2', count: 14, now: new Date('2026-11-16T12:00:00Z') }), 'listed-companies-page-2-14-rows-2026-11-16.csv');
});

test('RML-07: each source writes what it records, every gap the words Not recorded, an empty list None', () => {
  assert.equal(LISTED_CSV_HEADER.length, 13);
  assert.deepEqual(listedCsvCells(SIG), ['HLDN', 'Halden Storage Holdings', 'Nasdaq', 'Signal companies', 'Not recorded',
    'United States', 'Energy storage', '$1B–$10B', '1,001–5,000', 'Not recorded', '2026-11-12', 'Not recorded', 'Not recorded']);
  assert.deepEqual(listedCsvCells(ED), ['HLDN', 'Halden Storage Holdings', 'Nasdaq', 'SEC EDGAR', '0001849203',
    'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'None', '2026-10-07', EDGAR_URL, LICENCE]);
  const bare = listedCsvCells({ source: 'signal_companies', symbol: 'Z', name: 'Quiet', exchange: null, country: '', sector: null, market_cap_band: null, employee_band: null, updated_at: null });
  assert.deepEqual(bare.slice(2), ['Not recorded', 'Signal companies', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded', 'Not recorded']);
  assert.ok(!bare.includes('') && !bare.includes(null), 'no blank cell');
  assert.deepEqual(MARKET_CSV_HEADER, ['Market', 'Companies (taxonomy count)', 'Tracked sector', 'Slug']);
  assert.deepEqual(marketCsvCells({ name: 'Cold-chain storage', supplied_count: 208, mi_sector: null, slug: 'cold-chain-storage' }),
    ['Cold-chain storage', 208, 'Not mapped', 'cold-chain-storage']);
});

test('the directory export writes every match in the view\'s order, paging the Worker when one read is short', async () => {
  const ms = [
    { name: 'Data storage', slug: 'data-storage', supplied_count: 947, mi_sector: 'Data' },
    { name: 'Energy storage', slug: 'energy-storage', supplied_count: 1284, mi_sector: 'Energy' },
    { name: 'Robotics', slug: 'robotics', supplied_count: 3000, mi_sector: 'Industrial' },
  ];
  assert.deepEqual(filterMarkets(ms, 'storage', 'supplied_count:desc').map((m) => m.slug), ['energy-storage', 'data-storage']);
  assert.deepEqual(filterMarkets(ms, '', 'name:asc').map((m) => m.slug), ['data-storage', 'energy-storage', 'robotics']);
  const asked = [];
  const pages = [[ms[1], ms[0]], [ms[2]], []];
  const got = await collectMarkets({ q: ' storage ', sort: 'supplied_count:desc', pageSize: 2,
    fetchPage: async (params) => { asked.push(params); return { total: 3, items: pages[asked.length - 1] }; } });
  assert.deepEqual(got.map((m) => m.slug), ['energy-storage', 'data-storage', 'robotics']);
  assert.deepEqual(asked, [
    { q: 'storage', sort: 'supplied_count', dir: 'desc', limit: 2, offset: undefined },
    { q: 'storage', sort: 'supplied_count', dir: 'desc', limit: 2, offset: 2 },
  ], 'it stops at the Worker\'s total');
  const short = await collectMarkets({ sort: 'name:asc', fetchPage: async () => ({ total: 9, items: [] }) });
  assert.deepEqual(short, [], 'an empty page ends the loop');
  assert.deepEqual(marketExport({ status: 'ready', count: 6, query: 'storage', sortLabel: 'Company count, highest first' }),
    { label: 'Export filtered markets · 6 rows', scope: 'In the order shown: company count, highest first · “storage”', disabled: false, zone: 'markets', count: 6 });
  assert.equal(marketExport({ status: 'ready', count: 0 }).label, 'Export filtered markets · 0 rows');
  assert.equal(marketExport({ status: 'ready', count: 0 }).disabled, true);
  assert.equal(marketExport({ status: 'unreadable', count: 6 }).label, 'Export · not available');
});

test('the header row\'s Export carries the page\'s scoped label and click', () => {
  let ran = 0;
  const actions = makeZoneActions({ 'research/markets': [{ label: 'Export', kind: 'export' }] });
  const [live] = actions('research/markets', { view: { scoped: { label: 'Export this page · 14 rows', scope: 'Rows 51–64', onClick: () => { ran += 1; } } } });
  assert.deepEqual([live.label, live.disabled, live.title], ['Export this page · 14 rows', false, 'Rows 51–64']);
  live.onClick();
  assert.equal(ran, 1);
  const [off] = actions('research/markets', { view: { scoped: { label: 'Export · not available', disabled: true, onClick: () => { ran += 1; } } } });
  assert.deepEqual([off.label, off.disabled, off.onClick], ['Export · not available', true, undefined], 'a disabled export has no click');
});

// ---- the mounted page --------------------------------------------------------------

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function installDownloads() {
  const files = [];
  const realCreate = document.createElement;
  const realURL = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let pending = null;
  const state = { broken: false };
  URL.createObjectURL = (blob) => { if (state.broken) throw new Error('refused'); pending = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  document.createElement = function create(tag) {
    const node = realCreate.call(this, tag);
    if (String(tag).toLowerCase() === 'a') {
      node.click = () => { files.push({ name: node.download, blob: pending }); };
      node.remove = () => node.parentNode?.removeChild(node);
    }
    return node;
  };
  return {
    files, state,
    async text(i = files.length - 1) { return (await files[i].blob.text()).replace(/^﻿/, ''); },
    restore() { document.createElement = realCreate; URL.createObjectURL = realURL.create; URL.revokeObjectURL = realURL.revoke; },
  };
}

async function mount(path, answer) {
  const restore = installDocument('', { focus: true });
  document.cookie = '';
  const downloads = installDownloads();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url);
    return answer({ path: url.pathname, query: url.searchParams }) ?? json({ detail: 'Not found' }, 404);
  };
  const where = { search: null };
  const header = { actions: [] };
  function Probe() { where.search = useLocation().search; return null; }
  const zoneActions = (scoped, handlers) => {
    header.actions = makeZoneActions({ 'research/markets': [{ label: 'Export', kind: 'export' }] })('research/markets', { handlers, view: { scoped } });
    return header.actions;
  };
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  const textOf = (node) => (node.nodeType === 3 ? node.textContent : (node.childNodes || []).map(textOf).join('') || node.textContent || '');
  const nodes = () => { const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)]; return walk(box); };
  const props = (node) => Object.entries(node).find(([key]) => key.startsWith('__reactProps$'))?.[1] || {};
  const byTestId = (id) => nodes().find((n) => props(n)['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 15; i += 1) await act(async () => { await new Promise((resolve) => setImmediate(resolve)); }); };
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [path] }, h(MarketDirectoryZone, { role: 'founder', zoneActions }), h(Probe))));
  await settle();
  const button = (label) => nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === label);
  return {
    calls, downloads, where, header, nodes, props, byTestId, settle, textOf,
    text: (id) => (id ? (byTestId(id) ? textOf(byTestId(id)) : null) : textOf(box)),
    listedCalls: () => calls.filter((u) => u.pathname.endsWith('/research/listed-companies')),
    marketCalls: () => calls.filter((u) => u.pathname.endsWith('/research/markets')),
    button,
    async press(label) {
      const node = typeof label === 'string' ? button(label) : label;
      if (!node) throw new Error(`no button ${label}`);
      await act(async () => { props(node).onClick?.({ preventDefault() {}, stopPropagation() {} }); });
      await settle();
    },
    async unmount() {
      await act(async () => root.unmount());
      downloads.restore();
      globalThis.fetch = realFetch;
      restore();
    },
  };
}

/** The listed-companies route, answering as the Worker does for these fixtures. */
function listedAnswer({ fail = false } = {}) {
  return ({ path, query }) => {
    if (!path.endsWith('/research/listed-companies')) return null;
    if (fail) return json({ error: 'listed_companies_unreadable', message: 'The listed companies could not be read.' }, 503);
    const q = query.get('q') || '';
    const offset = Number(query.get('offset') || 0);
    if (q === 'HLDN') {
      return json({ items: [SIG, ED], total: 2, in_both: 1, store_total: 7596, limit: 50, offset: 0, sources: SOURCES(1, 1) });
    }
    const all = rowsOf(64);
    return json({ items: all.slice(offset, offset + 50), total: 64, in_both: 0, store_total: 7596, limit: 50, offset, source: query.get('source'), sources: SOURCES(0, 64) });
  };
}

test('page 2 from the URL: one Worker page, EDGAR columns, the fold, the scoped export and the file it writes', async () => {
  const m = await mount('/research/markets?tab=listed&q=energy&source=sec_edgar&sort=name&page=2', listedAnswer());
  try {
    const asked = m.listedCalls().at(-1).searchParams;
    assert.deepEqual(Object.fromEntries(asked), { q: 'energy', source: 'sec_edgar', sort: 'name', limit: '50', offset: '50' });
    assert.match(m.text('listed-heading'), /^64 listing records for “energy” · SEC EDGAR · rows 51–64, page 2 of 2$/);
    assert.match(m.text(), /SEC EDGAR records ticker, name, exchange and CIK\. Its rows carry no country/);
    assert.match(m.text('listed-folded'), /Country, Sector, Market cap band, Employees are Not recorded for every row in this view/);
    const heads = m.nodes().filter((n) => n.tagName === 'TH').map(m.textOf);
    assert.ok(heads.includes('CIK') && heads.includes('Other listings') && !heads.includes('Country'), heads.join('|'));
    assert.match(m.text(), /E055Energy Co 551000000055NYSENone/);
    assert.match(m.text('listed-pager'), /Rows 51–64 of 64 · page 2 of 2/);
    assert.match(m.text('scoped-export'), /Export this page · 14 rows/);
    assert.match(m.text('scoped-export'), /Rows 51–64 · SEC EDGAR · “energy” · name, A to Z/);
    assert.equal(m.header.actions[0].label, 'Export this page · 14 rows', 'the header row says the same as the page');

    await m.press(m.byTestId('scoped-export-button'));
    assert.equal(m.downloads.files.length, 1);
    assert.equal(m.downloads.files[0].name, `listed-companies-page-2-14-rows-${stamp()}.csv`);
    const lines = (await m.downloads.text()).split('\r\n');
    assert.equal(lines.length, 15, 'the header and the 14 rows on screen');
    assert.equal(lines[0], LISTED_CSV_HEADER.join(','));
    assert.equal(lines[1], `E051,Energy Co 51,NYSE,SEC EDGAR,1000000051,Not recorded,Not recorded,Not recorded,Not recorded,None,2026-10-07,${EDGAR_URL},"${LICENCE}"`);
    assert.match(m.text('scoped-export-done'), /Downloaded · 14 rows/);
    assert.match(m.text('scoped-export-done'), /listed-companies-page-2-14-rows-/);
  } finally { await m.unmount(); }
});

test('Previous drops the page from the URL, asks the Worker for page 1, and moves focus to the result heading', async () => {
  const m = await mount('/research/markets?tab=listed&q=energy&source=sec_edgar&sort=name&page=2', listedAnswer());
  try {
    await m.press('‹ Previous');
    assert.equal(m.where.search, '?tab=listed&q=energy&source=sec_edgar&sort=name');
    assert.equal(m.listedCalls().at(-1).searchParams.get('offset'), null);
    assert.equal(m.props(document.activeElement)['data-testid'], 'listed-heading', 'focus is on the result heading');
    assert.match(m.text('listed-heading'), /^64 listing records for “energy” · SEC EDGAR$/);
    assert.match(m.text('scoped-export'), /Export this page · 50 rows/);
    await m.press('Next ›');
    assert.equal(m.where.search, '?tab=listed&q=energy&source=sec_edgar&sort=name&page=2');
  } finally { await m.unmount(); }
});

test('a ticker in both sources: two rows, each with its source and the marker, Details on the EDGAR row', async () => {
  const m = await mount('/research/markets?tab=listed&q=HLDN', listedAnswer());
  try {
    const t = m.text();
    assert.match(m.text('listed-heading'), /^2 listing records for “HLDN”$/);
    assert.match(t, /1 from Signal companies, with bands, and 1 from SEC EDGAR\. 1 ticker in this search is in both sources: each keeps its own row with what that source records\. The rows are not merged\./);
    assert.equal(t.split('Same ticker, 2 sources').length - 1, 2, 'both rows carry the marker');
    assert.match(t, /HLDNHalden Storage Holdings⇄Same ticker, 2 sourcesNasdaqUnited StatesEnergy storage\$1B–\$10B1,001–5,000SSignal companiesNo link recorded/);
    assert.match(t, /HLDNHalden Storage Holdings⇄Same ticker, 2 sourcesCIK 0001849203NasdaqNot recordedNot recordedNot recordedNot recordedESEC EDGARSource file/);
    const details = m.nodes().filter((n) => n.tagName === 'BUTTON' && /details for HLDN, SEC EDGAR/.test(m.props(n)['aria-label'] || ''));
    assert.equal(details.length, 1);
    await m.press(details[0]);
    const d = m.text('listed-details');
    assert.match(d, /CIK0001849203/);
    assert.match(d, /Other listingsNone/);
    assert.match(d, /Read from SEC EDGAR7 Oct 2026/);
    assert.match(d, /company_tickers_exchange\.json/);
    assert.match(d, /Not recorded by this sourceCountry, sector, market cap band and employees\./);
    assert.match(d, /LicenceUS government work/);
    assert.match(m.text('scoped-export'), /Export this page · 2 rows/);
  } finally { await m.unmount(); }
});

test('Source and the search write the URL with history replace and return to page 1', async () => {
  const m = await mount('/research/markets?tab=listed&page=2', listedAnswer());
  try {
    const radios = m.nodes().filter((n) => m.props(n).role === 'radio');
    assert.deepEqual(radios.map((n) => m.props(n)['aria-checked']), [true, false, false]);
    await m.press(radios[2]);
    assert.equal(m.where.search, '?tab=listed&source=sec_edgar');
    const input = m.nodes().find((n) => n.tagName === 'INPUT' && m.props(n).type === 'search');
    await act(async () => { m.props(input).onChange({ target: { value: 'HLDN' } }); });
    await act(async () => { m.props(input).onKeyDown({ key: 'Enter', preventDefault() {} }); });
    await m.settle();
    assert.equal(m.where.search, '?tab=listed&source=sec_edgar&q=HLDN');
    await act(async () => { m.props(input).onKeyDown({ key: 'Escape', preventDefault() {} }); });
    await m.settle();
    assert.equal(m.where.search, '?tab=listed&source=sec_edgar', 'Esc clears the search');
  } finally { await m.unmount(); }
});

test('a country filter leaves SEC EDGAR out and says why; Clear filters brings it back', async () => {
  const m = await mount('/research/markets?tab=listed&country=US', ({ path }) => (path.endsWith('/research/listed-companies')
    ? json({ items: [SIG], total: 1, in_both: 0, store_total: 7596, limit: 50, offset: 0, sources: SOURCES(1, 0) }) : null));
  try {
    assert.match(m.text('listed-heading'), /^1 listing record in United States · Signal companies only$/);
    assert.match(m.text(), /SEC EDGAR is left out while a country filter is on\. EDGAR records no country for its 7,184 companies, so none of them can match\./);
    const edgar = m.nodes().find((n) => m.props(n).role === 'radio' && /SEC EDGAR/.test((n.childNodes || []).map((c) => c.textContent || '').join('')));
    assert.equal(m.props(edgar)['aria-disabled'], 'true');
    await m.press(edgar);
    assert.equal(m.where.search, '?tab=listed&country=US', 'a left-out source cannot be chosen');
    await m.press('Clear filters');
    assert.equal(m.where.search, '?tab=listed');
  } finally { await m.unmount(); }
});

test('a failed read says Unavailable with Retry and offers no file; no match offers Clear filters', async () => {
  const m = await mount('/research/markets?tab=listed&q=energy', listedAnswer({ fail: true }));
  try {
    assert.match(m.text('listed-unreadable'), /Unavailable/);
    assert.match(m.text('listed-unreadable'), /The listed companies could not be read\. This is not a sign there are none; try again\. Your search and filters are kept\./);
    assert.match(m.text('scoped-export'), /Export · not available/);
    assert.equal(m.props(m.byTestId('scoped-export-button')).disabled, true);
    assert.equal(m.header.actions[0].disabled, true, 'the header row offers no file either');
    const before = m.listedCalls().length;
    await m.press(m.nodes().find((n) => m.props(n)['data-state-retry'] === ''));
    assert.equal(m.listedCalls().length, before + 1, 'Retry reads again');
  } finally { await m.unmount(); }

  const none = await mount('/research/markets?tab=listed&q=HLDX&source=sec_edgar', ({ path }) => (path.endsWith('/research/listed-companies')
    ? json({ items: [], total: 0, in_both: 0, store_total: 7596, limit: 50, offset: 0, sources: SOURCES(0, 0) }) : null));
  try {
    assert.match(none.text('listed-no-match'), /No listing record matches “HLDX” in SEC EDGAR\./);
    assert.match(none.text('scoped-export'), /Export this page · 0 rows/);
    await none.press(none.byTestId('listed-clear-filters'));
    assert.equal(none.where.search, '?tab=listed');
  } finally { await none.unmount(); }

  const empty = await mount('/research/markets?tab=listed', ({ path }) => (path.endsWith('/research/listed-companies')
    ? json({ items: [], total: 0, in_both: 0, store_total: 0, limit: 50, offset: 0, sources: SOURCES(0, 0) }) : null));
  try {
    assert.match(empty.text('listed-empty'), /No listed companies are recorded yet\./);
    assert.equal(empty.byTestId('listed-no-match'), undefined);
  } finally { await empty.unmount(); }
});

const MARKETS = [
  { slug: 'energy-storage', name: 'Energy storage', mi_sector: 'Energy', supplied_count: 1284, as_of: '2026-11-02' },
  { slug: 'data-storage', name: 'Data storage', mi_sector: 'Data', supplied_count: 947, as_of: '2026-11-02' },
  { slug: 'cold-chain-storage', name: 'Cold-chain storage', mi_sector: null, supplied_count: 208, as_of: '2026-11-02' },
  { slug: 'robotics', name: 'Robotics', mi_sector: 'Industrial', supplied_count: 3000, as_of: '2026-11-02' },
];

test('the directory exports the filtered markets in the view\'s order, not the first 100 read', async () => {
  const m = await mount('/research/markets?q=storage&sort=name%3Aasc', ({ path, query }) => {
    if (!path.endsWith('/research/markets')) return null;
    const items = filterMarkets(MARKETS, query.get('q'), `${query.get('sort')}:${query.get('dir')}`);
    return json({ items, total: items.length });
  });
  try {
    assert.match(m.text('scoped-export'), /Export filtered markets · 3 rows/);
    assert.match(m.text('scoped-export'), /In the order shown: name, A to Z · “storage”/);
    assert.equal(m.header.actions[0].label, 'Export filtered markets · 3 rows');
    await act(async () => { m.header.actions[0].onClick(); });
    await m.settle();
    assert.equal(m.downloads.files[0].name, `markets-3-rows-${stamp()}.csv`);
    assert.deepEqual((await m.downloads.text()).split('\r\n'), [
      'Market,Companies (taxonomy count),Tracked sector,Slug',
      'Cold-chain storage,208,Not mapped,cold-chain-storage',
      'Data storage,947,Data,data-storage',
      'Energy storage,1284,Energy,energy-storage',
    ]);
  } finally { await m.unmount(); }
});

test('when one read does not hold the directory, the count is the Worker\'s total and the file pages the Worker', async () => {
  const m = await mount('/research/markets?q=storage&country=DE&fresh=90&src=named', ({ path, query }) => {
    if (!path.endsWith('/research/markets')) return null;
    if (query.get('country') !== 'DE' || query.get('fresh') !== '90' || query.get('src') !== 'named') return json({ items: [MARKETS[3]], total: 1 });
    if (query.get('limit') === '1') return json({ items: [MARKETS[0]], total: 3 });
    if (query.get('q') === 'storage') {
      const off = Number(query.get('offset') || 0);
      return json({ items: MARKETS.slice(0, 3).slice(off, off + 2), total: 3 });
    }
    return json({ items: MARKETS.slice(0, 2), total: 186 });
  });
  try {
    assert.match(m.text('scoped-export'), /Export filtered markets · 3 rows/);
    const initial = m.marketCalls().find((u) => u.searchParams.get('limit') === '25');
    assert.deepEqual(Object.fromEntries(initial.searchParams), { q: 'storage', sort: 'supplied_count', dir: 'desc', country: 'DE', fresh: '90', src: 'named', limit: '25' });
    await m.press(m.byTestId('scoped-export-button'));
    assert.equal(m.downloads.files[0].name, `markets-3-rows-${stamp()}.csv`);
    assert.equal((await m.downloads.text()).split('\r\n').length, 4);
    assert.doesNotMatch(await m.downloads.text(), /Robotics/);
    const exports = m.marketCalls().filter((u) => u.searchParams.get('limit') === '100');
    assert.deepEqual(exports.map((u) => [u.searchParams.get('country'), u.searchParams.get('fresh'), u.searchParams.get('src')]), [['DE', '90', 'named'], ['DE', '90', 'named']]);
    assert.deepEqual(m.marketCalls().filter((u) => u.searchParams.get('limit') === '100' && u.searchParams.get('q')).map((u) => u.searchParams.get('offset')), [null, '2']);
  } finally { await m.unmount(); }
});

test('the tabs are the URL\'s: Listed companies writes tab=listed and keeps the search; arrows move between them', async () => {
  const m = await mount('/research/markets?q=storage', (r) => (r.path.endsWith('/research/markets') ? json({ items: MARKETS, total: 4 }) : listedAnswer()(r)));
  try {
    const tabs = m.nodes().filter((n) => m.props(n).role === 'tab');
    assert.deepEqual(tabs.map((n) => m.props(n)['aria-selected']), [true, false]);
    assert.match(m.text(), /Government ownership\s*Not recorded\s*no source records who owns a company/);
    await m.press(tabs[1]);
    assert.equal(m.where.search, '?q=storage&tab=listed');
    assert.ok(m.byTestId('markets-public'));
    await act(async () => { m.props(m.nodes().filter((n) => m.props(n).role === 'tab')[1]).onKeyDown({ key: 'ArrowLeft', preventDefault() {} }); });
    await m.settle();
    assert.equal(m.where.search, '?q=storage');
  } finally { await m.unmount(); }
});

test('a browser that refuses the file is the Error state, with Try again', async () => {
  const m = await mount('/research/markets?tab=listed&q=HLDN', listedAnswer());
  try {
    m.downloads.state.broken = true;
    await m.press(m.byTestId('scoped-export-button'));
    assert.match(m.text('scoped-export-error'), /The file could not be created in this browser\.Nothing was downloaded\. The rows on screen are unchanged\./);
    m.downloads.state.broken = false;
    await m.press('Try again');
    assert.equal(m.downloads.files.length, 1);
    assert.match(m.text('scoped-export-done'), /Downloaded · 2 rows/);
  } finally { await m.unmount(); }
});

test('nothing on the page is sample data from the boards', async () => {
  const { readFileSync } = await import('node:fs');
  const src = ['ListedCompaniesPanel.jsx', 'listedCompaniesRead.js', 'MarketDirectoryZone.jsx']
    .map((f) => readFileSync(new URL(`../src/pages/research/${f}`, import.meta.url), 'utf8')).join('\n');
  for (const sample of ['HLDN', 'Halden', '0001849203', '7,184', '7184', '7,596', '412 ', 'Meridale']) {
    assert.ok(!src.includes(sample), `the page writes the canvas's sample "${sample}"`);
  }
  assert.ok(LISTED_SORTS.every((s) => s.label));
});

test('phone (RML-10): cards with ticker and source first, the sticky pager and export, and the filters sheet that returns to page 1', async () => {
  const realMatch = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  let m;
  try {
    m = await mount('/research/markets?tab=listed&q=energy&page=2', listedAnswer());
    const cards = () => m.nodes().filter((n) => m.props(n)['data-testid'] === 'listed-card');
    assert.equal(cards().length, 14);
    assert.match(m.textOf(cards()[0]), /^Energy Co 51E051ESEC EDGARMore details/);
    assert.equal(m.nodes().some((n) => n.tagName === 'TABLE'), false, 'no table on a phone');
    const bar = m.text('listed-phone-bar');
    assert.match(bar, /‹ PreviousPage 2 of 2Next ›/);
    assert.match(bar, /Export this page · 14 rows/);
    await m.press(m.nodes().find((n) => m.props(n)['aria-label'] === 'More details for E051, SEC EDGAR'));
    assert.match(m.textOf(cards()[0]), /CIK1000000051CountryNot recorded.*Read7 Oct 2026Open source file/);
    await m.press(m.nodes().find((n) => m.props(n)['aria-haspopup'] === 'dialog'));
    const radio = m.nodes().find((n) => n.tagName === 'INPUT' && m.props(n).name === 'listed-source' && /SEC EDGAR/.test(m.textOf(n.parentNode)));
    await act(async () => { m.props(radio).onChange({ target: {} }); });
    await m.press('Apply');
    assert.equal(m.where.search, '?tab=listed&q=energy&source=sec_edgar', 'Apply writes the source and returns to page 1');
  } finally {
    globalThis.matchMedia = realMatch;
    if (m) await m.unmount();
  }
});

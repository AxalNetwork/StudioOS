/**
 * D7172 (#7172) — the readings Research › Markets' Listed companies tab and its
 * two scoped exports share, to the D7037 canvas
 * (`design/incoming/Research Markets Listed Search and CSV Exports Page.dc.html`,
 * boards RML-00 to RML-11). Pure, so the tests read them without a browser.
 *
 * THE URL IS THE VIEW (RML-00, URL contract). `tab`, `q`, `source`, `sort`,
 * `country`, `sector` and `page` live in the address with history replace, so
 * Refresh and Back return the same page of the same search. Defaults stay out
 * of the URL. Any change to the search, source, sort, country or sector drops
 * `page`, so the reader is back on page 1. `q` and `sort` are shared with the
 * Market directory tab, which reads them as its own (`readMarketQuery`); a sort
 * one tab does not know falls back to that tab's default.
 *
 * TWO SOURCES, NEVER MERGED. A ticker in both stores is two rows, each with
 * what its own source records. `inBothOnPage` marks the pairs on the page
 * shown; the Worker's `in_both` counts them across every page of the search.
 *
 * EXPORTS SAY WHAT THEY WRITE. "Export this page · N rows" writes the rows on
 * screen in the order shown, every column including the folded ones;
 * "Export filtered markets · N rows" writes every market the search matches,
 * in the current sort, paging `GET /api/research/markets` when one read does not
 * hold them all. Missing values are written as "Not recorded" (owner, D7037
 * question 2, answer A), never a blank.
 */

import { NOT_RECORDED } from '../../lib/absence.js';

/** The Worker's page size for the listed companies (D595): one page per read. */
export const LISTED_PAGE = 50;
/** The Worker's own cap on `offset` (`LISTED_MAX_OFFSET`), as a page number. */
const MAX_PAGE = Math.floor(200_000 / LISTED_PAGE) + 1;


/** The Worker's sort keys, in the canvas's words. The first is the default. */
export const LISTED_SORTS = [
  { value: '-market_cap', label: 'Market cap, largest first' },
  { value: 'market_cap', label: 'Market cap, smallest first' },
  { value: 'name', label: 'Name, A to Z' },
  { value: '-name', label: 'Name, Z to A' },
];

/** The Source choice (RML-02, RML-10C). `''` is both stores. */
export const LISTED_SOURCES = [
  { value: '', label: 'All sources', hint: 'Both stores, one row per source' },
  { value: 'signal_companies', label: 'Signal companies', hint: 'With country, sector and bands' },
  { value: 'sec_edgar', label: 'SEC EDGAR', hint: 'Ticker, name, exchange and CIK only' },
];

export const SOURCE_LABEL = { signal_companies: 'Signal companies', sec_edgar: 'SEC EDGAR' };

const sortLabel = (v) => (LISTED_SORTS.find((s) => s.value === v) || LISTED_SORTS[0]).label;
const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** The view a URL holds. Anything unreadable is the default, never an error. */
export function readListedQuery(params) {
  const get = (k) => params?.get?.(k);
  const rawSource = get('source');
  const rawSort = get('sort');
  const rawCountry = String(get('country') || '').trim();
  const page = Number.parseInt(String(get('page') || ''), 10);
  return {
    tab: get('tab') === 'listed' ? 'listed' : 'directory',
    q: String(get('q') || '').slice(0, 120),
    source: LISTED_SOURCES.some((s) => s.value && s.value === rawSource) ? rawSource : '',
    sort: LISTED_SORTS.some((s) => s.value === rawSort) ? rawSort : LISTED_SORTS[0].value,
    country: /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : '',
    sector: String(get('sector') || '').trim().slice(0, 120),
    page: Number.isFinite(page) && page > 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** The params for a listed view; defaults are left out so the plain URL stays plain. */
export function writeListedQuery(params, view) {
  const next = new URLSearchParams(params);
  const put = (k, v, dflt = '') => { if (v && v !== dflt) next.set(k, String(v)); else next.delete(k); };
  put('q', view.q);
  put('source', view.source);
  put('sort', view.sort, LISTED_SORTS[0].value);
  put('country', view.country);
  put('sector', view.sector);
  put('page', view.page > 1 ? view.page : '');
  return next;
}

/**
 * Apply a change to the listed view. Changing anything but the page returns to
 * page 1 (RML-04 note 2); a page change keeps everything else.
 */
export function changeListedQuery(params, patch) {
  const cur = readListedQuery(params);
  const resets = Object.keys(patch).some((k) => k !== 'page');
  return writeListedQuery(params, { ...cur, ...patch, page: resets ? 1 : (patch.page ?? cur.page) });
}

/** Clear filters (RML-08): search, source, country and sector; the tab and the sort stay. */
export const clearListedFilters = (params) => changeListedQuery(params, { q: '', source: '', country: '', sector: '' });

/** Switching tabs keeps each tab's own parameters (URL contract): only `tab` changes. */
export function writeTab(params, tab) {
  const next = new URLSearchParams(params);
  if (tab === 'listed') next.set('tab', 'listed'); else next.delete('tab');
  return next;
}

/** What `GET /api/research/listed-companies` is asked for this view. */
export function listedRequest(view) {
  return {
    q: view.q.trim() || undefined,
    source: view.source || undefined,
    sort: view.sort !== LISTED_SORTS[0].value ? view.sort : undefined,
    country: view.country || undefined,
    sector: view.sector || undefined,
    limit: LISTED_PAGE,
    offset: view.page > 1 ? (view.page - 1) * LISTED_PAGE : undefined,
  };
}

/** A country or sector filter leaves SEC EDGAR out: EDGAR records neither (RML-05). */
export const edgarLeftOut = (view) => !!(view.country || view.sector);

/** Rows a–b of total, page p of P, from the Worker's answer; never a count of the page. */
export function pageInfo(data) {
  const items = data?.items || [];
  const total = Number(data?.total) || 0;
  const limit = Number(data?.limit) || LISTED_PAGE;
  const offset = Number(data?.offset) || 0;
  return {
    total,
    from: items.length ? offset + 1 : 0,
    to: offset + items.length,
    page: Math.floor(offset / limit) + 1,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
  };
}

/** The pager's line (RML-02, RML-04): "Rows 51–64 of 64 · page 2 of 2". */
export function pagerLine(info, fmt = (n) => Number(n).toLocaleString('en-US')) {
  const rows = `Rows ${fmt(info.from)}–${fmt(info.to)} of ${fmt(info.total)}`;
  return info.pages > 1 ? `${rows} · page ${fmt(info.page)} of ${fmt(info.pages)}` : `${rows} · one page`;
}

/** Symbols with a row from each source ON THIS PAGE: the "Same ticker, 2 sources" marker. */
export function inBothOnPage(items = []) {
  const seen = new Map();
  for (const x of items) {
    const sym = String(x?.symbol || '');
    if (!sym) continue;
    const set = seen.get(sym) || new Set();
    set.add(x.source || 'signal_companies');
    seen.set(sym, set);
  }
  return new Set([...seen].filter(([, s]) => s.size > 1).map(([sym]) => sym));
}

/** The columns a row may not record; folded on screen when no row in view records them. */
export const FOLDABLE = [
  { key: 'exchange', label: 'Exchange' },
  { key: 'country', label: 'Country' },
  { key: 'sector', label: 'Sector' },
  { key: 'market_cap_band', label: 'Market cap band' },
  { key: 'employee_band', label: 'Employees' },
];

const has = (v) => v != null && String(v).trim() !== '';

/** The foldable columns that are Not recorded on EVERY row in view (RML-04). None when there are no rows. */
export function foldedColumns(items = []) {
  if (!items.length) return [];
  return FOLDABLE.filter((c) => items.every((x) => !has(x?.[c.key])));
}

/** True when every row in view is SEC EDGAR's: CIK and other listings then get columns of their own (RML-04). */
export const allEdgar = (items = []) => items.length > 0 && items.every((x) => x?.source === 'sec_edgar');

/** `other_listings` as the canvas writes it: "TICKER (EXCHANGE)", "; " between. Empty is None. */
export function otherListingsText(list) {
  if (!Array.isArray(list) || list.length === 0) return 'None';
  return list.map((o) => (o?.exchange ? `${o.symbol} (${o.exchange})` : String(o?.symbol || ''))).join('; ');
}

/** The file a source URL names, for a short link text ("company_tickers_exchange.json"). */
export function sourceFileName(url) {
  const m = /\/([^/?#]+)(?:[?#].*)?$/.exec(String(url || ''));
  return m ? m[1] : 'Source file';
}

/** "2026-10-07…" → "7 Oct 2026"; anything else is null. */
export function shortDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The words after the count in the result heading (RML-03, RML-04, RML-05). */
export function headingContext(view, info, countryName = null) {
  const bits = [];
  if (view.q.trim()) bits.push(`for “${view.q.trim()}”`);
  if (view.country) bits.push(`in ${countryName || view.country}`);
  if (view.sector) bits.push(`in ${view.sector}`);
  let tail = bits.join(' ');
  if (view.source) tail += ` · ${SOURCE_LABEL[view.source]}`;
  else if (edgarLeftOut(view)) tail += ' · Signal companies only';
  if (info && info.page > 1 && info.from) tail += ` · rows ${info.from}–${info.to}, page ${info.page} of ${info.pages}`;
  return tail.trim();
}

/** The export's scope line (RML-04): rows, source, search, filters and the order. */
export function exportScope(view, info, countryName = null) {
  return [
    `Rows ${info.from}–${info.to}`,
    view.source ? SOURCE_LABEL[view.source] : (edgarLeftOut(view) ? 'Signal companies' : 'all sources'),
    view.q.trim() ? `“${view.q.trim()}”` : null,
    view.country ? (countryName || view.country) : null,
    view.sector || null,
    lowerFirst(sortLabel(view.sort)),
  ].filter(Boolean).join(' · ');
}

/**
 * The listed export control in each state (RML-04B): ready with its count,
 * loading, zero rows and a failed read each say so in the label, and only ready
 * offers a file.
 */
export function listedExport(read, view, countryName = null) {
  if (read?.status === 'unreadable' || read?.status === 'not_found') {
    return { label: 'Export · not available', scope: 'The listed companies could not be read', disabled: true };
  }
  if (!read?.data || read.status === 'loading') {
    return { label: 'Export this page · loading', scope: 'Waits for the rows; no file of headers only', disabled: true };
  }
  const items = read.data.items || [];
  if (!items.length) {
    return { label: 'Export this page · 0 rows', scope: 'No listing record matches, so there is nothing to export', disabled: true };
  }
  const info = pageInfo(read.data);
  return {
    label: `Export this page · ${items.length} ${items.length === 1 ? 'row' : 'rows'}`,
    scope: exportScope(view, info, countryName),
    disabled: false,
    zone: `listed-companies-page-${info.page}`,
    count: items.length,
  };
}

/** RML-07: the listing file's columns. Licence follows Source link. */
export const LISTED_CSV_HEADER = [
  'Ticker', 'Company', 'Exchange', 'Source', 'CIK', 'Country', 'Sector', 'Market cap band', 'Employee band',
  'Other listings', 'Source date', 'Source link', 'Licence',
];

const or = (v) => (has(v) ? v : NOT_RECORDED);

/**
 * One listing record → its CSV cells (RML-07 mapping). Nothing is copied across
 * sources: a signal company has no CIK, an EDGAR row has no bands, and each gap
 * is the words "Not recorded". An EDGAR row's empty `other_listings` is None,
 * because EDGAR records it.
 */
export function listedCsvCells(x) {
  if (x?.source === 'sec_edgar') {
    return [
      x.symbol, x.name, or(x.exchange), SOURCE_LABEL.sec_edgar, or(x.cik),
      NOT_RECORDED, NOT_RECORDED, NOT_RECORDED, NOT_RECORDED,
      otherListingsText(x.other_listings), or(String(x.as_of || '').slice(0, 10)), or(x.source_url), or(x.licence),
    ];
  }
  return [
    x.symbol, x.name, or(x.exchange), SOURCE_LABEL.signal_companies, NOT_RECORDED,
    or(x.country), or(x.sector), or(x.market_cap_band), or(x.employee_band),
    NOT_RECORDED, or(String(x.updated_at || '').slice(0, 10)), NOT_RECORDED, NOT_RECORDED,
  ];
}

// ---- The Market directory's export ----------------------------------------------

/**
 * The market file's columns (RML-06B): the four the zone exported before D7172,
 * unchanged and first, then D7710's provenance columns (owner answer A, appended):
 * the directory's date, the countries, the named and sector-level source counts,
 * the newest named date and what it measures, and when the Worker answered.
 * Every value comes from the list response; a missing one is "Not recorded" (D7172).
 */
export const MARKET_CSV_HEADER = [
  'Market', 'Companies (taxonomy count)', 'Tracked sector', 'Slug',
  'Directory as of', 'Countries', 'Sources naming the market', 'Sector-level sources (inherited)',
  'Newest named source', 'Newest date basis', 'Read at',
];
const BASIS_WORDS = { reported: 'Date the source reports', period_measured: 'End of the period measured', retrieved: 'Date retrieved' };
const kindCount = (m, k) => (Number.isFinite(m?.sources_by_kind?.[k]?.count) ? m.sources_by_kind[k].count : NOT_RECORDED);
export const marketCsvCells = (m) => [
  m.name, m.supplied_count, m.mi_sector || 'Not mapped', m.slug,
  or(m.as_of),
  m.countries?.status === 'recorded' && m.countries.value.length
    ? m.countries.value.map((c) => `${c.code} ${c.count}`).join('; ') : NOT_RECORDED,
  kindCount(m, 'signal_evidence'),
  kindCount(m, 'market_intel'),
  m.newest_source_at?.status === 'recorded' ? m.newest_source_at.value : NOT_RECORDED,
  BASIS_WORDS[m.newest_source_basis] || NOT_RECORDED,
  or(m.read_at),
];

/** The directory's sort value (`supplied_count:desc`) → the Worker's `sort` and `dir`. */
export function marketSortParams(sort) {
  const [key, dir] = String(sort || '').split(':');
  return { sort: key || 'supplied_count', dir: dir === 'asc' ? 'asc' : 'desc' };
}

/** The markets a search shows, in the view's order: the Private panel's own filter. */
export function filterMarkets(items = [], query = '', sort = 'supplied_count:desc') {
  const q = String(query || '').trim().toLowerCase();
  const { sort: key, dir } = marketSortParams(sort);
  const sign = dir === 'asc' ? 1 : -1;
  return items
    .filter((m) => !q || String(m.name || '').toLowerCase().includes(q))
    .sort((a, b) => sign * (key === 'name' ? a.name.localeCompare(b.name) : (a[key] - b[key])) || a.name.localeCompare(b.name));
}

/**
 * Every market the search matches, paged from the Worker (`GET
 * /api/research/markets?q=&sort=&dir=`, 100 a read) until it has `total`.
 * Used only when the page's one read did not hold the whole directory.
 * A captured directory request also preserves country, freshness, source and
 * thesis-sector filters on every export page; paging starts at the first match.
 * A page that comes back empty before `total` stops the loop rather than
 * spinning; the file then holds what was read and the caller says how many.
 */
export async function collectMarkets({ q, sort, request = null, fetchPage, pageSize = 100, maxPages = 100 }) {
  const params = { ...(request || { q: String(q || '').trim() || undefined, ...marketSortParams(sort) }), limit: pageSize };
  const out = [];
  let total = Infinity;
  for (let i = 0; i < maxPages && out.length < total; i += 1) {
    const r = await fetchPage({ ...params, offset: out.length || undefined });
    const items = r?.items || [];
    total = Number(r?.total) || 0;
    if (!items.length) break;
    // D7710: each row keeps the read time of the page it came from.
    out.push(...items.map((m) => ({ ...m, read_at: r?.read_at ?? null })));
  }
  return out;
}

/** The directory's export control (RML-06, RML-08). `count` is the Worker's total when one read is not the whole list. */
export function marketExport({ status, count, query, sort, sortLabel: label }) {
  if (status === 'unreadable' || status === 'not_found') {
    return { label: 'Export · not available', scope: 'The markets could not be read', disabled: true };
  }
  if (status === 'loading' || count == null) {
    return { label: 'Export filtered markets · loading', scope: 'Waits for the markets; no file of headers only', disabled: true };
  }
  if (!count) {
    return { label: 'Export filtered markets · 0 rows', scope: 'No market matches, so there is nothing to export', disabled: true };
  }
  const q = String(query || '').trim();
  return {
    label: `Export filtered markets · ${count} ${count === 1 ? 'row' : 'rows'}`,
    scope: [`In the order shown: ${lowerFirst(label || sort)}`, q ? `“${q}”` : null].filter(Boolean).join(' · '),
    disabled: false,
    zone: 'markets',
    count,
  };
}

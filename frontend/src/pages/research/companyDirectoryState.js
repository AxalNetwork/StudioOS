// D7179 (#7179, canvas D7045, boards RS-17-00 to RS-17 F) — the two kinds of
// state the Companies directory keeps, and the readings its results print.
//
// THE URL carries every list parameter, under the API's own names: q,
// sector_label, country, founded_from, founded_to, has, sort, page and limit.
// A copied link, a reload, Back, the breadcrumb and the tab switch all read
// the same results from it. It never carries who you are or what you picked.
//
// THIS TAB'S SESSION (sessionStorage, which sign-out clears) carries the
// selection, keyed by the member, the last results URL with its summary for
// the profile's "Back to results" and breadcrumb, and the return point: the
// company link that was opened, so the return can scroll it into view and
// focus it. Option A of D7045's selection-lifetime question: this tab only.
//
// Money goes through `lib/money.js`: a funding total is a REAL in major units,
// shown in its own currency and never ranked against another.
import { codeAmount, currencyCode, majorToMinor } from '../../lib/money.js';
import { DIRECTORY_SORTS, EMPTY_FILTERS, HAS_OPTIONS, PAGE_SIZES, activeFilters, pageWindow } from '../../lib/companyDirectoryView.js';

/** The list parameters a results URL carries, in the order it writes them. */
export const URL_KEYS = ['q', 'sector_label', 'country', 'founded_from', 'founded_to', 'has', 'sort', 'page', 'limit'];

export const DIRECTORY_PATH = '/research/companies';

/** A results URL (or URLSearchParams) → the directory's filters. Anything it cannot use is left at its default. */
export function filtersFromSearch(search) {
  const p = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const get = (k) => (p.get(k) || '').trim();
  const sort = DIRECTORY_SORTS.some((s) => s.value === get('sort')) ? get('sort') : EMPTY_FILTERS.sort;
  const limit = PAGE_SIZES.includes(Number(get('limit'))) ? Number(get('limit')) : EMPTY_FILTERS.limit;
  const page = /^\d{1,6}$/.test(get('page')) && Number(get('page')) >= 1 ? Number(get('page')) : 1;
  const year = (k) => (/^\d{1,4}$/.test(get(k)) ? get(k) : '');
  const has = get('has').split(',').map((s) => s.trim()).filter((h) => HAS_OPTIONS.some((o) => o.value === h));
  return {
    ...EMPTY_FILTERS,
    q: (p.get('q') || '').slice(0, 120),
    sector_label: get('sector_label'),
    country: get('country'),
    founded_from: year('founded_from'),
    founded_to: year('founded_to'),
    has: [...new Set(has)],
    sort, limit, page,
  };
}

/** The list keys of `f`, defaults left out, as `[key, value]` pairs in URL_KEYS order. */
function listEntries(f) {
  const out = [];
  const q = (f.q || '').trim();
  if (q) out.push(['q', q]);
  if (f.sector_label) out.push(['sector_label', f.sector_label]);
  if (f.country) out.push(['country', f.country]);
  if (f.founded_from) out.push(['founded_from', String(f.founded_from)]);
  if (f.founded_to) out.push(['founded_to', String(f.founded_to)]);
  if (f.has?.length) out.push(['has', f.has.join(',')]);
  if (f.sort && f.sort !== EMPTY_FILTERS.sort) out.push(['sort', f.sort]);
  if (Number(f.page) > 1) out.push(['page', String(f.page)]);
  if (Number(f.limit) && Number(f.limit) !== EMPTY_FILTERS.limit) out.push(['limit', String(f.limit)]);
  return out;
}

/** `?q=…&page=2`, only the list parameters: what "Copy link to these results" and Back carry. */
export function resultsSearch(f) {
  const s = new URLSearchParams(listEntries(f)).toString();
  return s ? `?${s}` : '';
}

export const resultsHref = (f) => `${DIRECTORY_PATH}${resultsSearch(f)}`;

/**
 * The page's whole query with the list parameters replaced by `f`'s. Every
 * other key (`tab`, and `market`/`website` for Saved analyses) is kept, so
 * switching tabs never drops the investigation.
 */
export function searchWithFilters(current, f) {
  const next = new URLSearchParams(current instanceof URLSearchParams ? current : current || '');
  for (const k of URL_KEYS) next.delete(k);
  for (const [k, v] of listEntries(f)) next.set(k, v);
  return next;
}

export const YEAR_MIN = 1000;
export const YEAR_MAX = 2100;

/**
 * RS-17 A · details (RCD01D): a year is four digits from 1000 to 2100, and From
 * is not after To. The Worker refuses anything else (400); the page checks first
 * and sends nothing until the range is valid.
 */
export function yearRange(from, to) {
  const bad = (v) => v !== '' && v != null && !(/^\d{4}$/.test(String(v)) && Number(v) >= YEAR_MIN && Number(v) <= YEAR_MAX);
  if (bad(from) || bad(to)) {
    return { ok: false, reason: 'incomplete', field: bad(from) ? 'founded_from' : 'founded_to', message: `Type a four-digit year from ${YEAR_MIN} to ${YEAR_MAX}.` };
  }
  if (from && to && Number(from) > Number(to)) {
    return { ok: false, reason: 'reversed', field: 'founded_from', message: '“From” is after “To”.' };
  }
  return { ok: true };
}

/** "Founded 2016 – 2024", "Founded in or after 2016", or null. */
export function foundedLabel(from, to) {
  if (from && to) return `Founded ${from} – ${to}`;
  if (from) return `Founded in or after ${from}`;
  if (to) return `Founded in or before ${to}`;
  return null;
}

/** The inline message beside the year fields, naming the results that stay. */
export function yearMessage(check, last) {
  if (check.ok) return null;
  const kept = foundedLabel(last?.from, last?.to);
  return `${check.message} Showing the last valid results${kept ? ` (${kept.replace(/^Founded /, '')})` : ''} until the range is fixed.`;
}

export const sortLabel = (sort) => (DIRECTORY_SORTS.find((s) => s.value === sort) || DIRECTORY_SORTS[0]).label;
export const isFundingSort = (sort) => sort === 'funding' || sort === '-funding';

/** "Euro", "US dollar": the currency's English name, or the code alone. */
export function currencyName(code) {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(code);
    return name && name !== code ? name.replace(/ Dollar$/, ' dollar') : code;
  } catch {
    return code;
  }
}

/**
 * A row's funding total with its currency: "USD 18,000,000". Null when no
 * amount is recorded (the page says Not recorded, never USD 0). An amount in a
 * currency the money layer does not list is shown with its code, unconverted.
 */
export function fundingTotal(row) {
  const v = row?.funding_total;
  if (v == null || v === '' || !Number.isFinite(Number(v))) return null;
  const code = currencyCode(String(row.funding_currency || '').trim().toUpperCase());
  const minor = code ? majorToMinor(Number(v), code) : null;
  const shown = minor != null ? codeAmount(minor, code) : null;
  if (shown) return shown;
  const raw = Number(v).toLocaleString('en-US');
  return row.funding_currency ? `${row.funding_currency} ${raw}` : `${raw} · currency not recorded`;
}

/**
 * Sorted by funding (RS-17 A, RCD01E): the page's rows in currency groups, in
 * the order the Worker sent them (currency first, then amount), with the rows
 * that record no funding last. Each row keeps its number in the whole result.
 */
export function fundingGroups(items, offset = 0) {
  const groups = [];
  (items || []).forEach((row, i) => {
    const none = row?.funding_total == null;
    const key = none ? 'none' : String(row.funding_currency || '').trim().toUpperCase() || 'unknown';
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const label = key === 'none' ? 'No funding recorded · sorted after every recorded amount'
        : key === 'unknown' ? 'Currency not recorded · amounts compared only with each other'
          : `${currencyName(key)} · amounts compared only with each other`;
      g = { key, code: key === 'none' ? '—' : key === 'unknown' ? '?' : key, label, rows: [] };
      groups.push(g);
    }
    g.rows.push({ row, n: offset + i + 1 });
  });
  return groups;
}

export const FUNDING_SORT_NOTE = 'Amounts are ordered within each currency, currencies in code order; an amount is never ranked against another currency. Companies with no funding recorded come after every company with it.';

/** "26–50 of 186 companies match · page 2 of 8 · of 2,480 in the directory". */
export function countLine(data) {
  const w = pageWindow(data?.total, data?.limit, data?.offset);
  const of = data?.coverage?.of;
  return {
    range: `${w.from}–${w.to}`,
    total: w.total.toLocaleString('en-US'),
    page: `page ${w.page} of ${w.pages}`,
    directory: Number.isFinite(of) ? `of ${of.toLocaleString('en-US')} in the directory` : null,
  };
}

/** What "Back to results" names: page, filters, sort and selection. */
export function resultsSummary(f, selected = 0) {
  const parts = [`page ${Math.max(1, Number(f.page) || 1)}`];
  if (f.q?.trim()) parts.push(`“${f.q.trim()}”`);
  const founded = foundedLabel(f.founded_from, f.founded_to);
  if (founded) parts.push(founded);
  for (const c of activeFilters(f)) if (!c.key.startsWith('founded')) parts.push(c.label);
  parts.push(sortLabel(f.sort));
  if (selected) parts.push(`${selected} selected`);
  return parts.join(' · ');
}

/** The polite status on return: "Back to your results: page 2, 2 selected". */
export function restoredStatus(f, selected = 0) {
  return `Back to your results: page ${Math.max(1, Number(f.page) || 1)}${selected ? `, ${selected} selected` : ''}`;
}

/** The phone and tablet "Filters" badge: how many filters are on. */
export const filterCount = (f) => activeFilters(f).length;

// ---- this tab's session ------------------------------------------------------

const PREFIX = 'studioos.research.companies.';
export const selectionKey = (member) => `${PREFIX}selection.${member ?? 'signed-out'}`;
export const LAST_RESULTS_KEY = `${PREFIX}results`;
export const RETURN_KEY = `${PREFIX}return`;

/** The browser's sessionStorage, or null where it is blocked (a private window, a test). */
export function sessionStore() {
  try { return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null; } catch { return null; }
}

function readJSON(store, key) {
  try { const raw = store?.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeJSON(store, key, value) {
  try { if (value == null) store?.removeItem(key); else store?.setItem(key, JSON.stringify(value)); } catch { /* blocked storage keeps nothing */ }
}

/**
 * The member's selection in this tab: Map(uid → { name, page, sector, country }), the
 * shape D7177's Review selection reads (the page a company was ticked on). An entry kept
 * as a bare name reads with page, sector and country null.
 */
export function readSelection(store, member) {
  const list = readJSON(store, selectionKey(member));
  const pick = (uid, v) => {
    const o = v && typeof v === 'object' ? v : { name: v };
    return { name: String(o.name ?? uid), page: Number.isInteger(o.page) ? o.page : null, sector: o.sector ?? null, country: o.country ?? null };
  };
  return new Map(Array.isArray(list) ? list.filter((e) => Array.isArray(e) && typeof e[0] === 'string').map(([uid, v]) => [uid, pick(uid, v)]) : []);
}
export function writeSelection(store, member, selected) {
  writeJSON(store, selectionKey(member), selected?.size ? [...selected] : null);
}

/** The last results this tab showed: `{ href, summary }`. */
export const readLastResults = (store) => {
  const v = readJSON(store, LAST_RESULTS_KEY);
  return v && typeof v.href === 'string' && v.href.startsWith(DIRECTORY_PATH) ? v : null;
};
export const writeLastResults = (store, href, summary) => writeJSON(store, LAST_RESULTS_KEY, { href, summary });

/** Where the profile's Back and breadcrumb go: the last results, or the bare directory. */
export function backToResults(store) {
  const last = readLastResults(store);
  return last ? { href: last.href, label: 'Back to results', summary: last.summary || null } : { href: DIRECTORY_PATH, label: 'Companies', summary: null };
}

/** The return point: the results URL and the company link opened from it. */
export const writeReturnPoint = (store, href, uid) => writeJSON(store, RETURN_KEY, { href, uid });

/** The return point for `href`, removed as it is read; null when it is for other results. */
export function takeReturnPoint(store, href) {
  const v = readJSON(store, RETURN_KEY);
  if (!v || v.href !== href) return null;
  writeJSON(store, RETURN_KEY, null);
  return v;
}

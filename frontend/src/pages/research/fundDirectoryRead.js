/**
 * D535 (#1081), steps 4–5 — what the Funds pages derive from the directory
 * API, as plain functions so the tests can read them without a DOM.
 *
 * Nothing here computes a figure the API did not return. A size is printed
 * only when the row carries `size_currency: 'EUR'` (the EUR_SOURCE rule on the
 * Worker); every other row reads "Not recorded" with the API's own reason.
 * EIF and EIFO are true, false, or null — null is unknown, never "no".
 *
 * D7166 (#7166): a size reads in its list's own currency (`size_currency`
 * EUR or USD), and the size filter works in one currency at a time. A row is
 * one fund vehicle: `vehicleLabel` names it from the manager and `fund_number`.
 *
 * D7744 (#7744): the currency is the row's own (`size_currency` as the Worker
 * marks it), any three-letter code. EUR, USD and GBP print with their mark;
 * another code prints as the code ("CHF 75M"). The size currency control
 * offers the currencies the answer lists (`size_currencies`), and no sentence
 * falls back to "euros": a currency is named by its own word or code.
 */
import { currencyCode } from '../../lib/money.js';

export const PAGE_SIZES = [25, 50, 100];

export const SORT_OPTIONS = [
  ['name', 'Name, A to Z'],
  ['-name', 'Name, Z to A'],
  ['-size', 'Size, largest first'],
  ['size', 'Size, smallest first'],
  ['-vintage', 'Vintage, newest first'],
  ['vintage', 'Vintage, oldest first'],
];

/** D7166 part 2 (RFD-03A): the sort as the phone's thumb bar names it, "Sort · Size ↓". */
const SORT_SHORT = { name: 'Name A–Z', '-name': 'Name Z–A', '-size': 'Size ↓', size: 'Size ↑', '-vintage': 'Vintage ↓', vintage: 'Vintage ↑' };
export function sortShort(sort) {
  return SORT_SHORT[sort] || SORT_SHORT.name;
}

/** The sort's full name, "Size, largest first", for an accessible name or a sentence. */
export function sortLabel(sort) {
  return (SORT_OPTIONS.find(([v]) => v === sort) || SORT_OPTIONS[0])[1];
}

/** The Worker's SIZE_BANDS, for the labels while the facets have not answered. */
export const SIZE_BANDS = [
  ['lt25', 'Under €25M'],
  ['25-50', '€25–50M'],
  ['50-100', '€50–100M'],
  ['100-250', '€100–250M'],
  ['250-500', '€250–500M'],
  ['500+', '€500M and over'],
];

export const STAGE_REASON = 'The fund directory records no stage for any fund yet.';

/** D7166: no list records where a fund invests, so it reads Not recorded and is not a filter. */
export const GEOGRAPHY_REASON = 'No list records where a fund invests. Manager HQ is where the manager is based, not where it invests.';

/** D7166: the currencies the size filter works in, one at a time, before the API has answered (D7744: it lists its own). */
export const SIZE_CURRENCIES = [['EUR', 'Euros (EUR)'], ['USD', 'US dollars (USD)']];
const MARK = { EUR: '€', USD: 'US$', GBP: '£' };
const CURRENCY_WORD = { EUR: 'euros', USD: 'US dollars', GBP: 'pounds sterling' };

/** D7744: a currency's word in a sentence ("euros"); a code with no word is named by itself, never as euros. */
export function currencyWord(code) {
  return CURRENCY_WORD[code] || String(code || '');
}

/** D7744: the mark printed before a figure: "€", "US$", "£", or the code and a space ("CHF "). */
export function currencyMark(code) {
  return MARK[code] || (code ? `${code} ` : '');
}

/**
 * D7744: the size currency control's options — the currencies the answer lists
 * (`size_currencies`), as [code, label]. The asked currency is kept when the
 * answer does not list it, so the control still shows what is asked; before an
 * answer, the asked currency alone.
 */
export function sizeCurrencyOptions(data, asked = 'EUR') {
  const listed = Array.isArray(data?.size_currencies) ? data.size_currencies.filter((c) => /^[A-Z]{3}$/.test(c)) : [];
  const codes = listed.includes(asked) ? listed : [...listed, asked];
  return codes.map((c) => [c, CURRENCY_WORD[c] ? `${CURRENCY_WORD[c][0].toUpperCase()}${CURRENCY_WORD[c].slice(1)} (${c})` : c]);
}

export const EMPTY_QUERY = Object.freeze({
  q: '', hq_country: '', focus: '', size_band: '', size_min: '', size_max: '', size_currency: 'EUR',
  vintage: '', eif: false, eifo: false, sort: 'name', limit: 25, offset: 0,
});

/** D7166: a size field, in millions as typed, as the whole units the Worker reads; '' or a bad value is none. */
export function millionsToUnits(v) {
  const text = String(v ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  return Math.round(Number(text) * 1_000_000);
}

/** The query string the Worker reads; empty filters are dropped by the client module. */
export function toParams(query) {
  return {
    q: query.q.trim() || undefined,
    hq_country: query.hq_country || undefined,
    focus: query.focus || undefined,
    size_band: query.size_band || undefined,
    size_min: query.size_band ? undefined : millionsToUnits(query.size_min),
    size_max: query.size_band ? undefined : millionsToUnits(query.size_max),
    size_currency: query.size_currency && query.size_currency !== 'EUR' ? query.size_currency : undefined,
    vintage: query.vintage || undefined,
    eif: query.eif ? 1 : undefined,
    eifo: query.eifo ? 1 : undefined,
    sort: query.sort,
    limit: query.limit,
    offset: query.offset,
  };
}

const num = (n) => Number(n).toLocaleString('en-US');

/** "1–25 of 2,616", from the page the API answered. */
export function rangeLabel(offset, count, total) {
  if (!total || !count) return `0 of ${num(total || 0)}`;
  return `${num(offset + 1)}–${num(offset + count)} of ${num(total)}`;
}

export function pageInfo(offset, limit, total) {
  const pages = Math.max(1, Math.ceil((total || 0) / limit));
  return { page: Math.floor(offset / limit) + 1, pages };
}

/** Page numbers to offer: the first, the last, and the current one with its neighbours. */
export function pageList(page, pages) {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

/** Cents → "€1,375M" / "US$2.5M" / "CHF 40M", in the currency the API marked. */
export function moneyM(cents, currency = 'EUR') {
  const m = Number(cents) / 100 / 1_000_000;
  return `${currencyMark(currency)}${m.toLocaleString('en-US', { maximumFractionDigits: m < 10 ? 1 : 0 })}M`;
}

/** Euro cents → "€1,375M" / "€2.5M". Only ever called on a row the API marked EUR. */
export function eurM(cents) {
  return moneyM(cents, 'EUR');
}

/**
 * The size to print with its currency code, or null with the reason it is not
 * recorded. Only a currency the API marked is ever printed (D7744: any listed
 * ISO code, the same set the profile's `amount` prints, so the two agree).
 */
export function sizeOf(item) {
  const currency = item?.size_currency;
  if (item && currencyCode(currency) && item.fund_size_cents != null) {
    return { text: moneyM(item.fund_size_cents, currency), currency, reason: null };
  }
  return { text: null, currency: null, reason: item?.size_reason || 'Not recorded' };
}

/**
 * D7166: a row is one fund vehicle. Its label is the manager and the fund
 * number ("Dawn Capital V", "Dawn Capital Opp"); a name that already carries
 * the number ("Afore IV") is not given it twice, and a row with no number is
 * its manager's name. `manager` is the line under it.
 */
export function vehicleLabel(item) {
  const name = String(item?.name || '').trim();
  const number = String(item?.fund_number || '').trim();
  if (!number) return { vehicle: name, manager: name };
  return { vehicle: carriesWord(name, number) ? name : `${name} ${number}`, manager: name };
}

const isWordChar = (ch) => /[A-Za-z0-9]/.test(ch || '');

/** Whether `name` holds `word` with no letter or digit either side (case-insensitive). */
function carriesWord(name, word) {
  const hay = name.toLowerCase();
  const needle = word.toLowerCase();
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    if (!isWordChar(hay[at - 1]) && !isWordChar(hay[at + needle.length])) return true;
  }
  return false;
}

/**
 * EIF / EIFO as the notable LPs name them: the backers named, "neither" when
 * the LPs are recorded and name neither, or "unknown" when no LPs are
 * recorded — a 0 flag with no LP text is not a "no".
 */
export function backingOf(item) {
  const named = [item?.eif === true && 'EIF', item?.eifo === true && 'EIFO'].filter(Boolean);
  if (named.length) return { kind: 'named', named };
  if (item?.eif === false && item?.eifo === false) return { kind: 'neither', named };
  return { kind: 'unknown', named };
}

const has = (v) => typeof v === 'string' ? v.trim() !== '' : v != null;
export const recorded = has;

/** The filters in force, each with its label and the patch that removes it. */
export function activeFilters(query, facets) {
  const label = (list, value) => (list || []).find((x) => x.value === value)?.label || value;
  const out = [];
  if (query.hq_country) out.push({ key: 'hq_country', label: `HQ: ${label(facets?.hq_country, query.hq_country)}` });
  if (query.focus) out.push({ key: 'focus', label: `Focus: ${label(facets?.focus, query.focus)}` });
  const ccy = query.size_currency || 'EUR';
  const mark = currencyMark(ccy);
  if (query.size_band === UNSIZED) {
    out.push({ key: 'size_band', label: `Size: not recorded in ${ccy}` });
  } else if (query.size_band) {
    const band = (facets?.size_band || []).find((x) => x.value === query.size_band)?.label
      || ((SIZE_BANDS.find(([v]) => v === query.size_band) || [])[1] || query.size_band).replace(/€/g, mark);
    out.push({ key: 'size_band', label: `Size: ${band} (${ccy})` });
  }
  const lo = millionsToUnits(query.size_min);
  const hi = millionsToUnits(query.size_max);
  if (!query.size_band && (lo != null || hi != null)) {
    const range = lo != null && hi != null ? `${mark}${query.size_min}M to ${mark}${query.size_max}M`
      : lo != null ? `from ${mark}${query.size_min}M` : `up to ${mark}${query.size_max}M`;
    out.push({ key: 'size', label: `Size: ${range} (${ccy})` });
  }
  if (query.vintage) out.push({ key: 'vintage', label: `Vintage: ${query.vintage === 'none' ? 'not recorded' : query.vintage}` });
  if (query.eif) out.push({ key: 'eif', label: 'EIF' });
  if (query.eifo) out.push({ key: 'eifo', label: 'EIFO' });
  return out;
}

/** The coverage bars, in the canvas's order, from the API's `coverage.fields`. */
export function coverageRows(coverage) {
  const f = coverage?.fields || {};
  return [
    // D7744: every currency the rows record (`size_by_currency`), else the two counts an older answer carries.
    ['Size in a known currency', f.size_by_currency
      ? Object.values(f.size_by_currency).reduce((t, n) => t + Number(n || 0), 0)
      : Number(f.size_eur || 0) + Number(f.size_usd || 0)],
    ['Manager HQ', f.hq],
    ['Website', f.website],
    ['Stated focus', f.sector_focus],
    ['Vintage', f.fund_year],
    ['Notable LPs', f.notable_lps],
  ].map(([label, n]) => ({ label, n: Number(n || 0) }));
}

/** "2,616 funds from 2 public fund lists", from the API's own figures. */
export function directoryLine(coverage, sources) {
  const lists = (sources || []).length;
  return `${num(coverage?.total || 0)} funds from ${lists} public fund ${lists === 1 ? 'list' : 'lists'}`;
}

/**
 * D593 — the N in the Funds page's "Directory (N)" tab: the API's
 * `coverage.total`, which counts the whole directory, never the filtered
 * `total` of the page on screen. Null until a read has answered and after a
 * failed one, so the tab reads "Directory" rather than a count it was not
 * given. It follows the directory's own header line: a refetch keeps the
 * answer already on screen until the new one arrives.
 */
export function directoryTotalOf(result) {
  const n = result?.error ? null : result?.data?.coverage?.total;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** "Directory (2,616)" once the directory has answered; "Directory" while it has not, or could not. */
export function directoryTabLabel(total) {
  return typeof total === 'number' && Number.isFinite(total) ? `Directory (${num(total)})` : 'Directory';
}

export { num as formatCount };

/**
 * D7166 (RFD-02): the count line, "11 fund vehicles match" beside "of 1,966
 * in the directory, unfiltered", from the API's `total` and `coverage.total`.
 */
export function matchLine(data) {
  const n = Number(data?.total || 0);
  return {
    match: `${num(n)} fund ${n === 1 ? 'vehicle matches' : 'vehicles match'}`,
    of: `of ${num(data?.coverage?.total || 0)} in the directory, unfiltered`,
  };
}

/**
 * D7166 part 2 (RFD-02's "Show them"): the Worker's `size_band=none`, every match with no size in the asked
 * currency — the funds the size filter's line says it leaves out.
 */
export const UNSIZED = 'none';

/** The patch "Show them" applies: the size filter's other side, in the same currency, keeping every other filter. */
export function showUnsized() {
  return { size_band: UNSIZED, size_min: '', size_max: '' };
}

/** The link's accessible name, which starts with its visible text (WCAG 2.5.3). */
export function showUnsizedLabel(query, facets) {
  const n = Number(facets?.size_not_comparable || 0);
  const word = currencyWord(query.size_currency || 'EUR');
  return `Show them: the ${num(n)} ${n === 1 ? 'fund' : 'funds'} with no size in ${word}`;
}

/** True when a size filter (a band, or a from/to figure) is in force. */
export const sizeFiltered = (query) => !!query.size_band || millionsToUnits(query.size_min) != null || millionsToUnits(query.size_max) != null;

/**
 * D7166: what the size filter leaves out — every match with no size in the
 * asked currency (`facets.size_not_comparable`). Null when no size filter is on.
 */
export function sizeExclusion(query, facets) {
  if (!sizeFiltered(query) || query.size_band === UNSIZED || !facets) return null;
  const n = Number(facets.size_not_comparable || 0);
  if (!n) return null;
  const word = currencyWord(query.size_currency || 'EUR');
  return `${num(n)} ${n === 1 ? 'fund has' : 'funds have'} no size in ${word}, so the size filter leaves ${n === 1 ? 'it' : 'them'} out.`;
}

/** D7744: the sentence under the filters — what the size filter compares in, from the asked currency. */
export function sizeCompareLine(query, facets) {
  const ccy = query?.size_currency || 'EUR';
  const n = Number(facets?.size_not_comparable || 0);
  return `Sizes compare in ${ccy} only: ${num(n)} matching ${n === 1 ? 'fund has' : 'funds have'} no size in ${currencyWord(ccy)} and sit outside the size filter.`;
}

/** D7744: the coverage card's sentence on sizes with no recorded currency; null when there are none. */
export function unknownCurrencyLine(coverage) {
  const n = Number(coverage?.fields?.size_unknown_currency || 0);
  if (!n) return null;
  return `${num(n)} more ${n === 1 ? 'fund holds a size' : 'funds hold sizes'} whose currency is not recorded. Those sizes are not shown, banded or sorted until the currency is known.`;
}

/** D7744: a list's size text in the sources line, from the currencies its sized rows record. */
export function listSizeText(source) {
  const list = Array.isArray(source?.size_currencies) ? source.size_currencies
    : (source?.size_currency ? [source.size_currency] : []);
  return list.length ? `sizes in ${list.join(', ')}` : 'size currency not recorded, so no size is shown';
}

/**
 * D7166 (RFD-05): the zero-result hint, from the facet counts. Each facet's
 * counts apply every other filter but not its own, so the sum of a facet
 * whose values never overlap (size, vintage, EIF, EIFO) is how many funds
 * dropping that one filter would show. HQ and focus can count a fund twice,
 * so they give no hint. Null when no filter would show any.
 */
export function zeroHint(query, facets) {
  if (!facets) return null;
  const sum = (list) => (list || []).reduce((t, x) => t + Number(x.count || 0), 0);
  const backed = (f) => (f ? Number(f.backed || 0) + Number(f.not_backed || 0) + Number(f.unknown || 0) : 0);
  const options = [];
  if (sizeFiltered(query)) options.push(['size', sum(facets.size_band) + Number(facets.size_not_comparable || 0)]);
  if (query.vintage) options.push(['vintage', sum(facets.vintage)]);
  if (query.eif) options.push(['eif', backed(facets.eif)]);
  if (query.eifo) options.push(['eifo', backed(facets.eifo)]);
  const best = options.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const names = { size: 'the size filter', vintage: 'the vintage filter', eif: 'EIF', eifo: 'EIFO' };
  return { key: best[0], count: best[1], text: `Removing ${names[best[0]]} would show ${num(best[1])} fund ${best[1] === 1 ? 'vehicle' : 'vehicles'}.` };
}

/**
 * D7166 part 2 (RFD-04B): the line under "Signed in. This is the search you opened.", from the answer on screen:
 * "Directory · 3 filters · Size, largest first · page 1 of 1". Null until the read answers.
 */
export function restoredLine(query, facets, data) {
  if (!data) return null;
  const n = activeFilters(query, facets).length;
  const q = String(query.q || '').trim();
  const { page, pages } = pageInfo(data.offset || 0, data.limit || query.limit, data.total);
  return [
    'Directory',
    q ? `search “${q}”` : null,
    n ? `${num(n)} ${n === 1 ? 'filter' : 'filters'}` : 'no filters',
    sortLabel(query.sort),
    `page ${num(page)} of ${num(pages)}`,
  ].filter(Boolean).join(' · ');
}

/** The patch that removes one active filter. */
export function removeFilter(key) {
  if (key === 'eif' || key === 'eifo') return { [key]: false };
  if (key === 'size' || key === 'size_band') return { size_band: '', size_min: '', size_max: '' };
  return { [key]: '' };
}

/** The three terms verdicts migration 406 allows (D597), as the page prints them. */
export const VERDICT_LABELS = Object.freeze({
  'republish allowed': 'Republishing allowed',
  'cite only': 'Cite only',
  'not allowed': 'Not allowed',
});

const httpHref = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/**
 * D597 (#1232) — how a fund cites its list, from the API's `source`: the
 * list's title (else its name), its publisher, the link to where it is
 * published (else to where the row was read from), and its terms verdict.
 * A publisher or verdict the API does not give reads "Not recorded"; the
 * API's `reason` says why (terms not found, or never reviewed).
 */
export function citationOf(item) {
  const s = item?.source || null;
  const verdict = s?.verdict && VERDICT_LABELS[s.verdict] ? s.verdict : null;
  return {
    name: (has(s?.title) && s.title) || (has(s?.name) && s.name) || (has(item?.source_name) && item.source_name) || null,
    publisher: has(s?.publisher) ? s.publisher : null,
    href: httpHref(s?.url) || httpHref(item?.source_url),
    verdict,
    terms: verdict ? VERDICT_LABELS[verdict] : 'Not recorded',
    reason: has(s?.reason) ? s.reason : null,
  };
}

/**
 * D4612 — the directory's search, filters, sort and page live in the address,
 * so a direct link, a reload, opening a profile and Back all land on the same
 * list. Only values that differ from `EMPTY_QUERY` are written; other
 * parameters (`view`) are kept as they are.
 */
const TEXT_KEYS = ['q', 'hq_country', 'focus', 'size_band', 'size_min', 'size_max', 'size_currency', 'vintage', 'sort'];
export function queryFromSearch(params) {
  const get = (k) => (typeof params?.get === 'function' ? params.get(k) : null);
  const out = { ...EMPTY_QUERY };
  for (const k of TEXT_KEYS) {
    const v = get(k);
    if (v != null && v !== '') out[k] = String(v).slice(0, 200);
  }
  out.eif = get('eif') === '1';
  out.eifo = get('eifo') === '1';
  const limit = Number(get('limit'));
  if (Number.isInteger(limit) && limit > 0 && limit <= 100) out.limit = limit;
  const offset = Number(get('offset'));
  if (Number.isInteger(offset) && offset > 0) out.offset = offset;
  return out;
}

export function searchFromQuery(query, base) {
  const next = new URLSearchParams(base ? String(base) : '');
  for (const k of [...TEXT_KEYS, 'eif', 'eifo', 'limit', 'offset']) next.delete(k);
  for (const k of TEXT_KEYS) {
    const v = String(query[k] ?? '').trim();
    if (v && v !== EMPTY_QUERY[k]) next.set(k, v);
  }
  if (query.eif) next.set('eif', '1');
  if (query.eifo) next.set('eifo', '1');
  if (query.limit !== EMPTY_QUERY.limit) next.set('limit', String(query.limit));
  if (query.offset) next.set('offset', String(query.offset));
  return next;
}

/** The directory, filtered as a company profile's short list was. */
export function directoryHref(filter = {}) {
  const params = searchFromQuery({ ...EMPTY_QUERY, ...filter }, 'view=directory');
  return `/research/funds?${params.toString()}`;
}

/**
 * D535 (#1081), steps 4–5 — what the Funds pages derive from the directory
 * API, as plain functions so the tests can read them without a DOM.
 *
 * Nothing here computes a figure the API did not return. A size is printed
 * only when the row carries `size_currency: 'EUR'` (the EUR_SOURCE rule on the
 * Worker); every other row reads "Not recorded" with the API's own reason.
 * EIF and EIFO are true, false, or null — null is unknown, never "no".
 */

export const PAGE_SIZES = [25, 50, 100];

export const SORT_OPTIONS = [
  ['name', 'Name, A to Z'],
  ['-name', 'Name, Z to A'],
  ['-size', 'Size, largest first'],
  ['size', 'Size, smallest first'],
  ['-vintage', 'Vintage, newest first'],
  ['vintage', 'Vintage, oldest first'],
];

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

export const EMPTY_QUERY = Object.freeze({
  q: '', hq_country: '', focus: '', size_band: '', vintage: '', eif: false, eifo: false,
  sort: 'name', limit: 25, offset: 0,
});

/** The query string the Worker reads; empty filters are dropped by the client module. */
export function toParams(query) {
  return {
    q: query.q.trim() || undefined,
    hq_country: query.hq_country || undefined,
    focus: query.focus || undefined,
    size_band: query.size_band || undefined,
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

/** Euro cents → "€1,375M" / "€2.5M". Only ever called on a row the API marked EUR. */
export function eurM(cents) {
  const m = Number(cents) / 100 / 1_000_000;
  return `€${m.toLocaleString('en-US', { maximumFractionDigits: m < 10 ? 1 : 0 })}M`;
}

/** The size to print, or null with the reason it is not recorded. */
export function sizeOf(item) {
  if (item && item.size_currency === 'EUR' && item.fund_size_cents != null) {
    return { text: eurM(item.fund_size_cents), reason: null };
  }
  return { text: null, reason: item?.size_reason || 'Not recorded' };
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
  if (query.size_band) out.push({ key: 'size_band', label: `Size: ${(SIZE_BANDS.find(([v]) => v === query.size_band) || [])[1] || query.size_band}` });
  if (query.vintage) out.push({ key: 'vintage', label: `Vintage: ${query.vintage === 'none' ? 'not recorded' : query.vintage}` });
  if (query.eif) out.push({ key: 'eif', label: 'EIF' });
  if (query.eifo) out.push({ key: 'eifo', label: 'EIFO' });
  return out;
}

/** The coverage bars, in the canvas's order, from the API's `coverage.fields`. */
export function coverageRows(coverage) {
  const f = coverage?.fields || {};
  return [
    ['Size in euros', f.size_eur],
    ['HQ', f.hq],
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

export { num as formatCount };

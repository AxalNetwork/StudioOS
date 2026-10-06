// D534 (#1079) — what the Companies and Company pages print, kept out of the
// JSX so it can be tested without a browser. Every number comes from the
// API's response; nothing here counts rows of its own, and a value no source
// holds reads NOT_RECORDED, never a zero.

import { NOT_RECORDED } from './absence.js';

export { NOT_RECORDED };
export const UNREADABLE = 'Unreadable';

/** The canvas's sort menu, in its order. Values are the API's `sort`. */
export const DIRECTORY_SORTS = [
  { value: 'name', label: 'Name, A to Z' },
  { value: '-founded', label: 'Founded, newest first' },
  { value: 'founded', label: 'Founded, oldest first' },
  { value: '-funding', label: 'Funding total, highest first' },
];

export const PAGE_SIZES = [25, 50, 100];

/** A directory company's profile page. */
export const companyHref = (uid) => `/research/companies/company/${encodeURIComponent(uid)}`;

/** The "Only companies with" checkboxes: the API's `has` values. */
export const HAS_OPTIONS = [
  { value: 'funding', label: 'Funding total recorded' },
  { value: 'revenue', label: 'Revenue recorded' },
  { value: 'headcount', label: 'Headcount recorded' },
];

/** The coverage strip, in the canvas's order. Keys are the API's `coverage.fields`. */
export const COVERAGE_LABELS = [
  { key: 'website', label: 'Website' },
  { key: 'country', label: 'Country' },
  { key: 'founded_year', label: 'Founded year' },
  { key: 'sector', label: 'Sector label' },
  { key: 'funding', label: 'Funding total' },
  { key: 'last_round', label: 'Last round' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'headcount', label: 'Headcount' },
];

export const EMPTY_FILTERS = Object.freeze({
  q: '', sector_label: '', country: '', founded_from: '', founded_to: '', has: [],
  sort: 'name', limit: 25, page: 1,
});

/** UI state → the list call's parameters. Empty values are left out. */
export function directoryParams(f) {
  const limit = PAGE_SIZES.includes(Number(f.limit)) ? Number(f.limit) : 25;
  const page = Math.max(1, Number(f.page) || 1);
  return {
    q: f.q?.trim() || undefined,
    sector_label: f.sector_label || undefined,
    country: f.country || undefined,
    founded_from: f.founded_from || undefined,
    founded_to: f.founded_to || undefined,
    has: f.has?.length ? f.has.join(',') : undefined,
    sort: f.sort && f.sort !== 'name' ? f.sort : undefined,
    limit,
    offset: (page - 1) * limit,
  };
}

/** "1–25 of 300", and which page of how many. Reads the API's `total`. */
export function pageWindow(total, limit, offset) {
  const n = Math.max(0, Number(total) || 0);
  const size = Math.max(1, Number(limit) || 25);
  const start = Math.max(0, Number(offset) || 0);
  const pages = Math.max(1, Math.ceil(n / size));
  return {
    from: n ? start + 1 : 0,
    to: Math.min(n, start + size),
    total: n,
    page: Math.min(pages, Math.floor(start / size) + 1),
    pages,
  };
}

/** Page buttons: the first, the last, and the current one with its neighbours; gaps are '…'. */
export function pageList(page, pages) {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out = [];
  let prev = 0;
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

/** An amount with its currency, compact: "USD 7M", "EUR 1.2B". Null when not recorded. */
export function money(amount, currency) {
  if (amount == null || amount === '' || !Number.isFinite(Number(amount))) return null;
  const n = Number(amount);
  const abs = Math.abs(n);
  const [div, unit] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
  const v = n / div;
  const shown = unit ? (Number.isInteger(Math.round(v * 10) / 10) ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1)) : String(n);
  return `${currency ? `${currency} ` : ''}${shown}${unit}`;
}

/** A row's last round: the amount, then type and date; null when not recorded. */
export function lastRound(row) {
  const amount = money(row?.last_funding_amount, row?.last_funding_currency);
  if (!amount) return null;
  const detail = [row.last_funding_type, row.last_funding_date].filter(Boolean).join(' · ');
  return { amount, detail: detail || null };
}

/** A signed percentage, "+12.5%" / "−3%"; null when not recorded. */
export function signedPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Math.round(Number(v) * 10) / 10;
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`;
}

/** A row's headcount and growth; null when not recorded. */
export function employees(row) {
  if (row?.employee_count == null) return null;
  const growth = signedPct(row.employee_growth_pct);
  return { count: Number(row.employee_count).toLocaleString('en-US'), growth: growth ? `${growth} growth` : null };
}

/**
 * The filters in force, each with how to remove it — for the "No results"
 * state, which names them. Labels read the API's facets, not the page's guess.
 */
export function activeFilters(f) {
  const out = [];
  if (f.sector_label) out.push({ key: 'sector_label', label: f.sector_label === 'none' ? 'Sector label: none' : `Sector label: ${f.sector_label}` });
  if (f.country) out.push({ key: 'country', label: `Country: ${f.country}` });
  if (f.founded_from) out.push({ key: 'founded_from', label: `Founded in or after ${f.founded_from}` });
  if (f.founded_to) out.push({ key: 'founded_to', label: `Founded in or before ${f.founded_to}` });
  for (const h of f.has || []) {
    const opt = HAS_OPTIONS.find((o) => o.value === h);
    if (opt) out.push({ key: `has:${h}`, label: opt.label });
  }
  return out;
}

/** The filters with one removed, by `activeFilters` key; back to page 1. */
export function withoutFilter(f, key) {
  const next = { ...f, page: 1 };
  if (key.startsWith('has:')) next.has = (f.has || []).filter((h) => h !== key.slice(4));
  else next[key] = '';
  return next;
}

/**
 * The list's state from one read: 'loading' until it answers, 'unreadable'
 * when it fails (never zero companies), 'empty' when nothing matches, else 'ready'.
 */
export function listState({ loading, error, data }) {
  if (loading) return 'loading';
  if (error || !data) return 'unreadable';
  return (data.items || []).length ? 'ready' : 'empty';
}

/** A company metric as the Key metrics card prints it. */
export function metricCard(m) {
  if (!m) return { state: 'unreadable', value: UNREADABLE };
  if (m.status !== 'recorded') return { state: 'not_recorded', value: NOT_RECORDED };
  return { state: 'recorded', value: m.value };
}

/** The market index's six dimensions, as the Market context card names them. */
export const INDEX_DIMENSIONS = [
  { key: 'demand', label: 'Demand' },
  { key: 'supply', label: 'Supply' },
  { key: 'capital', label: 'Capital' },
  { key: 'talent', label: 'Talent' },
  { key: 'research', label: 'Research' },
  { key: 'sentiment', label: 'Sentiment' },
];

/**
 * One row per dimension from `GET /research/markets/:slug`'s `index.series`:
 * the latest point and its change, or Not recorded with the API's reason.
 */
export function indexRows(index) {
  return INDEX_DIMENSIONS.map(({ key, label: name }) => {
    const d = index?.series?.[key];
    const pts = d?.status === 'recorded' ? d.points || [] : [];
    if (!pts.length) return { key, label: name, state: 'not_recorded', reason: d?.reason || index?.reason || NOT_RECORDED, points: [] };
    const last = pts[pts.length - 1];
    return {
      key, label: name, state: 'recorded', value: last.value, change: signedPct(last.change),
      period: last.period, month_to_date: !!last.month_to_date, points: pts.map((p) => p.value),
    };
  });
}

/**
 * Signals that name the tracked sector or the country, each once, with what
 * it matched on. Sector matches come first, as the canvas lists them.
 */
export function relatedSignals(sectorSignals = [], countrySignals = []) {
  const byId = new Map();
  for (const s of sectorSignals) byId.set(s.id, { ...s, match: 'Sector' });
  for (const s of countrySignals) {
    const hit = byId.get(s.id);
    if (hit) hit.match = 'Sector and country';
    else byId.set(s.id, { ...s, match: 'Country' });
  }
  return [...byId.values()];
}

/** The Companies list, filtered to one sector label. */
export const sectorLabelHref = (sectorLabel) => `/research/companies?sector_label=${encodeURIComponent(sectorLabel)}`;

/** The competitor-analysis form, prefilled with this company. */
export const analysisHref = (company) => {
  const p = new URLSearchParams({ tab: 'analyses', market: company?.name || '' });
  if (company?.website) p.set('website', company.website);
  return `/research/companies?${p.toString()}`;
};

/**
 * Where `/build/competitors` sends a founder, advisor or admin: the Saved
 * analyses tab, keeping `market` and `website` so the form is prefilled. It
 * used to send them to the bare directory, and the prefill was lost.
 */
export function buildCompetitorsRedirect(search) {
  const from = new URLSearchParams(search || '');
  const to = new URLSearchParams({ tab: 'analyses' });
  for (const k of ['market', 'website']) {
    const v = from.get(k);
    if (v) to.set(k, v);
  }
  return `/research/companies?${to.toString()}`;
}

/**
 * Only the newest read may land. A list or profile read that answers after a
 * newer one started (a filter changed, a peer link followed) is dropped, so
 * the controls and the rows never describe two different queries.
 */
export function latestOnly() {
  let current = 0;
  return {
    next: () => { current += 1; return current; },
    isCurrent: (id) => id === current,
  };
}

import { request } from '../api.js';

const qs = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** D533 — Research · Markets and · Geographies (routes/research_markets.ts). */
export const researchMarketsApi = {
  /**
   * `{ q, sort, dir, limit, offset }` → `{ items, total, limit, offset, sort, dir, … }`.
   * Each item, besides slug, name, mi_sector, company_count, supplied_count and
   * as_of, carries three fields derived on the Worker for the page (D6284, #6284):
   *   - `countries`: `{ status: 'recorded', value: [{ code, count }] }`, where the
   *     directory's companies in this market are based (D533 crosswalk);
   *   - `source_count`: `{ status: 'recorded', value: n }`, D7710: the sources
   *     of evidence behind active signals that NAME the market; not recorded
   *     ("None named") when none does, whatever the sector-level sources;
   *   - `newest_source_at`: `{ status: 'recorded', value: date }`, the newest of
   *     that evidence's dates, with `newest_source_basis` saying what the date
   *     measures (`reported`: the date the source reports).
   * Each is `{ status: 'not_recorded', value: null, reason }` when no source
   * holds it — print "Not recorded", never 0. `distinct_source_count` counts
   * the named and sector-level sources together, a source key in both once.
   * `sources` lists at most 20 of both kinds (`{ kind, key, rows, newest,
   * basis }`, newest first): a sector-level source is read over the index
   * window (the 30 days before `read_at`, `sector_window`), each observation
   * once, and dated by the end of the period it measures (`period_measured`)
   * or else when it was retrieved (`retrieved`). No market size or growth.
   *
   * D7171 (#7171): `q` matches the market name or its tracked sector (each
   * item says which in `matched_on`); `country` (codes, comma-joined),
   * `fresh` (30 | 90 | older | none), `src` (named | sector | none) and
   * `sector` (tracked sectors) filter the whole directory before paging, and
   * `sort` also takes `newest_source`. The answer adds `directory_total`,
   * `facets` (counts per option over what the other filters leave),
   * `summary` (the coverage of the filtered markets), `read_at`, and per item
   * `sources_by_kind` (`{ count, newest, basis }` per kind). `fresh` and the
   * summary's bands read `newest_source_at` (D7710). An unreadable filter is a
   * 400 with a code.
   *
   * `get(slug)` answers the market with its `index`: per dimension, monthly
   * points each carrying the window it covers (`window_start`, `window_end`,
   * or `window_reason` when none was stored; D7708). No all-time source mix.
   */
  list: (params) => request(`/research/markets${qs(params)}`),
  get: (slug) => request(`/research/markets/${encodeURIComponent(slug)}`),
  geographies: (params) => request(`/research/geographies${qs(params)}`),
  geography: (code) => request(`/research/geographies/${encodeURIComponent(code)}`),
  listedCompanies: (params) => request(`/research/listed-companies${qs(params)}`),
  marketDataSources: () => request('/research/market-data/sources'),
  countryMarketData: (iso3) => request(`/research/market-data/countries/${encodeURIComponent(iso3)}`),
  marketDataCsvUrl: (params = {}) => `/api/research/market-data/export.csv${qs(params)}`,
};

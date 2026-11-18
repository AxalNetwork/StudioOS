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
   *   - `source_count`: `{ status: 'recorded', value: n }`, the distinct live
   *     sources (the tracked sector's live market-intelligence sources and the
   *     evidence sources behind active signals naming the market);
   *   - `newest_source_at`: `{ status: 'recorded', value: date }`, the newest of
   *     those sources' row dates.
   * Each is `{ status: 'not_recorded', value: null, reason }` when no source
   * holds it — print "Not recorded", never 0. `sources` lists at most 20 of them
   * (`{ kind, key, rows, newest }`, newest first). No market size or growth.
   *
   * D7171 (#7171): `q` matches the market name or its tracked sector (each
   * item says which in `matched_on`); `country` (codes, comma-joined),
   * `fresh` (30 | 90 | older | none), `src` (named | sector | none) and
   * `sector` (tracked sectors) filter the whole directory before paging, and
   * `sort` also takes `newest_source`. The answer adds `directory_total`,
   * `facets` (counts per option over what the other filters leave),
   * `summary` (the coverage of the filtered markets), `read_at`, and per item
   * `sources_by_kind`. An unreadable filter is a 400 with a code.
   */
  list: (params) => request(`/research/markets${qs(params)}`),
  get: (slug) => request(`/research/markets/${encodeURIComponent(slug)}`),
  geographies: (params) => request(`/research/geographies${qs(params)}`),
  geography: (code) => request(`/research/geographies/${encodeURIComponent(code)}`),
  listedCompanies: (params) => request(`/research/listed-companies${qs(params)}`),
};

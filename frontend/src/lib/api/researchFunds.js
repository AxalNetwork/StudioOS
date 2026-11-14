// D535 (#1081) — the fund directory, searched, filtered, sorted and paged on
// the Worker. `list` takes q, hq_country, focus, size_min, size_max,
// size_band, vintage, vintage_from, vintage_to, eif, eifo, sort, limit and
// offset (`none` is a value for hq_country, focus and vintage: the field is
// empty), and answers { items, total, limit, offset, sort, size_basis,
// coverage, sources, facets, facets_unmapped, facets_basis }. A bad filter is
// a 400 with `detail`; a failed read is a 503 "Unreadable", never an empty
// list. `get` answers { item, reports, reports_status } and a 404 for no fund.
// D597 (#1232): every item carries `source` (its list's name, publisher, link
// and terms verdict), the list answer adds `removed_sources`, and `get` answers
// 410 { detail, reason, removed } for a fund whose list was taken down.
// Read by pages/research/FundDirectory.jsx and FundCatalogProfile.jsx.
import { request } from '../api.js';

export const researchFundsApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return request(`/research/fund-directory${qs ? `?${qs}` : ''}`);
  },
  get: (uid) => request(`/research/fund-directory/${encodeURIComponent(uid)}`),
};

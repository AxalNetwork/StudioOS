// D534 (#1079) — the company directory, searched, filtered, sorted and paged
// on the Worker (services/researchCompanyDirectory.ts).
//
// `list` takes q, country, country_code, sector_label (`none` for no label),
// founded_from, founded_to, has, sort, limit and offset, and answers
// { items, total, limit, offset, sort, coverage, facets }. `get` answers one
// company with its metrics, evidence, tracked sector and peers. A bad filter
// is a 400 with `detail` and `field`; a failed read is a 503 "Unreadable",
// never an empty list.
import { request } from '../api.js';

const qs = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const researchCompaniesApi = {
  list: (params) => request(`/research/company-directory${qs(params)}`),
  get: (uid) => request(`/research/company-directory/${encodeURIComponent(uid)}`),
};

// D535 (#1081) — the fund directory, searched, filtered, sorted and paged on
// the Worker. `list` takes q, hq_country, focus, size_min, size_max,
// vintage_from, vintage_to, eif, eifo, sort, limit and offset, and answers
// { items, total, limit, offset, sort, size_basis }. A bad filter is a 400
// with `detail`; a failed read is a 503 "Unreadable", never an empty list.
import { request } from '../api.js';

export const researchFundsApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return request(`/research/fund-directory${qs ? `?${qs}` : ''}`);
  },
  get: (uid) => request(`/research/fund-directory/${encodeURIComponent(uid)}`),
};

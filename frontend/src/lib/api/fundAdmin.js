import { request } from '../api.js';

/**
 * D714 (#1779) — the fund administration console's reads. `access()` answers
 * which fund acts this admin may take, from the Worker's act table; the
 * Worker still decides each act on its own route. `distributionPreview` is
 * what the `returns_distribution` job would write for those proceeds, and
 * writes nothing.
 */
export const fundAdminApi = {
  access: () => request('/fund-admin/access'),
  distributionPreview: (fundId, proceedsCents) =>
    request(`/funds/${fundId}/distributions/preview`, { method: 'POST', body: JSON.stringify({ proceeds_cents: proceedsCents }) }),
  /** Decision 9: the stores' overview. Audited before it answers; a 503 means the read was not made. */
  overview: () => request('/fund-admin/overview'),
  /**
   * D1158: every LP of every administered fund (FND5). `params` are the
   * Worker's filters — fund, lpa, identity, booklet, outstanding, overdue, q,
   * sort, dir, page, per_page; empty ones are left out. Audited before it
   * answers; a 503 means the read was not made.
   */
  lps: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '' || v === false) continue;
      qs.set(k, v === true ? '1' : String(v));
    }
    const s = qs.toString();
    return request(`/fund-admin/lps${s ? `?${s}` : ''}`);
  },
};

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
  /**
   * D4812: the Overview's Recent activity — the fund acts HQ admins took,
   * newest first. `fund` keeps one fund; `before` is the last page's
   * `next_before`. A 503 means the store could not be read, never "no activity".
   */
  activity: ({ fund = null, before = null, limit = null } = {}) => {
    const qs = new URLSearchParams();
    if (fund != null) qs.set('fund', String(fund));
    if (before != null) qs.set('before', String(before));
    if (limit != null) qs.set('limit', String(limit));
    const s = qs.toString();
    return request(`/fund-admin/activity${s ? `?${s}` : ''}`);
  },
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

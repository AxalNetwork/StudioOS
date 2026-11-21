import { refusalError, request } from '../api.js';

/**
 * D714 (#1779) — the fund administration console's reads. `access()` answers
 * which fund acts this admin may take, from the Worker's act table; the
 * Worker still decides each act on its own route. `distributionPreview` is
 * what the `returns_distribution` job would write for those proceeds, and
 * writes nothing.
 */
export const fundAdminApi = {
  /** D6397: deterministic recorded answers, never a model or financial write. */
  answer: (prompt, fundId = null) => {
    const query = new URLSearchParams({ prompt });
    if (fundId != null) query.set('fund', String(fundId));
    return request(`/fund-admin/ask?${query}`);
  },
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
  /**
   * D4812 part 3: the person picker's read — who holds `role` ('gp' or
   * 'ledger') on a fund, by name; for the Super Admin, the accounts matching
   * `q` with their eligibility. Never an email.
   */
  people: (fundId, role, q = '') => request(`/fund-admin/funds/${fundId}/people?role=${encodeURIComponent(role)}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  /**
   * D4812 part 4: Export view — the roster's own filters, every page, as a
   * CSV file the Worker writes (`GET /api/fund-admin/lps/export`), audited
   * there. A binary read with the bearer header, as other downloads are.
   */
  exportLps: async (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '' || v === false || k === 'page' || k === 'per_page') continue;
      qs.set(k, v === true ? '1' : String(v));
    }
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const res = await fetch(`/api/fund-admin/lps/export${qs.toString() ? `?${qs}` : ''}`, {
      credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw await refusalError(res, 'The LP view could not be exported.');
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'fund-admin-lps.csv';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    return { name };
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

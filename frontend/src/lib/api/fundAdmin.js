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
};

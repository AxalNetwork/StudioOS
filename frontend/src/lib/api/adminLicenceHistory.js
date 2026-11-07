// D4707 (#4707) — a licence's history, a page at a time: who did what, the
// structured before and after, and how each write ended. Worker:
// routes/admin_licences.ts (`GET /api/admin/licences/:uid/events`).
import { request } from '../api.js';
import { EVENTS_PAGE_DEFAULT } from '../licenceContracts.js';

export const adminLicenceHistoryApi = {
  /**
   * One page of the history, newest first; pass `next_before` back as `before`
   * for the next (older) page, null at the start. The shape is the contract's
   * (`lib/licenceContracts.js`).
   * @returns {Promise<import('../licenceContracts.js').LicenceEventsPage>}
   */
  events: (uid, { before = null, limit = EVENTS_PAGE_DEFAULT } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (before !== null && before !== undefined) q.set('before', String(before));
    return request(`/admin/licences/${encodeURIComponent(uid)}/events?${q}`);
  },
};

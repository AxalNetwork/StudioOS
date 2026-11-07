// D4707 (#4707) — a licence's history, a page at a time: who did what, the
// structured before and after, and how each write ended. Worker:
// routes/admin_licences.ts (`GET /api/admin/licences/:uid/events`).
import { request } from '../api.js';

export const adminLicenceHistoryApi = {
  /** `{ items, next_before }`; pass `next_before` back as `before` for the next (older) page, null at the start. */
  events: (uid, { before = null, limit = 50 } = {}) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (before !== null && before !== undefined) q.set('before', String(before));
    return request(`/admin/licences/${encodeURIComponent(uid)}/events?${q}`);
  },
};

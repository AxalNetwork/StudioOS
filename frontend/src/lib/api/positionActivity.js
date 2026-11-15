// D6227 (#6227) — one portfolio company's joined activity, newest first:
// investments, marks, distributions, reports received and corrected, the
// caller's own asks and waivers, and support with its amendments. Worker:
// routes/position_activity.ts, GET /api/positions/:uid/activity. Each source
// answers `ok`, `failed` or `not_in_scope` in `sources`; a failed one is never
// an empty list. `before` is the `page.next_cursor` of the previous page.
import { request } from '../api.js';

export const positionActivityApi = {
  companyActivity: (uid, { limit, before } = {}) => {
    const q = new URLSearchParams();
    if (limit != null) q.set('limit', String(limit));
    if (before) q.set('before', String(before));
    const qs = q.toString();
    return request(`/positions/${encodeURIComponent(uid)}/activity${qs ? `?${qs}` : ''}`);
  },
};

// D6205 (#6205) — an investor's requests to HQ for a mark, a correction or a
// missing follow-on round on a company they hold, and HQ's answer. Worker:
// routes/mark_requests.ts (/api/mark-requests).
import { request } from '../api.js';

export const markRequestsApi = {
  // The caller's own requests, newest first; an admin reads every one. `state`: open | resolved | declined.
  list: ({ state } = {}) => request(`/mark-requests${state ? `?state=${encodeURIComponent(state)}` : ''}`),
  // { project_uid, kind: 'mark' | 'correction' | 'follow_on', reason }. 409 `request_open` carries the open one.
  create: ({ projectUid, kind, reason }) => request('/mark-requests', {
    method: 'POST',
    body: JSON.stringify({ project_uid: projectUid, kind, reason }),
  }),
  // Admin: { state: 'resolved' | 'declined', mark_uid?, note? }.
  answer: (uid, { state, markUid, note } = {}) => request(`/mark-requests/${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    body: JSON.stringify({ state, mark_uid: markUid ?? null, note: note ?? null }),
  }),
};

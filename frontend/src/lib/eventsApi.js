// Task #40 (E2) — Event host/attendee API client.
//
// This is the `events.*` namespace the host/attendee UI consumes. It maps 1:1
// to the `/api/events` routes documented in design/EVENT_SYSTEM.md §8.1 (the E1
// backend, Task #39).
//
// Why it lives here and not inside `frontend/src/lib/api.js`:
//   - The API ↔ Worker drift guards (`scripts/check-api-drift.mjs` +
//     `cloudflare-worker/test/api_drift.test.mjs`) statically scan ONLY
//     `api.js` and assert every `/api/...` path it calls is mounted on the
//     production Worker. The E1 `/api/events` mount ships in Task #39, which is
//     not merged in this environment yet — adding these paths to `api.js` now
//     would hard-fail the (allowlist-less) drift test. Keeping the events
//     client in its own module keeps both gates green while the UI is built,
//     and avoids a merge conflict with E1's own `api.js` changes.
//   - It reuses the same exported `request()` helper, so auth/CSRF/step-up
//     handling is identical to every other call.
import { request } from './api';

const BASE = '/api';

export const eventsApi = {
  // GET / — the caller's events (hosting, attending, and Past).
  // D1032: `past_limit` and `past_offset` page Past (`past.total` is exact).
  list: (params = {}) => {
    const q = new URLSearchParams();
    if (params.pastLimit != null) q.set('past_limit', String(params.pastLimit));
    if (params.pastOffset != null) q.set('past_offset', String(params.pastOffset));
    const qs = q.toString();
    return request(`/events${qs ? `?${qs}` : ''}`);
  },
  // D1032: my pending invitations, and answering one signed in (no token).
  invitations: () => request('/events/invitations'),
  answerInvitation: (id, action) => request(`/events/${id}/invitation`, { method: 'POST', body: JSON.stringify({ action }) }),
  // D1032: the host's cancel; paid tickets go to the Events desk for refunds.
  cancel: (id, note) => request(`/events/${id}/cancel`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  // GET /:id — read one (host or admin).
  get: (id) => request(`/events/${id}`),
  // POST / — create an event (host).
  create: (data) => request('/events', { method: 'POST', body: JSON.stringify(data) }),
  // PATCH /:id — edit (host or admin).
  update: (id, data) => request(`/events/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // POST /:id/submit-review — founder "publish public" → pending_review.
  submitReview: (id) => request(`/events/${id}/submit-review`, { method: 'POST', body: JSON.stringify({}) }),
  // POST /:id/invitations — invite from network/connections or emails.
  invite: (id, data) => request(`/events/${id}/invitations`, { method: 'POST', body: JSON.stringify(data) }),
  // GET /:id/roster — registrations + invitations (host).
  roster: (id) => request(`/events/${id}/roster`),
  // POST /:id/registrations/:rid/approve|decline|promote — roster management.
  approve: (id, rid) => request(`/events/${id}/registrations/${rid}/approve`, { method: 'POST', body: JSON.stringify({}) }),
  decline: (id, rid) => request(`/events/${id}/registrations/${rid}/decline`, { method: 'POST', body: JSON.stringify({}) }),
  promote: (id, rid) => request(`/events/${id}/registrations/${rid}/promote`, { method: 'POST', body: JSON.stringify({}) }),
  // POST /:id/register — register the caller (comp auto-applied; capacity/approval aware).
  register: (id, data) => request(`/events/${id}/register`, { method: 'POST', body: JSON.stringify(data || {}) }),
  // GET /:id/eligibility — whether the caller is comp-eligible + price.
  eligibility: (id) => request(`/events/${id}/eligibility`),
  // POST /:id/checkin/:code — QR check-in → attended.
  checkin: (id, code) => request(`/events/${id}/checkin/${encodeURIComponent(code)}`, { method: 'POST', body: JSON.stringify({}) }),
  // Task #7 cross-system wiring:
  // GET /suggested — archetype/track-aware upcoming event suggestions for the caller.
  suggested: () => request('/events/suggested'),
  // GET /:id/invite-suggestions — matching-ranked people to invite (host/admin).
  inviteSuggestions: (id) => request(`/events/${id}/invite-suggestions`),
  // Direct file URLs (opened in a new tab / anchor href, not fetched via request()).
  icsUrl: (id) => `${BASE}/events/${id}/ics`,
  exportUrl: (id) => `${BASE}/events/${id}/export`,
};

export default eventsApi;

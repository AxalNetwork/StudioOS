// D976 (#2762) — the advisor and partner network's admin writes and one
// person's standing. Worker: routes/admin_network.ts, migration 552. Any admin.
// No page draws these yet: Advisors & Partners' People tab and person drawer
// (part 6, #2764) do.
//
//   person    GET  /admin/network/people/:userId
//             → { user_id, kind: 'advisor'|'operating_partner', stage: 'onboarding'|'active'|'paused'|'ended',
//                 pause: { paused, paused_at, reason, last_resumed_at, last_resume_reason, effects[] },
//                 directory, kyc_status, ratings, sessions, engagements, payout, agreement, lab_host }
//             Each of the last six is `{ available: true, … }`, `{ available: false, unreadable: true, reason }`
//             or `{ recorded: false, reason }`. 404 not_found | not_in_network.
//   pause     POST /admin/network/people/:userId/pause  { reason }  → { user_id, stage, paused_at, effects[] }
//             400 reason_required; 409 already_paused | ended. `effects` says what the pause does to
//             this person, so the dialog says nothing more.
//   resume    POST /admin/network/people/:userId/resume { reason }  → { user_id, stage, resumed_at }
//             400 reason_required; 409 not_paused.
//   setListed POST /admin/network/people/:userId/directory { listed } → { user_id, hidden_by_admin, listed }
//             An advisor only: 409 not_an_advisor; 400 listed_required; 409 already_hidden | not_hidden.
import { request } from '../api.js';

const path = (userId) => `/admin/network/people/${encodeURIComponent(userId)}`;

export const adminNetworkApi = {
  person: (userId) => request(path(userId)),
  pause: (userId, reason) => request(`${path(userId)}/pause`, { method: 'POST', body: JSON.stringify({ reason }) }),
  resume: (userId, reason) => request(`${path(userId)}/resume`, { method: 'POST', body: JSON.stringify({ reason }) }),
  setListed: (userId, listed) => request(`${path(userId)}/directory`, { method: 'POST', body: JSON.stringify({ listed }) }),
};

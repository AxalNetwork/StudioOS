// #4190 (K3 of #4155, D4155) — HQ › Decks › Beta cohort: named people get deck
// features early, added and removed by name with a reason. Worker:
// routes/admin_deck_beta.ts (/api/admin/deck-beta, HQ admins). Never an email.
//   GET    /admin/deck-beta?q=&feature=&added_by=&page=   { people, page, per_page, total, keys }
//   GET    /admin/deck-beta/people?q=                     { people: [{ uid, name, company, role }] }  (2+ characters, at most 10)
//   POST   /admin/deck-beta        { user_uids, features, reason }   → { added, features }
//   DELETE /admin/deck-beta/:uid   { reason }                        → { removed, cleared }
import { request } from '../api.js';

const enc = encodeURIComponent;
const q = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export const adminDeckBetaApi = {
  list: (filters = {}) => request(`/admin/deck-beta?${q(filters)}`),
  people: (query) => request(`/admin/deck-beta/people?${q({ q: query })}`),
  add: (userUids, features, reason) => request('/admin/deck-beta', { method: 'POST', body: JSON.stringify({ user_uids: userUids, features, reason }) }),
  remove: (userUid, reason) => request(`/admin/deck-beta/${enc(userUid)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
};

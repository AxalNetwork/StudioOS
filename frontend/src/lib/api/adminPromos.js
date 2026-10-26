// D1272 (#3298), Promo codes part 2 — HQ › Platform › Promo codes' Worker
// reads and writes beyond today's console (`api.adminListPromos` and friends
// in api.js). Worker: routes/admin_promos.ts over services/promos.ts.
//   list(params)        GET   /admin/promos?q=&state=&applies=&sort=&page=&page_size=
//                       → { promos, total, page, page_size, sort, counts }; state is one of
//                         active, paused, ended, expired, at_cap, off; applies all or products
//                         (plans waits for part 3 and is a 400 until then)
//   change(id, body)    PATCH /admin/promos/:id { action: pause|resume|end, reason } or { name, note }
//                       → { ok, promo_id, active, paused_at, ended_at }; an ended code is 409 promo_ended
//   replace(id, body)   POST  /admin/promos/:id/replace { …the new code, as create takes it, reason }
//                       → { ok, promo_id, code, old_ended, old_promo_id }; 502 with old_ended false
//                         when the new code was made and the old one could not be ended
// Every write needs TOTP and a recent step-up; `request` handles the challenge.
import { request } from '../api.js';

const enc = encodeURIComponent;
const LIST_KEYS = ['q', 'state', 'applies', 'sort', 'page', 'page_size'];

export const adminPromosApi = {
  list: (params = {}) => {
    const q = new URLSearchParams();
    for (const k of LIST_KEYS) if (params[k] != null && params[k] !== '') q.set(k, String(params[k]));
    const qs = q.toString();
    return request(`/admin/promos${qs ? `?${qs}` : ''}`);
  },
  change: (id, body) => request(`/admin/promos/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  replace: (id, body) => request(`/admin/promos/${enc(id)}/replace`, { method: 'POST', body: JSON.stringify(body || {}) }),
};

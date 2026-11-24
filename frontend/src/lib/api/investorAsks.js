/**
 * D6261 (#6261): what happens after an investor's quota intro ask, on
 * cloudflare-worker/src/routes/introductions.ts at /api/introductions.
 *   withdraw(uid)  POST /introductions/asks/:uid/withdraw → { ok, status: 'withdrawn', slot_returned, used, cap, remaining }
 *                  (the investor's own ask, while pending; a slot spent this quarter comes back)
 *   received()     GET  /introductions/asks/received → { asks: [{ uid, message, status, quarter, created_at, decided_at, investor_name, investor_headline }] }
 *   accept(uid)    POST /introductions/asks/received/:uid/accept → { ok, status: 'accepted' } (the founder the ask is addressed to)
 *   decline(uid)   POST /introductions/asks/received/:uid/decline → { ok, status: 'declined' }
 * Another member's ask is 404 `ask_not_found`; an ask that is no longer pending is 409 `ask_already_answered`.
 * Acceptance opens the Trust Center NDA step (`trustIntroRequest`), which the investor starts; it signs nothing.
 */
import { request } from '../api.js';

const id = (v) => encodeURIComponent(String(v));
const post = (path) => request(path, { method: 'POST', body: '{}' });

export const investorAsksApi = {
  withdraw: (uid) => post(`/introductions/asks/${id(uid)}/withdraw`),
  received: () => request('/introductions/asks/received'),
  accept: (uid) => post(`/introductions/asks/received/${id(uid)}/accept`),
  decline: (uid) => post(`/introductions/asks/received/${id(uid)}/decline`),
};

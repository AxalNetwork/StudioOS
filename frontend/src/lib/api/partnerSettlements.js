// D713 (#1778) — settlements under signed partner deals: one amount a deal
// says moves between the member and Axal VC Management. A member reads their
// own issued, matched and void rows. An Admin drafts, edits and deletes drafts;
// only the Super Admin, with a fresh step-up, issues or voids. Nothing here
// moves money. Worker: routes/partner_settlements.ts.
import { request } from '../api.js';

const row = (uid) => `/admin/partner-settlements/${encodeURIComponent(uid)}`;
const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o || {})) if (v != null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const partnerSettlementsApi = {
  /** The caller's own rows, never drafts. */
  mine: () => request('/partner-settlements'),
  /** Admin, HQ only. Filters: `deal`, `partner`, `state`. */
  list: ({ deal, partner, state } = {}) => request(`/admin/partner-settlements${qs({ deal, partner, state })}`),
  /** `{ partner_deal_id, kind, direction, amount_cents, due_on, memo }`. */
  create: (body) => request('/admin/partner-settlements', { method: 'POST', body: JSON.stringify(body) }),
  update: (uid, body) => request(row(uid), { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (uid) => request(row(uid), { method: 'DELETE' }),
  /** Super Admin only, behind the step-up; a plain Admin gets 403 `super_admin_required`. */
  issue: (uid) => request(`${row(uid)}/issue`, { method: 'POST', body: JSON.stringify({}) }),
  void: (uid, reason) => request(`${row(uid)}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
};

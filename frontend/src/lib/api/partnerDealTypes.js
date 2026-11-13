// D986 (#2776, part 5 of #2376) — which partner deal types a licence may offer.
// Worker: routes/admin_partner_deal_types.ts (HQ) and
// routes/licence_partner_deal_types.ts (the studio), over migration 555.
// HQ's reads are Super Admin only; the write takes the money bar (a TOTP
// session, a fresh step-up, the elevation) and a reason of at least 10
// characters, and appends one `program_changed` licence event.
//   GET  /api/admin/partner-deal-types               → { catalogue, licences }
//   GET  /api/admin/partner-deal-types/licences/:uid → { licence, catalogue, recorded, types, reason, history }
//   PUT  /api/admin/partner-deal-types/licences/:uid { types: [...] | null, reason }
//   GET  /api/licence/mine/partner-deal-types        → { source, catalogue, recorded, types, reason }
// A licence HQ has not set reads `recorded: false` and "Not recorded", never
// "every type"; until HQ sets it, every type stays open (D986 §3).
import { request } from '../api.js';

const enc = encodeURIComponent;

export const partnerDealTypesApi = {
  list: () => request('/admin/partner-deal-types'),
  licence: (uid) => request(`/admin/partner-deal-types/licences/${enc(uid)}`),
  save: (uid, body) => request(`/admin/partner-deal-types/licences/${enc(uid)}`, { method: 'PUT', body: JSON.stringify(body || {}) }),
  mine: () => request('/licence/mine/partner-deal-types'),
};

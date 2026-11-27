// D5019 (#5019) — a licence's territorial exclusivity and development commitments, apart from its operating fee.
// HQ only (Super Admin; writes take the write bar and a reason). Worker: cloudflare-worker/src/routes/admin_licence_exclusivity.ts.
//   GET  /api/admin/licences/:uid/exclusivity → { operating, exclusivity, exclusivity_reason, reach, progress, observations,
//                                                next_review_on, reviews, history, children, master, schedule, agreement, regions }
//   PUT  /api/admin/licences/:uid/exclusivity { scope_type, territory: { countries, regions }, parent_licence_uid?, child_licence_uids?,
//        starts_on?, ends_on?, review_on?, cure_period_days?, targets?, contractual?, reason, expected_revision,
//        acknowledge_agreement_mismatch? } → { exclusivity }; 409 territory_overlap / exclusivity_conflict / agreement_ack_required
//   POST /api/admin/licences/:uid/exclusivity/observations { metric, period_start, period_end, value, source, reason }
//        → { observation, review_opened, exclusivity_changed: false }
//   POST /api/admin/licences/:uid/exclusivity/reviews { reason }
//   POST /api/admin/licences/:uid/exclusivity/reviews/:rid/preview { action, territory?, cure_period_days? } → { consequence, next, stored: false }
//   POST /api/admin/licences/:uid/exclusivity/reviews/:rid/resolve { action, reason, expected_revision, acknowledge_consequence: true, … }
//   GET|POST /api/admin/territory-regions
import { request } from '../api.js';

const enc = encodeURIComponent;
const base = (uid) => `/admin/licences/${enc(uid)}/exclusivity`;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const licenceExclusivityApi = {
  get: (uid) => request(base(uid)),
  save: (uid, body) => request(base(uid), { method: 'PUT', body: JSON.stringify(body || {}) }),
  observe: (uid, body) => post(`${base(uid)}/observations`, body),
  openReview: (uid, body) => post(`${base(uid)}/reviews`, body),
  preview: (uid, rid, body) => post(`${base(uid)}/reviews/${enc(rid)}/preview`, body),
  resolve: (uid, rid, body) => post(`${base(uid)}/reviews/${enc(rid)}/resolve`, body),
  regions: () => request('/admin/territory-regions'),
  addRegion: (body) => post('/admin/territory-regions', body),
};

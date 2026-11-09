// D5017 (#5017) — country pricing on a licence. HQ only (Super Admin; writes take the write bar).
// Worker: cloudflare-worker/src/routes/admin_licence_pricing_apply.ts, services/licencePricingApply.ts.
//   GET  /api/admin/licences/:uid/pricing → { terms, territory, basis, model, countries, recommendation, latest_decision,
//                                              drift, next_review_on, review_due, reviews, agreement }
//   PUT  /api/admin/licences/:uid/pricing/policy { basis, primary_country?, weights?, reason, expected_revision } → { policy }
//   POST /api/admin/licences/:uid/pricing/snapshot { allow_provisional? } → { snapshot, licence_changed: false }
//   POST /api/admin/licences/:uid/pricing/apply { snapshot_uid, expected_terms_revision, accepted?, effective_from, reason,
//                                                override_reason?, acknowledge_agreement_mismatch?, pricing_review_on?, review_uid? }
//        → { committed, decision, terms, agreement, pushed, push_outcome }; 409 terms_conflict / snapshot_stale / agreement_ack_required
//   POST /api/admin/licences/:uid/pricing/reviews { allow_provisional? } → { review, snapshot, licence_changed: false }
//   POST /api/admin/licences/:uid/pricing/reviews/:reviewUid/resolve { action: keep|postpone, reason, postponed_until?, expected_revision }
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const licencePricingApi = {
  get: (uid) => request(`/admin/licences/${enc(uid)}/pricing`),
  setBasis: (uid, body) => request(`/admin/licences/${enc(uid)}/pricing/policy`, { method: 'PUT', body: JSON.stringify(body) }),
  refresh: (uid, body) => post(`/admin/licences/${enc(uid)}/pricing/snapshot`, body),
  apply: (uid, body) => post(`/admin/licences/${enc(uid)}/pricing/apply`, body),
  openReview: (uid, body) => post(`/admin/licences/${enc(uid)}/pricing/reviews`, body),
  resolveReview: (uid, reviewUid, body) => post(`/admin/licences/${enc(uid)}/pricing/reviews/${enc(reviewUid)}/resolve`, body),
};

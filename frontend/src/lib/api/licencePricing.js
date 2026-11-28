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
//
// D7715 (#7715) — the country catalogue's writes (D5016), sent by the HQ sheets on `/admin/licences/pricing`.
// Worker: cloudflare-worker/src/routes/admin_licence_pricing.ts. Each takes the write bar, a reason and the revision read.
//   POST /api/admin/licence-pricing/countries/import { observations[1..500], expected_revisions, reason }
//        → 200 or 207 { applied: { CODE: rows }, conflicts: [{ country_code, current_revision }] }
//   POST /api/admin/licence-pricing/countries/:code/observations { field, value, status, source, source_ref, as_of, reason,
//        expected_revision } → 201 { profile }; 409 profile_conflict { current_revision }; 400 invalid_observation { fields }
//   PUT  /api/admin/licence-pricing/countries/:code/fields/:field/status { status: provisional|not_recorded, reason,
//        expected_revision } → { profile }
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

export const licencePricingCatalogueApi = {
  importCountries: (body) => post('/admin/licence-pricing/countries/import', body),
  recordObservation: (code, body) => post(`/admin/licence-pricing/countries/${enc(code)}/observations`, body),
  setFieldStatus: (code, field, body) => request(`/admin/licence-pricing/countries/${enc(code)}/fields/${enc(field)}/status`, { method: 'PUT', body: JSON.stringify(body) }),
};

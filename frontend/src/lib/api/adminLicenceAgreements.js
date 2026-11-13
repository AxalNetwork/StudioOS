// D5051 (#5051): HQ's client for the canonical package and program agreements (D5048, D5049).
// Worker: routes/admin_licence_agreements.ts over services/programAgreements.ts, mounted at
// `/api/admin/licence-agreements`. Reads are Super Admin; every write takes the write bar, the revision it
// read and a reason of at least 10 characters.
//   GET  /licences/:licenceUid          → { licence_uid, licence_identity, agreements, slots, programs }
//   GET  /templates                     → { items, merge_namespaces }
//   POST /licences/:licenceUid/drafts   { agreement_kind, template_slug, program_key?, package_key?, addendum_key?, package_version?, package_offer_uid?, reason }
//   GET  /:uid                          → { agreement, events }
//   GET  /:uid/preview                  → the stored body, its hash and its readiness
//   POST /:uid/send                     { revision, reason }
//   POST /:uid/void                     { revision, reason }
// A draft of a slot supersedes that slot's unsent draft; one out for signature is refused (409 in_flight),
// so a second copy of one agreement is never created. A program schedule is sent from Program access.
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const adminLicenceAgreementsApi = {
  forLicence: (licenceUid) => request(`/admin/licence-agreements/licences/${enc(licenceUid)}`),
  templates: () => request('/admin/licence-agreements/templates'),
  draft: (licenceUid, body) => post(`/admin/licence-agreements/licences/${enc(licenceUid)}/drafts`, body),
  get: (uid) => request(`/admin/licence-agreements/${enc(uid)}`),
  preview: (uid) => request(`/admin/licence-agreements/${enc(uid)}/preview`),
  send: (uid, body) => post(`/admin/licence-agreements/${enc(uid)}/send`, body),
  void: (uid, body) => post(`/admin/licence-agreements/${enc(uid)}/void`, body),
};

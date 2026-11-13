// D5051 (#5051): HQ's client for the agreement policies, a licence's legal readiness and its legal history (D5052).
// Worker: routes/admin_licence_agreement_policies.ts over services/agreementPolicies.ts, mounted at
// `/api/admin/licence-agreement-policies`. Reads are Super Admin; writes take the write bar and a reason.
//   GET  /                                          → { items, strategies, legal_gates, default_gate, unrecorded_means }
//   GET  /licences/:licenceUid                      → { holdings, programs, replacements_required }
//   GET  /licences/:licenceUid/history              → { items } (agreement lifecycle and legal events, oldest first)
//   POST /licences/:licenceUid/package-acceptances  { package_key, package_offer_uid?, reason }
//   GET  /:scopeKind/:scopeKey                      → { latest, versions, holders_by_version, history }
//   POST /:scopeKind/:scopeKey                      { strategy, legal_gate?, programs?, required_schedules?, reason }
// A new policy version reaches no existing holder: a licence keeps the version it froze.
import { request } from '../api.js';

const enc = encodeURIComponent;
const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });

export const adminLicenceAgreementPoliciesApi = {
  list: () => request('/admin/licence-agreement-policies'),
  forLicence: (licenceUid) => request(`/admin/licence-agreement-policies/licences/${enc(licenceUid)}`),
  history: (licenceUid) => request(`/admin/licence-agreement-policies/licences/${enc(licenceUid)}/history`),
  acceptPackage: (licenceUid, body) => post(`/admin/licence-agreement-policies/licences/${enc(licenceUid)}/package-acceptances`, body),
  scope: (scopeKind, scopeKey) => request(`/admin/licence-agreement-policies/${enc(scopeKind)}/${enc(scopeKey)}`),
  recordVersion: (scopeKind, scopeKey, body) => post(`/admin/licence-agreement-policies/${enc(scopeKind)}/${enc(scopeKey)}`, body),
};

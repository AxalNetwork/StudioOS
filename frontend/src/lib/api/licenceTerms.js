// D797 (#2230) — a licence's terms schedule: deal terms, renewal and notice,
// money and reporting. HQ writes it; the Administrator reads it on `/mine`.
// Worker: routes/admin_licences.ts (Super Admin), migration 512's `licence_terms`;
// the field list, types, ranges and labels are `services/licenceTerms.ts`.
//   GET /api/admin/licences/:uid/terms → { licence_uid, terms: { <key>: value|null }|null, sections, revision }
//   PUT /api/admin/licences/:uid/terms { terms?: { <key>: value|null }, sections?: { <key>: '§7.3'|null }, reason, expected_revision }
//                                      → { ok, terms, sections, revision, changed, pushed }; 400 invalid_terms names the field,
//                                        400 reason_required, 400 revision_required, 403 step_up_required (a TOTP session and a recent step-up),
//                                        409 terms_conflict { current_revision, current } when another save got there first (D4694)
// The Administrator's read is `/api/licence/mine`, which carries `terms`, `terms_reason` and `sections`.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const licenceTermsApi = {
  get: (uid) => request(`/admin/licences/${enc(uid)}/terms`),
  save: (uid, { terms, sections, reason, expected_revision } = {}) => request(`/admin/licences/${enc(uid)}/terms`, {
    method: 'PUT',
    body: JSON.stringify({ ...(terms ? { terms } : {}), ...(sections ? { sections } : {}), reason, expected_revision }),
  }),
};

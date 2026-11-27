/**
 * D5837 (#5837): a founder pins one line of one exact ledger statement revision to a Raise claim, as Private
 * evidence (routes/raise_ledger_evidence.ts). The venture's founder only; sharing beyond Private stays on the
 * evidence item (`PATCH /cycles/raise/evidence/items/:id`).
 *
 * `read(projectId)` → `{ selections, options }`: each selection's kept fact and its source now (`current`,
 *   `corrected` with the correction to re-review, `access_revoked`, `deleted`), and the lines that may be chosen.
 * `pin(projectId, { snapshot_uid, source_key, amount, currency, basis, observed_on, claim_id })` → `{ selection }`.
 * `review(projectId, uid, { snapshot_uid, source_key, amount, currency, basis, observed_on })` → `{ selection }`.
 * `withdraw(projectId, uid)` → `{ selection }`.
 */
import { request } from '../api.js';

export const raiseLedgerEvidenceApi = {
  read: (projectId) => request(`/raise-ledger-evidence?project=${encodeURIComponent(projectId)}`),
  pin: (projectId, fact) => request(`/raise-ledger-evidence/selections?project=${encodeURIComponent(projectId)}`, { method: 'POST', body: JSON.stringify(fact) }),
  review: (projectId, uid, fact) =>
    request(`/raise-ledger-evidence/selections/${encodeURIComponent(uid)}/review?project=${encodeURIComponent(projectId)}`, { method: 'POST', body: JSON.stringify(fact) }),
  withdraw: (projectId, uid) =>
    request(`/raise-ledger-evidence/selections/${encodeURIComponent(uid)}/withdraw?project=${encodeURIComponent(projectId)}`, { method: 'POST', body: JSON.stringify({}) }),
};

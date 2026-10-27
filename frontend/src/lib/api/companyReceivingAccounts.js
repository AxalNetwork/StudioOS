// D1217 (#3214, part 4 of #2424) — the company's receiving account. Worker:
// routes/company_receiving_accounts.ts, at /api/closings/company-receiving-accounts.
//
// Every read is masked (last four digits, or two for a short number). The
// venture's founder saves the account; a save notifies every investor with an
// unpaid line, with CP9's warning, and pauses nothing. An investor with a
// signed line (D1215's line, its own envelope completed and signed by them)
// reveals the full number once, logged without the number; the reply says how
// long to show it (`expires_in_seconds`). Nothing here moves money.
import { request } from '../api.js';

const at = (projectId) => `/closings/company-receiving-accounts/${encodeURIComponent(projectId)}`;

export const companyReceivingAccountsApi = {
  read: (projectId) => request(at(projectId)),
  /** The founder's save: the account's details and the revision it was read at. */
  save: (projectId, body) => request(at(projectId), { method: 'PUT', body: JSON.stringify(body || {}) }),
  /** An investor's reveal of the full number, for their own signed commitment. */
  reveal: (projectId, commitmentUid) =>
    request(`${at(projectId)}/reveal`, { method: 'POST', body: JSON.stringify({ commitment_uid: commitmentUid }) }),
};

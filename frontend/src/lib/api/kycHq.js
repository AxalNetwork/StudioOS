// D1230 (#3238) — KYC part 2: Send to HQ, HQ's decision, and the review of a
// sanctions match. The case read (`kycAdminGet`) carries `screening` and `hq`.
// Worker: routes/kyc.ts (Send to HQ, decide) and routes/trust.ts (review).
import { request } from '../api.js';

export const kycHqApi = {
  /** An admin sends a case to HQ with a note (5 to 1000 characters). */
  sendToHq: (userId, note) => request(`/kyc/admin/${encodeURIComponent(userId)}/hq`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  }),
  /** A Super Admin decides a case HQ holds: `approved` or `rejected` (a note required to reject). */
  decide: (userId, verdict, note) => request(`/kyc/admin/${encodeURIComponent(userId)}/hq/decide`, {
    method: 'POST',
    body: JSON.stringify({ verdict, ...(note ? { note } : {}) }),
  }),
  /** Record who reviewed a sanctions match, when, and their notes. */
  reviewMatch: (screeningId, notes) => request(`/trust/sanctions/${encodeURIComponent(screeningId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  }),
};

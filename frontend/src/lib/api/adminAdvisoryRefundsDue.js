// #5305 (D4703) — HQ's advisory refunds due: charges that landed on a cancelled or missed advisor booking, owed
// back. Worker: routes/admin_platform.ts.
//   list()                 GET  /admin/platform/advisory-refunds-due
//                          → { items: [{ id, booking_uid, booking_status, payment_intent_id, amount_cents, currency,
//                              created_at, resolved_at, resolved_by, resolved_by_name, resolution_reason }], open }.
//                            Open rows first; no founder or advisor is named. 503 `store_unavailable` when the
//                            record cannot be read: never an empty list.
//   resolve(id, reason)    POST /admin/platform/advisory-refunds-due/:id/resolve { reason }
//                          → { ok, id, resolved_at, resolved_by, resolution_reason, moves_money: false }.
//                            Records that the operator refunded it outside the platform; moves no money. 409
//                            `already_resolved` on a second resolve.
// Super admin; the resolve takes the write bar (TOTP session and a recent step-up).
import { request } from '../api.js';

export const adminAdvisoryRefundsDueApi = {
  list: () => request('/admin/platform/advisory-refunds-due'),
  resolve: (id, reason) => request(`/admin/platform/advisory-refunds-due/${encodeURIComponent(id)}/resolve`, {
    method: 'POST', body: JSON.stringify({ reason }),
  }),
};

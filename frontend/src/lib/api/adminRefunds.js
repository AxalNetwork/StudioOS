// D5037 (#5037) — the refund review HQ confirms before money moves. Worker: routes/admin_billing.ts over
// services/refundReview.ts.
//   review(body)   POST /admin/billing/refund/review { payment_intent | charge, amount_major? }
//                  → { ok, review, review_token }. Moves no money and writes nothing; the review shows gross,
//                    refunded to date, what is left, the amount asked, the policy (allowed, blocked or unavailable)
//                    and the clawback. The refund itself is `api.adminBillingRefund({ review_token, reason, … })`.
// Super admin; the review needs no step-up, the confirmation does.
import { request } from '../api.js';

export const adminRefundsApi = {
  review: (body) => request('/admin/billing/refund/review', { method: 'POST', body: JSON.stringify(body || {}) }),
};

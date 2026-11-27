// D1434 (#3703 part 3) — HQ › Payments' Move to live: the owner-run move of
// production from Stripe's sandbox to the live account. Super Admin only.
// Worker: routes/admin_stripe.ts.
//   GET  /api/admin/stripe/cutover   → { mode, stored_mode, last_cutover, would_clear }
//   POST /api/admin/stripe/cutover   { to_mode, reason, confirm } → the cutover's counts
import { request } from '../api.js';

export const stripeCutoverApi = {
  read: () => request('/admin/stripe/cutover'),
  run: (toMode, reason, confirm) => request('/admin/stripe/cutover', { method: 'POST', body: JSON.stringify({ to_mode: toMode, reason, confirm }) }),
};

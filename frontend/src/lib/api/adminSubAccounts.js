import { request } from '../api.js';

// D1302 (#3399, Accounts part 3 of #2377) — an account's sub-accounts for
// Admin › Accounts. Worker: routes/admin_sub_accounts.ts over
// services/subAccounts.ts. Reads only: a tester is decided on
// /admin/product-testers (D1042), an LP on the LP applications page.
//
//   counts()          GET /admin/sub-accounts/counts
//                     → { testers: { available, by_status, active, pending, unknown_status } | { available: false, reason },
//                         lps: { available, active, pending } | { available: false, reason } }
//   account(userId)   GET /admin/sub-accounts/accounts/:userId
//                     → { user_id, tester: { available, record | null }, lp: { available, is_lp, funds, applications } };
//                       another administrator's record is 403 super_admin_required
//
// `reason` is `not_set_up` or `unreadable`, never a 0 in its place.
const enc = encodeURIComponent;

export const adminSubAccountsApi = {
  counts: () => request('/admin/sub-accounts/counts'),
  account: (userId) => request(`/admin/sub-accounts/accounts/${enc(userId)}`),
};

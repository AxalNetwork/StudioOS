import { request } from '../api.js';

// D1301 (#3397) — Admin › Accounts' overview, on routes/admin_accounts_overview.ts.
// Any admin. Counted as Insights counts (services/accountCounts.ts). Each block is
// `{ available: true, … }`, `{ available: false, unreadable: true, reason }` or
// `{ available: false, recorded: false, reason }`.
//   accountsOverview  GET /admin/accounts/overview
//                     → { as_of, scope: { key, label }, weeks, current_week,
//                         kpis: { accounts, active_30d, unverified, waiting },
//                         profiles: { rows: [{ profile, label, count, new_30d, weeks }], other, admins },
//                         lps, product_testers, readiness: { all, by_profile }, explorers,
//                         newest: { rows }, attention: { rows, by_kind, not_recorded, partial },
//                         definitions }
//                     Newest and Needs attention list another administrator to a Super Admin only.
export const adminAccountsApi = {
  accountsOverview: () => request('/admin/accounts/overview'),
};

// D1303 (#3400, part 4 of #2377) — All accounts' smaller writes, the Worker's
// routes/admin_accounts.ts at /api/admin/accounts: the bulk resend of the
// verification email (capped; verified, deactivated and other
// administrators' accounts skipped; a dry run gives the dialog its counts),
// saved views (only me, or every admin of this studio), and the accounts
// export with its required reason. The full-access reason is
// `kycAdminApprove(userId, { reason })` in api.js, and who saved an account's
// notes comes back on its profile read as `notes_saved`.
import { request } from '../api.js';

const view = (uid) => `/admin/accounts/views/${encodeURIComponent(uid)}`;

export const adminAccountWritesApi = {
  /** {user_ids, dry_run?}: at most 50 accounts; a dry run sends nothing. */
  adminBulkResendVerification: (userIds, { dryRun = false } = {}) =>
    request('/admin/accounts/resend-verification', { method: 'POST', body: JSON.stringify({ user_ids: userIds, ...(dryRun ? { dry_run: true } : {}) }) }),
  adminAccountViews: () => request('/admin/accounts/views'),
  /** {name, scope: 'admin' | 'studio', query}: query holds the list's own filter keys. */
  adminSaveAccountView: (body) => request('/admin/accounts/views', { method: 'POST', body: JSON.stringify(body) }),
  adminUpdateAccountView: (uid, body) => request(view(uid), { method: 'PUT', body: JSON.stringify(body) }),
  adminDeleteAccountView: (uid) => request(view(uid), { method: 'DELETE' }),
  /** {reason, user_ids? | q?, columns?}: answers {filename, rows, csv}; the export is recorded first. */
  adminExportAccounts: (body) => request('/admin/accounts/export', { method: 'POST', body: JSON.stringify(body) }),
};

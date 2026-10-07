// #1384 — the Super Admin's credit reward rules and grants (D540, D608).
// Worker: routes/admin_credit_rules.ts, at /api/admin/credit-rules. Every
// route is the Super Admin's, and every write carries a typed reason of at
// least ten characters, recorded through logAdminAction.
import { request } from '../api.js';

export const creditRulesApi = {
  // { rules: [{ key, kind, credits, usd_value_cents, active, updated_by, updated_at }] }
  rules: () => request('/admin/credit-rules'),
  // Credits and on/off only: the dollar value follows the credits on the
  // Worker (`usd_value_fixed`), so it is never sent.
  updateRule: (key, { credits, active, reason }) =>
    request(`/admin/credit-rules/${encodeURIComponent(key)}`, {
      method: 'PUT', body: JSON.stringify({ credits, active, reason }),
    }),
  // { grants: [...] }: rule grants and manual lines, newest 200.
  grants: () => request('/admin/credit-rules/grants'),
  revokeGrant: (id, reason) =>
    request(`/admin/credit-rules/grants/${encodeURIComponent(id)}/revoke`, {
      method: 'POST', body: JSON.stringify({ reason }),
    }),
};

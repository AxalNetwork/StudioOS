// D638 (#1384) — the Super Admin's reward rules and grants (D540).
// Worker: routes/admin_credit_rules.ts, at /api/admin/credit-rules. Every
// route is the Super Admin's, and every write carries a typed reason of at
// least ten characters.
import { request } from '../api.js';

const send = (method, path, body) => request(path, { method, body: JSON.stringify(body) });

export const creditRulesApi = {
  // { rules: [{ key, kind, credits, usd_value_cents, active, updated_by, updated_at }] }
  rules: () => request('/admin/credit-rules'),
  // { rule } — `changes` holds credits and/or active; the value follows the credits.
  updateRule: (key, changes, reason) => send('PUT', `/admin/credit-rules/${encodeURIComponent(key)}`, { ...changes, reason }),
  // { grants: [...] }: rule grants and manual lines (D608), newest first, at most 200.
  grants: () => request('/admin/credit-rules/grants'),
  revokeGrant: (id, reason) => send('POST', `/admin/credit-rules/grants/${encodeURIComponent(id)}/revoke`, { reason }),
};

// D5757 (#5757) — the Platform scope switcher's client: the subsidiaries HQ can scope to, and one subsidiary's reading (D5786). Super Admin only.
// Worker: routes/admin_platform.ts, service services/platformScope.ts.
//   GET /api/admin/platform/scopes        → { registry_available, registry_reason?, scopes: [{ kind, code, licence_uid, registry_status, bound }] }
//   GET /api/admin/platform/scopes/:code  → { scope, observed_at, state, detected, unknown, signals, unavailable, hq_only }
//                                           400 `invalid_scope` (incl. 'hq'), 404 `unknown_scope`, read from err.code (D258)
// The HQ-wide position reads nothing here: it keeps the summary, deployments and traffic reads it always made.
import { request } from '../api.js';

export const platformScopesApi = {
  list: () => request('/admin/platform/scopes'),
  read: (code) => request(`/admin/platform/scopes/${encodeURIComponent(String(code || ''))}`),
};

// D4155 (#4155) — HQ › Decks reads and writes D1509's feature flags. Worker:
// routes/admin_feature_flags.ts, mounted at /api/admin/feature-flags (an admin).
//   GET /api/admin/feature-flags
//       → { flags: [{ key, scope, scope_id, enabled, updated_by: { uid, name } | null, updated_at, affected }], keys, labels, cache_s }
//   PUT /api/admin/feature-flags  { key, scope, scope_id?, enabled: true|false|null, reason }
//       → { ok, key, scope, scope_id, enabled }
// K2 (#4189) made the PUT take a reason of 10 to 500 characters (400
// `reason_required`) and write one admin audit row. `set` refuses a missing or
// short reason here too, before anything is sent, so no write leaves without one.
import { request } from '../api.js';

/** The Worker's `REASON_MIN` and its upper bound (`admin_feature_flags.ts`). */
export const FLAG_REASON_MIN = 10;
export const FLAG_REASON_MAX = 500;

export const adminFeatureFlagsApi = {
  list: () => request('/admin/feature-flags'),
  set: ({ key, scope, scope_id: scopeId = '', enabled }, reason) => {
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length < FLAG_REASON_MIN || why.length > FLAG_REASON_MAX) {
      const e = new Error(`Say why, in ${FLAG_REASON_MIN} to ${FLAG_REASON_MAX} characters. It is kept in the admin audit.`);
      e.code = 'reason_required';
      return Promise.reject(e);
    }
    return request('/admin/feature-flags', { method: 'PUT', body: JSON.stringify({ key, scope, scope_id: scopeId, enabled, reason: why }) });
  },
};

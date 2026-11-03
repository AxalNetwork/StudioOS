// D4155 (#4155) — HQ › Decks reads D1509's feature flags. Worker:
// routes/admin_feature_flags.ts, mounted at /api/admin/feature-flags (an admin).
//   GET /api/admin/feature-flags
//       → { flags: [{ key, scope, scope_id, enabled, updated_by, updated_at }], keys, cache_s }
// Read-only here: the PUT takes no reason yet, and every change on HQ › Decks
// asks for one. The write method arrives with K2 (#4189).
import { request } from '../api.js';

export const adminFeatureFlagsApi = {
  list: () => request('/admin/feature-flags'),
};

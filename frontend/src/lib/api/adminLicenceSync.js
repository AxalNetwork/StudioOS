// D4819 part 21 (#5928) — Retry branch sync: push a licence's current copy to its
// branch now, changing nothing at HQ. Worker: routes/admin_licences_lifecycle.ts
// (`POST /api/admin/licences/:uid/sync/retry`, Super Admin).
import { request } from '../api.js';

export const adminLicenceSyncApi = {
  /** Answers `{ ok, status, pushed }`; a draft is refused (`not_issued`). */
  retry: (uid) => request(`/admin/licences/${encodeURIComponent(uid)}/sync/retry`, { method: 'POST' }),
};

// D6733 (#6733) — Retry sync: HQ re-sends a licence's owed copy to its branch now.
// Worker: routes/admin_licence_sync_retry.ts (Super Admin), through services/licencePush.ts.
//   POST /api/admin/licences/:uid/sync/retry
//        → { ok: true, pushed: { ok, revision, failure_code?, no_deployment? }, sync }
//        409 nothing_pending (no copy is owed; nothing was sent), 409 retry_in_flight,
//        503 sync_unreadable, 404 not_found
import { request } from '../api.js';

const enc = encodeURIComponent;

export const licenceSyncApi = {
  retry: (uid) => request(`/admin/licences/${enc(uid)}/sync/retry`, { method: 'POST' }),
};

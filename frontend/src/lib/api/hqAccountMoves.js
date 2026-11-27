// D5043 (#5043) — HQ Team's recovery for a cross-branch move whose destination invitation did not land.
// Worker: routes/admin_support_sessions.ts over services/accountMoves.ts (Super Admin; migration 202611091210).
//   open()                 GET  /admin/account-moves
//       → { items: [{ uid, from, to, target: { name, email, role }, status, state, moved_out, attempts,
//           last_error_code, last_error, invitation: { uid, stored, email_sent, email_reason } | null,
//           records_note }] } — moves whose invitation failed, is in flight, or landed without its email.
//   retryInvitation(uid)   POST /admin/account-moves/:uid/retry-invitation   (no body: the Worker sends
//       what the source recorded, never anything from here; TOTP, a recent step-up and Super Admin)
//       → { operation, retried, invited: { ok, stored, uid, email_sent, reason?, invite_link?, reused? } };
//         retried: false when the invitation had already landed (no branch was called). Refusals:
//         400 bad_operation, 404 move_not_found, 409 move_out_not_proven, retry_in_progress,
//         destination_active, destination_refused, destination_not_bound, move_target_unrecorded,
//         502 destination_unreachable — each with `message` and, past the gates, `operation`.
import { request } from '../api.js';

const enc = encodeURIComponent;

export const hqAccountMovesApi = {
  open: () => request('/admin/account-moves'),
  retryInvitation: (uid) => request(`/admin/account-moves/${enc(uid)}/retry-invitation`, { method: 'POST' }),
};

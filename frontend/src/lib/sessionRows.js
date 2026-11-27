/**
 * D4616 (#4616) — how the Settings sessions card draws a row, from the
 * `status` the Worker gives it (services/sessionStatus.ts `userSessionStatus`).
 *
 * Only an `active` row is a device that can still act, so only it offers
 * Revoke. Every other row is history and says which kind: revoked one by one,
 * expired with its token, or ended by "Sign out everywhere". A row with no
 * status (an older Worker) falls back to `revoked_at`, as the card did before.
 */
export const SESSION_STATUS_LABELS = {
  revoked: 'Revoked',
  expired: 'Expired',
  signed_out: 'Signed out',
  unknown: 'Unknown',
};

export function sessionRowState(s) {
  const status = s?.status || (s?.revoked_at ? 'revoked' : 'active');
  const live = status === 'active';
  return { status, live, label: live ? null : (SESSION_STATUS_LABELS[status] || 'Inactive') };
}

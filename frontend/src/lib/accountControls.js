/**
 * D221 — whether the account directory draws its two per-account controls,
 * View As and Disable/Enable, on a given row for a given viewer.
 *
 * ONE RULE, BECAUSE THE SERVER HAS ONE. `POST /api/admin/impersonate/:userId`
 * and `PATCH /api/admin/users/:userId/toggle-active` refuse the same target for
 * the same reason: an account whose role is `admin` is the Super Admin's alone
 * (D132 on the toggle, D133 on impersonation). Both answer 403
 * `super_admin_required` to anyone else. And the toggle refuses the caller's
 * own account outright ("Cannot deactivate yourself").
 *
 * A CONTROL THAT CAN ONLY REFUSE IS NOT DRAWN — D134's rule, stated where it
 * was first applied: a UI that offers a button and lets the server pick
 * teaches the operator that one of its buttons is a lie. Before D221 the
 * directory drew both controls on every row for every admin, so a plain admin
 * saw View As and Disable on every other admin's row and on the holder's, and
 * each of those buttons could only answer 403.
 *
 * THE VIEWER'S OWN ROW DRAWS NEITHER, and the two reasons differ. Disabling
 * yourself is refused. Impersonating yourself is not refused — it opens a
 * support session whose actor and target are the same person and writes an
 * impersonation row saying so, which is not support and reads in Security as
 * though it were. Neither is a thing anyone needs a button for.
 *
 * The elevation is read the way `canOverrideRole` reads it on the same page:
 * `is_super_admin` as hydrated onto the signed-in user, compared to 1, so an
 * absent field is "not the holder" rather than truthy by accident.
 *
 * @param {{id?: number|string, role?: string}|null|undefined} row
 * @param {{id?: number|string, is_super_admin?: number|boolean}|null|undefined} viewer
 * @returns {boolean}
 */
export function drawsAccountControls(row, viewer) {
  if (!row) return false;
  const self = viewer?.id != null && Number(row.id) === Number(viewer.id);
  if (self) return false;
  const adminTarget = String(row.role || '').toLowerCase() === 'admin';
  const holder = Number(viewer?.is_super_admin ?? 0) === 1;
  return !adminTarget || holder;
}

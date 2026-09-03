/**
 * Which sidebar shell a session gets — and why that is not just `user.role`.
 *
 * `super_admin` is an ELEVATION on `admin` (migration 199, narrowed to one
 * holder by 207), not a role beside it: `user.role` stays `'admin'` so the
 * 468 `role === 'admin'` checks across the worker and every `guard([...])`
 * array in App.jsx keep passing unchanged. The shell therefore has to be
 * chosen on the flag, here, and NOTHING that decides access may read the
 * value this returns — it names a sidebar, not a permission.
 *
 * Three inputs, in order:
 *
 *   - `role` is the role the session is browsing AS (`resolveActiveRole`).
 *     An admin using "View as" to check a founder's experience must get the
 *     founder shell, or the switch shows them their own console back.
 *   - `user.is_super_admin` is the elevation, read straight off `/me`.
 *   - `hqView` is the super admin's own choice between the HQ shell and the
 *     plain admin shell — the "Super Admin" and "Admin" entries in the
 *     View-as list. It exists so the franchisor can see exactly what a
 *     subsidiary admin sees without impersonating anyone. Default on.
 *
 * Lives in lib/ so the app shell, SidebarNav and a plain node test can all
 * import it without a renderer — the same reason `lib/activeRole.js` is here.
 */

export const HQ_VIEW_KEY = 'hqView';

/** The elevation, as `/me` reports it. A missing column reads as 0. */
export function isSuperAdminUser(user) {
  return Number(user?.is_super_admin ?? 0) === 1;
}

export function shellRoleFor(role, user, hqView = true) {
  return role === 'admin' && Number(user?.is_super_admin ?? 0) === 1 && hqView ? 'super_admin' : role;
}

/** Storage-blocked browsers get the default, which is the HQ shell. */
export function readHqView() {
  try {
    const v = localStorage.getItem(HQ_VIEW_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export function writeHqView(on) {
  try { localStorage.setItem(HQ_VIEW_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
}

export function clearHqView() {
  try { localStorage.removeItem(HQ_VIEW_KEY); } catch { /* storage blocked */ }
}

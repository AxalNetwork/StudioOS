/**
 * The role a session is CURRENTLY BROWSING AS — which is not always `user.role`.
 *
 * Three inputs decide it:
 *
 *   - Impersonation wins outright: the impersonated user's own role is the
 *     whole point of impersonating them.
 *   - An admin using the "View as" switcher browses as `viewMode`. This is the
 *     case that bites. An admin previewing Investor View still has
 *     `user.role === 'admin'`, so any surface branching on `user.role` shows
 *     them the admin/founder experience while the sidebar chip says "Investor
 *     View" — the two disagree, and the page silently wins.
 *   - Everyone else browses as their own role.
 *
 * Lives in lib/ (not next to ViewModeContext) so it carries no React import:
 * the app shell picks the sidebar from it, the router picks route elements from
 * it, and a plain node test can pin it without a renderer. Those two callers
 * MUST agree — when they don't, the nav offers one thing and the route serves
 * another, which is exactly how the investor profile ended up with a
 * "Spin-Out Lab" nav item opening the founder program.
 *
 * @param {{user?: {role?: string}|null, realUser?: {role?: string}|null,
 *          viewMode?: string, isImpersonating?: boolean}} session
 * @returns {string|undefined} the active role, or undefined when signed out
 */
export function resolveActiveRole({ user, realUser, viewMode, isImpersonating } = {}) {
  if (isImpersonating) return user?.role;
  const isAdmin = (realUser || user)?.role === 'admin';
  return isAdmin ? viewMode : user?.role;
}

export default resolveActiveRole;

/**
 * D4473 (#4473) — the licences a session is browsing WITH, beside the role it
 * browses AS. `resolveActiveRole` keeps its meaning (the primary role, or the
 * previewed or impersonated one); this is the set the sidebar is built from and
 * the licence-owned routes are gated on.
 *
 *   - An admin's "View as" preview is the single previewed licence: `[viewMode]`.
 *   - An impersonation is the impersonated member's own `licences`.
 *   - Everyone else: `user.licences` (`/api/auth/me`, D4472), else `[user.role]`.
 *
 * @returns {string[]} never empty for a signed-in session with a role
 */
export function resolveHeldLicences({ user, realUser, viewMode, isImpersonating } = {}) {
  const own = (u) => (Array.isArray(u?.licences) && u.licences.length ? [...u.licences] : (u?.role ? [u.role] : []));
  if (isImpersonating) return own(user);
  const isAdmin = (realUser || user)?.role === 'admin';
  if (isAdmin) return viewMode ? [viewMode] : [];
  return own(user);
}

/**
 * D4473 — RoleGuard's admission rule: a route's list admits the role browsed as, or any licence held. `App.jsx`'s
 * RoleGuard calls it, and #9024 reads it from the Worker (`lib/growDistributionAccess.js`), so a link the Worker
 * offers is decided by the rule the route will apply.
 */
export function guardAdmits(allowedRoles, role, held = []) {
  return allowedRoles.includes(role) || held.some((l) => allowedRoles.includes(l));
}

/**
 * D7178 (#7044): the Research shell a page is drawn in, from the role browsed as and the licences held. The rule
 * lives in `lib/researchAccess.js` beside the admissions it reads; it is re-exported here, beside the two resolvers
 * it takes its inputs from, so the router reads it from the module it already reads them from.
 */
export { researchRoleFor } from './researchAccess.js';

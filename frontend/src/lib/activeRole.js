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

/**
 * Who sees the whole Learning center, and who sees "Coming soon" (D562).
 *
 * TEMPORARY, BY THE OWNER'S REQUEST ON 2026-10-06: "Build everything for
 * Learning, but put a temporary coming soon for Founder, Investor, Partner,
 * and Advisor profiles except articles please. As the content is not there
 * yet."
 *
 * TO LIFT IT, set `LEARNING_COMING_SOON` to `false`. That is the whole change:
 * every Learning screen asks `learningComingSoon()` and nothing else, so with
 * the switch off every profile gets the full Learning center. Then delete this
 * gate, its callers' coming-soon branches and `ComingSoonCard`, and record the
 * lift in a decision. Lift it once the content exists, which means the Learning
 * store (#1158) has merged and HQ has published courses into it.
 *
 * WHO IS GATED. Every profile that is not an admin: founder, investor,
 * partner, advisor, exploring, and any role added later. A gated profile keeps
 * Articles, which already have content: the article list, the reader and
 * "Write an article".
 *
 * WHO IS NOT. The admin and the Super Admin, so they can author and check
 * content before anyone else sees it. The Super Admin is an elevation on the
 * admin role, not a role of its own (`lib/shellRole.js`): `user.role` stays
 * `'admin'` and `is_super_admin` is the flag. So the one check that admits an
 * admin admits the Super Admin too, the same check `RoleGuard` and every
 * `guard(['admin'], …)` route make.
 *
 * THE ROLE IT ASKS ABOUT IS THE ONE BEING BROWSED (`lib/activeRole.js`). An
 * admin who uses "View as" to check the founder experience gets the founder's
 * page, coming-soon card and all: a page that read `user.role` instead would
 * show the admin's Learning center under a "Founder View" chip, which is the
 * disagreement `resolveActiveRole` exists to prevent. Impersonation needs no
 * special case: `user` is then the impersonated account.
 */

/** The switch. Temporary (owner, 2026-10-06): set to false when the content exists. */
export const LEARNING_COMING_SOON = true;

/** The one sentence a gated profile reads, wherever a Learning screen is closed to them. */
export const COMING_SOON_LINE = 'Courses, videos, webinars and more are coming soon. Articles are open now.';

/**
 * True when this profile sees "Coming soon" instead of the Learning center.
 *
 * @param {{ role?: string, is_super_admin?: number } | null | undefined} user
 * @param {string} [activeRole] the role the session browses as; `user.role` when absent.
 * @param {boolean} [gateOn] the switch; a parameter so the test can read the lifted gate.
 */
export function learningComingSoon(user, activeRole = user?.role, gateOn = LEARNING_COMING_SOON) {
  if (!gateOn) return false;
  // Admin and Super Admin: both carry the role 'admin' (see the header).
  return activeRole !== 'admin';
}

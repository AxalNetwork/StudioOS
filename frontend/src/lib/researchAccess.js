/**
 * D4612 — which Research destinations a reader may open, in one table.
 *
 * `App.jsx` admits each Research route with `guard(labRoles([...]))`. The
 * pages that link between those routes used to link unconditionally, so a
 * Markets reader (every licence) was offered company and fund profiles that
 * only some licences are admitted to, and the link opened a refusal. This
 * table restates the admissions, and `frontend/test/research_links_4612.test.mjs`
 * fails if it and `App.jsx` disagree, so the routes stay where they are and a
 * link is offered only where the route would let its reader in.
 *
 * `labRoles` admits any role while the user's Spin-Out Lab is active, and an
 * admin is admitted everywhere; `canOpenResearch` honours both. It widens
 * nothing: it is the route's own rule, read from the other end.
 */
const ALL = ['admin', 'founder', 'partner', 'investor', 'advisor'];
export const RESEARCH_ACCESS = Object.freeze({
  ask: ALL,
  markets: ALL,
  geographies: ALL,
  library: ALL,
  companies: ['admin', 'founder', 'advisor'],
  funds: ['admin', 'founder'],
  // #6265: these three are `adminToResearch(guard([...]))`, not labRoles: the
  // founder shell an admin browses Research as has none of them, and an active
  // Lab does not admit a role whose shell lacks them. No admin, no Lab shortcut.
  diligence: ['investor'],
  benchmarking: ['investor'],
  clientPrep: ['advisor', 'partner'],
});

/** The areas whose routes take a plain `guard`, so neither shortcut below applies. */
export const PLAIN_GUARD_AREAS = Object.freeze(['diligence', 'benchmarking', 'clientPrep']);

/**
 * D7178 (#7044, RS-16 B) — the licences a signed-in member holds, as `/api/auth/me` reports them (D4472), else their
 * role. An admin holds none here: an admin is the role browsed as, or the one licence previewed.
 */
export function heldResearchLicences(user) {
  if (!user || user.role === 'admin') return [];
  return Array.isArray(user.licences) && user.licences.length ? [...user.licences] : (user.role ? [user.role] : []);
}

/** True when `user` (its role, the page's research role, or a licence it holds) may open `area`. */
export function canOpenResearch(area, user, role = user?.role) {
  const roles = RESEARCH_ACCESS[area];
  if (!roles) return false;
  // D7178: held licences admit, the way RoleGuard does (D4473): an Investor who also holds Founder is offered the
  // company a Markets page names, because the Companies route admits that member.
  const held = heldResearchLicences(user).some((l) => roles.includes(l));
  if (PLAIN_GUARD_AREAS.includes(area)) return roles.includes(role || user?.role) || held;
  if (user?.role === 'admin') return true;
  if (user?.spinout_lab_active === 1 || user?.spinout_lab_active === true) return true;
  return roles.includes(role || user?.role) || held;
}

/** The order a held licence's Research shell is tried in: licence order (D4473). */
const SHELL_ORDER = Object.freeze(['founder', 'investor', 'advisor', 'partner']);

/** The Research area a path is in (`companies`, `funds`, `clientPrep`, …), or null for `/research` and unlisted paths. */
export function researchAreaOf(pathname) {
  const m = /^\/research\/([^/?#]+)/.exec(String(pathname || ''));
  if (!m) return null;
  const area = m[1] === 'client-prep' ? 'clientPrep' : m[1];
  return Object.prototype.hasOwnProperty.call(RESEARCH_ACCESS, area) ? area : null;
}

/**
 * D7178 (#7044) — THE ONE HELD-LICENCE RULE for a Research page: which shell it is drawn in. That shell gives the
 * zone list (`shellConfig.js` RESEARCH_ZONES), and the page's research role is what `canOpenResearch` and
 * `canAddToResearch` read, so the route, the zone list, the cross-links and the actions give one answer.
 *
 *   - An admin, or no role, reads as the founder, as before.
 *   - The role browsed as, wherever its own shell is admitted to the page's area: every page that worked before
 *     this rule is drawn as it was.
 *   - Otherwise the first held licence (licence order) whose shell is admitted: an Investor who also holds Founder
 *     reads Companies in the founder shell, with the founder's actions (the owner's answer A: actions are the union
 *     of held licences); a Partner who also holds Advisor reads Companies as the advisor; a Founder who also holds
 *     Investor reads Diligence as the investor. Before, each of these drew "Nothing serves this zone yet".
 *   - An active Lab admits the route without such a licence (`labRoles`); Companies and Funds then read in the
 *     founder shell, the one shell that lists both.
 *   - `/research` itself and unlisted paths keep the role browsed as, so each licence keeps its own Research home.
 */
export function researchRoleFor({ effectiveRole, heldLicences = [], pathname = '', labActive = false } = {}) {
  const base = (!effectiveRole || effectiveRole === 'admin') ? 'founder' : effectiveRole;
  const area = researchAreaOf(pathname);
  if (!area || effectiveRole === 'admin') return base;
  const roles = RESEARCH_ACCESS[area];
  const held = Array.isArray(heldLicences) ? heldLicences : [];
  if (roles.includes(base)) return base;
  const first = SHELL_ORDER.find((l) => held.includes(l) && roles.includes(l));
  if (first) return first;
  if (labActive && !PLAIN_GUARD_AREAS.includes(area)) return 'founder';
  return base;
}

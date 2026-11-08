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
  diligence: ['admin', 'investor'],
  benchmarking: ['admin', 'investor'],
  clientPrep: ['admin', 'advisor', 'partner'],
});

/** True when `user` (its role, or the page's research role) may open `area`. */
export function canOpenResearch(area, user, role = user?.role) {
  const roles = RESEARCH_ACCESS[area];
  if (!roles) return false;
  if (user?.role === 'admin') return true;
  if (user?.spinout_lab_active === 1 || user?.spinout_lab_active === true) return true;
  return roles.includes(role || user?.role);
}

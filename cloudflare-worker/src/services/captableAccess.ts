/**
 * Task #28 — Cap-table access scoping (pure, dependency-free).
 *
 * Centralises WHO may read/write a project's cap table so the simulator's
 * authorization matches Projects visibility exactly (mirrors
 * `routes/projects.ts::listProjectsHandler` and `routes/captable.ts`'s
 * `/captable/:projectId` read route):
 *
 *   - Project READ  → founder (own project only) · admin · partner · investor
 *   - Project WRITE → founder (own project only) · admin · partner
 *     (investors get masked, read-only project views everywhere else, so they
 *     never write a founder's cap-table model)
 *
 * A scenario row inherits its project's access when it is project-bound; a
 * scenario with no project_id stays private to its owner (legacy free
 * scenarios). Kept free of Worker/Hono imports so it unit-tests under the
 * --experimental-strip-types loader.
 */

export type AccessUser = { id: number; role?: string | null; founder_id?: number | null };
export type AccessProject = { founder_id?: number | null };
export type AccessScenario = { owner_user_id: number; project_id?: number | null };

function role(user: AccessUser): string {
  return (user.role || '').toLowerCase();
}

export function isAdmin(user: AccessUser): boolean {
  return role(user) === 'admin';
}

/** Founder owns the project when their founder_id matches the project's. */
function founderOwns(user: AccessUser, project: AccessProject): boolean {
  return project.founder_id != null && project.founder_id === user.founder_id;
}

/** Read access to a project (same scope as the Projects list dropdown). */
export function canReadProject(user: AccessUser, project: AccessProject): boolean {
  const r = role(user);
  if (r === 'admin' || r === 'partner' || r === 'investor') return true;
  if (r === 'founder') return founderOwns(user, project);
  return founderOwns(user, project); // unknown roles fall back to ownership
}

/** Write access to a project's cap table (investors excluded). */
export function canWriteProject(user: AccessUser, project: AccessProject): boolean {
  const r = role(user);
  if (r === 'admin' || r === 'partner') return true;
  if (r === 'founder') return founderOwns(user, project);
  return founderOwns(user, project);
}

/**
 * Read a scenario: its owner, an admin, or — when the scenario is bound to a
 * project — anyone who can read that project. `project` may be null when the
 * scenario has no project_id.
 */
export function canReadScenario(
  user: AccessUser,
  scenario: AccessScenario,
  project: AccessProject | null,
): boolean {
  if (scenario.owner_user_id === user.id) return true;
  if (isAdmin(user)) return true;
  if (scenario.project_id != null && project) return canReadProject(user, project);
  return false;
}

/**
 * Write a scenario: its owner, an admin, or — when project-bound — anyone with
 * write access to that project.
 */
export function canWriteScenario(
  user: AccessUser,
  scenario: AccessScenario,
  project: AccessProject | null,
): boolean {
  if (scenario.owner_user_id === user.id) return true;
  if (isAdmin(user)) return true;
  if (scenario.project_id != null && project) return canWriteProject(user, project);
  return false;
}

/** #2436: pure gates consume verified project membership answers. */
export type AccessUser = { id: number; role?: string | null; founder_id?: number | null };
export type AccessProject = { founder_id?: number | null; capRead?: boolean; capWrite?: boolean };
export type AccessScenario = { owner_user_id: number; project_id?: number | null };
export function isAdmin(user: AccessUser): boolean { return user.role?.toLowerCase() === 'admin'; }
function owns(user: AccessUser, project: AccessProject): boolean {
  return user.role?.toLowerCase() === 'founder' && !!user.founder_id && user.founder_id === project.founder_id;
}
export function canReadProject(user: AccessUser, project: AccessProject): boolean {
  if (user.role?.toLowerCase() === 'investor') return false;
  return isAdmin(user) || owns(user, project) || project.capRead === true;
}
export function canWriteProject(user: AccessUser, project: AccessProject): boolean {
  if (user.role?.toLowerCase() === 'investor') return false;
  return isAdmin(user) || owns(user, project) || project.capWrite === true;
}
export function canReadScenario(user: AccessUser, scenario: AccessScenario, project: AccessProject | null): boolean {
  if (scenario.project_id != null) return isAdmin(user) || (!!project && canReadProject(user, project));
  return isAdmin(user) || scenario.owner_user_id === user.id;
}
export function canWriteScenario(user: AccessUser, scenario: AccessScenario, project: AccessProject | null): boolean {
  if (scenario.project_id != null) return isAdmin(user) || (!!project && canWriteProject(user, project));
  return isAdmin(user) || scenario.owner_user_id === user.id;
}

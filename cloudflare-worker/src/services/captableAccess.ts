/** #2436: pure gates consume verified project membership answers. */
import type { Env } from '../types';
import { isSuperAdmin } from '../auth';
import { investorProjectIds } from '../routes/_investorProjectScope';
import { getProjectMembershipRole } from './projectAccess';
import { type AccessLevel, levelRank, widerLevel } from './captableShare';
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

// ---------------------------------------------------------------------------
// D1019 (#2856) — who sees what, per venture and level (CT13, CT15–CT18).
//
// NOTHING IS SEEN UNTIL THE FOUNDER GRANTS A LEVEL (D1015 §5, questions 3 and
// 4, read as A). The venture's owner and accepted co-founders read Full. An
// accepted advisor reads Summary unless granted otherwise. An investor reads
// only through a grant AND a relationship with the venture
// (`investorProjectIds`), never through `canReadProject`. An Operating Partner
// or anyone else reads only through a grant. A plain admin reads this
// deployment's ventures (a branch's database holds only its own studio's) as
// the group summary, and the full table only by opening it for support with a
// reason the founder sees. The Super Admin reads every venture, read only.
//
// A grant with a `holder_ref` sees at least that holder's own position, even
// when its level is None.
// ---------------------------------------------------------------------------


export type AccessVia = 'owner' | 'member' | 'grant' | 'studio' | 'support' | 'hq' | 'link';

export type LiveGrant = {
  id: number; project_id: number; user_id: number | null; holder_ref: string | null; level: AccessLevel;
  source: 'founder' | 'side_letter'; source_ref: string | null; granted_by: number; since: string;
};

export type Resolved =
  | { ok: true; level: Exclude<AccessLevel, 'none'>; via: AccessVia; read_only: boolean; holder_ref: string | null; owner: boolean; cofounder: boolean }
  | { ok: false; code: 'not_shared' | 'not_a_venture'; status: 403 | 404 };

/** The sentence CT15 draws for anyone the founder has not shared with. */
export const NOT_SHARED = 'The founder has not shared the cap table with you.';

export async function liveGrantFor(env: Env, projectId: number, userId: number): Promise<LiveGrant | null> {
  return env.DB.prepare(
    `SELECT id, project_id, user_id, holder_ref, level, source, source_ref, granted_by, since
       FROM cap_table_access_grants WHERE project_id = ? AND user_id = ? AND revoked_at IS NULL LIMIT 1`,
  ).bind(projectId, userId).first<LiveGrant>();
}

/** A grant's level, widened to Own position when it names the holder. None stays None without one. */
function grantLevel(g: LiveGrant | null): AccessLevel {
  if (!g) return 'none';
  return g.holder_ref ? widerLevel(g.level, 'own_position') : g.level;
}

/**
 * The caller's level on one venture, and how they hold it. A read that fails
 * throws, so a broken store is a 5xx, never an empty level.
 */
export async function resolveAccess(
  env: Env, user: AccessUser & { is_super_admin?: unknown }, project: { id: number; founder_id: number | null },
): Promise<Resolved> {
  const role = String(user.role ?? '').toLowerCase();
  const refused: Resolved = { ok: false, code: 'not_shared', status: 403 };
  if (role === 'admin') {
    return isSuperAdmin(user as any)
      ? { ok: true, level: 'full', via: 'hq', read_only: true, holder_ref: null, owner: false, cofounder: false }
      : { ok: true, level: 'summary', via: 'studio', read_only: true, holder_ref: null, owner: false, cofounder: false };
  }
  if (role === 'founder' && !!user.founder_id && user.founder_id === project.founder_id) {
    return { ok: true, level: 'full', via: 'owner', read_only: false, holder_ref: null, owner: true, cofounder: false };
  }
  if (role === 'investor') {
    const related = await investorProjectIds(env, user as any, null);
    if (!related || !related.includes(project.id)) return refused;
    const g = await liveGrantFor(env, project.id, user.id);
    const level = grantLevel(g);
    if (level === 'none') return refused;
    return { ok: true, level, via: 'grant', read_only: true, holder_ref: g?.holder_ref ?? null, owner: false, cofounder: false };
  }
  const member = await getProjectMembershipRole(env, project.id, user.id);
  if (member === 'owner' || member === 'cofounder') {
    return { ok: true, level: 'full', via: 'member', read_only: true, holder_ref: null, owner: false, cofounder: true };
  }
  const g = await liveGrantFor(env, project.id, user.id);
  if (member === 'advisor') {
    // An advisor reads Summary by default; a grant may widen or narrow it.
    const level = g ? grantLevel(g) : 'summary';
    if (level === 'none') return refused;
    return { ok: true, level, via: g ? 'grant' : 'member', read_only: true, holder_ref: g?.holder_ref ?? null, owner: false, cofounder: false };
  }
  const level = grantLevel(g);
  if (level === 'none') return refused;
  return { ok: true, level, via: 'grant', read_only: true, holder_ref: g?.holder_ref ?? null, owner: false, cofounder: false };
}

/** Whether `level` shows at least as much as `floor`. */
export function atLeast(level: AccessLevel, floor: AccessLevel): boolean {
  return levelRank(level) >= levelRank(floor);
}

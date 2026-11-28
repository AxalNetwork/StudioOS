/**
 * D9277 (#9277) — an Eadwyn conversation's space: exactly one company or one project, resolved and re-checked
 * against the member's access every time it is used.
 *
 * A space is `{ scope: 'company' | 'project', id }`. It is never inherited: a project that sits under a company is
 * not in that company's space, and a company space does not reach a project's own space, even when the member is in
 * both. The membership test for each kind is the platform's own:
 *   company  a `user_company_links` row for a company that is not archived (`resolveActiveCompany`, D1137);
 *   project  the project exists, is not in Trash, and `canAccessProject` lets the member read it.
 *
 * The API, for `/api/eadwyn` and for the advisor binding that reuses it (#9285):
 *   parseSpaceRef(scope, id)      a client's claim, shape-checked, or null. It grants nothing.
 *   spaceRefOfRow(row)            the space a stored row names (scope_kind / company_id / project_id), or null for a
 *                                 row with neither. A row the previous Worker wrote (company_id, no scope_kind) reads
 *                                 as company scope.
 *   spaceColumns(ref)             the three column values to store for a space (company XOR project).
 *   resolveSpace(env, user, ref)  the space with its name, if the member is in it NOW; null otherwise.
 *   recheckSpace(env, user, row)  `{ ok: true, space }`, or `{ ok: false, reason: 'no_space' | 'space_access_lost' }`.
 *   spaceChecker(env, user)       `recheckSpace` with one lookup per space per request, for lists.
 *   projectInSpace(space, p)      whether a project record is inside the space (its own project, or a project of
 *                                 the company). An unassigned project is in no company's space.
 *   publicSpace(space)            what a page shows: `{ scope, id, name }`.
 */
import type { Env, User } from '../types';
import { resolveActiveCompany } from '../middleware/activeCompany';
import { canAccessProject } from './projectAccess';

export type SpaceKind = 'company' | 'project';

/** A space as a client names it or a row stores it. Holding one proves nothing about access. */
export interface SpaceRef {
  scope: SpaceKind;
  id: number;
}

/** A space the member was found to be in, just now. */
export interface Space extends SpaceRef {
  /** The company's or the project's name, for the chat header; null when none is recorded. */
  name: string | null;
  /** The company whose connections a run may read: the company itself, or the project's own company (null when the
   *  project has none, so a connector gated by company reads nothing). */
  companyId: number | null;
  /** The project, for a project space; null for a company space. */
  projectId: number | null;
}

export interface SpaceColumns {
  scope_kind: SpaceKind;
  company_id: number | null;
  project_id: number | null;
}

/** What a stored row carries about its space. */
export interface SpaceRow {
  scope_kind?: string | null;
  company_id?: number | null;
  project_id?: number | null;
}

export type SpaceCheck =
  | { ok: true; space: Space }
  | { ok: false; reason: 'no_space' | 'space_access_lost' };

/** The members' sentences for the space refusals the Eadwyn routes send. */
export const SPACE_REFUSALS = Object.freeze({
  space_invalid: 'Name one company or one project for this conversation.',
  space_required: 'Open a company or a project first: a conversation belongs to one of them.',
  space_not_member: 'You are not a member of that company or project, so nothing was started or listed.',
  space_access_lost: 'You no longer have access to the company or project this conversation belongs to, so nothing was run or sent.',
  no_space: 'This conversation belongs to no company or project. You can read it, but start a new one to ask or send.',
});

function positiveId(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^[0-9]{1,15}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A client's `{ scope, id }`, shape-checked: 'company' or 'project' and a positive whole id. Null otherwise. */
export function parseSpaceRef(scope: unknown, id: unknown): SpaceRef | null {
  if (scope !== 'company' && scope !== 'project') return null;
  const n = positiveId(id);
  return n === null ? null : { scope, id: n };
}

/** The space a stored row names, or null for a row with neither company nor project. */
export function spaceRefOfRow(row: SpaceRow | null | undefined): SpaceRef | null {
  if (!row) return null;
  const company = positiveId(row.company_id ?? null);
  const project = positiveId(row.project_id ?? null);
  if (row.scope_kind === 'project') return project === null ? null : { scope: 'project', id: project };
  if (row.scope_kind === 'company') return company === null ? null : { scope: 'company', id: company };
  // The previous Worker writes company_id without scope_kind (a rollback): that is company scope.
  if (row.scope_kind == null && project === null && company !== null) return { scope: 'company', id: company };
  return null;
}

/** The columns a row stores for a space: company XOR project, as the migration's triggers require. */
export function spaceColumns(ref: SpaceRef): SpaceColumns {
  return ref.scope === 'company'
    ? { scope_kind: 'company', company_id: ref.id, project_id: null }
    : { scope_kind: 'project', company_id: null, project_id: ref.id };
}

export function sameSpace(a: SpaceRef | null | undefined, b: SpaceRef | null | undefined): boolean {
  return !!a && !!b && a.scope === b.scope && a.id === b.id;
}

type Member = Pick<User, 'id' | 'role' | 'founder_id'>;

/**
 * The space, if the member is in it now. Membership is re-read on every call; nothing is cached across requests.
 * Null when the member is not in it, or it no longer exists (an archived company, a project in Trash).
 */
export async function resolveSpace(env: Env, user: Member, ref: SpaceRef | null | undefined): Promise<Space | null> {
  if (!ref) return null;
  if (ref.scope === 'company') {
    if ((await resolveActiveCompany(env, user, String(ref.id))) !== ref.id) return null;
    const row = await env.DB.prepare('SELECT company_name FROM company_profiles WHERE id = ?')
      .bind(ref.id).first<{ company_name: string | null }>();
    return { scope: 'company', id: ref.id, name: row?.company_name ?? null, companyId: ref.id, projectId: null };
  }
  const project = await env.DB.prepare('SELECT id, name, founder_id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL')
    .bind(ref.id).first<{ id: number; name: string | null; founder_id: number | null; company_id: number | null }>();
  if (!project) return null;
  if (!(await canAccessProject(env, user, project))) return null;
  return { scope: 'project', id: ref.id, name: project.name ?? null, companyId: project.company_id ?? null, projectId: ref.id };
}

/** A stored row's space, re-checked now. */
export async function recheckSpace(env: Env, user: Member, row: SpaceRow | null | undefined): Promise<SpaceCheck> {
  const ref = spaceRefOfRow(row);
  if (!ref) return { ok: false, reason: 'no_space' };
  const space = await resolveSpace(env, user, ref);
  return space ? { ok: true, space } : { ok: false, reason: 'space_access_lost' };
}

/** `recheckSpace` for a list: one checker per request, and each distinct space in it is looked up once. */
export function spaceChecker(env: Env, user: Member): (row: SpaceRow | null | undefined) => Promise<SpaceCheck> {
  const seen = new Map<string, Promise<Space | null>>();
  return async (row) => {
    const ref = spaceRefOfRow(row);
    if (!ref) return { ok: false, reason: 'no_space' };
    const key = `${ref.scope}:${ref.id}`;
    if (!seen.has(key)) seen.set(key, resolveSpace(env, user, ref));
    const space = await seen.get(key)!;
    return space ? { ok: true, space } : { ok: false, reason: 'space_access_lost' };
  };
}

/** Whether a project record is inside the space: the space's own project, or a project assigned to the company. */
export function projectInSpace(space: Space, project: { id: number; company_id?: number | null } | null | undefined): boolean {
  if (!project) return false;
  if (space.scope === 'project') return Number(project.id) === space.id;
  return project.company_id != null && Number(project.company_id) === space.id;
}

export function publicSpace(space: Space | null | undefined): { scope: SpaceKind; id: number; name: string | null } | null {
  return space ? { scope: space.scope, id: space.id, name: space.name } : null;
}

/**
 * D4676 (#4676, Pipeline audit 1 of 6) — who may do what to a Pipeline
 * project, decided in ONE place and asked by every door: the board's list and
 * its enrichment, the detail read, every write, and the realtime room.
 *
 * WHY. The list returned every project, with its latest metrics, its gate's
 * recommendation and its task counts, to any signed-in account that was not a
 * founder; the detail read refused the same accounts. Writes checked a scalar
 * role and never the project, so an operating partner could advance, score or
 * decide any venture's gate — including one they could not open. The realtime
 * room admitted any partner or investor to any deal and sent board events to
 * them whatever they could read.
 *
 * THE RULE IS THE PROJECT RULE (`services/projectAccess.ts`, D889). Pipeline
 * adds no second idea of who belongs to a venture:
 *
 *   read     an admin; the founder who owns the project (founder licence and
 *            `users.founder_id = projects.founder_id`); an accepted project
 *            member (owner, co-founder or advisor). An account holding ONLY
 *            the investor licence reads nothing here: its view of a venture is
 *            the masked, NDA-gated one on the project routes.
 *   edit     MVP tasks and metrics snapshots;
 *   review   opening a decision-gate review and advancing the stage;
 *   spinout  deciding a gate, whose `passed` moves the venture to spin-out.
 *            For all three: an admin, or an account holding the PARTNER licence
 *            that is an accepted owner or co-founder member of THIS project.
 *            The three are named separately because they are separate acts;
 *            today one rule answers all three, and it is the operator rule the
 *            route always had (admins and partners), now held to the project.
 *
 * NOTHING HERE WIDENS A WRITE. Before D4676 a partner could write to every
 * project and a founder to none; after it a partner writes only where they are
 * a member, and a founder still writes to none. Reads follow the project rule,
 * so a member reads their venture's pipeline as they already read the venture.
 *
 * LICENCES, NOT ONE ROLE. Every check reads the licences the account holds
 * (`holdsLicence`), so an account that is both a founder and a partner keeps
 * both: its own ventures to read, and the ventures it is a member of to read
 * and, as a partner, to operate.
 *
 * IDENTITY. A project's owner is a FOUNDER PROFILE (`projects.founder_id` =
 * `founders.id`); an account is a user (`users.id`), tied to a profile by
 * `users.founder_id`. Ownership compares `user.founder_id` with
 * `project.founder_id`, never `user.id` — the two ranges overlap, and an
 * account whose id equals some founder's profile id owns nothing by that.
 */
import type { Env, User } from '../types';
import { holdsLicence, holdsOnlyLicence } from './accountLicences';
import { ensureProjectMembershipSchema, type MemberRole } from './projectAccess';

export type PipelineCapability = 'read' | 'edit' | 'review' | 'spinout';
export const PIPELINE_CAPABILITIES: readonly PipelineCapability[] = ['read', 'edit', 'review', 'spinout'];

export type PipelinePrincipal = Pick<User, 'id' | 'role' | 'founder_id'> & { licences?: readonly string[] };
export type PipelineProject = { id: number; founder_id: number | null };

const OPERATOR_MEMBER_ROLES: ReadonlySet<MemberRole> = new Set(['owner', 'cofounder']);

/** The account's accepted membership role on the project, or null. One read. */
async function memberRole(env: Env, projectId: number, userId: number): Promise<MemberRole | null> {
  await ensureProjectMembershipSchema(env);
  const row = await env.DB.prepare(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ? AND status = 'accepted' LIMIT 1",
  ).bind(projectId, userId).first<{ role: MemberRole }>();
  return row ? row.role : null;
}

/** True iff the account owns the project as its founder (profile id, never account id). */
export function ownsAsFounder(user: PipelinePrincipal, project: PipelineProject): boolean {
  return holdsLicence(user, 'founder') && user.founder_id != null && project.founder_id != null
    && Number(user.founder_id) === Number(project.founder_id);
}

/**
 * Every capability the account holds on one project. One membership read
 * answers all four, so a door that needs two asks once.
 */
export async function pipelineCapabilities(
  env: Env, user: PipelinePrincipal, project: PipelineProject,
): Promise<Record<PipelineCapability, boolean>> {
  if (user.role === 'admin') return { read: true, edit: true, review: true, spinout: true };
  const none = { read: false, edit: false, review: false, spinout: false };
  if (holdsOnlyLicence(user, 'investor')) return none;
  const owns = ownsAsFounder(user, project);
  const role = await memberRole(env, project.id, user.id);
  const read = owns || role !== null;
  const operate = holdsLicence(user, 'partner') && role !== null && OPERATOR_MEMBER_ROLES.has(role);
  return { read, edit: operate, review: operate, spinout: operate };
}

export async function pipelineCan(
  env: Env, user: PipelinePrincipal, project: PipelineProject, capability: PipelineCapability,
): Promise<boolean> {
  return (await pipelineCapabilities(env, user, project))[capability];
}

/**
 * The projects the account may READ, as the list needs them: `all` for an
 * admin, otherwise the founder profile it owns through (or null) and the
 * projects it is an accepted member of. The list's own query applies them,
 * with its company and closed-venture filters, so the page, its total and its
 * enrichment are all drawn from exactly this set.
 */
export type ReadableScope =
  | { all: true }
  | { all: false; founderId: number | null; memberIds: number[] };

export async function readablePipelineScope(env: Env, user: PipelinePrincipal): Promise<ReadableScope> {
  if (user.role === 'admin') return { all: true };
  if (holdsOnlyLicence(user, 'investor')) return { all: false, founderId: null, memberIds: [] };
  const founderId = holdsLicence(user, 'founder') && user.founder_id != null ? Number(user.founder_id) : null;
  await ensureProjectMembershipSchema(env);
  const rows = await env.DB.prepare(
    "SELECT project_id FROM project_members WHERE user_id = ? AND status = 'accepted'",
  ).bind(user.id).all<{ project_id: number }>();
  const memberIds = [...new Set((rows.results || []).map((r) => Number(r.project_id)).filter(Number.isInteger))];
  return { all: false, founderId, memberIds };
}

/** The project a Pipeline row belongs to, read for an access decision. Null when it does not exist. */
export async function pipelineProject(env: Env, projectId: number): Promise<PipelineProject | null> {
  if (!Number.isInteger(projectId) || projectId <= 0) return null;
  const row = await env.DB.prepare('SELECT id, founder_id FROM projects WHERE id = ?').bind(projectId).first<PipelineProject>();
  return row ? { id: Number(row.id), founder_id: row.founder_id == null ? null : Number(row.founder_id) } : null;
}

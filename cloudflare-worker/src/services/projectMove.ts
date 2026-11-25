/**
 * D1415 Part 3 (#3855) — the one place `projects.company_id` is written: a
 * venture moved into a company, out of one, or between two. It returns the
 * statements, bound and not run, so each caller batches them with its own
 * change: the move route (`routes/project_lifecycle.ts`) runs them alone; the
 * filing (`incorporationCompany.ts`) runs them in the batch that creates the
 * company. #3850 (S07, agent engine E6) adds its transfer statements here:
 * the agent engine's goals and tasks change in the same batch as the move.
 *
 * Every move writes its `project_move` membership event in the same batch, so
 * a move without its record cannot land.
 */
import type { Env } from '../types';
import { membershipEvent } from './companyMembershipEvents';
import { retireSlug } from './slugs';
import { followupStatement, transferStatements } from './agents/transfer';

/** The owner's account: the oldest user on the venture's founders row, as `projects.ts` resolves it. */
export async function ownerUserId(env: Pick<Env, 'DB'>, founderId: number | null): Promise<number | null> {
  if (founderId == null) return null;
  const row = await env.DB.prepare('SELECT id FROM users WHERE founder_id = ? ORDER BY id ASC LIMIT 1').bind(founderId).first<{ id: number }>();
  return row ? Number(row.id) : null;
}

export type ProjectMove = {
  projectId: number;
  from: number | null;
  actorUserId: number;
  /** The venture's slug: retired in its old scope in the same batch, so the old address still resolves (D1415). */
  slug?: string | null;
} & (
  /**
   * A company that exists now, or null to take the venture out of its company.
   * `owner` is the owner account the route checked against `to` (D8525): the
   * batch commits only while that account still belongs to `to`.
   */
  | { to: number | null; owner?: number | null }
  /**
   * A company created earlier in the same batch, named by its uid, and only
   * while the formation order `orderId` is filed and not yet linked: the guard
   * every statement of the filing batch carries (`incorporationCompany.ts`).
   */
  | { toNewCompanyUid: string; orderId: number }
);

/** The move's UPDATE, its `project_move` event and, for a venture with a slug, the old address retired. */
export function projectMoveStatements(env: Pick<Env, 'DB'>, m: ProjectMove): D1PreparedStatement[] {
  const retired = m.slug ? [retireSlug(env as Env, 'project', m.slug, m.projectId, m.from, m.actorUserId)] : [];
  if ('toNewCompanyUid' in m) {
    const before = JSON.stringify({ company_id: m.from });
    return [
      env.DB.prepare(
        `UPDATE projects SET company_id = (SELECT id FROM company_profiles WHERE uid = ?)
          WHERE id = ? AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`,
      ).bind(m.toNewCompanyUid, m.projectId, m.orderId),
      env.DB.prepare(
        `INSERT INTO company_membership_events (company_id, project_id, actor_user_id, target_user_id, kind, before_json, after_json)
         SELECT cp.id, ?, ?, NULL, 'project_move', ?, json_object('company_id', cp.id)
           FROM company_profiles cp
          WHERE cp.uid = ? AND EXISTS (SELECT 1 FROM incorporations WHERE id = ? AND status = 'filed' AND company_id IS NULL)`,
      ).bind(m.projectId, m.actorUserId, before, m.toNewCompanyUid, m.orderId),
      ...retired,
      // #3850: a venture filed into a new company leaves no company, so this adds nothing today; kept for the rule.
      ...transferStatements(env, { projectId: m.projectId, from: m.from, to: null, actorUserId: m.actorUserId }),
    ];
  }
  return [
    // D8525: compare and set. Everything below was decided against what the
    // route read; the first statement aborts the whole batch unless it is still
    // so, and nothing is written. The UPDATE carries the same condition.
    moveGuard(env, m),
    env.DB.prepare('UPDATE projects SET company_id = ? WHERE id = ? AND company_id IS ? AND slug IS ?')
      .bind(m.to, m.projectId, m.from, m.slug ?? null),
    // D8535 (#8535): the venture's data-room grants were given under the company it leaves; a move ends them, in the
    // same batch, as the owner's revoke does (`status = 'revoked'`). The owner shares the room again from its new home.
    env.DB.prepare(`UPDATE data_room_grants SET status = 'revoked', updated_at = ? WHERE project_id = ? AND status = 'active'`)
      .bind(new Date().toISOString(), m.projectId),
    membershipEvent(env, {
      kind: 'project_move', projectId: m.projectId, companyId: m.to ?? m.from, actorUserId: m.actorUserId,
      before: { company_id: m.from }, after: { company_id: m.to },
    }),
    ...retired,
    // #3850 (E6): the agent engine's side, committed with the move or not at all.
    ...transferStatements(env, { projectId: m.projectId, from: m.from, to: m.to, actorUserId: m.actorUserId }),
    // D8525: the step after the move is owed from here; the last statement, so its row id is the batch's last.
    followupStatement(env, { projectId: m.projectId, from: m.from, to: m.to, actorUserId: m.actorUserId }),
  ];
}

/** The marker the guards below abort with; `isStale` reads it back from the batch's error. */
export const STALE = 'project_conflict';
/** True for the error a guard's abort raises (SQLite: `malformed JSON`, the marker's text). */
export const isStale = (e: unknown) => /malformed JSON|project_conflict/i.test(String((e as Error)?.message ?? e));

/**
 * D8525: the move's guard. It aborts the batch (`json()` over the bound marker,
 * which is not JSON: the repository's idiom, `team_skills.ts`) unless the venture still sits in
 * `from` with the slug the route read, the company it leaves is not archived,
 * and the company it goes to exists, is not archived and, when the caller
 * names the owner it checked (the move route always does), still has them.
 */
function moveGuard(env: Pick<Env, 'DB'>, m: { projectId: number; from: number | null; to: number | null; slug?: string | null; owner?: number | null }) {
  return env.DB.prepare(
    `SELECT CASE WHEN
        EXISTS (SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL AND company_id IS ? AND slug IS ?)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM company_profiles WHERE id = ? AND COALESCE(archived_at, '') = ''))
        AND (? IS NULL OR (EXISTS (SELECT 1 FROM company_profiles WHERE id = ? AND COALESCE(archived_at, '') = '')
                           AND (? IS NULL OR EXISTS (SELECT 1 FROM user_company_links WHERE user_id = ? AND company_id = ?))))
      THEN 1 ELSE json(?) END AS current`,
  ).bind(m.projectId, m.from, m.slug ?? null, m.from, m.from, m.to, m.to, m.owner ?? null, m.owner ?? null, m.to, STALE);
}

/** D8525: the rename's guard: the venture still sits in `scope` with the slug the route read. */
export function renameGuard(env: Pick<Env, 'DB'>, projectId: number, scope: number | null, previous: string | null) {
  return env.DB.prepare(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM projects WHERE id = ? AND deleted_at IS NULL AND company_id IS ? AND slug IS ?)
      THEN 1 ELSE json(?) END AS current`,
  ).bind(projectId, scope, previous, STALE);
}

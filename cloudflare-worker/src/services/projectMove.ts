/**
 * D1415 Part 3 (#3855) — the one place `projects.company_id` is written: a
 * venture moved into a company, out of one, or between two. It returns the
 * statements, bound and not run, so each caller batches them with its own
 * change: the move route (`routes/project_lifecycle.ts`) runs them alone; the
 * filing (`incorporationCompany.ts`) runs them in the batch that creates the
 * company. #3850 (S07, agent engine E6) adds its transfer statements here.
 *
 * Every move writes its `project_move` membership event in the same batch, so
 * a move without its record cannot land.
 */
import type { Env } from '../types';
import { membershipEvent } from './companyMembershipEvents';
import { retireSlug } from './slugs';

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
  /** A company that exists now, or null to take the venture out of its company. */
  | { to: number | null }
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
    ];
  }
  return [
    env.DB.prepare('UPDATE projects SET company_id = ? WHERE id = ?').bind(m.to, m.projectId),
    membershipEvent(env, {
      kind: 'project_move', projectId: m.projectId, companyId: m.to ?? m.from, actorUserId: m.actorUserId,
      before: { company_id: m.from }, after: { company_id: m.to },
    }),
    ...retired,
  ];
}

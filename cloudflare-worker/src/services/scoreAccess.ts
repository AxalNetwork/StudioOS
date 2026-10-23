import type { Env, User } from '../types';
import { userMayReadDeal } from '../routes/deals';

/** A project is visible to an investor only through an existing readable deal. */
export async function mayReadProjectDeal(env: Env, user: User, projectId: number): Promise<boolean> {
  const deals = await env.DB.prepare('SELECT id FROM deals WHERE project_id = ?').bind(projectId).all<{ id: number }>();
  for (const deal of deals.results || []) {
    if (await userMayReadDeal(env, user, deal.id)) return true;
  }
  return false;
}

/** External readers get bare scores only for members of ventures on readable deals. */
export async function mayReadTrustScores(env: Env, user: User, ids: number[]): Promise<boolean> {
  if (user.role === 'admin') return true;
  const others = ids.filter(id => id !== user.id);
  if (!others.length) return true;
  if (user.role !== 'partner' && user.role !== 'investor') return false;
  const rows = await env.DB.prepare(`
    SELECT DISTINCT u.id AS user_id, d.id AS deal_id
      FROM users u JOIN projects p ON (
        (u.role IN ('founder', 'exploring') AND u.founder_id IS NOT NULL AND p.founder_id = u.founder_id)
        OR EXISTS (SELECT 1 FROM user_company_links l WHERE l.user_id = u.id AND l.company_id = p.company_id)
      ) JOIN deals d ON d.project_id = p.id
     WHERE u.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
       AND p.deleted_at IS NULL
  `).bind(JSON.stringify(others)).all<{ user_id: number; deal_id: number }>();
  const allowed = new Set<number>();
  const cache = new Map<number, boolean>();
  for (const row of rows.results || []) {
    if (!cache.has(row.deal_id)) cache.set(row.deal_id, await userMayReadDeal(env, user, row.deal_id));
    if (cache.get(row.deal_id)) allowed.add(Number(row.user_id));
  }
  return others.every(id => allowed.has(id));
}

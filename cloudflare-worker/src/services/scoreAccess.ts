import type { Env, User } from '../types';
import { userMayReadDeal, userReadableDealIds } from '../routes/deals';

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
    SELECT u.id AS user_id, d.id AS deal_id
      FROM users u JOIN projects p ON p.founder_id = u.founder_id
      JOIN deals d ON d.project_id = p.id
     WHERE u.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
       AND u.role IN ('founder','exploring') AND u.founder_id IS NOT NULL
       AND p.deleted_at IS NULL
    UNION
    SELECT l.user_id, d.id AS deal_id
      FROM user_company_links l JOIN projects p ON p.company_id = l.company_id
      JOIN deals d ON d.project_id = p.id
     WHERE l.user_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
       AND p.deleted_at IS NULL
  `).bind(JSON.stringify(others), JSON.stringify(others)).all<{ user_id: number; deal_id: number }>();
  const candidates = rows.results || [];
  const readable = await userReadableDealIds(env, user, candidates.map(row => row.deal_id));
  const allowed = new Set<number>();
  for (const row of candidates) {
    if (readable.has(Number(row.deal_id))) allowed.add(Number(row.user_id));
  }
  return others.every(id => allowed.has(id));
}

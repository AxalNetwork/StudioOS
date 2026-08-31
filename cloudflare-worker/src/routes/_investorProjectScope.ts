import type { Env, User } from '../types';
import { ensureInvestorPaywallSchema } from '../middleware/requireInvestorTier';
import { isInvestor } from './_t13t14t15_helpers';

/**
 * Projects an investor has an explicit relationship with. Operators return
 * null, meaning "use the route's normal portfolio-wide scope".
 */
export async function investorProjectIds(env: Env, user: User): Promise<number[] | null> {
  if (!isInvestor(user)) return null;
  await ensureInvestorPaywallSchema(env);

  const seatOwner = await env.DB.prepare(
    'SELECT investor_seat_primary_user_id FROM users WHERE id = ?',
  ).bind(user.id).first<{ investor_seat_primary_user_id: number | null }>().catch(() => null);
  const investorId = Number(seatOwner?.investor_seat_primary_user_id || user.id);

  const ids = new Set<number>();
  const related = await env.DB.prepare(
    `SELECT d.project_id
       FROM investor_dealroom_members m
       JOIN deals d ON d.id = m.deal_id
      WHERE m.investor_user_id = ? AND d.project_id IS NOT NULL
     UNION
     SELECT project_id
       FROM investor_introductions
      WHERE investor_user_id = ? AND project_id IS NOT NULL`,
  ).bind(investorId, investorId).all<{ project_id: number }>();
  for (const row of related.results || []) ids.add(Number(row.project_id));

  const converted = await env.DB.prepare(
    `SELECT d.project_id
       FROM watchlist_items w
       JOIN deals d ON d.id = w.converted_deal_id
      WHERE w.owner_user_id = ? AND d.project_id IS NOT NULL`,
  ).bind(investorId).all<{ project_id: number }>().catch(() => ({ results: [] as { project_id: number }[] }));
  for (const row of converted.results || []) ids.add(Number(row.project_id));
  return [...ids].filter(Number.isFinite);
}

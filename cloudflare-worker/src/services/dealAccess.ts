import type { Env } from '../types';

/** D1149: a room request never grants investor access. */
export async function investorHasDealRelationship(env: Env, userId: number, dealId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS allowed FROM deals d WHERE d.id = ? AND (
      EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id AND i.investor_user_id = ?)
      OR EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id AND k.investor_user_id = ?))`
  ).bind(dealId, userId, userId).first();
  return !!row;
}

/** Diligence uses exactly the same relationship as the deal page. */
export async function investorHasProjectDeal(env: Env, userId: number, projectId: number): Promise<boolean> {
  const rows = await env.DB.prepare('SELECT id FROM deals WHERE project_id = ?').bind(projectId).all<{ id: number }>();
  for (const row of rows.results || []) {
    if (await investorHasDealRelationship(env, userId, row.id)) return true;
  }
  return false;
}

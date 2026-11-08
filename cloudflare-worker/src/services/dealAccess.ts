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

/*
 * D4631 (#4631) — ONE deal-relative audience, decided from the caller's relationship to THIS deal and the
 * licences they hold, never from their primary role alone. A second licence adds access (D4472's union) but
 * never changes what a given relationship may see:
 *
 *   staff     the platform admin, or a holder of the partner licence     every field, every investor named;
 *                                                                         the venture's NDA still binds a partner
 *   owner     the founder of the deal's own venture                       every investor named; no studio-internal fields
 *   investor  an invited or committed investor (the relationship above)  their own rows and firm; no other investor named
 *   none      anyone else                                                 refused (the readers 403/404 as today)
 *
 * Staff wins over owner, and owner over investor, so a founder who also holds the investor licence reads their
 * own venture's deal as its owner, and another venture's deal as an investor. Studio-internal fields (the deal
 * team's notes, a pass's note and who passed) leave only to staff.
 */
import type { User } from '../types';
import { canAccessFounderResource } from '../auth';
import { holdsLicence } from './accountLicences';

export type DealAudience = 'staff' | 'owner' | 'investor' | 'none';

/** The studio's deal staff: the platform admin, or a holder of the partner licence. */
export const isDealStaff = (user: User) => user.role === 'admin' || holdsLicence(user as any, 'partner');

export async function dealAudience(env: Env, user: User, dealId: number, projectFounderId: number | null | undefined): Promise<DealAudience> {
  if (isDealStaff(user)) return 'staff';
  if (projectFounderId != null && canAccessFounderResource(user, projectFounderId)) return 'owner';
  if (holdsLicence(user as any, 'investor') && await investorHasDealRelationship(env, Number(user.id), dealId)) return 'investor';
  return 'none';
}

/** Whether this audience may see every investor's name and amount on the deal. */
export const namesInvestors = (a: DealAudience) => a === 'staff' || a === 'owner';
/** Whether this audience may see the studio's internal fields. */
export const seesStudioInternals = (a: DealAudience) => a === 'staff';
/**
 * Whether the caller is exempt from the venture's NDA: the platform admin, or the venture's own founder. An
 * Operating Partner reads every deal (#2460 keeps them outside members, not studio staff), so they sign the NDA.
 */
export const ndaExempt = (a: DealAudience, user: User) => user.role === 'admin' || a === 'owner';

/**
 * The venture's pairwise NDA with this reader: the founder as party A, the reader as party B, active and not past
 * its validity. The same directional pair the deal's team, market and traction sections already read.
 */
export async function hasActiveDealNda(env: Env, readerId: number, projectFounderId: number | null | undefined): Promise<boolean> {
  if (projectFounderId == null) return false;
  const founder = await env.DB.prepare('SELECT id FROM users WHERE founder_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY id LIMIT 1')
    .bind(projectFounderId).first<{ id: number }>();
  if (!founder) return false;
  const nda = await env.DB.prepare('SELECT status, valid_until FROM pairwise_ndas WHERE party_a_user_id = ? AND party_b_user_id = ? LIMIT 1')
    .bind(founder.id, readerId).first<{ status: string; valid_until: string | null }>();
  return !!nda && nda.status === 'active' && !(nda.valid_until && !(Date.parse(nda.valid_until) > Date.now()));
}

/** The firms the caller belongs to: what an investor may see of a deal's money is their own firms' share. */
export async function userFirmIds(env: Env, userId: number): Promise<number[]> {
  const rows = await env.DB.prepare('SELECT DISTINCT company_id FROM user_company_links WHERE user_id = ? AND company_id IS NOT NULL')
    .bind(userId).all<{ company_id: number }>();
  return (rows.results || []).map((r) => Number(r.company_id));
}

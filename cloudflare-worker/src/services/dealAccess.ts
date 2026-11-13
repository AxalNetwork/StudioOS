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

/**
 * The founder of the deal's own venture, whatever else they hold: the `owner` relationship, read without the staff
 * precedence, for the writes only the venture may make (D4631 part 2: sharing its deck on the deal). The admin is
 * not the venture's founder; a caller that admits the admin as well says so itself.
 */
export const isDealOwner = (user: User, projectFounderId: number | null | undefined) =>
  user.role !== 'admin' && projectFounderId != null && canAccessFounderResource(user, projectFounderId);

export async function dealAudience(env: Env, user: User, dealId: number, projectFounderId: number | null | undefined): Promise<DealAudience> {
  if (isDealStaff(user)) return 'staff';
  if (isDealOwner(user, projectFounderId)) return 'owner';
  if (holdsLicence(user as any, 'investor') && await investorHasDealRelationship(env, Number(user.id), dealId)) return 'investor';
  return 'none';
}

/**
 * D4631 part 2: `dealAudience` for a list of deals in one read, by the same rule and the same precedence. Each row
 * names its deal and its venture's founder id; the investor relationship is one batched, bound statement.
 */
export async function dealAudiences(env: Env, user: User, deals: Array<{ id: number; founder_id: number | null | undefined }>): Promise<Map<number, DealAudience>> {
  const out = new Map<number, DealAudience>();
  if (isDealStaff(user)) { for (const d of deals) out.set(Number(d.id), 'staff'); return out; }
  const ids = [...new Set(deals.map((d) => Number(d.id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  const related = new Set<number>();
  if (ids.length && holdsLicence(user as any, 'investor')) {
    const rows = await env.DB.prepare(
      `SELECT d.id FROM deals d WHERE d.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?)) AND (
         EXISTS (SELECT 1 FROM deal_invitations i WHERE i.deal_id = d.id AND i.investor_user_id = ?)
         OR EXISTS (SELECT 1 FROM commitments k WHERE k.deal_id = d.id AND k.investor_user_id = ?))`,
    ).bind(JSON.stringify(ids), Number(user.id), Number(user.id)).all<{ id: number }>();
    for (const r of rows.results || []) related.add(Number(r.id));
  }
  for (const d of deals) {
    const id = Number(d.id);
    out.set(id, isDealOwner(user, d.founder_id) ? 'owner' : related.has(id) ? 'investor' : 'none');
  }
  return out;
}

/** Whether this audience may see every investor's name and amount on the deal. */
export const namesInvestors = (a: DealAudience) => a === 'staff' || a === 'owner';
/** Whether this audience may see the studio's internal fields. */
export const seesStudioInternals = (a: DealAudience) => a === 'staff';
/**
 * Whether the caller is exempt from the venture's NDA: the platform admin, or the venture's own founder. An
 * Operating Partner reads every deal (#2460 keeps them outside members, not studio staff), so they sign the NDA.
 */
export const ndaExempt = (user: User, projectFounderId: number | null | undefined) =>
  user.role === 'admin' || isDealOwner(user, projectFounderId);

/*
 * D4631 part 2 — THE venture's NDA: one rule for every surface that reads it (the deal's sections and documents,
 * the data room's listing, download and record, the investor's evidence pack, the Research diligence list and a
 * round call's room). In force means a `pairwise_ndas` row with an ACTIVE account of the venture's founder as
 * party A and the reader as party B, `status = 'active'`, and no `valid_until` or one later than now as SQLite's
 * `datetime()` reads it (a date it cannot read is not in force). Every other status (pending, partially signed,
 * expired, revoked) is not an NDA in force. The three helpers are the same predicate keyed three ways; each
 * statement is literal and binds every value.
 */

/** The venture's NDA with this reader, keyed by the venture's founder id (the deal surfaces). */
export async function hasActiveDealNda(env: Env, readerId: number, projectFounderId: number | null | undefined): Promise<boolean> {
  if (projectFounderId == null) return false;
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM pairwise_ndas n JOIN users owner ON owner.id = n.party_a_user_id
      WHERE owner.founder_id = ? AND COALESCE(owner.is_active, 1) = 1 AND n.party_b_user_id = ?
        AND n.status = 'active' AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))
      LIMIT 1`,
  ).bind(projectFounderId, readerId).first();
  return !!row;
}

/** The venture's NDA with this reader, keyed by the venture's project id (the data room and the evidence pack). */
export async function hasActiveVentureNda(env: Env, projectId: number, readerId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM pairwise_ndas n JOIN users owner ON owner.id = n.party_a_user_id
       JOIN projects p ON p.founder_id = owner.founder_id
      WHERE p.id = ? AND COALESCE(owner.is_active, 1) = 1 AND n.party_b_user_id = ?
        AND n.status = 'active' AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))
      LIMIT 1`,
  ).bind(projectId, readerId).first();
  return !!row;
}

/** The same rule for one named pair: what the data room asks before it sends a new NDA to that pair. */
export async function hasActivePairNda(env: Env, partyAUserId: number, readerId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM pairwise_ndas n JOIN users owner ON owner.id = n.party_a_user_id
      WHERE n.party_a_user_id = ? AND COALESCE(owner.is_active, 1) = 1 AND n.party_b_user_id = ?
        AND n.status = 'active' AND (n.valid_until IS NULL OR datetime(n.valid_until) > datetime('now'))
      LIMIT 1`,
  ).bind(partyAUserId, readerId).first();
  return !!row;
}

/** The firms the caller belongs to: what an investor may see of a deal's money is their own firms' share. */
export async function userFirmIds(env: Env, userId: number): Promise<number[]> {
  const rows = await env.DB.prepare('SELECT DISTINCT company_id FROM user_company_links WHERE user_id = ? AND company_id IS NOT NULL')
    .bind(userId).all<{ company_id: number }>();
  return (rows.results || []).map((r) => Number(r.company_id));
}

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

/**
 * D1074 (#2966, owner question 5 answer A on #2425): who may read another
 * member's requirement status (the trust score). Self; an admin of this
 * territory; or a counterparty in an open intro or deal. Nobody else, whatever
 * their role.
 *
 *  - TERRITORY. Each branch is its own deployment over its own database (D104),
 *    so an admin's territory is the members of this database: an admin reads a
 *    user id that exists here, and one that does not is refused like any other.
 *  - AN OPEN INTRO is a `pairwise_ndas` row between the two, `pending` or
 *    `active` and not past `valid_until`. Revoked and expired pairs are closed.
 *  - AN OPEN DEAL is a deal that is neither `funded` nor `rejected` and was not
 *    passed, on a venture the target or the caller belongs to (as its founder,
 *    or through `user_company_links`), with the other side invited to it, holding
 *    a commitment that is not withdrawn, or its lead partner. Both directions
 *    count: the founder reads their investor's, and the investor the founder's.
 *
 * All or nothing: a batch with one id the caller may not read is refused whole.
 */
export async function mayReadTrustScores(env: Env, user: User, ids: number[]): Promise<boolean> {
  const others = [...new Set(ids.filter(id => id !== user.id))];
  if (!others.length) return true;
  if (user.role === 'admin') {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM users WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))',
    ).bind(JSON.stringify(others)).first<{ n: number }>();
    return Number(row?.n ?? 0) === others.length;
  }
  const allowed = await counterpartiesOf(env, user.id, others);
  return others.every(id => allowed.has(id));
}

/** The ids in `others` that are `userId`'s counterparty in an open intro or an open deal. */
export async function counterpartiesOf(env: Env, userId: number, others: number[]): Promise<Set<number>> {
  const list = JSON.stringify(others);
  const rows = await env.DB.prepare(`
    WITH want(id) AS (SELECT CAST(value AS INTEGER) FROM json_each(?)),
    members(user_id, project_id) AS (
      SELECT u.id, p.id FROM users u JOIN projects p ON p.founder_id = u.founder_id
       WHERE u.founder_id IS NOT NULL AND p.deleted_at IS NULL
      UNION
      SELECT l.user_id, p.id FROM user_company_links l JOIN projects p ON p.company_id = l.company_id
       WHERE p.deleted_at IS NULL
    ),
    open_deals(deal_id, project_id, lead_partner_id) AS (
      SELECT d.id, d.project_id, d.lead_partner_id FROM deals d
       WHERE d.status NOT IN ('funded','rejected') AND d.passed_at IS NULL
    ),
    deal_sides(deal_id, user_id) AS (
      SELECT i.deal_id, i.investor_user_id FROM deal_invitations i
      UNION
      SELECT k.deal_id, k.investor_user_id FROM commitments k WHERE k.status <> 'withdrawn'
      UNION
      SELECT od.deal_id, od.lead_partner_id FROM open_deals od WHERE od.lead_partner_id IS NOT NULL
    ),
    pairs(a, b) AS (
      SELECT m.user_id, s.user_id FROM open_deals od
        JOIN members m ON m.project_id = od.project_id
        JOIN deal_sides s ON s.deal_id = od.deal_id
      UNION
      SELECT n.party_a_user_id, n.party_b_user_id FROM pairwise_ndas n
       WHERE n.status IN ('pending','active')
         AND (n.valid_until IS NULL OR julianday(n.valid_until) > julianday('now'))
    )
    SELECT DISTINCT CASE WHEN pairs.a = ? THEN pairs.b ELSE pairs.a END AS id
      FROM pairs
     WHERE (pairs.a = ? AND pairs.b IN (SELECT id FROM want))
        OR (pairs.b = ? AND pairs.a IN (SELECT id FROM want))
  `).bind(list, userId, userId, userId).all<{ id: number }>();
  return new Set((rows.results || []).map(row => Number(row.id)));
}

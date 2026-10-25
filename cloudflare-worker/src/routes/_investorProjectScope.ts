import type { Env, User } from '../types';
import { ensureInvestorPaywallSchema } from '../middleware/requireInvestorTier';
import { isInvestor } from './_t13t14t15_helpers';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';

/**
 * Projects an investor has an explicit relationship with, narrowed to their
 * active company. Operators return null, meaning "use the route's normal
 * portfolio-wide scope".
 *
 * COMPANY SCOPING, STAGE 5 — and the first surface that could not inherit a
 * company through migration 189. A founder's data hangs off a project, and a
 * project has a `company_id`. An investor's does not: the projects they can
 * see are derived from RELATIONSHIPS — dealroom membership, introductions, a
 * converted watchlist item — and each of those rows is keyed on a user id
 * alone. So migration 193 puts `company_id` on the relationship rows, and this
 * function filters on it.
 *
 * `companyId === null` means "no company selected" and returns everything the
 * investor may see, the same reading `companyScope` and `projectInActiveCompany`
 * use. A relationship with `company_id IS NULL` — an investor who has no
 * primary company, so 193 backfilled nothing for them — stays visible under
 * every company rather than vanishing behind a control they never touched.
 *
 * The company id must already be VERIFIED. Callers pass the result of
 * `resolveActiveCompany`, which checks the header against `user_company_links`;
 * a forged id arrives here as null and therefore widens nothing.
 */
export async function investorProjectIds(
  env: Env, user: User, companyId: number | null = null,
): Promise<number[] | null> {
  if (!isInvestor(user)) return null;
  await ensureInvestorPaywallSchema(env);

  const investorId = await seatOwnerId(env, user);

  // TWO FULL LITERALS PER QUERY, not one template with an interpolated clause.
  //
  // The first draft built the company predicate in a helper and dropped it in
  // with `${…}`. `check-sql-prepare` flagged all three sites, and although the
  // interpolated value was a constant fragment and the id itself was bound,
  // the guard is right about the shape: anything that reaches query TEXT is
  // unprotected by definition, and "provably safe today" is a property that
  // decays. Writing both variants out costs a dozen lines and removes the
  // question entirely — and it has the side benefit that each query can be
  // read exactly as the database receives it.
  //
  // The clause mirrors `companyScope`'s SQL and `projectInActiveCompany`'s
  // predicate: match the company, or match a row that has none.
  const ids = new Set<number>();
  const related = companyId === null
    ? await env.DB.prepare(
      `SELECT d.project_id
         FROM investor_dealroom_members m
         JOIN deals d ON d.id = m.deal_id
        WHERE m.investor_user_id = ? AND d.project_id IS NOT NULL
       UNION
       SELECT project_id
         FROM investor_introductions i
        WHERE i.investor_user_id = ? AND i.project_id IS NOT NULL`,
    ).bind(investorId, investorId).all<{ project_id: number }>()
    : await env.DB.prepare(
      `SELECT d.project_id
         FROM investor_dealroom_members m
         JOIN deals d ON d.id = m.deal_id
        WHERE m.investor_user_id = ? AND d.project_id IS NOT NULL
          AND (m.company_id = ? OR m.company_id IS NULL)
       UNION
       SELECT project_id
         FROM investor_introductions i
        WHERE i.investor_user_id = ? AND i.project_id IS NOT NULL
          AND (i.company_id = ? OR i.company_id IS NULL)`,
    ).bind(investorId, companyId, investorId, companyId).all<{ project_id: number }>();
  for (const row of related.results || []) ids.add(Number(row.project_id));

  const empty = { results: [] as { project_id: number }[] };
  const converted = companyId === null
    ? await env.DB.prepare(
      `SELECT d.project_id
         FROM watchlist_items w
         JOIN deals d ON d.id = w.converted_deal_id
        WHERE w.owner_user_id = ? AND d.project_id IS NOT NULL`,
    ).bind(investorId).all<{ project_id: number }>().catch(() => empty)
    : await env.DB.prepare(
      `SELECT d.project_id
         FROM watchlist_items w
         JOIN deals d ON d.id = w.converted_deal_id
        WHERE w.owner_user_id = ? AND d.project_id IS NOT NULL
          AND (w.company_id = ? OR w.company_id IS NULL)`,
    ).bind(investorId, companyId).all<{ project_id: number }>().catch(() => empty);
  for (const row of converted.results || []) ids.add(Number(row.project_id));
  return [...ids].filter(Number.isFinite);
}

/** The investor whose relationships a seat reads: the seat's primary holder, or the caller. */
async function seatOwnerId(env: Env, user: User): Promise<number> {
  const seatOwner = await env.DB.prepare(
    'SELECT investor_seat_primary_user_id FROM users WHERE id = ?',
  ).bind(user.id).first<{ investor_seat_primary_user_id: number | null }>().catch(() => null);
  return Number(seatOwner?.investor_seat_primary_user_id || user.id);
}

/**
 * D1057 (#2927, #2427 finding 8): the companies an investor HOLDS, for
 * Portfolio's positions. A relationship (`investorProjectIds`: a dealroom, an
 * introduction, a converted watchlist item) lets an investor see a company;
 * it is not a position. Until #2424's `closing_lines` record who signed into
 * which round, the rule is a CONFIRMED commitment: `commitments.status =
 * 'confirmed'` on a deal of that company, by the seat's investor, in the
 * active company (or with none recorded). Pending and withdrawn commitments
 * are not holdings. The answer is the relationship set narrowed to those
 * companies, so it never widens what the investor could already see.
 * Operators return null, as `investorProjectIds` does.
 */
export async function investorHeldProjectIds(
  env: Env, user: User, companyId: number | null = null,
): Promise<number[] | null> {
  const related = await investorProjectIds(env, user, companyId);
  if (related === null || related.length === 0) return related;
  const investorId = await seatOwnerId(env, user);
  const rows = companyId === null
    ? await env.DB.prepare(
      `SELECT DISTINCT d.project_id
         FROM commitments t
         JOIN deals d ON d.id = t.deal_id
        WHERE t.investor_user_id = ? AND t.status = 'confirmed' AND d.project_id IS NOT NULL`,
    ).bind(investorId).all<{ project_id: number }>()
    : await env.DB.prepare(
      `SELECT DISTINCT d.project_id
         FROM commitments t
         JOIN deals d ON d.id = t.deal_id
        WHERE t.investor_user_id = ? AND t.status = 'confirmed' AND d.project_id IS NOT NULL
          AND (t.company_id = ? OR t.company_id IS NULL)`,
    ).bind(investorId, companyId).all<{ project_id: number }>();
  const held = new Set((rows.results || []).map((r) => Number(r.project_id)));
  return related.filter((id) => held.has(id));
}

/** What Portfolio's positions are scoped by, said on the read (D1057). */
export const HELD_SCOPE = Object.freeze({
  rule: 'confirmed_commitment',
  text: 'Companies where you hold a confirmed commitment. The amounts are the positions the studio recorded in them; how you hold each one (direct, through an SPV or a fund) is not recorded yet.',
});

/**
 * The caller's verified active company for this request, resolved once.
 *
 * Every investor route below wants the same answer, and `resolveActiveCompany`
 * is a DB round trip, so it is memoised on the Hono context rather than
 * re-verified per call. Lives here rather than in each route file so the four
 * investor surfaces cannot disagree about what "active company" means.
 */
const ACTIVE_COMPANY_KEY = '__activeCompanyId';
export async function investorActiveCompany(c: any, user: User): Promise<number | null> {
  const cached = c?.get?.(ACTIVE_COMPANY_KEY);
  if (cached !== undefined) return cached as number | null;
  const id = await resolveActiveCompany(c.env, user, c.req.header(ACTIVE_COMPANY_HEADER));
  c?.set?.(ACTIVE_COMPANY_KEY, id);
  return id;
}

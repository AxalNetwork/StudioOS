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

  const seatOwner = await env.DB.prepare(
    'SELECT investor_seat_primary_user_id FROM users WHERE id = ?',
  ).bind(user.id).first<{ investor_seat_primary_user_id: number | null }>().catch(() => null);
  const investorId = Number(seatOwner?.investor_seat_primary_user_id || user.id);

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

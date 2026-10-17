/**
 * D702 — "Let investors find my venture" (`projects.investor_findable`,
 * migration 467): who an investor may find, in one place.
 *
 * NULL (the founder never chose) and 1 read as findable, so no venture's reach
 * changes until its founder turns the toggle off. With 0, an investor reaches
 * the venture only through an introduction, and an introduction is exactly one
 * of two things, both defined elsewhere and only called here:
 *
 *   - the venture is in `investorProjectIds(env, investor, null)`
 *     (routes/_investorProjectScope.ts): a deal-room membership, an
 *     introduction row, or a converted watchlist item;
 *   - an active pairwise NDA exists between the investor and the venture's
 *     founder user (`hasActivePairwiseNda`, services/trust.ts).
 *
 * The founder user is the lowest `users.id` whose `founder_id` is the
 * venture's, as the public startup read resolves it.
 *
 * ONLY INVESTORS ARE FILTERED. Admins, partners and founders get an empty set
 * and every venture they could reach before. Every read that lists or opens a
 * venture for an investor calls this; D702.md carries the census of them.
 */
import type { Env, User } from '../types';
import { investorProjectIds } from '../routes/_investorProjectScope';
import { hasActivePairwiseNda } from './trust';

function isInvestorUser(user: Pick<User, 'role'> | null | undefined): boolean {
  return String(user?.role || '').toLowerCase() === 'investor';
}

/** A database that never ran migration 467 has no column, so nobody chose. */
function isMissingColumn(e: unknown): boolean {
  return /no such column:?\s*(\w+\.)?investor_findable/i.test(String((e as Error)?.message || e));
}

/**
 * The ventures among `projectIds` this investor may NOT find. Empty for every
 * other role. A venture is hidden when its founder set `investor_findable = 0`
 * and the investor has no introduction to it.
 */
export async function hiddenFromInvestor(
  env: Env, user: Pick<User, 'id' | 'role'> | null | undefined, projectIds: Array<number | string | null | undefined>,
): Promise<Set<number>> {
  const hidden = new Set<number>();
  if (!user || !isInvestorUser(user)) return hidden;
  const ids = [...new Set(projectIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return hidden;

  let candidates: Array<{ id: number; founder_user_id: number | null }> = [];
  try {
    const rows = await env.DB.prepare(
      `SELECT p.id, (SELECT MIN(u.id) FROM users u WHERE u.founder_id = p.founder_id) AS founder_user_id
         FROM projects p
        WHERE p.id IN (SELECT value FROM json_each(?)) AND p.investor_findable = 0`,
    ).bind(JSON.stringify(ids)).all<{ id: number; founder_user_id: number | null }>();
    candidates = rows.results || [];
  } catch (e) {
    if (isMissingColumn(e)) return hidden;
    throw e;
  }
  if (candidates.length === 0) return hidden;

  const related = new Set((await investorProjectIds(env, user as User, null)) || []);
  for (const p of candidates) {
    const id = Number(p.id);
    if (related.has(id)) continue;
    if (p.founder_user_id != null && await hasActivePairwiseNda(env, Number(p.founder_user_id), Number(user.id))) continue;
    hidden.add(id);
  }
  return hidden;
}

/** True when this caller may find this venture. Always true for non-investors. */
export async function findableBy(
  env: Env, user: Pick<User, 'id' | 'role'> | null | undefined, projectId: number | string | null | undefined,
): Promise<boolean> {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return true;
  return !(await hiddenFromInvestor(env, user, [id])).has(id);
}

/** `rows` without the ventures this investor may not find, order kept. */
export async function keepFindable<T>(
  env: Env, user: Pick<User, 'id' | 'role'> | null | undefined, rows: T[], idOf: (row: T) => unknown,
): Promise<T[]> {
  if (!user || !isInvestorUser(user) || rows.length === 0) return rows;
  const hidden = await hiddenFromInvestor(env, user, rows.map((r) => idOf(r) as number));
  if (hidden.size === 0) return rows;
  return rows.filter((r) => !hidden.has(Number(idOf(r))));
}

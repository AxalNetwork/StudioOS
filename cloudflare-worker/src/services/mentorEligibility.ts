/**
 * D4807 (#4807) — who may hold a mentor-cohort assignment: ONE entitlement predicate.
 *
 * The question "is this account a mentor today?" was answered three ways:
 *   - the route that lists who can be assigned honoured an ADDITIONAL Advisor
 *     licence (D4472: `account_licences`, not revoked);
 *   - the catalogue's mentor count, its cohort coverage and its "no longer an
 *     Advisor" warning, and the opt-out total, tested the PRIMARY role only;
 *   - the access gate (`mayHoldCohortAssignment`) used `holdsLicence`, which
 *     honours both.
 * So a valid secondary Advisor could be assigned and read a cohort's founders,
 * yet was not counted as a mentor, left their cohort reading "no mentor", and
 * was flagged as having lost the role.
 *
 * ONE RULE, here: the account is active (`users.is_active = 1`, D960) AND
 * holds the Advisor licence, as the primary role or as an additional licence
 * that has not been revoked. A revoked licence, a changed role and a
 * deactivated account each remove eligibility at once, because each is read
 * from the live row, never from a copy.
 *
 * Every SQL read that needs the rule writes `{ELIGIBLE}` where it belongs and
 * passes the statement through `withMentorEligible`, with `u` the `users` row.
 * The rule is code, never input, so this is a placeholder swap and not a
 * value interpolated into a query.
 *
 * A database built before D4472 has no `account_licences`: it has no possible
 * additional licence, so the rule is the primary role alone (as `heldLicences`
 * treats the same case).
 */
import type { Env } from '../types';

/** The licence a mentor holds. */
export const MENTOR_LICENCE = 'advisor' as const;

/** Where a statement says "the account is an eligible mentor". */
export const ELIGIBLE_PLACEHOLDER = '{ELIGIBLE}';

const ACTIVE = 'u.is_active = 1';
const PRIMARY = "lower(COALESCE(u.role, '')) = 'advisor'";
const ADDITIONAL = "EXISTS (SELECT 1 FROM account_licences l WHERE l.user_id = u.id AND l.licence = 'advisor' AND l.revoked_at IS NULL)";

/** The rule as a SQL boolean over the `users` row aliased `u`. */
export function mentorEligibleSql(opts: { additionalLicences: boolean } = { additionalLicences: true }): string {
  return `(${ACTIVE} AND (${opts.additionalLicences ? `${PRIMARY} OR ${ADDITIONAL}` : PRIMARY}))`;
}

/** Whether this database has the additional-licence table at all. */
export async function hasAdditionalLicences(env: Pick<Env, 'DB'>): Promise<boolean> {
  const r = await env.DB.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'account_licences'").first<{ ok: number }>();
  return !!r;
}

/** The statement with every `{ELIGIBLE}` replaced by the rule. */
export async function withMentorEligible(env: Pick<Env, 'DB'>, sql: string): Promise<string> {
  if (!sql.includes(ELIGIBLE_PLACEHOLDER)) return sql;
  return sql.split(ELIGIBLE_PLACEHOLDER).join(mentorEligibleSql({ additionalLicences: await hasAdditionalLicences(env) }));
}

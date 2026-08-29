/**
 * Tenancy scope — the one place that decides which rows a non-admin may read.
 *
 * The integration brief requires tenancy through a single middleware and
 * forbids ad-hoc WHERE clauses scattered through route files. That middleware
 * did not exist: src/middleware/ has cfAccess, csrf, rateLimit, requireTier
 * and others, but nothing for tenancy, so every de-admined surface so far has
 * inlined its own scoping (see the comments in capital.ts and funds.ts, each
 * explaining its own IDOR fix separately).
 *
 * This module is the seed of that layer rather than a fourth inlined pattern.
 * It is deliberately small and pure: a resource name in, a SQL fragment plus
 * binds out. Route files compose the fragment; they never decide policy. As
 * Phase 3 lands, resources are added here and the routes do not change.
 *
 * The property that matters most is the DEFAULT. An actor this module does
 * not recognise gets `1=0` — no rows — never an unfiltered query. Scoping
 * bugs in this shape are silent: an accidental "no filter" reads as working
 * software right up until it serves another tenant's contracts. So the
 * fallthrough denies, and tests pin that it denies.
 */

/** The minimum an authenticated caller must present to be scoped at all. */
export interface Actor {
  id?: number | null;
  role?: string | null;
  /**
   * The caller's account email. Only `lpMembershipScope` reads it, and only
   * because `limited_partners` rows can predate the account that claims them.
   *
   * Safe to match on because `users.email` is VERIFIED: changing it requires
   * confirming a token mailed to the new address (`email_change_requests` in
   * routes/settings.ts), so holding an address here means having proved
   * control of it. If that flow is ever relaxed, this scope becomes unsafe —
   * `lpMembershipScope`'s own comment says so, and a test pins the coupling.
   */
  email?: string | null;
  /**
   * `users.founder_id` — the founders row this account is attached to.
   * `projectOwnerScope` reads it because `projects.founder_id` points at
   * `founders(id)`, not at `users(id)`: a project's owner cannot be matched on
   * the caller's user id at all.
   */
  founder_id?: number | null;
}

/** A composable SQL fragment. `sql` is always safe to drop after WHERE. */
export interface ScopeClause {
  sql: string;
  binds: Array<string | number>;
}

/** Every row. Only ever returned for a role in UNSCOPED_ROLES. */
export const ALL_ROWS: ScopeClause = { sql: '1=1', binds: [] };

/** No rows. The default for anyone this module cannot positively identify. */
export const NO_ROWS: ScopeClause = { sql: '1=0', binds: [] };

/**
 * Roles that see across tenants. Kept as a set rather than `role === 'admin'`
 * so Phase 3 can add an auditor or support role in one edit, and so a typo in
 * a role string fails closed instead of matching.
 */
export const UNSCOPED_ROLES: ReadonlySet<string> = new Set(['admin']);

/** A caller with no usable id is malformed, whatever role it claims. */
function actorId(actor: Actor | null | undefined): number | null {
  const id = Number(actor?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Unscoped requires BOTH a recognised role and a real id.
 *
 * Checking the role alone looked equivalent and was not: `{ role: 'admin' }`
 * with no id — a half-built actor, a session that failed to load, a shape
 * assembled from an untrusted body — came back as every row. That is the
 * exact silent widening this module exists to prevent, so identity is
 * required before privilege.
 */
export function isUnscoped(actor: Actor | null | undefined): boolean {
  return actorId(actor) !== null && UNSCOPED_ROLES.has(String(actor?.role ?? ''));
}

/**
 * Envelopes an actor may read, as `e.*`.
 *
 * Three ways to be entitled to an envelope, and all three are real:
 *   created_by   you originated it
 *   user_id      it is ABOUT you (the founder a 3-way agreement names)
 *   recipient    you were asked to sign it
 *
 * esign_envelopes has no company_id, so this is user-scoped rather than
 * company-scoped. When Phase 3 introduces company membership, the extra
 * clause is added here and no route file changes.
 */
export function esignEnvelopeScope(actor: Actor | null | undefined, alias = 'e'): ScopeClause {
  if (isUnscoped(actor)) return ALL_ROWS;
  const id = actorId(actor);
  if (id === null) return NO_ROWS;
  return {
    sql: `(${alias}.created_by = ? OR ${alias}.user_id = ? OR EXISTS (
            SELECT 1 FROM esign_recipients r
             WHERE r.envelope_id = ${alias}.id AND r.user_id = ?))`,
    binds: [id, id, id],
  };
}

/**
 * Funds an actor may operate, as `f.*`.
 *
 * Ownership is `vc_funds.gp_user_id` — the GP of record added by migration
 * 163, whose own header says it exists so the platform can tell "whether the
 * signer is a real user and reach them". That is precisely an ownership key,
 * and it is the only one this table has: there is no company_id and no
 * fund_members join.
 *
 * Consequence worth stating plainly: a fund with a NULL gp_user_id has no
 * owner, so no non-admin can operate it. That is the correct failure. The
 * alternative — treating unowned funds as open — would hand every
 * institutional-tier account write access to every legacy fund in the table,
 * including capital calls and distributions.
 */
export function fundGpScope(actor: Actor | null | undefined, alias = 'f'): ScopeClause {
  if (isUnscoped(actor)) return ALL_ROWS;
  const id = actorId(actor);
  if (id === null) return NO_ROWS;
  // `= ?` and not `IS ?`: a NULL gp_user_id must never match, and in SQL
  // `NULL = 5` is NULL rather than true, which is the behaviour wanted here.
  return { sql: `(${alias}.gp_user_id = ?)`, binds: [id] };
}

/**
 * "Is this caller an LP of this fund?" — the canonical predicate.
 *
 * Before this existed the question was asked at THIRTEEN sites with TWO
 * answers. Eleven checked `user_id` alone (capital.ts ×4, funds.ts's LPA gate,
 * lp_reports.ts ×2, liquidity.ts ×2, and the two `listByUser` models behind
 * the LP portal); two also matched the account email (funds.ts's capital-call
 * join, spinout_lab.ts's fund entitlement). The consequence was not a leak but
 * a denial: an LP whose `user_id` was never backfilled — a "legacy LP migrated
 * from lp_investors", in funds.ts's own words — read their fund metrics and
 * capital calls through two doors and was refused their LP record, their LP
 * list, their LP reports and their portfolio through the other eleven. The LP
 * portal asked it BOTH ways inside a single handler, so the same page listed
 * capital calls for a fund whose LP row it had just failed to find.
 *
 * The email arm is qualified by `user_id IS NULL`, which is narrower than
 * either predicate it replaces and is the point of the whole exercise:
 *
 *   - `limited_partners.email` is operator-entered and denormalized, so it can
 *     name one address while `user_id` points at a different account. The
 *     unqualified `OR LOWER(email) = LOWER(?)` that funds.ts and spinout_lab.ts
 *     shipped therefore handed such a row to whoever held the address, over
 *     the top of the account that actually owned it. Requiring the row to be
 *     UNCLAIMED closes that: a row with an owner is reachable only by its
 *     owner.
 *   - What remains is exactly the legacy case — an LP row nobody has claimed —
 *     and it is safe because `users.email` is verified (see `Actor.email`).
 *
 * It is also deliberately paired with `claimLpRowsByEmail` at the call sites,
 * whose UPDATE carries the same `user_id IS NULL` condition. Reaching a row by
 * email CLAIMS it, so the email grant converts to a permanent, auditable
 * account link on first use rather than staying live forever, and an address
 * that is later reassigned inherits nothing.
 *
 * An empty email is never matched. `spinout_lab.ts` bound `user.email ?? ''`,
 * and `LOWER(email) = LOWER('')` is true for any row with an empty email — so
 * a session without an address could have claimed every such row. Dropping the
 * arm entirely when there is nothing to match on is what closes that.
 */
export function lpMembershipScope(actor: Actor | null | undefined, alias = 'lp'): ScopeClause {
  if (isUnscoped(actor)) return ALL_ROWS;
  const id = actorId(actor);
  if (id === null) return NO_ROWS;
  const email = typeof actor?.email === 'string' ? actor.email.trim() : '';
  if (!email) {
    // Identified, but nothing to match on beyond the account link.
    return { sql: `(${alias}.user_id = ?)`, binds: [id] };
  }
  return {
    sql: `(${alias}.user_id = ? OR (${alias}.user_id IS NULL AND LOWER(${alias}.email) = LOWER(?)))`,
    binds: [id, email],
  };
}

/**
 * The same LP predicate, with NO unscoped escape — the caller's own rows and
 * nothing else, whatever their role.
 *
 * Self-views need this and `lpMembershipScope` would break them. `/lp-portal`
 * and `/liquidity/my-portfolio` answer "what do *I* hold"; returning ALL_ROWS
 * to an admin there does not grant an oversight view, it corrupts a personal
 * one — every LP's commitments summed into one operator's TVPI, every LP's
 * distributions listed as their own. The pre-existing code was right about
 * this: those handlers never branched on role at all.
 *
 * So the choice between the two functions is not about privilege, it is about
 * what the page MEANS:
 *
 *   lpMembershipScope   "which LP rows may I administer?"  → admin sees all
 *   lpSelfScope         "which LP rows are mine?"          → nobody sees more
 *
 * Both share the membership rule itself, which is the point of the pair: the
 * legacy-email arm cannot drift between the administrative surfaces and the
 * personal ones, because there is only one copy of it.
 */
export function lpSelfScope(actor: Actor | null | undefined, alias = 'lp'): ScopeClause {
  const id = actorId(actor);
  if (id === null) return NO_ROWS;
  // Deliberately re-entering through the shared predicate with the role
  // stripped, rather than duplicating the two arms. A second copy is exactly
  // the failure this module was built to end.
  return lpMembershipScope({ id, email: actor?.email ?? null }, alias);
}

/**
 * The caller's own AI usage rows, as `u.*`. A self-view, like `lpSelfScope`.
 *
 * `ai_usage_logs` is the audit trail `aiRouter` writes on every model call:
 * task, model, tokens, `est_cost_usd`, latency, whether a fallback or the
 * cache was used, and any refusal. The org-wide rollup over the same table
 * already exists behind `requireAdmin` at `/api/monitoring/ai-usage`, so this
 * resource exists for one question only — "what have *I* spent?" — and has no
 * unscoped escape for the same reason `/lp-portal` has none: an admin's own
 * spend meter must show their own spend, not the organisation's.
 *
 * `user_id` is nullable on that table (calls made outside a user session), and
 * `= ?` never matches NULL, so unattributed rows belong to nobody's meter.
 * That is correct: a row the platform cannot attribute must not be billed to
 * whoever happens to be looking.
 */
export function aiUsageSelfScope(actor: Actor | null | undefined, alias = 'u'): ScopeClause {
  const id = actorId(actor);
  if (id === null) return NO_ROWS;
  return { sql: `(${alias}.user_id = ?)`, binds: [id] };
}

/** Compose a scope into a query that already has its own WHERE conditions. */
export function andScope(baseSql: string, baseBinds: Array<string | number>, scope: ScopeClause) {
  return { sql: `${baseSql} AND ${scope.sql}`, binds: [...baseBinds, ...scope.binds] };
}

/**
 * Projects the caller owns — the fourth resource, after e-sign envelopes, fund
 * GP rows and LP memberships.
 *
 * `projects.founder_id` references `founders(id)`, so ownership is the
 * caller's `users.founder_id`, never their user id. Getting that wrong does not
 * fail loudly: `founder_id = <a user id>` is valid SQL that matches whichever
 * unrelated founder happens to hold that number, which is worse than an error.
 *
 * `deleted_at IS NULL` is part of the predicate rather than left to the caller.
 * A soft-deleted project is not owned in any sense a surface should act on, and
 * two routes that already inline this scope both remembered the filter — which
 * is exactly the kind of agreement that survives right up until the third
 * copy forgets.
 *
 * PARTNERS GET NOTHING HERE, which is where this diverges from
 * `canAccessFounderResource` — that predicate treats admin and partner alike as
 * studio-wide staff. A data room is not "founder data staff may read": it is the
 * set of documents a founder chose to share with named investors, and a
 * blanket partner path would make the per-investor grant decorative. The
 * divergence is the point, so it is written down rather than inferred.
 *
 * `routes/contacts.ts` and `routes/advisory.ts` each carry their own
 * `ownedProjectScope` helper predating this module. They are not rewritten
 * here: both are correct, both are covered, and a working ownership filter is
 * the last thing to refactor speculatively. New code uses this one.
 */
export function projectOwnerScope(actor: Actor | null | undefined, alias = 'p'): ScopeClause {
  if (isUnscoped(actor)) return { sql: `(${alias}.deleted_at IS NULL)`, binds: [] };
  if (actorId(actor) === null) return NO_ROWS;
  // ROLE-GATED, not merely founder_id-gated. `auth.ts` records why, in two
  // places: a principal converted to another role KEEPS its residual
  // `users.founder_id`, so a founder who later became an investor would
  // otherwise still read their old projects through this scope. Matching on
  // the id alone is the bug `canAccessFounderResource` and `entityListScope`
  // were both written to avoid; this is the third copy of that rule and it
  // agrees with them deliberately.
  if (actor?.role !== 'founder') return NO_ROWS;
  const founderId = typeof actor?.founder_id === 'number' ? actor.founder_id : null;
  // A founder account with no founders row owns no projects. Falling back to
  // the user id here would be the id-space mismatch described above.
  if (founderId === null) return NO_ROWS;
  return {
    sql: `(${alias}.founder_id = ? AND ${alias}.deleted_at IS NULL)`,
    binds: [founderId],
  };
}

/**
 * A founder's projects, narrowed to ONE company.
 *
 * This is the scope the CompanySwitcher was always implying and never had.
 * Before migration 189 no business table carried a `company_id` at all — the
 * whole schema had it on `user_company_links`, the membership join itself — so
 * selecting a company changed a label and nothing else.
 *
 * It layers on `projectOwnerScope` rather than replacing it. Ownership is still
 * the outer question: a company you belong to does not hand you another
 * founder's projects that happen to share it. Company is a NARROWING, never a
 * widening, and composing this way means the id-space rule projectOwnerScope
 * documents (`projects.founder_id` is a founders row, not a users row) is
 * enforced once instead of restated here.
 *
 * `companyId === null` means "no company selected", NOT "no access": the caller
 * sees every project they own. That is the single-company case, which is almost
 * everyone, and the case before the switcher has been touched. Returning
 * NO_ROWS for a missing header would blank the app for every existing user the
 * moment this shipped.
 *
 * UNASSIGNED PROJECTS ARE VISIBLE UNDER EVERY COMPANY. `company_id IS NULL` is
 * a real state — migration 189 backfills only founders who have a primary
 * company, and deliberately invents nothing for those who do not. An unassigned
 * project is not another company's data, so showing it breaks no isolation
 * rule; hiding it would make a founder's own work vanish behind a control they
 * did not know changed anything. When assignment UI ships, the OR clause is
 * what it removes.
 *
 * ADMIN STAYS UNSCOPED, as everywhere else in this module. The cross-tenant
 * "read-only overlay" that would let an admin view one tenant at a time is a
 * separate feature (ROUTE_MAP: Admin · Super); bolting it on here would make an
 * admin's blank-company case indistinguishable from a scoped one.
 *
 * @param companyId a company the caller has been VERIFIED to belong to.
 *   This function does not check membership and must never be handed a raw
 *   client value — `middleware/activeCompany.ts` resolves the header against
 *   `user_company_links` and passes null when the claim does not hold.
 */
export function companyScope(
  actor: Actor | null | undefined,
  companyId: number | null,
  alias = 'p',
): ScopeClause {
  const owner = projectOwnerScope(actor, alias);
  // No rows is already the answer; narrowing it further cannot help, and
  // appending to `1=0` would make the SQL harder to read for no gain.
  if (owner.sql === NO_ROWS.sql) return owner;
  if (isUnscoped(actor)) return owner;
  if (companyId === null) return owner;
  return {
    sql: `(${owner.sql} AND (${alias}.company_id = ? OR ${alias}.company_id IS NULL))`,
    binds: [...owner.binds, companyId],
  };
}

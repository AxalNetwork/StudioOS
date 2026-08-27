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

/** Compose a scope into a query that already has its own WHERE conditions. */
export function andScope(baseSql: string, baseBinds: Array<string | number>, scope: ScopeClause) {
  return { sql: `${baseSql} AND ${scope.sql}`, binds: [...baseBinds, ...scope.binds] };
}

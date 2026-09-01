/**
 * Fund GP access — the single gate every de-admined fund control goes through.
 *
 * Task #126 opens the GP controls on a fund (LP records, reporting periods,
 * capital calls, distributions) to the fund's own general partner rather than
 * only to Axal platform admins. Three conditions have to hold together, and
 * the reason they live in one function is that they must never drift apart
 * between routes — twelve handlers each re-deriving "signed in AND on the
 * right tier AND owns this fund" is twelve chances to omit one:
 *
 *   1. authenticated                        requireAuth
 *   2. meets the institutional investor tier ensureInvestorTier (throws 402
 *                                            with the standard upsell body)
 *   3. is the GP of record for THIS fund     vc_funds.gp_user_id, via
 *                                            services/tenancyScope.ts
 *   4. under the ACTIVE COMPANY                vc_funds.company_id (195), via
 *                                            the same scope function
 *
 * Admins bypass (3) and (4) but still resolve through this function, so an
 * admin and a GP hit exactly the same code path and the same 404 for a fund
 * that does not exist.
 *
 * (4) is company scoping, stage 7, and it is deliberately here rather than in
 * the twelve handlers: this is the one place the GP question is asked, so it
 * is the one place the answer can be narrowed without twelve chances to omit
 * it. A fund the caller runs under a DIFFERENT company is 404, identical to a
 * fund that does not exist and to one that is somebody else's — the switcher
 * must not become an oracle either. See 195 for why an authorisation scope can
 * carry an `IS NULL` arm safely.
 *
 * Order matters. The tier check runs BEFORE ownership, so a professional-tier
 * user probing fund ids gets an identical 402 whatever the id — ownership
 * never becomes an oracle for which funds exist. And a caller who fails
 * ownership gets 404, not 403, for the same reason: on a sequential integer
 * id, 403 counts the platform's funds for you.
 */
import type { Context } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { ensureInvestorTier } from '../middleware/requireInvestorTier';
import { fundGpScope } from './tenancyScope';
import { resolveActiveCompany, ACTIVE_COMPANY_HEADER } from '../middleware/activeCompany';
import { ensureFundGpColumns } from './fundGpSchema';

/** The fund row, plus the actor that was allowed to reach it. */
export interface FundGpContext {
  user: any;
  fund: any;
  /** True when the caller passed on the admin bypass rather than ownership. */
  viaAdmin: boolean;
  /**
   * The caller's verified active company, or null for "none selected" — and
   * always null for an admin, who is not scoped by one. Returned so a handler
   * that WRITES can stamp the same company the read was gated on, rather than
   * resolving the header a second time and risking a different answer.
   */
  companyId: number | null;
}

/**
 * Resolve a fund the caller is entitled to operate, or throw.
 *
 * Throws: Unauthorized (401) · a 402 tier upsell Response · 404 Response when
 * the fund does not exist OR is not the caller's.
 */
export async function requireFundGp(
  c: Context<{ Bindings: Env }>,
  fundId: number,
): Promise<FundGpContext> {
  const user = await requireAuth(c);
  const viaAdmin = String((user as any)?.role ?? '') === 'admin';

  // Tier before ownership — see the header. An admin is not asked for a
  // subscription to administer the platform they run.
  if (!viaAdmin) ensureInvestorTier(user as any, 'institutional');

  if (!Number.isInteger(fundId) || fundId <= 0) throw notFound();

  // Verified, never the raw header. An admin is unscoped, so the lookup is
  // skipped for them rather than resolved and discarded.
  const companyId = viaAdmin ? null : await activeCompany(c, user);
  // Only the company clause names a column migration 195 added, so the
  // bootstrap runs only when that clause is about to be used. Without this an
  // environment still on 194 would answer a GP's first switcher click with
  // `no such column: company_id`, which mapError renders as a bare 400 — a
  // NEW failure on a stale schema, where the pre-195 path had none. The
  // helper caches per isolate on success, so this is one PRAGMA per isolate.
  if (companyId !== null) await ensureFundGpColumns(c.env);

  const scope = fundGpScope(user as any, companyId);
  const fund = await c.env.DB.prepare(
    `SELECT f.* FROM vc_funds f WHERE f.id = ? AND ${scope.sql}`,
  ).bind(fundId, ...scope.binds).first();

  if (!fund) throw notFound();
  return { user, fund, viaAdmin, companyId };
}

/**
 * The tier + auth half, for the one control that has no fund yet.
 *
 * POST /funds creates the fund, so there is nothing to own at call time. The
 * caller becomes the GP of record instead — see the route.
 */
export async function requireFundCreator(c: Context<{ Bindings: Env }>) {
  const user = await requireAuth(c);
  const viaAdmin = String((user as any)?.role ?? '') === 'admin';
  if (!viaAdmin) ensureInvestorTier(user as any, 'institutional');
  // Resolved here even though there is nothing to gate: POST /funds records
  // the GP of record, and stage 7 makes it record the firm at the same moment.
  // A fund created with no company selected keeps NULL, which 195 reads as
  // "this GP's under every company" — the honest answer when the creator never
  // told us which firm, and better than guessing their primary.
  const companyId = viaAdmin ? null : await activeCompany(c, user);
  return { user, viaAdmin, companyId };
}

/** The verified active company for a non-admin caller. */
async function activeCompany(
  c: Context<{ Bindings: Env }>,
  user: unknown,
): Promise<number | null> {
  return resolveActiveCompany(c.env, user as any, c.req.header(ACTIVE_COMPANY_HEADER));
}

/** Identical body whether the fund is absent or merely someone else's. */
function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Fund not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

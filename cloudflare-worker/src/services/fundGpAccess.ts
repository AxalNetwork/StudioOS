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
 *
 * Admins bypass (3) but still resolve through this function, so an admin and
 * a GP hit exactly the same code path and the same 404 for a fund that does
 * not exist.
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

/** The fund row, plus the actor that was allowed to reach it. */
export interface FundGpContext {
  user: any;
  fund: any;
  /** True when the caller passed on the admin bypass rather than ownership. */
  viaAdmin: boolean;
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

  const scope = fundGpScope(user as any);
  const fund = await c.env.DB.prepare(
    `SELECT f.* FROM vc_funds f WHERE f.id = ? AND ${scope.sql}`,
  ).bind(fundId, ...scope.binds).first();

  if (!fund) throw notFound();
  return { user, fund, viaAdmin };
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
  return { user, viaAdmin };
}

/** Identical body whether the fund is absent or merely someone else's. */
function notFound(): Response {
  return new Response(JSON.stringify({ error: 'Fund not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

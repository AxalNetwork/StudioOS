/**
 * Task #50 — 24h cool-off middleware.
 *
 * Blocks sensitive routes while user_recovery_state.cooling_off_until is in
 * the future. Applied to billing / contracts / capital / DD / KYC
 * re-submission / impersonation prefixes in index.ts so the gate is
 * declarative and lives in one place.
 *
 * Admins bypass the gate for THEIR OWN sessions only — impersonation
 * sessions (Bearer JWT carrying impersonated_by) still hit the block
 * because the gate keys off the impersonated user, not the actor.
 */
import type { Context, Next } from 'hono';
import type { Env } from '../types';
import { getCurrentUser } from '../auth';

/**
 * The cool-off refusal's body for this user, or null when no cool-off holds.
 *
 * D714 — exported so `services/fundAdminAccess.ts` can refuse a Super Admin
 * fund act that shares its route with reads (a first call through
 * `POST /api/funds/:id/lps`, a change of GP of record or carry) with the SAME
 * body this middleware sends, without pausing the reads on that route.
 */
export function recoveryCoolOffBody(user: unknown): {
  error: string; message: string; cool_off_until: string;
} | null {
  const until = (user as any)?.recovery_cooling_off_until;
  if (!until) return null;
  let isFuture = false;
  try { isFuture = new Date(until).getTime() > Date.now(); } catch {}
  if (!isFuture) return null;
  return {
    error: 'recovery_cool_off_active',
    message: 'This action is paused for 24 hours after account recovery. Re-enrol your authenticator from Settings → Security, then try again after the cool-off ends.',
    cool_off_until: until,
  };
}

export async function recoveryCoolOff(c: Context<{ Bindings: Env }>, next: Next) {
  const user = await getCurrentUser(c);
  if (!user) return next();  // unauth — let the route's own auth check fire
  const body = recoveryCoolOffBody(user);
  if (!body) return next();
  return c.json(body, 423);
}

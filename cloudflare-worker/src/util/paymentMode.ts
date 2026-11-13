import type { Env } from '../types';

/**
 * Task #6 — centralized payment-mode policy.
 *
 * Production payments run in the Worker; the dev FastAPI backend is never
 * deployed. Historically every checkout / payout surface fell back to a
 * SIMULATED path ("dev-upgrade" / "dev-complete" / dev transfers) when
 * `STRIPE_SECRET_KEY` was unset. That is fine for local development, but it
 * MUST NOT be reachable in production: a missing or misconfigured Stripe setup
 * has to fail loudly, never silently grant a paid entitlement.
 *
 * Every route that previously branched on `!STRIPE_SECRET_KEY` to simulate a
 * payment now routes that decision through `devPaymentFallbackAllowed()` so the
 * policy lives in exactly one place.
 */

/**
 * True when running as the deployed production Worker. `wrangler.toml` sets
 * `ENVIRONMENT = "production"`; `wrangler dev` / preview / local leave it unset
 * or set it to a dev value.
 */
export function isProductionEnv(env: Env): boolean {
  const name = String(env.ENVIRONMENT || '').toLowerCase();
  return name === 'production' || name === 'prod';
}

/**
 * Simulated payment fallbacks (dev-upgrade / dev-complete / dev transfers) are
 * permitted ONLY in a non-production environment that has no Stripe key
 * configured. In production — or any environment where a Stripe key is present
 * — callers must return an explicit error instead of simulating a payment.
 */
export function devPaymentFallbackAllowed(env: Env): boolean {
  return !isProductionEnv(env) && !env.STRIPE_SECRET_KEY;
}

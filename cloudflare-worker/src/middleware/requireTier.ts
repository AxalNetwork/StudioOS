/**
 * Task #6 — Founder subscription tier middleware.
 *
 * Three-tier ladder for founder accounts. D683 (owner, 2026-10-13): the paid
 * plans are the founder cycles in two groups, and each keeps everything below
 * it. The tier ids stay `growth` and `studio` (Stripe product metadata,
 * `users.subscription_tier`); what members read is the plan name.
 *   free    — "Free": 1 project, 5 interviews, 3 OKRs, read-only across most
 *             surfaces
 *   growth  — "Validate + Build": unlimited projects, interviews and OKRs,
 *             scoring runs, company lookups, wellbeing sessions
 *   studio  — "Raise + Grow": everything in Validate + Build, plus pitch deck
 *             save, share and premium templates, captable writes, advisor
 *             booking, co-marketing, compliance events, and capital, funds,
 *             reserves, waterfall, liquidity, legalcap, cofounder, 83(b), KYC,
 *             network-effects, partner insights, watchlist + decision journal,
 *             partner office hours
 *
 * Bypass roles: admin, partner, investor, advisor — these never hit the gate.
 * Mirrors the `requireMiPro` pattern in middleware/miAccess.ts: throws a
 * 402 Response (the global error handler returns it as-is).
 */
import type { Context } from 'hono';
import { planByKey } from '../services/planCatalogue';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { bindingKey, runSchemaBootstrap } from '../util/schemaBootstrap';

export type Tier = 'free' | 'growth' | 'studio';

const TIER_RANK: Record<Tier, number> = { free: 0, growth: 1, studio: 2 };

const BYPASS_ROLES = new Set<string>(['admin', 'partner', 'investor', 'advisor']);

/** What a member reads for each paid tier (D683). */
/** D1050: the plan names are the plan catalogue's (`services/planCatalogue.ts`). */
export const PLAN_NAME: Record<Exclude<Tier, 'free'>, string> = {
  growth: planByKey('founder:growth')!.name,
  studio: planByKey('founder:studio')!.name,
};

const TIER_COPY: Record<Exclude<Tier, 'free'>, string> = {
  growth: 'This is on the Validate + Build plan. Upgrade to validate and build without limits.',
  studio: 'This is on the Raise + Grow plan. Upgrade for the pitch deck, cap table, capital, legal, and partner tooling.',
};

/**
 * D1050 (#2901): no price is typed here. The upsell names the plan by its
 * catalogue key (`plan_key`), and the price is read from Stripe's D1 mirror
 * on `GET /api/public/plans-and-packs`, as the paywall and Pricing read it.
 */
export const PLAN_KEY: Record<Exclude<Tier, 'free'>, string> = {
  growth: 'founder:growth',
  studio: 'founder:studio',
};

export interface TierUserCols {
  subscription_tier?: string | null;
  subscription_status?: string | null;
  subscription_renews_at?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
}
export type TierUser = User & TierUserCols;

/** True when `userTier` covers `required`. */
export function tierCovers(userTier: string | null | undefined, required: Tier): boolean {
  const u = (userTier ?? 'free').toLowerCase() as Tier;
  const have = TIER_RANK[u] ?? 0;
  return have >= TIER_RANK[required];
}

/** True when `user` is allowed past a `required`-tier gate. */
export function userMeetsTier(user: User | null | undefined, required: Tier): boolean {
  if (!user) return false;
  if (BYPASS_ROLES.has(String(user.role))) return true;
  if (required === 'free') return true;
  const status = (user as TierUser).subscription_status ?? 'active';
  // Cancelled subs keep tier until renews_at; we read tier as-is and rely on
  // the Stripe webhook to flip tier→'free' on subscription.deleted.
  if (status === 'past_due' || status === 'unpaid') return false;
  // X-1: partner-granted/referred tiers are time-bounded. The cron sweep
  // resets tier→'free' at expiry, but enforce on read too so a stale
  // session can't bypass an expired grant before the cron runs.
  if (status === 'partner_grant' || status === 'partner_referral') {
    const renews = (user as TierUser).subscription_renews_at;
    if (renews && new Date(renews).getTime() <= Date.now()) return false;
  }
  return tierCovers((user as TierUser).subscription_tier, required);
}

/** Build the 402 payload the frontend renders as the upgrade modal. */
export function tierUpsell(required: Exclude<Tier, 'free'>) {
  return {
    error: 'tier_required',
    required,
    message: TIER_COPY[required],
    plan: { tier: required, name: PLAN_NAME[required], plan_key: PLAN_KEY[required] },
    checkout_path: '/api/billing/tier/checkout',
  };
}

/**
 * Inline guard — call from a route handler after `requireAuth` to gate a
 * single endpoint. Throws 402 Response, intercepted by Hono.
 */
export function ensureTier(user: User | null, required: Exclude<Tier, 'free'>): void {
  if (userMeetsTier(user, required)) return;
  throw new Response(JSON.stringify(tierUpsell(required)), {
    status: 402,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Hono middleware factory — mount at the router level, e.g.
 *   app.use('/api/capital/*', requireTier('studio'))
 *
 * Runs `requireAuth` itself so the underlying route handler still sees a
 * valid user (and so unauth'd callers get 401, not 402).
 */
export function requireTier(required: Exclude<Tier, 'free'>) {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    const user = await requireAuth(c);
    if (userMeetsTier(user, required)) return next();
    return c.json(tierUpsell(required), 402);
  };
}

/**
 * Variant that only gates mutating methods. Used when a router has free-tier
 * read paths (e.g. captable view) but tier-gated writes.
 */
export function requireTierForMutations(required: Exclude<Tier, 'free'>) {
  const inner = requireTier(required);
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    const m = c.req.method.toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
    return inner(c, next);
  };
}

const MIGRATED = new WeakMap<object, boolean>();
/** Idempotent column bootstrap — mirrors ensureMiPaywallSchema. */
export async function ensureTierSchema(env: Env): Promise<void> {
  if (MIGRATED.get(bindingKey(env))) return;
  const stmts = [
    `ALTER TABLE users ADD COLUMN subscription_tier TEXT NOT NULL DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'active'`,
    `ALTER TABLE users ADD COLUMN subscription_renews_at TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`,
    `ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_users_subscription_tier   ON users(subscription_tier)`,
    `CREATE INDEX IF NOT EXISTS idx_users_stripe_customer     ON users(stripe_customer_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id)`,
  ];
  // `users` is at D1's 100-column limit, so every ALTER here now raises "too
  // many columns" — including the ones whose column already exists, because
  // SQLite checks the limit before the duplicate-name test. This loop used to
  // rethrow that and take the whole router down with it. See
  // util/schemaBootstrap.ts.
  await runSchemaBootstrap(env, stmts);
  MIGRATED.set(bindingKey(env), true);
}

/** Free-tier hard limits enforced server-side in route handlers. */
export const FREE_TIER_LIMITS = {
  projects: 1,
  discoveryInterviews: 5,
  roadmapOkrs: 3,
} as const;

/**
 * D757 (#1898) — the free tier's interview cap, one check for every creator:
 * the 402 body when `userId` is a founder below Growth whose venture already
 * holds FREE_TIER_LIMITS.discoveryInterviews interviews, else null. The rule
 * and the body are the ones `POST /sessions` has always applied; the channel
 * intake's "Create interview from this chat" and an assistant's submission
 * reach it too.
 */
export async function interviewCapRefusal(env: Env, userId: number, projectId: number): Promise<ReturnType<typeof tierUpsell> | null> {
  await ensureTierSchema(env);
  const user = await env.DB.prepare(
    'SELECT id, role, subscription_tier, subscription_status, subscription_renews_at FROM users WHERE id = ?',
  ).bind(userId).first<TierUser>();
  if (!user || user.role !== 'founder' || userMeetsTier(user, 'growth')) return null;
  const existing = await env.DB.prepare('SELECT COUNT(*) AS n FROM discovery_interviews WHERE project_id = ?')
    .bind(projectId).first<{ n: number }>();
  return Number(existing?.n ?? 0) >= FREE_TIER_LIMITS.discoveryInterviews ? tierUpsell('growth') : null;
}

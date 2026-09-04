/**
 * Task #6 (W-1) — Investor paywall middleware.
 *
 * Tiers (rank order):
 *   free          — read-only browse, hard caps on intros/dealrooms/exports
 *   professional  — pipeline browse, full deals/intros, calendar bookings,
 *                   MI exports, up to 5 dealrooms, 25 intros / quarter
 *   institutional — unlimited dealrooms, Carta sync write, co-invest,
 *                   LP reporting, peer benchmarks, 100 intros / quarter,
 *                   up to 4 seat colleagues
 *
 * Bypass roles: admin, partner, advisor — never hit the gate. Founders
 * never see investor surfaces so they're not in the bypass list (they'll
 * just 401 on /api/introductions etc).
 *
 * Mirrors the requireTier (founder) and requireMiPro (MI) shapes so the
 * frontend can re-use the upsell modal pattern.
 */
import type { Context } from 'hono';
import type { Env, User } from '../types';
import { requireAuth } from '../auth';
import { runSchemaBootstrap } from '../util/schemaBootstrap';

export type InvestorTier = 'free' | 'professional' | 'institutional';

const TIER_RANK: Record<InvestorTier, number> = {
  free: 0,
  professional: 1,
  institutional: 2,
};

const BYPASS_ROLES = new Set<string>(['admin', 'partner', 'advisor']);

const TIER_COPY: Record<Exclude<InvestorTier, 'free'>, string> = {
  professional:
    'This is an Investor Professional feature. Upgrade for full deal flow, intros, and exports.',
  institutional:
    'This is an Investor Institutional feature. Upgrade for unlimited dealrooms, co-invest, and LP reporting.',
};

const PLAN_PRICE_LABEL: Record<Exclude<InvestorTier, 'free'>, string> = {
  professional: '$149 / month',
  institutional: '$599 / month',
};

export const INVESTOR_QUOTAS: Record<InvestorTier, { intros_per_quarter: number; dealroom_max: number; seats: number }> = {
  free:          { intros_per_quarter: 3,   dealroom_max: 1,        seats: 0 },
  professional:  { intros_per_quarter: 25,  dealroom_max: 5,        seats: 0 },
  institutional: { intros_per_quarter: 100, dealroom_max: 1_000_000, seats: 4 },
};

export interface InvestorTierUserCols {
  investor_tier?: string | null;
  investor_subscription_status?: string | null;
  investor_trial_ends_at?: string | null;
  investor_subscription_renews_at?: string | null;
  investor_stripe_customer_id?: string | null;
  investor_stripe_subscription_id?: string | null;
  investor_seat_count?: number | null;
  investor_quota_intros_quarter?: string | null;
  investor_quota_intros_used?: number | null;
  investor_dealroom_max?: number | null;
  investor_seat_primary_user_id?: number | null;
}
export type InvestorUser = User & InvestorTierUserCols;

/** True when `userTier` covers `required`. */
export function investorTierCovers(userTier: string | null | undefined, required: InvestorTier): boolean {
  const u = (userTier ?? 'free').toLowerCase() as InvestorTier;
  const have = TIER_RANK[u] ?? 0;
  return have >= TIER_RANK[required];
}

/**
 * Returns the *effective* tier for a user, honoring active trial windows.
 * A row with status='trialing' and a future trial_ends_at keeps its tier;
 * past_due/unpaid downgrade to 'free'.
 */
export function effectiveInvestorTier(user: InvestorUser | null | undefined): InvestorTier {
  if (!user) return 'free';
  const status = (user.investor_subscription_status ?? 'free').toLowerCase();
  if (status === 'past_due' || status === 'unpaid' || status === 'cancelled') return 'free';
  // X-1: partner-granted/referred investor tiers expire at renews_at.
  // Cron flips them to 'free'; this read-side check prevents stale
  // sessions from sneaking past expiry between sweeps.
  if (status === 'partner_grant' || status === 'partner_referral') {
    const renews = user.investor_subscription_renews_at;
    if (renews && new Date(renews).getTime() <= Date.now()) return 'free';
  }
  const tier = (user.investor_tier ?? 'free').toLowerCase() as InvestorTier;
  return (TIER_RANK[tier] !== undefined ? tier : 'free');
}

export function userMeetsInvestorTier(user: User | null | undefined, required: InvestorTier): boolean {
  if (!user) return false;
  if (BYPASS_ROLES.has(String(user.role))) return true;
  if (required === 'free') return true;
  // Tier gate is investor-specific: only enforce when caller IS an investor.
  // Other roles (founder, etc.) are passed through so shared surfaces like
  // /api/deals (founder writes own deals) keep working. Investor-only routes
  // such as /api/introductions still gate with their own role check.
  if (user.role !== 'investor') return true;
  return investorTierCovers(effectiveInvestorTier(user as InvestorUser), required);
}

export function investorUpsell(required: Exclude<InvestorTier, 'free'>) {
  return {
    error: 'investor_tier_required',
    required,
    message: TIER_COPY[required],
    plan: { tier: required, price_label: PLAN_PRICE_LABEL[required] },
    checkout_path: '/api/billing/investor/checkout',
  };
}

/** Inline guard — call after requireAuth. Throws 402 Response. */
export function ensureInvestorTier(user: User | null, required: Exclude<InvestorTier, 'free'>): void {
  if (userMeetsInvestorTier(user, required)) return;
  throw new Response(JSON.stringify(investorUpsell(required)), {
    status: 402,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Hono middleware factory — mount at the router level. */
export function requireInvestorTier(required: Exclude<InvestorTier, 'free'>) {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    const user = await requireAuth(c);
    if (userMeetsInvestorTier(user, required)) return next();
    return c.json(investorUpsell(required), 402);
  };
}

let _migrated = false;
/** Idempotent column bootstrap — mirrors ensureTierSchema. */
export async function ensureInvestorPaywallSchema(env: Env): Promise<void> {
  if (_migrated) return;
  const stmts: string[] = [
    `ALTER TABLE users ADD COLUMN investor_tier TEXT NOT NULL DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN investor_subscription_status TEXT NOT NULL DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN investor_trial_ends_at TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN investor_subscription_renews_at TIMESTAMP`,
    `ALTER TABLE users ADD COLUMN investor_stripe_customer_id TEXT`,
    `ALTER TABLE users ADD COLUMN investor_stripe_subscription_id TEXT`,
    `ALTER TABLE users ADD COLUMN investor_seat_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN investor_quota_intros_quarter TEXT`,
    `ALTER TABLE users ADD COLUMN investor_quota_intros_used INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN investor_dealroom_max INTEGER NOT NULL DEFAULT 5`,
    `ALTER TABLE users ADD COLUMN investor_seat_primary_user_id INTEGER`,
    `CREATE INDEX IF NOT EXISTS idx_users_investor_tier ON users(investor_tier)`,
    `CREATE INDEX IF NOT EXISTS idx_users_investor_trial ON users(investor_trial_ends_at)`,
    `CREATE INDEX IF NOT EXISTS idx_users_investor_seat_primary ON users(investor_seat_primary_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_investor_stripe_cust ON users(investor_stripe_customer_id)`,
    `CREATE TABLE IF NOT EXISTS investor_seats (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       primary_user_id INTEGER NOT NULL,
       seat_email TEXT NOT NULL,
       seat_user_id INTEGER,
       invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       accepted_at TIMESTAMP,
       revoked_at TIMESTAMP,
       invite_token TEXT,
       UNIQUE(primary_user_id, seat_email)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_investor_seats_primary ON investor_seats(primary_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_investor_seats_email ON investor_seats(seat_email)`,
    `CREATE INDEX IF NOT EXISTS idx_investor_seats_token ON investor_seats(invite_token)`,
    `CREATE TABLE IF NOT EXISTS investor_introductions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       uid TEXT UNIQUE NOT NULL,
       investor_user_id INTEGER NOT NULL,
       founder_user_id INTEGER,
       founder_id INTEGER,
       project_id INTEGER,
       message TEXT,
       status TEXT NOT NULL DEFAULT 'pending',
       quarter TEXT NOT NULL,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
     )`,
    `CREATE INDEX IF NOT EXISTS idx_intros_investor ON investor_introductions(investor_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_intros_quarter ON investor_introductions(investor_user_id, quarter)`,
    `CREATE TABLE IF NOT EXISTS investor_dealroom_members (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       investor_user_id INTEGER NOT NULL,
       deal_id INTEGER NOT NULL,
       joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(investor_user_id, deal_id)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_dealroom_investor ON investor_dealroom_members(investor_user_id)`,
  ];
  // `users` is at D1's 100-column limit, so every ALTER here now raises "too
  // many columns" — including the ones whose column already exists, because
  // SQLite checks the limit before the duplicate-name test. This loop used to
  // rethrow that and take the whole router down with it. See
  // util/schemaBootstrap.ts.
  await runSchemaBootstrap(env, stmts);
  _migrated = true;
}

/** Returns the current quarter key, e.g. "2026Q2", in UTC. */
export function currentQuarterKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}Q${q}`;
}

/**
 * Atomically reset the per-quarter intro counter when the stored quarter is
 * stale, then return the post-reset row. Caller increments after success.
 */
export async function getIntroQuotaState(env: Env, userId: number): Promise<{
  used: number; cap: number; quarter: string; tier: InvestorTier;
}> {
  await ensureInvestorPaywallSchema(env);
  const row = await env.DB.prepare(
    `SELECT investor_tier, investor_subscription_status,
            investor_quota_intros_quarter, investor_quota_intros_used
     FROM users WHERE id = ?`
  ).bind(userId).first<{
    investor_tier: string | null;
    investor_subscription_status: string | null;
    investor_quota_intros_quarter: string | null;
    investor_quota_intros_used: number | null;
  }>();
  const tier = effectiveInvestorTier(row as InvestorUser);
  const quarter = currentQuarterKey();
  const cap = INVESTOR_QUOTAS[tier].intros_per_quarter;
  let used = row?.investor_quota_intros_used ?? 0;
  if ((row?.investor_quota_intros_quarter ?? '') !== quarter) {
    await env.DB.prepare(
      `UPDATE users SET investor_quota_intros_quarter = ?, investor_quota_intros_used = 0 WHERE id = ?`
    ).bind(quarter, userId).run();
    used = 0;
  }
  return { used, cap, quarter, tier };
}

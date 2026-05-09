/**
 * Task #11 — Subscription plan catalog.
 * Task #14 — Multi-currency support (native currency + FX conversion).
 *
 * Backed by the `subscription_plans` D1 table (migration
 * `cloudflare-worker/sql/migrations/004_subscription_plans.sql`, extended by
 * `005_plan_currency_and_fx.sql`). Replaces the previously-hardcoded
 * `PLAN_MONTHLY_USD` map in analyticsReports.ts so launching a new plan in
 * Stripe (or inserting a row here) reflects in MRR/ARR immediately, without
 * a code change.
 *
 * The Stripe webhook calls `upsertPlanFromStripeSubscription` on every
 * `customer.subscription.created|updated` event so plans register the first
 * time anyone subscribes to them, capturing both the USD-normalised figure
 * (for cross-plan rollups) and the native currency + amount (for honest,
 * FX-rate-controlled display).
 */
import type { Env } from '../types';
import { getSQL } from '../db';

export interface SubscriptionPlanRow {
  plan_id: string;
  monthly_price_usd: number;
  display_name: string | null;
  stripe_price_id: string | null;
  is_active: number;
  currency: string;
  native_amount: number | null;
  native_interval: string | null;
}

/** Per-plan pricing as carried through analytics. */
export interface PlanPricing {
  usd: number;             // monthly USD (for cross-currency rollups)
  currency: string;        // ISO 4217 code Stripe charged in
  nativeAmount: number;    // monthly amount in `currency` (0 if unknown)
}

let _schemaReady = false;

/**
 * Idempotent CREATE TABLE + seed. Mirrors migrations 004 + 005 so a fresh
 * worker boot has the catalog available even if the wrangler migration
 * hasn't been applied yet (matches the pattern used by `ensureMiPaywallSchema`).
 */
export async function ensureSubscriptionPlansSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  try {
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS subscription_plans (' +
      'plan_id TEXT PRIMARY KEY, ' +
      'monthly_price_usd REAL NOT NULL, ' +
      'display_name TEXT, ' +
      'stripe_price_id TEXT, ' +
      'is_active INTEGER NOT NULL DEFAULT 1, ' +
      "created_at TEXT NOT NULL DEFAULT (datetime('now')), " +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_sub_plans_active ON subscription_plans(is_active)');
    // Task #14 — best-effort ALTERs (idempotent; "duplicate column" is fine).
    for (const a of [
      "ALTER TABLE subscription_plans ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'",
      'ALTER TABLE subscription_plans ADD COLUMN native_amount REAL',
      'ALTER TABLE subscription_plans ADD COLUMN native_interval TEXT',
    ]) {
      try { await env.DB.exec(a); }
      catch (e) { if (!/duplicate column/i.test((e as Error).message || '')) throw e; }
    }
    await env.DB.exec(
      'CREATE TABLE IF NOT EXISTS fx_rates (' +
      'currency TEXT PRIMARY KEY, ' +
      'usd_rate REAL NOT NULL, ' +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    );
    // Seed the two legacy plans. INSERT OR IGNORE so admin edits survive boot.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO subscription_plans (plan_id, monthly_price_usd, display_name, currency, native_amount, native_interval) VALUES ('mi_pro_monthly', 49, 'MI Pro · Monthly', 'USD', 49, 'month')",
    ).run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO subscription_plans (plan_id, monthly_price_usd, display_name, currency, native_amount, native_interval) VALUES ('mi_pro_annual', 39, 'MI Pro · Annual', 'USD', 468, 'year')",
    ).run();
    // Seed FX rates (illustrative; admins refresh by editing rows).
    const seed: Array<[string, number]> = [
      ['USD', 1.0], ['EUR', 0.92], ['GBP', 0.79], ['CAD', 1.37], ['AUD', 1.52],
      ['JPY', 152.0], ['INR', 83.5], ['SGD', 1.35], ['CHF', 0.88], ['SEK', 10.4],
    ];
    for (const [c, r] of seed) {
      await env.DB.prepare('INSERT OR IGNORE INTO fx_rates (currency, usd_rate) VALUES (?, ?)').bind(c, r).run();
    }
    _schemaReady = true;
  } catch (e) {
    console.warn('[subscriptionPlans] ensureSchema failed:', (e as Error).message);
  }
}

/**
 * Load every known plan as a `plan_id → PlanPricing` map. Analytics
 * functions call this once at the top of a request and pass the map down,
 * so a single report does at most one DB read for pricing.
 */
export async function loadPlanPriceMap(env: Env): Promise<Map<string, PlanPricing>> {
  await ensureSubscriptionPlansSchema(env);
  const sql = getSQL(env);
  try {
    const rows = (await sql`SELECT plan_id, monthly_price_usd, currency, native_amount FROM subscription_plans`) as Array<{
      plan_id: string;
      monthly_price_usd: number | string;
      currency: string | null;
      native_amount: number | string | null;
    }>;
    const map = new Map<string, PlanPricing>();
    for (const r of rows) {
      const usd = typeof r.monthly_price_usd === 'number' ? r.monthly_price_usd : Number(r.monthly_price_usd);
      const native = r.native_amount == null ? usd
        : (typeof r.native_amount === 'number' ? r.native_amount : Number(r.native_amount));
      if (!Number.isFinite(usd)) continue;
      map.set(r.plan_id, {
        usd,
        currency: (r.currency || 'USD').toUpperCase(),
        nativeAmount: Number.isFinite(native) ? native : usd,
      });
    }
    return map;
  } catch (e) {
    console.warn('[subscriptionPlans] loadPlanPriceMap failed:', (e as Error).message);
    return new Map();
  }
}

/** Returns the monthly USD figure for a plan (0 if unknown). */
export function priceFor(map: Map<string, PlanPricing>, plan: string | null | undefined): number {
  if (!plan) return 0;
  return map.get(plan)?.usd ?? 0;
}

/** Returns the monthly amount in the plan's native currency (0 if unknown). */
export function nativePriceFor(map: Map<string, PlanPricing>, plan: string | null | undefined): { amount: number; currency: string } {
  const row = plan ? map.get(plan) : undefined;
  if (!row) return { amount: 0, currency: 'USD' };
  return { amount: row.nativeAmount, currency: row.currency };
}

// ---------- FX ----------

export interface FxTable {
  /** ISO code → "1 USD = N <currency>". Always contains USD=1. */
  rates: Map<string, number>;
  /** Most-recent `updated_at` across loaded rows (ISO string), or null if empty. */
  asOf: string | null;
}

export async function loadFxRates(env: Env): Promise<FxTable> {
  await ensureSubscriptionPlansSchema(env);
  const sql = getSQL(env);
  const out: FxTable = { rates: new Map([['USD', 1]]), asOf: null };
  try {
    const rows = (await sql`SELECT currency, usd_rate, updated_at FROM fx_rates`) as Array<{
      currency: string; usd_rate: number | string; updated_at: string | null;
    }>;
    for (const r of rows) {
      const code = (r.currency || '').toUpperCase();
      const rate = typeof r.usd_rate === 'number' ? r.usd_rate : Number(r.usd_rate);
      if (!code || !Number.isFinite(rate) || rate <= 0) continue;
      out.rates.set(code, rate);
      if (r.updated_at && (!out.asOf || r.updated_at > out.asOf)) out.asOf = r.updated_at;
    }
  } catch (e) {
    console.warn('[subscriptionPlans] loadFxRates failed:', (e as Error).message);
  }
  return out;
}

/**
 * Convert a USD amount to `target` using the FX table. Returns 0 if the
 * target currency isn't in the table. Rounds to 2 decimals (or 0 for JPY).
 */
export function convertFromUsd(usd: number, target: string, fx: FxTable): number {
  const code = (target || 'USD').toUpperCase();
  const rate = fx.rates.get(code);
  if (!rate || !Number.isFinite(usd)) return 0;
  const raw = usd * rate;
  const decimals = code === 'JPY' ? 0 : 2;
  const m = Math.pow(10, decimals);
  return Math.round(raw * m) / m;
}

// ---------- Admin catalog management (Task #13) ----------

/**
 * Full plan rows for the admin catalog UI. Sorted with active plans first,
 * then alphabetically by plan_id so newly auto-registered Stripe-id plans
 * sort below the friendly named ones.
 */
export async function listPlansFull(env: Env): Promise<SubscriptionPlanRow[]> {
  await ensureSubscriptionPlansSchema(env);
  const sql = getSQL(env);
  try {
    const rows = (await sql`
      SELECT plan_id, monthly_price_usd, display_name, stripe_price_id, is_active,
             currency, native_amount, native_interval
        FROM subscription_plans
       ORDER BY is_active DESC, plan_id ASC
    `) as Array<SubscriptionPlanRow & { monthly_price_usd: number | string; native_amount: number | string | null }>;
    return rows.map(r => ({
      plan_id: r.plan_id,
      monthly_price_usd: typeof r.monthly_price_usd === 'number'
        ? r.monthly_price_usd
        : Number(r.monthly_price_usd),
      display_name: r.display_name ?? null,
      stripe_price_id: r.stripe_price_id ?? null,
      is_active: Number(r.is_active) ? 1 : 0,
      currency: (r.currency || 'USD').toUpperCase(),
      native_amount: r.native_amount == null ? null
        : (typeof r.native_amount === 'number' ? r.native_amount : Number(r.native_amount)),
      native_interval: r.native_interval ?? null,
    }));
  } catch (e) {
    console.warn('[subscriptionPlans] listPlansFull failed:', (e as Error).message);
    return [];
  }
}

export interface PlanCreate {
  plan_id: string;
  /**
   * Monthly USD price. Required when `currency` is USD or unset. When a
   * non-USD `currency` + `native_amount` are supplied this is ignored —
   * the USD figure is FX-derived from the native amount (matching the
   * Stripe webhook upsert path).
   */
  monthly_price_usd?: number;
  display_name?: string | null;
  stripe_price_id?: string | null;
  /** ISO 4217 code. Defaults to USD when omitted. */
  currency?: string | null;
  /**
   * Monthly amount in `currency`. Required when `currency` is non-USD;
   * defaults to `monthly_price_usd` when `currency` is USD.
   */
  native_amount?: number | null;
}

export class PlanCreateError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const PLAN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,63}$/;

/**
 * Insert a brand-new catalog row. Used by the admin "Add plan" UI so a plan
 * can be advertised before the first Stripe subscriber lands. The row is
 * inserted with `is_active=1`. Currency defaults to USD; pass a non-USD
 * `currency` + `native_amount` to launch a regional plan (Task #18) — the
 * USD figure is then FX-derived from the `fx_rates` table, matching the
 * Stripe webhook upsert path. Admins can toggle/edit via PATCH.
 *
 * Throws `PlanCreateError` (with HTTP status hint) for validation failures
 * and duplicates so the route layer can map them to clean 4xx responses.
 */
export async function createPlan(env: Env, input: PlanCreate): Promise<SubscriptionPlanRow> {
  await ensureSubscriptionPlansSchema(env);
  const planId = String(input.plan_id || '').trim();
  if (!planId) throw new PlanCreateError('plan_id is required');
  if (!PLAN_ID_RE.test(planId)) {
    throw new PlanCreateError('plan_id must be 1-64 chars: letters, digits, _ . -');
  }
  const displayName = input.display_name == null
    ? null
    : (String(input.display_name).trim().slice(0, 200) || null);
  const stripePriceId = input.stripe_price_id == null
    ? null
    : (String(input.stripe_price_id).trim().slice(0, 200) || null);

  // Task #18 — multi-currency support. When `currency` is non-USD, the
  // native amount is the source of truth and `monthly_price_usd` is
  // FX-derived (mirrors `upsertPlanFromStripeSubscription`). USD path
  // keeps its original semantics.
  const currency = String(input.currency || 'USD').toUpperCase().trim() || 'USD';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PlanCreateError('currency must be a 3-letter ISO 4217 code');
  }
  let price: number;
  let nativeAmount: number;
  if (currency === 'USD') {
    const p = Number(input.monthly_price_usd);
    if (!Number.isFinite(p) || p < 0) {
      throw new PlanCreateError('monthly_price_usd must be a non-negative number');
    }
    price = p;
    const n = input.native_amount == null ? p : Number(input.native_amount);
    nativeAmount = Number.isFinite(n) && n >= 0 ? n : p;
  } else {
    const n = Number(input.native_amount);
    if (!Number.isFinite(n) || n < 0) {
      throw new PlanCreateError('native_amount must be a non-negative number when currency is non-USD');
    }
    nativeAmount = n;
    const fx = await loadFxRates(env);
    const rate = fx.rates.get(currency);
    if (!rate || rate <= 0) {
      throw new PlanCreateError(`No FX rate available for currency "${currency}"`);
    }
    price = Number((n / rate).toFixed(2));
  }

  // Duplicate check up-front so we can return a friendly 409. The unique
  // PRIMARY KEY constraint would also catch this, but its error message is
  // engine-specific.
  const existing = (await env.DB.prepare(
    'SELECT plan_id FROM subscription_plans WHERE plan_id = ?',
  ).bind(planId).first()) as { plan_id?: string } | null;
  if (existing && existing.plan_id) {
    throw new PlanCreateError(`Plan "${planId}" already exists`, 409);
  }

  try {
    await env.DB.prepare(
      'INSERT INTO subscription_plans (plan_id, monthly_price_usd, display_name, stripe_price_id, is_active, currency, native_amount, native_interval) ' +
      "VALUES (?, ?, ?, ?, 1, ?, ?, 'month')",
    ).bind(planId, price, displayName, stripePriceId, currency, nativeAmount).run();
  } catch (e) {
    const msg = (e as Error).message || '';
    if (/UNIQUE|PRIMARY KEY/i.test(msg)) {
      throw new PlanCreateError(`Plan "${planId}" already exists`, 409);
    }
    throw e;
  }
  const all = await listPlansFull(env);
  const row = all.find(p => p.plan_id === planId);
  if (!row) throw new PlanCreateError('Plan inserted but could not be reloaded', 500);
  return row;
}

export interface PlanUpdate {
  monthly_price_usd?: number;
  display_name?: string | null;
  is_active?: boolean;
}

/**
 * Patch an existing plan row. Returns the updated row, or null if the
 * plan_id does not exist. We deliberately do NOT allow renaming `plan_id`
 * here — that's the join key against `users.mi_subscription_plan` and the
 * Stripe webhook upsert relies on it being stable.
 */
export async function updatePlan(
  env: Env,
  planId: string,
  patch: PlanUpdate,
): Promise<SubscriptionPlanRow | null> {
  await ensureSubscriptionPlansSchema(env);
  const sets: string[] = [];
  const binds: Array<string | number | null> = [];
  if (patch.monthly_price_usd !== undefined) {
    const n = Number(patch.monthly_price_usd);
    if (!Number.isFinite(n) || n < 0) throw new Error('monthly_price_usd must be a non-negative number');
    sets.push('monthly_price_usd = ?'); binds.push(n);
  }
  if (patch.display_name !== undefined) {
    const v = patch.display_name == null ? null : String(patch.display_name).trim().slice(0, 200) || null;
    sets.push('display_name = ?'); binds.push(v);
  }
  if (patch.is_active !== undefined) {
    sets.push('is_active = ?'); binds.push(patch.is_active ? 1 : 0);
  }
  if (!sets.length) {
    // Nothing to change — just return the current row.
    const cur = await listPlansFull(env);
    return cur.find(p => p.plan_id === planId) ?? null;
  }
  sets.push("updated_at = datetime('now')");
  try {
    const res = await env.DB.prepare(
      `UPDATE subscription_plans SET ${sets.join(', ')} WHERE plan_id = ?`,
    ).bind(...binds, planId).run();
    const changes = (res as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (!changes) return null;
    const cur = await listPlansFull(env);
    return cur.find(p => p.plan_id === planId) ?? null;
  } catch (e) {
    console.warn('[subscriptionPlans] updatePlan failed:', (e as Error).message);
    throw e;
  }
}

// ---------- Stripe webhook upsert ----------

interface StripePrice {
  id?: string;
  unit_amount?: number | null;
  currency?: string | null;
  recurring?: { interval?: string; interval_count?: number } | null;
}
interface StripeSubscriptionItem { price?: StripePrice | null }
interface StripeSubscriptionLike {
  items?: { data?: StripeSubscriptionItem[] } | null;
  // Legacy single-plan shape some older API versions still emit.
  plan?: (StripePrice & { interval?: string; interval_count?: number }) | null;
  metadata?: Record<string, string> | null;
}

/**
 * Convert a Stripe price (`unit_amount` in cents + `recurring.interval`) to a
 * normalised monthly USD figure. Matches the convention the analytics layer
 * uses (annual plans are stored as their monthly equivalent so MRR math is a
 * straight `subscribers * monthly_price`).
 *
 * NOTE: This function does NOT FX-convert — it assumes the input is already
 * USD. The webhook does the FX-conversion separately via `loadFxRates`.
 */
export function monthlyUsdFromStripePrice(price: StripePrice | null | undefined): number | null {
  if (!price || price.unit_amount == null) return null;
  const dollars = Number(price.unit_amount) / 100;
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  const interval = price.recurring?.interval ?? 'month';
  const count = Math.max(1, Number(price.recurring?.interval_count ?? 1));
  switch (interval) {
    case 'day':   return Number(((dollars * 30) / count).toFixed(2));
    case 'week':  return Number(((dollars * 4.345) / count).toFixed(2));
    case 'month': return Number((dollars / count).toFixed(2));
    case 'year':  return Number((dollars / (12 * count)).toFixed(2));
    default:      return Number((dollars / count).toFixed(2));
  }
}

/**
 * Convert a Stripe price to a monthly amount in the price's NATIVE currency
 * (no FX conversion). Used to populate `subscription_plans.native_amount`.
 */
export function monthlyNativeFromStripePrice(price: StripePrice | null | undefined): number | null {
  // Same maths as `monthlyUsdFromStripePrice` — divisions are unit-agnostic.
  return monthlyUsdFromStripePrice(price);
}

/**
 * Upsert a `subscription_plans` row from a Stripe subscription event payload
 * and return the resolved plan_id (so the caller can keep
 * `users.mi_subscription_plan` aligned with the catalog key).
 *
 * Plan-id resolution order:
 *   1. `preferredPlanId` — caller passes the plan currently stored on the
 *      user row. This is the value we already wrote to `users` from the
 *      checkout-session metadata, so it's the right key for backward
 *      compatibility with existing seed plans (e.g. `mi_pro_monthly`).
 *   2. `subscription.metadata.plan` — set on checkout sessions; sometimes
 *      copied onto the subscription itself.
 *   3. `price.id` — final fallback for plans launched in Stripe without
 *      explicit metadata wiring. Ensures MRR still tracks them; admins can
 *      later rename via the catalog row.
 *
 * Existing rows are NEVER overwritten on price (admins may have set the
 * canonical USD figure manually); only `stripe_price_id`, `currency`,
 * `native_amount`, `native_interval` and `updated_at` are refreshed. New
 * rows get the price derived from the Stripe payload, FX-converted to USD
 * via the `fx_rates` table.
 *
 * Returns the resolved plan_id, or null if no row could be derived.
 */
export async function upsertPlanFromStripeSubscription(
  env: Env,
  subscription: StripeSubscriptionLike,
  preferredPlanId?: string | null,
): Promise<string | null> {
  const item = subscription.items?.data?.[0];
  const price = (item?.price ?? subscription.plan ?? null) as StripePrice | null;
  if (!price) return null;
  const native = monthlyNativeFromStripePrice(price);
  if (native == null) return null;
  const currency = (price.currency || 'usd').toUpperCase();
  // FX-normalise to USD for the `monthly_price_usd` column. If the rate is
  // missing we fall back to assuming the native amount IS USD — better to
  // under-represent than to drop the plan entirely.
  await ensureSubscriptionPlansSchema(env);
  const fx = await loadFxRates(env);
  const rate = fx.rates.get(currency);
  const monthlyUsd = rate && rate > 0
    ? Number((native / rate).toFixed(2))
    : native;
  const interval = price.recurring?.interval ?? 'month';
  const planId = preferredPlanId || subscription.metadata?.plan || price.id || null;
  if (!planId) return null;
  try {
    await env.DB.prepare(
      'INSERT INTO subscription_plans (plan_id, monthly_price_usd, display_name, stripe_price_id, currency, native_amount, native_interval) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(plan_id) DO UPDATE SET ' +
      '  stripe_price_id = excluded.stripe_price_id, ' +
      '  currency        = excluded.currency, ' +
      '  native_amount   = excluded.native_amount, ' +
      '  native_interval = excluded.native_interval, ' +
      "  updated_at = datetime('now')",
    ).bind(planId, monthlyUsd, planId, price.id ?? null, currency, native, interval).run();
    return planId;
  } catch (e) {
    console.warn('[subscriptionPlans] upsertPlanFromStripeSubscription failed:', (e as Error).message);
    return null;
  }
}

/**
 * D1434 (#3703, part 2): the owner-run move from one Stripe mode to the other.
 *
 * Production ran on Stripe's sandbox (test) account, so every stored customer,
 * subscription, saved card and mirrored price is a test-mode object that live
 * keys cannot charge or read. The cutover clears them in one D1 batch, under
 * the owner's answer Q1 = A (#3703, 2026-11-02):
 *
 * - every plan paid through a sandbox subscription goes back to free (founder
 *   tier, investor tier and its accepted seat colleagues, persona account plans,
 *   Market Intel Pro);
 * - the stored customer and subscription ids are cleared (the columns from
 *   migrations 011, 027, 103 and 134);
 * - saved auto-reload cards are cleared and auto-reload is switched off;
 * - token packs are archived: their prices are the old mode's, and HQ ›
 *   Token packs creates them again on the new account;
 * - recorded subscription amounts are marked canceled and open payment alerts
 *   are closed, because they name sandbox objects;
 * - the catalogue mirror is emptied;
 * - one `stripe_mode_cutovers` row is written with the counts.
 *
 * A plan granted without a Stripe subscription (a complimentary grant) has no
 * subscription id, so it is not touched. Every count is read with bound SQL and
 * a count that cannot be read throws: the caller answers 503, never 0.
 */
import type { Env } from '../types';
import { INVESTOR_QUOTAS } from '../middleware/requireInvestorTier';

export type StripeModeName = 'test' | 'live';

/** Statuses under which a paid plan is held (the same set the webhook uses). */
const HELD = "('active', 'trialing', 'past_due')";

export interface CutoverCounts {
  customers: number;
  subscriptions: number;
  plans: number;
  mirror_rows: number;
  /** Token packs on the old mode's prices, archived so HQ can create them again in the new mode. */
  packs: number;
}

export interface CutoverRecord {
  id: number;
  from_mode: StripeModeName;
  to_mode: StripeModeName;
  reason: string;
  customers_cleared: number;
  subscriptions_cleared: number;
  plans_reset: number;
  mirror_rows_dropped: number;
  created_at: string;
}

/** Thrown when a count or the cutover history cannot be read. */
export class CutoverUnreadable extends Error {
  constructor(cause: unknown) {
    super('cutover_unreadable');
    this.cause = cause;
  }
}

// --- The predicates. One definition each, shared by the counts and the batch.

const FOUNDER_PAID = `subscription_tier <> 'free' AND stripe_subscription_id IS NOT NULL`;
const INVESTOR_PAID = `investor_tier <> 'free' AND investor_stripe_subscription_id IS NOT NULL`;
const INVESTOR_SEATS = `investor_tier <> 'free' AND investor_stripe_subscription_id IS NULL
  AND investor_seat_primary_user_id IN (SELECT id FROM users WHERE ${INVESTOR_PAID})`;
const SIDE_PAID = `subscription_id IS NOT NULL AND status IN ${HELD}`;

async function scalar(env: Env, sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number | null }>();
  const n = Number(row?.n ?? 0);
  if (!Number.isFinite(n)) throw new Error('count_not_a_number');
  return n;
}

/** What a cutover would clear now. Throws `CutoverUnreadable` on any failed read. */
export async function cutoverCounts(env: Env): Promise<CutoverCounts> {
  try {
    const [customers, subscriptions, plans, mirrorRows, packs] = await Promise.all([
      scalar(env, `SELECT
        (SELECT COUNT(*) FROM users WHERE stripe_customer_id IS NOT NULL)
      + (SELECT COUNT(*) FROM users WHERE investor_stripe_customer_id IS NOT NULL)
      + (SELECT COUNT(*) FROM account_subscriptions WHERE stripe_customer_id IS NOT NULL)
      + (SELECT COUNT(*) FROM mi_pro_subscriptions WHERE stripe_customer_id IS NOT NULL) AS n`),
      scalar(env, `SELECT
        (SELECT COUNT(*) FROM users WHERE stripe_subscription_id IS NOT NULL)
      + (SELECT COUNT(*) FROM users WHERE investor_stripe_subscription_id IS NOT NULL)
      + (SELECT COUNT(*) FROM account_subscriptions WHERE subscription_id IS NOT NULL)
      + (SELECT COUNT(*) FROM mi_pro_subscriptions WHERE subscription_id IS NOT NULL) AS n`),
      scalar(env, `SELECT
        (SELECT COUNT(*) FROM users WHERE ${FOUNDER_PAID})
      + (SELECT COUNT(*) FROM users WHERE ${INVESTOR_PAID})
      + (SELECT COUNT(*) FROM users WHERE ${INVESTOR_SEATS})
      + (SELECT COUNT(*) FROM account_subscriptions WHERE ${SIDE_PAID})
      + (SELECT COUNT(*) FROM mi_pro_subscriptions WHERE ${SIDE_PAID}) AS n`),
      scalar(env, `SELECT COUNT(*) AS n FROM stripe_products`),
      scalar(env, `SELECT COUNT(*) AS n FROM ai_token_packs WHERE archived_at IS NULL`),
    ]);
    return { customers, subscriptions, plans, mirror_rows: mirrorRows, packs };
  } catch (e) {
    throw new CutoverUnreadable(e);
  }
}

/** The members whose paid plan the cutover resets, for the notice. Throws `CutoverUnreadable`. */
export async function cutoverMembers(env: Env): Promise<number[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id AS user_id FROM users WHERE (${FOUNDER_PAID}) OR (${INVESTOR_PAID}) OR (${INVESTOR_SEATS})
       UNION SELECT user_id FROM account_subscriptions WHERE ${SIDE_PAID}
       UNION SELECT user_id FROM mi_pro_subscriptions WHERE ${SIDE_PAID}
       ORDER BY user_id`,
    ).all<{ user_id: number }>();
    return (results ?? []).map((r) => Number(r.user_id)).filter((n) => Number.isSafeInteger(n) && n > 0);
  } catch (e) {
    throw new CutoverUnreadable(e);
  }
}

/** The most recent cutover, or null when none was ever run. Throws `CutoverUnreadable`. */
export async function lastCutover(env: Env): Promise<CutoverRecord | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT id, from_mode, to_mode, reason, customers_cleared, subscriptions_cleared, plans_reset,
              mirror_rows_dropped, created_at
         FROM stripe_mode_cutovers ORDER BY id DESC LIMIT 1`,
    ).first<CutoverRecord>();
    return row ?? null;
  } catch (e) {
    throw new CutoverUnreadable(e);
  }
}

/**
 * The mode the stored Stripe objects belong to: the last cutover's target, or
 * `test` when none ran (production started on the sandbox; migration 654).
 */
export function storedMode(last: CutoverRecord | null): StripeModeName {
  return last ? last.to_mode : 'test';
}

export interface CutoverResult {
  id: number;
  customers_cleared: number;
  subscriptions_cleared: number;
  plans_reset: number;
  mirror_rows_dropped: number;
  cards_cleared: number;
  alerts_closed: number;
  packs_archived: number;
}

/**
 * Run the cutover in one D1 batch. Plans are reset before the ids they are
 * found by are cleared; the cutover row is inserted in the same batch, with
 * the counts read just before, and then corrected to the rows each statement
 * actually changed.
 */
export async function runCutover(
  env: Env,
  a: { fromMode: StripeModeName; toMode: StripeModeName; actorUserId: number; reason: string; expected: CutoverCounts },
): Promise<CutoverResult> {
  const db = env.DB;
  const plan = [
    // Plans first: their predicates read the subscription ids cleared below.
    db.prepare(`UPDATE users SET subscription_tier = 'free', subscription_status = 'cancelled',
      subscription_renews_at = NULL WHERE ${FOUNDER_PAID}`),
    // Seat colleagues before their primary, whose subscription id names them.
    db.prepare(`UPDATE users SET investor_tier = 'free', investor_subscription_status = 'cancelled',
      investor_subscription_renews_at = NULL WHERE ${INVESTOR_SEATS}`),
    db.prepare(`UPDATE users SET investor_tier = 'free', investor_subscription_status = 'cancelled',
      investor_subscription_renews_at = NULL, investor_dealroom_max = ? WHERE ${INVESTOR_PAID}`)
      .bind(INVESTOR_QUOTAS.free.dealroom_max),
    db.prepare(`UPDATE account_subscriptions SET status = 'free', plan = NULL, period_end = NULL, trial_end = NULL,
      updated_at = datetime('now') WHERE ${SIDE_PAID}`),
    db.prepare(`UPDATE mi_pro_subscriptions SET status = 'free', plan = NULL, period_end = NULL,
      updated_at = datetime('now') WHERE ${SIDE_PAID}`),
  ];
  const subs = [
    db.prepare(`UPDATE users SET stripe_subscription_id = NULL WHERE stripe_subscription_id IS NOT NULL`),
    db.prepare(`UPDATE users SET investor_stripe_subscription_id = NULL WHERE investor_stripe_subscription_id IS NOT NULL`),
    db.prepare(`UPDATE account_subscriptions SET subscription_id = NULL WHERE subscription_id IS NOT NULL`),
    db.prepare(`UPDATE mi_pro_subscriptions SET subscription_id = NULL WHERE subscription_id IS NOT NULL`),
  ];
  const customers = [
    db.prepare(`UPDATE users SET stripe_customer_id = NULL WHERE stripe_customer_id IS NOT NULL`),
    db.prepare(`UPDATE users SET investor_stripe_customer_id = NULL WHERE investor_stripe_customer_id IS NOT NULL`),
    db.prepare(`UPDATE account_subscriptions SET stripe_customer_id = NULL WHERE stripe_customer_id IS NOT NULL`),
    db.prepare(`UPDATE mi_pro_subscriptions SET stripe_customer_id = NULL WHERE stripe_customer_id IS NOT NULL`),
  ];
  const others = [
    db.prepare(`UPDATE member_ai_auto_reload SET enabled = 0, stripe_payment_method = NULL,
      disabled_reason = 'stripe_mode_cutover', updated_at = datetime('now') WHERE stripe_payment_method IS NOT NULL`),
    db.prepare(`UPDATE billing_alerts SET state = 'closed', closed_reason = 'stripe_mode_cutover',
      closed_at = datetime('now'), updated_at = datetime('now') WHERE state = 'open'`),
    db.prepare(`UPDATE member_subscription_amounts SET status = 'canceled', updated_at = datetime('now')
      WHERE status <> 'canceled'`),
    // A pack's price belongs to the old mode and cannot be charged under the new
    // keys (migration 654's header): archived, so the pricing page stops
    // offering it and HQ › Token packs creates it again on the new account.
    db.prepare(`UPDATE ai_token_packs SET on_sale = 0, archived_at = datetime('now'), updated_at = datetime('now')
      WHERE archived_at IS NULL`),
  ];
  const mirror = db.prepare(`DELETE FROM stripe_products`);
  const record = db.prepare(
    `INSERT INTO stripe_mode_cutovers (from_mode, to_mode, actor_user_id, reason, customers_cleared,
       subscriptions_cleared, plans_reset, mirror_rows_dropped) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(a.fromMode, a.toMode, a.actorUserId, a.reason, a.expected.customers, a.expected.subscriptions,
    a.expected.plans, a.expected.mirror_rows);

  const all = [...plan, ...subs, ...customers, ...others, mirror, record];
  const results = await db.batch(all);
  const changes = (i: number) => Number((results[i] as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  const sum = (from: number, n: number) => Array.from({ length: n }, (_, k) => changes(from + k)).reduce((x, y) => x + y, 0);

  let i = 0;
  const plansReset = sum(i, plan.length); i += plan.length;
  const subsCleared = sum(i, subs.length); i += subs.length;
  const customersCleared = sum(i, customers.length); i += customers.length;
  const cardsCleared = changes(i);
  const alertsClosed = changes(i + 1);
  const packsArchived = changes(i + 3);
  i += others.length;
  const mirrorDropped = changes(i); i += 1;
  const id = Number((results[i] as { meta?: { last_row_id?: number } })?.meta?.last_row_id ?? 0);

  const actual = { customers: customersCleared, subscriptions: subsCleared, plans: plansReset, mirror_rows: mirrorDropped, packs: packsArchived };
  const drifted = (Object.keys(actual) as Array<keyof CutoverCounts>).some((k) => actual[k] !== a.expected[k]);
  if (drifted && id > 0) {
    // A row changed between the read and the batch. The record keeps what was done.
    await db.prepare(
      `UPDATE stripe_mode_cutovers SET customers_cleared = ?, subscriptions_cleared = ?, plans_reset = ?,
         mirror_rows_dropped = ? WHERE id = ?`,
    ).bind(customersCleared, subsCleared, plansReset, mirrorDropped, id).run();
  }
  return {
    id,
    customers_cleared: customersCleared,
    subscriptions_cleared: subsCleared,
    plans_reset: plansReset,
    mirror_rows_dropped: mirrorDropped,
    cards_cleared: cardsCleared,
    alerts_closed: alertsClosed,
    packs_archived: packsArchived,
  };
}

/** The notice each member whose plan was reset receives (Q1 = A). */
export const CUTOVER_NOTICE = {
  type: 'billing_plan_reset',
  category: 'billing',
  title: 'Your plan is now the free plan',
  body: 'Axal VC now takes real payments. The plan on your account was set up while payments were in test, '
    + 'so nothing was charged and it has moved to the free plan. Choose a plan on Pricing to keep its features.',
  link: '/pricing',
} as const;

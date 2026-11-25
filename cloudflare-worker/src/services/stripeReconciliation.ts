/**
 * D8512 (#8512): a read-only reconciliation of the Stripe webhook. It sets the
 * events Stripe says it created against the receipts this Worker recorded in
 * `stripe_webhook_events` (migration 691, written by `routes/billing.ts`) and
 * answers one state:
 *
 *   no_events_expected          Stripe created no event in the window and no
 *                               paying subscription is on record: silence is
 *                               what should be seen.
 *   reconciled                  every settled event Stripe created has a
 *                               finished receipt here.
 *   delivery_failed_or_absent   Stripe created an event, past the grace for
 *                               delivery, that no receipt here holds: a wrong
 *                               destination, a signing secret from the other
 *                               mode or a disabled event looks like this.
 *   accepted_state_missing      a receipt was taken and never finished, so the
 *                               entitlement, alert or ledger row it should have
 *                               written is not known to exist (`handled_at` is
 *                               set only after every handler and the ledger
 *                               write succeeded).
 *   unreadable                  one side could not be read; never a zero.
 *
 * It reads and counts. It never writes, never sends an event and never
 * returns an event id, a customer, a payload or a key: the result is the
 * state, the window and counts. The Stripe side is one `GET /v1/events`
 * through `stripeCall` with the key the Worker already holds
 * (`routes/admin_stripe.ts` serves it to the Super Admin), so it adds no
 * access. The request log's view of deliveries stays in
 * `stripeWebhookDeliveries.ts`.
 */
import type { Env } from '../types';

/** How far back the two sides are compared. Stripe retries a delivery for three days. */
export const RECONCILE_WINDOW_HOURS = 72;
/** An event younger than this may still be on its way; it is not counted either way. */
export const DELIVERY_GRACE_MINUTES = 15;
/** One page of events; more than this is reported as `truncated`, never guessed. */
export const STRIPE_EVENT_PAGE = 100;

export type ReconcileState =
  | 'no_events_expected'
  | 'reconciled'
  | 'delivery_failed_or_absent'
  | 'accepted_state_missing'
  | 'unreadable';

/** What Stripe says it created: ids stay in memory and never leave this module. */
export type StripeSide =
  | { available: true; events: Array<{ id: string; created: number }>; truncated: boolean }
  | { available: false };

/** What this Worker recorded. */
export type LocalSide =
  | {
      available: true;
      /** Receipts in the window, by event id: whether each finished. */
      receipts: Map<string, boolean>;
      /** Receipts in the current mode, past the grace, never finished and not being worked on. */
      unfinished: number;
      /** Subscriptions on record that Stripe would bill. */
      paying_subscriptions: number;
    }
  | { available: false };

export type Reconciliation = {
  state: ReconcileState;
  window_hours: number;
  grace_minutes: number;
  stripe_events: number | null;
  receipted: number | null;
  not_received: number | null;
  unfinished: number | null;
  paying_subscriptions: number | null;
  truncated: boolean;
  reason: string;
};

const REASONS: Record<ReconcileState, string> = {
  no_events_expected: 'Stripe created no event in the window and no paying subscription is on record.',
  reconciled: 'Every settled event Stripe created in the window has a finished receipt.',
  delivery_failed_or_absent: 'Stripe created events in the window that no receipt here holds.',
  accepted_state_missing: 'A receipt was taken and never finished, so the state it should have written is not known to exist.',
  unreadable: 'One side could not be read, so the state is unknown rather than clean.',
};

/** The state from both sides. Pure: `nowSec` is the clock in Unix seconds. */
export function classifyStripeReconciliation(stripe: StripeSide, local: LocalSide, nowSec: number): Reconciliation {
  const base = { window_hours: RECONCILE_WINDOW_HOURS, grace_minutes: DELIVERY_GRACE_MINUTES };
  if (!stripe.available || !local.available) {
    const side = !stripe.available && !local.available ? 'Neither side' : !stripe.available ? 'Stripe' : 'The receipt table';
    return {
      ...base, state: 'unreadable', stripe_events: null, receipted: null, not_received: null, unfinished: null,
      paying_subscriptions: local.available ? local.paying_subscriptions : null,
      truncated: stripe.available ? stripe.truncated : false,
      reason: `${side} could not be read, so the state is unknown rather than clean.`,
    };
  }
  const settledBefore = nowSec - DELIVERY_GRACE_MINUTES * 60;
  const settled = stripe.events.filter((e) => e.created <= settledBefore);
  let notReceived = 0, receipted = 0, unfinishedOfStripe = 0;
  for (const e of settled) {
    const handled = local.receipts.get(e.id);
    if (handled === undefined) notReceived += 1;
    else {
      receipted += 1;
      if (!handled) unfinishedOfStripe += 1;
    }
  }
  // A receipt of a settled event that never finished is already in `unfinished`
  // when it is past the grace; the larger of the two counts it once.
  const unfinished = Math.max(local.unfinished, unfinishedOfStripe);
  const state: ReconcileState = notReceived > 0
    ? 'delivery_failed_or_absent'
    : unfinished > 0
      ? 'accepted_state_missing'
      : settled.length === 0 && local.paying_subscriptions === 0
        ? 'no_events_expected'
        : 'reconciled';
  return {
    ...base, state, stripe_events: settled.length, receipted, not_received: notReceived, unfinished,
    paying_subscriptions: local.paying_subscriptions, truncated: stripe.truncated, reason: REASONS[state],
  };
}

/** A count read back from SQL, or a throw: `null` is not a measured zero. */
function countOf(value: unknown, what: string): number {
  const n = value === null || value === undefined ? NaN : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} unreadable`);
  return n;
}

/**
 * The receipt side. `livemode` is the mode of the key the Worker runs on: a
 * receipt of the other mode is ignored by the webhook (`mode_mismatch`) and
 * never finishes, so it is not counted as unfinished. Never throws.
 */
export async function readLocalSide(env: Env, livemode: boolean): Promise<LocalSide> {
  try {
    // datetime() on both sides: `received_at` is written by datetime('now').
    const rows = (await env.DB.prepare(
      `SELECT event_id, handled_at FROM stripe_webhook_events
        WHERE datetime(received_at) >= datetime('now', ?)`,
    ).bind(`-${RECONCILE_WINDOW_HOURS} hours`).all<{ event_id: string; handled_at: string | null }>()).results ?? [];
    const receipts = new Map<string, boolean>();
    for (const r of rows) receipts.set(String(r.event_id), r.handled_at !== null);
    const open = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM stripe_webhook_events
        WHERE handled_at IS NULL AND livemode = ?
          AND datetime(received_at) <= datetime('now', ?)
          AND (processing_until IS NULL OR datetime(processing_until) <= datetime('now'))`,
    ).bind(livemode ? 1 : 0, `-${DELIVERY_GRACE_MINUTES} minutes`).first<{ n: number }>();
    // Every store that holds a Stripe subscription the account would bill.
    const paying = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM account_subscriptions
           WHERE subscription_id IS NOT NULL AND status IN ('active', 'trialing', 'past_due'))
       + (SELECT COUNT(*) FROM mi_pro_subscriptions
           WHERE subscription_id IS NOT NULL AND status IN ('active', 'trialing', 'past_due'))
       + (SELECT COUNT(*) FROM users
           WHERE stripe_subscription_id IS NOT NULL AND subscription_status IN ('active', 'trialing', 'past_due'))
       + (SELECT COUNT(*) FROM users
           WHERE investor_stripe_subscription_id IS NOT NULL
             AND investor_subscription_status IN ('active', 'trialing', 'past_due')) AS n`,
    ).first<{ n: number }>();
    return {
      available: true,
      receipts,
      unfinished: countOf(open?.n, 'unfinished receipt count'),
      paying_subscriptions: countOf(paying?.n, 'paying subscription count'),
    };
  } catch {
    return { available: false };
  }
}

type EventsPage = { data?: Array<{ id?: unknown; created?: unknown }>; has_more?: unknown };
/** The caller that reads one page from Stripe: `stripeCall` in the route, a fixture in tests. */
export type StripeGet = (path: string, query: Record<string, string>) => Promise<EventsPage>;

/**
 * The Stripe side: one `GET /v1/events` page of the event types the webhook
 * destination subscribes to, created in the window. Never throws.
 */
export async function readStripeSide(get: StripeGet, types: readonly string[], nowSec: number): Promise<StripeSide> {
  try {
    const query: Record<string, string> = {
      limit: String(STRIPE_EVENT_PAGE),
      'created[gte]': String(nowSec - RECONCILE_WINDOW_HOURS * 3600),
    };
    types.forEach((t, i) => { query[`types[${i}]`] = t; });
    const page = await get('/events', query);
    if (!page || !Array.isArray(page.data)) return { available: false };
    const events: Array<{ id: string; created: number }> = [];
    for (const e of page.data) {
      const created = Number(e?.created);
      if (typeof e?.id !== 'string' || !e.id || !Number.isFinite(created)) return { available: false };
      events.push({ id: e.id, created });
    }
    return { available: true, events, truncated: page.has_more === true };
  } catch {
    return { available: false };
  }
}

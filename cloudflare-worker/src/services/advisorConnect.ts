/**
 * The advisory practice's Stripe Connect leg — onboarding, account state, and
 * the destination charge that pays an advisor.
 *
 * NOT A NEW MECHANISM. `services/wellbeing/bookings.ts` and
 * `routes/wellbeing.ts` have run this exact shape in production since task #4
 * for the WELLBEING directory: an Express account per provider, an account
 * link for onboarding, a status refresh writing `charges_enabled` /
 * `payouts_enabled` back to the row, and a PaymentIntent with
 * `application_fee_amount` plus `transfer_data[destination]`. This is the same
 * leg over the advisory practice's own tables (migration 241), for the same
 * reason 240 built beside `experts` rather than into it: that table is the
 * wellbeing match pool, and an advisor written there joins it. D75.
 *
 * ════ NOTHING HERE CHARGES ANYONE TODAY ════════════════════════════════════
 *
 * Every money-moving function below refuses unless `settlementMode()` says
 * otherwise, and it says `'none'` unless `ADVISOR_CHARGING_ENABLED` is exactly
 * `'1'` AND a Stripe key is present. That variable is set in no environment,
 * so the charge path is written, tested and unreachable — which is the point:
 * the alternative is discovering its shape on the day the flag flips.
 *
 * THE REFUSAL IS LOUD, NEVER SILENT, and that is `util/paymentMode.ts`'s whole
 * argument: "a missing or misconfigured Stripe setup has to fail loudly, never
 * silently grant a paid entitlement". So `chargeSession` THROWS when
 * settlement is off rather than returning a falsy result a caller might read
 * as "free". A simulated success here would be a session recorded as paid
 * that nobody paid for.
 *
 * ONBOARDING IS NOT CHARGING, and the two are gated differently on purpose.
 * An advisor may connect an account and see it verify while charging is off —
 * that is exactly how a platform gets ready to switch on — so `connectLink`
 * and `refreshAccount` need a Stripe key and not the flag. Neither moves a
 * cent: one returns a URL the advisor visits, the other reads a status.
 */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';
import { cutCents, derivePayoutState, settlementMode, takeRate } from './advisorMoney';

export interface PayoutAccountRow {
  id: number;
  advisor_id: number;
  state: string;
  provider: string;
  provider_account_id: string | null;
  charges_enabled: number;
  payouts_enabled: number;
  blocked_reason: string | null;
  last_checked_at: string | null;
}

/**
 * Thrown when a money path is reached with settlement off. Callers map it.
 *
 * THE FIELD IS DECLARED, NOT A PARAMETER PROPERTY. Node's strip-only
 * TypeScript — which is how `cloudflare-worker/test/_ts-loader.mjs` loads this
 * file — refuses `constructor(public readonly mode: …)` outright:
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, because a parameter property is syntax
 * that has to be COMPILED rather than erased. `tsc` accepts it, so the shape
 * typechecks and then cannot be tested, which is the worst of both.
 */
export class SettlementDisabled extends Error {
  readonly mode: 'none';

  constructor(mode: 'none') {
    super('advisory_settlement_disabled');
    this.name = 'SettlementDisabled';
    this.mode = mode;
  }
}

/** Thrown when the advisor's account cannot take a charge yet. */
export class PayoutAccountNotReady extends Error {
  readonly state: string;

  constructor(state: string) {
    super(`payout_account_${state}`);
    this.name = 'PayoutAccountNotReady';
    this.state = state;
  }
}

const nowIso = () => new Date().toISOString();

/** Read the advisor's payout row, or null. */
export async function loadPayoutAccount(env: Env, advisorId: number): Promise<PayoutAccountRow | null> {
  return env.DB.prepare('SELECT * FROM advisor_payout_accounts WHERE advisor_id = ?')
    .bind(advisorId).first<PayoutAccountRow>();
}

/**
 * Create the row if it does not exist. `pending` and all-zero is the honest
 * starting state: an account nobody has begun is not refused, it is not yet
 * asked (D56/D68).
 */
export async function ensurePayoutAccount(
  env: Env, advisorId: number, uid: string,
): Promise<PayoutAccountRow> {
  const existing = await loadPayoutAccount(env, advisorId);
  if (existing) return existing;
  await env.DB.prepare(
    `INSERT INTO advisor_payout_accounts (uid, advisor_id, state, provider, created_at, updated_at)
     VALUES (?, ?, 'pending', 'stripe', ?, ?)
     ON CONFLICT(advisor_id) DO NOTHING`,
  ).bind(uid, advisorId, nowIso(), nowIso()).run();
  return (await loadPayoutAccount(env, advisorId))!;
}

/**
 * Start or resume Connect onboarding, returning the URL the advisor visits.
 *
 * EXPRESS, and the capabilities requested are the two this needs: `transfers`
 * so money can reach them, and `card_payments` so a destination charge can be
 * made on their behalf. The same pair `routes/wellbeing.ts` requests, because
 * asking for more than the flow uses is asking an advisor for more than it
 * needs.
 *
 * NO FLAG CHECK. Connecting an account moves no money, and an advisor
 * verifying while charging is off is how the platform gets ready to switch on.
 */
export async function connectLink(
  env: Env,
  account: PayoutAccountRow,
  email: string,
  returnPath: string,
): Promise<{ url: string }> {
  if (!env.STRIPE_SECRET_KEY) throw new Error('stripe_not_configured');
  const appUrl = (env as any).APP_URL || 'https://axal.vc';
  let accountId = account.provider_account_id;
  if (!accountId) {
    const acct = await stripeCall<{ id: string }>(env, '/accounts', {
      type: 'express',
      'capabilities[transfers][requested]': 'true',
      'capabilities[card_payments][requested]': 'true',
      email: email || '',
      'metadata[advisor_id]': String(account.advisor_id),
      // NAMES THE PRODUCT, because one Stripe platform account now carries
      // accounts for two of them. Without this, an advisory account and a
      // wellbeing account are indistinguishable in the dashboard and in any
      // reconciliation built on top of it.
      'metadata[axal_product]': 'advisory',
    });
    accountId = acct.id;
    await env.DB.prepare(
      'UPDATE advisor_payout_accounts SET provider_account_id = ?, updated_at = ? WHERE advisor_id = ?',
    ).bind(accountId, nowIso(), account.advisor_id).run();
  }
  const link = await stripeCall<{ url: string }>(env, '/account_links', {
    account: accountId,
    refresh_url: `${appUrl}${returnPath}?connect=refresh`,
    return_url: `${appUrl}${returnPath}?connect=return`,
    type: 'account_onboarding',
  });
  return { url: link.url };
}

/**
 * Ask the provider what the account can actually do, and write it back.
 *
 * THE STORED STATE IS DERIVED FROM THE ANSWER, never from the attempt. A
 * refresh that fails leaves the previous state and the previous
 * `last_checked_at` in place, because "we could not ask" is not "blocked" —
 * and the page tells those apart by the timestamp, which is why it is only
 * moved on a successful read.
 */
export async function refreshAccount(
  env: Env, account: PayoutAccountRow,
): Promise<{ refreshed: boolean; state: string; reason?: string }> {
  if (!env.STRIPE_SECRET_KEY || !account.provider_account_id) {
    return { refreshed: false, state: account.state, reason: 'not_connected' };
  }
  try {
    const acct = await stripeCall<{
      charges_enabled?: boolean; payouts_enabled?: boolean;
      requirements?: { disabled_reason?: string | null };
    }>(env, `/accounts/${account.provider_account_id}`, {}, { method: 'GET' });
    const ce = acct.charges_enabled ? 1 : 0;
    const pe = acct.payouts_enabled ? 1 : 0;
    // THE PROVIDER'S OWN WORDS where there are any. A block with no reason is
    // a state an advisor cannot act on.
    const blocked = acct.requirements?.disabled_reason || null;
    const state = derivePayoutState({ charges_enabled: ce, payouts_enabled: pe, blocked_reason: blocked });
    await env.DB.prepare(
      `UPDATE advisor_payout_accounts
          SET charges_enabled = ?, payouts_enabled = ?, blocked_reason = ?,
              state = ?, last_checked_at = ?, updated_at = ?
        WHERE advisor_id = ?`,
    ).bind(ce, pe, blocked, state, nowIso(), nowIso(), account.advisor_id).run();
    return { refreshed: true, state };
  } catch (e: any) {
    console.warn('[advisorConnect] refresh failed:', String(e?.message || e));
    return { refreshed: false, state: account.state, reason: 'refresh_failed' };
  }
}

/**
 * Charge a client for one advisory session, paying the advisor the remainder.
 *
 * A DESTINATION CHARGE with an application fee: the platform takes the fee and
 * `transfer_data[destination]` routes the rest to the advisor's connected
 * account. The fee comes from `takeRate()` — the admin-configurable setting —
 * through `cutCents`, which is the SAME function the ledger totals with. Two
 * functions computing a platform fee is how a client is charged one number and
 * an advisor is shown another.
 *
 * THREE REFUSALS, ALL LOUD, and the order matters:
 *
 *   1. Settlement off. Throws `SettlementDisabled` rather than returning
 *      anything a caller could read as success. While the flag is unset this
 *      is every call, which is intended.
 *   2. No verified payout account. Throws `PayoutAccountNotReady` with the
 *      state, so the caller can say WHICH of the three gates applied — that
 *      is what 240's `payment_state = 'held_unpaid'` records on the slot.
 *   3. Nothing to charge. A null or non-positive price is not a free session
 *      and not an error to swallow; a caller that reaches here with one has a
 *      bug upstream.
 */
export async function chargeSession(
  env: Env,
  args: {
    account: PayoutAccountRow;
    bookingUid: string;
    bookingId: number;
    advisorId: number;
    amountCents: number | null;
    currency?: string;
    description?: string;
    customerId: string;
  },
): Promise<{
  client_secret: string; payment_intent_id: string;
  application_fee_cents: number; take_rate_bps: number; mode: 'test' | 'live';
}> {
  const mode = settlementMode(env);
  if (mode === 'none') throw new SettlementDisabled('none');

  const state = derivePayoutState(args.account);
  if (state !== 'verified') throw new PayoutAccountNotReady(state);
  if (!args.account.provider_account_id) throw new PayoutAccountNotReady('pending');

  const gross = args.amountCents;
  if (gross == null || !Number.isFinite(gross) || gross <= 0) {
    throw new Error('advisory_charge_amount_missing');
  }

  const rate = await takeRate(env);
  const fee = cutCents(gross, rate.bps);
  if (fee == null) throw new Error('advisory_charge_fee_uncomputable');

  const intent = await stripeCall<{ id: string; client_secret: string }>(
    env, '/payment_intents',
    {
      amount: String(Math.trunc(gross)),
      currency: args.currency || 'usd',
      customer: args.customerId,
      'automatic_payment_methods[enabled]': 'true',
      application_fee_amount: String(fee),
      'transfer_data[destination]': args.account.provider_account_id,
      description: (args.description || 'Advisory session').slice(0, 500),
      'metadata[kind]': 'advisor_session',
      'metadata[booking_uid]': args.bookingUid,
      'metadata[booking_id]': String(args.bookingId),
      'metadata[advisor_id]': String(args.advisorId),
      // THE RATE THAT WAS APPLIED, on the intent itself. A dispute six months
      // later is settled by what Stripe recorded, not by what the setting says
      // then — the same reason 241 stamps it on the line.
      'metadata[take_rate_bps]': String(rate.bps),
      'metadata[axal_product]': 'advisory',
    },
    // One intent per booking, replayed rather than duplicated. A double-submit
    // on a money call is the failure this exists for.
    { idempotencyKey: `pi:advisory:${args.bookingUid}` },
  );

  return {
    client_secret: intent.client_secret,
    payment_intent_id: intent.id,
    application_fee_cents: fee,
    take_rate_bps: rate.bps,
    mode,
  };
}

/**
 * Webhook fulfilment: mark the booking charged and the slot with it.
 *
 * IDEMPOTENT, because Stripe redelivers. Re-running on a booking already
 * marked `collected` is a no-op rather than a second write.
 *
 * WHAT IT WRITES AND WHAT IT DOES NOT. It sets `billing_state = 'collected'`
 * and stamps the cut Stripe actually took — not a recomputation from today's
 * setting, which could have moved since the charge. It does NOT invent a
 * payout row: a payout is the provider paying the advisor out, which is a
 * later and separate event, and writing one here would assert a settlement
 * that has not happened.
 */
export async function markSessionCharged(
  env: Env, pi: Record<string, unknown>,
): Promise<void> {
  const meta = (pi.metadata as Record<string, string> | undefined) ?? {};
  const uid = meta.booking_uid;
  if (!uid) return;
  const row = await env.DB.prepare(
    'SELECT id, billing_state FROM advisor_bookings WHERE uid = ? LIMIT 1',
  ).bind(uid).first<{ id: number; billing_state: string }>();
  if (!row) return;
  if (row.billing_state === 'collected') return;

  const feeRaw = Number((pi as any).application_fee_amount);
  const fee = Number.isFinite(feeRaw) ? feeRaw : null;
  const bpsRaw = Number(meta.take_rate_bps);
  const bps = Number.isInteger(bpsRaw) ? bpsRaw : null;
  const receivedRaw = Number((pi as any).amount_received);
  const amount = Number.isFinite(receivedRaw) ? receivedRaw : null;

  await env.DB.prepare(
    `UPDATE advisor_bookings
        SET billing_state = 'collected',
            amount_cents = COALESCE(?, amount_cents),
            platform_cut_cents = COALESCE(?, platform_cut_cents),
            take_rate_bps = COALESCE(?, take_rate_bps),
            updated_at = ?
      WHERE id = ?`,
  ).bind(amount, fee, bps, nowIso(), row.id).run();

  // The slot that was held because nothing could be charged is no longer
  // held. Best-effort and scoped to the booking's own slot: a slot that was
  // never held is left alone rather than transitioned from nowhere.
  try {
    await env.DB.prepare(
      `UPDATE advisor_office_hour_slots
          SET payment_state = 'charged'
        WHERE id = (SELECT slot_id FROM advisor_bookings WHERE id = ?)
          AND payment_state IN ('held_unpaid', 'authorized')`,
    ).bind(row.id).run();
  } catch (e: any) {
    console.warn('[advisorConnect] slot payment_state update failed:', String(e?.message || e));
  }
}

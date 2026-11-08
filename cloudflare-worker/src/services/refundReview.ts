/**
 * D5037 (#5037) — a refund is reviewed before money moves: Lookup → Review → Confirm → Step-up → Refund.
 *
 * WHAT THIS FILE OWNS. The three facts a refund rests on, read the same way by the review (which moves nothing) and by
 * the write (`POST /api/admin/billing/refund`), so what the operator confirmed is what the write checks:
 *
 *   the target    the PaymentIntent and its charge as Stripe holds them now: gross, refunded to date, what is left to
 *                 refund, the currency, the customer and the local account it maps to (`resolveRefundTarget`);
 *   the policy    the per-product refund rule (Task #11), with THREE outcomes, not two: allowed, blocked, or
 *                 UNAVAILABLE. Before D5037 a policy context that could not be read (a D1 read that failed, an
 *                 incorporation or booking row that was not found) returned "allowed, kind unknown", so a Super Admin
 *                 could move money on a decision nobody made. Unavailable now needs an explicit, written, audited
 *                 override, exactly as blocked does (`decideRefundPolicy`);
 *   the review    a token the review signs over the target, the amount, what was left to refund and the policy state,
 *                 for this admin, for ten minutes. The write refuses a refund without one, so a refund can no longer be
 *                 issued from a raw identifier nobody looked at, and refuses one whose facts changed since (another
 *                 refund landed, the policy moved) rather than refunding against a screen that is no longer true.
 *
 * AMOUNTS. Everything Stripe-facing is in Stripe's units. For ISK and UGX Stripe counts hundredths although ISO 4217
 * gives them no decimals (D5029), so the review reports both: `*_cents` in the currency's own minor unit for display,
 * and the token carries Stripe's units for the write.
 */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';
import { currencyCode } from './currencies';
import { previewReferralClawback } from './referralCommissions';
import { exponentOf, parseMinor } from '../../../frontend/src/lib/money.js';

export interface StripePaymentIntent {
  id: string; amount: number; amount_received?: number; currency: string; latest_charge?: string | null;
  customer?: string | null; metadata?: Record<string, string>; status?: string;
}
export interface StripeCharge {
  id: string; amount: number; amount_captured?: number; amount_refunded?: number; currency: string; paid?: boolean;
  refunded?: boolean; payment_intent?: string | null; customer?: string | null; metadata?: Record<string, string>;
  created?: number; description?: string | null;
}

/** Stripe counts these in hundredths though ISO 4217 gives them no decimals (D5029). */
const STRIPE_HUNDREDTHS = new Set(['ISK', 'UGX']);
/** Stripe units to the currency's own minor unit. */
export const fromStripe = (n: number, currency: string | null) => (currency && STRIPE_HUNDREDTHS.has(currency) ? Math.round(n / 100) : n);
/** The currency's own minor unit to Stripe units. */
export const toStripe = (n: number, currency: string | null) => (currency && STRIPE_HUNDREDTHS.has(currency) ? n * 100 : n);

export type RefundTarget = {
  payment_intent: string | null;
  charge: string;
  currency: string | null;
  /** Stripe units. */
  gross: number;
  refunded: number;
  remaining: number;
  customer: string | null;
  metadata: Record<string, string>;
  description: string | null;
  created: number | null;
};

export type TargetRefusal = { ok: false; status: 400 | 404 | 409 | 502 | 503; code: string; message: string };

const ID = /^(pi|ch)_[A-Za-z0-9_]{1,250}$/;

/** The target as Stripe holds it now. A lookup that cannot read it refuses: nothing is reviewed against a guess. */
export async function resolveRefundTarget(
  env: Env, opts: { paymentIntentId?: string; chargeId?: string },
): Promise<{ ok: true; target: RefundTarget } | TargetRefusal> {
  const id = opts.paymentIntentId || opts.chargeId || '';
  if (!ID.test(id) || (opts.paymentIntentId && !id.startsWith('pi_')) || (opts.chargeId && !id.startsWith('ch_'))) {
    return { ok: false, status: 400, code: 'invalid_target', message: 'Give one PaymentIntent (pi_…) or Charge (ch_…) id.' };
  }
  let pi: StripePaymentIntent | null = null;
  let charge: StripeCharge | null = null;
  try {
    if (opts.paymentIntentId) {
      pi = await stripeCall<StripePaymentIntent>(env, `/payment_intents/${encodeURIComponent(opts.paymentIntentId)}`, {}, { method: 'GET' });
      if (pi?.latest_charge) charge = await stripeCall<StripeCharge>(env, `/charges/${encodeURIComponent(pi.latest_charge)}`, {}, { method: 'GET' });
    } else {
      charge = await stripeCall<StripeCharge>(env, `/charges/${encodeURIComponent(opts.chargeId!)}`, {}, { method: 'GET' });
      if (charge?.payment_intent) pi = await stripeCall<StripePaymentIntent>(env, `/payment_intents/${encodeURIComponent(charge.payment_intent)}`, {}, { method: 'GET' });
    }
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg === 'stripe_not_configured') return { ok: false, status: 503, code: 'stripe_not_configured', message: 'Stripe is not configured.' };
    const m = /^stripe_error:(\d+):/.exec(msg);
    if (m && Number(m[1]) === 404) return { ok: false, status: 404, code: 'target_not_found', message: 'Stripe has no payment with that id. Nothing was refunded.' };
    return { ok: false, status: 502, code: 'lookup_failed', message: 'The payment could not be read from Stripe, so it cannot be reviewed. Nothing was refunded.' };
  }
  if (!charge || !Number.isSafeInteger(charge.amount)) {
    return { ok: false, status: 409, code: 'no_charge', message: 'This payment has no charge yet, so there is nothing to refund.' };
  }
  const gross = Number(charge.amount_captured ?? charge.amount);
  const refunded = Number(charge.amount_refunded ?? 0);
  return {
    ok: true,
    target: {
      payment_intent: pi?.id || charge.payment_intent || null,
      charge: charge.id,
      currency: currencyCode(String(charge.currency ?? pi?.currency ?? '').toUpperCase()),
      gross, refunded, remaining: Math.max(0, gross - refunded),
      customer: charge.customer || pi?.customer || null,
      metadata: { ...(charge.metadata || {}), ...(pi?.metadata || {}) },
      description: charge.description ?? null,
      created: Number.isFinite(Number(charge.created)) ? Number(charge.created) : null,
    },
  };
}

// Incorporation statuses past which filing has begun → no refund (Task #11). 'paid' is still refundable: the line is
// drawn once filing actually progresses.
const INCORPORATION_FILED_STATUSES = new Set([
  'packet_processing', 'packet_ready', 'filed', 'submitted', 'in_review', 'completed', 'active',
]);
/** An expert booking is refundable only while the session is at least this far away. */
const SESSION_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;
const SUBSCRIPTION_KINDS = new Set(['tier', 'investor', 'mi_pro', 'subscription']);

export type PolicyState = 'allowed' | 'blocked' | 'unavailable';
export type PolicyDecision = { state: PolicyState; kind: string; reason: string | null; note: string };

/**
 * The per-product refund policy (Task #11), decided from the target the review read:
 *   incorporation  → blocked once filing has begun; UNAVAILABLE when the incorporation cannot be read or found
 *   expert_booking → blocked inside 24h of the session; UNAVAILABLE when the booking or its time cannot be read
 *   subscription   → allowed; a refund should be prorated, which the operator sets as the amount
 *   anything else  → allowed by the default rule, and said to be the default rule
 * Never throws. Never answers "allowed" for a context it could not read.
 */
export async function decideRefundPolicy(env: Env, t: RefundTarget, nowMs = Date.now()): Promise<PolicyDecision> {
  const meta = t.metadata || {};
  const kind = String(meta.kind || '').toLowerCase();
  const pi = t.payment_intent;

  if (kind === 'incorporation') {
    let status: string | null = null;
    try {
      const incId = meta.incorporation_id ? Number(meta.incorporation_id) : null;
      const r = incId
        ? await env.DB.prepare('SELECT status FROM incorporations WHERE id = ? LIMIT 1').bind(incId).first<{ status: string }>()
        : (pi ? await env.DB.prepare('SELECT status FROM incorporations WHERE stripe_payment_intent = ? LIMIT 1').bind(pi).first<{ status: string }>() : null);
      status = r?.status ?? null;
    } catch {
      return { state: 'unavailable', kind, reason: 'incorporation_unreadable', note: 'The incorporation this payment is for could not be read, so whether filing has begun is not known.' };
    }
    if (!status) return { state: 'unavailable', kind, reason: 'incorporation_not_found', note: 'No incorporation is recorded for this payment, so whether filing has begun is not known.' };
    if (INCORPORATION_FILED_STATUSES.has(status.toLowerCase())) {
      return { state: 'blocked', kind, reason: `incorporation_filed:${status}`, note: `Filing has begun (status ${status}). An incorporation is not refunded once filing starts.` };
    }
    return { state: 'allowed', kind, reason: null, note: `Filing has not begun (status ${status}).` };
  }

  if (kind === 'expert_booking') {
    let scheduledAt = NaN;
    try {
      const bid = meta.booking_id ? Number(meta.booking_id) : null;
      const r = bid
        ? await env.DB.prepare('SELECT scheduled_at FROM expert_bookings WHERE id = ? LIMIT 1').bind(bid).first<{ scheduled_at: string | null }>()
        : (pi ? await env.DB.prepare('SELECT scheduled_at FROM expert_bookings WHERE stripe_payment_intent_id = ? LIMIT 1').bind(pi).first<{ scheduled_at: string | null }>() : null);
      scheduledAt = r?.scheduled_at ? Date.parse(r.scheduled_at) : NaN;
    } catch {
      return { state: 'unavailable', kind, reason: 'booking_unreadable', note: 'The booking this payment is for could not be read, so the cancellation window cannot be checked.' };
    }
    if (!Number.isFinite(scheduledAt)) {
      return { state: 'unavailable', kind, reason: 'booking_time_unknown', note: 'No session time is recorded for this booking, so the cancellation window cannot be checked.' };
    }
    if (scheduledAt - nowMs < SESSION_CANCEL_WINDOW_MS) {
      return { state: 'blocked', kind, reason: 'session_cancel_window_passed', note: 'The session is less than 24 hours away or has happened. A booking is refunded only before that.' };
    }
    return { state: 'allowed', kind, reason: null, note: 'The session is more than 24 hours away.' };
  }

  if (SUBSCRIPTION_KINDS.has(kind)) {
    return { state: 'allowed', kind, reason: null, note: 'A subscription refund should be prorated: set the amount for the unused part.' };
  }
  return {
    state: 'allowed', kind: kind || 'unknown', reason: null,
    note: kind ? `No product rule restricts a ${kind} refund.` : 'The payment names no product kind, so the default rule applies: refundable.',
  };
}

/**
 * The amount asked for, in Stripe units, or null for "the rest". `amount` is Stripe's own minor units (the form callers
 * used before D5029); `amount_major` is what a person typed, read in the charge's currency exactly or refused.
 */
export function requestedAmount(body: Record<string, unknown>, currency: string | null):
  { ok: true; stripe: number | null } | { ok: false; status: 400 | 409; code: string; message: string; extra?: Record<string, unknown> } {
  const major = body.amount_major == null || body.amount_major === '' ? null : String(body.amount_major).trim();
  if (body.amount != null && major !== null) return { ok: false, status: 400, code: 'invalid_amount', message: 'Send amount or amount_major, not both.' };
  if (body.amount != null) {
    const n = Number(body.amount);
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, status: 400, code: 'invalid_amount', message: 'amount must be a positive integer in minor units.' };
    return { ok: true, stripe: n };
  }
  if (major === null) return { ok: true, stripe: null };
  if (!currency) {
    return { ok: false, status: 409, code: 'currency_unknown', message: 'The charge\'s currency could not be read from Stripe, so the amount cannot be converted to its minor unit. Nothing was refunded.' };
  }
  const parsed = parseMinor(major, currency);
  if (!parsed.ok || parsed.minor <= 0) {
    return { ok: false, status: 400, code: 'invalid_amount', message: parsed.ok ? 'The amount must be positive.' : parsed.message, extra: { currency, decimals: exponentOf(currency) } };
  }
  if (exponentOf(currency) === 3 && parsed.minor % 10 !== 0) {
    return { ok: false, status: 400, code: 'invalid_amount', message: `Stripe refunds ${currency} in steps of 0.010: ${major} is not a multiple of that.`, extra: { currency } };
  }
  const stripe = toStripe(parsed.minor, currency);
  if (!Number.isSafeInteger(stripe)) return { ok: false, status: 400, code: 'invalid_amount', message: 'That amount is larger than can be sent to Stripe exactly.' };
  return { ok: true, stripe };
}

/* ------------------------------------------------------------------ *
 * The review token
 * ------------------------------------------------------------------ */

/** How long a review stays confirmable. */
export const REVIEW_TTL_SECONDS = 600;

export type ReviewClaims = {
  v: 1;
  /** The admin who reviewed; only they can confirm. */
  a: number;
  pi: string | null;
  ch: string;
  cur: string | null;
  /** Requested, Stripe units; null is "the rest". */
  req: number | null;
  /** What was left to refund at review, Stripe units. */
  rem: number;
  ps: PolicyState;
  pk: string;
  iat: number;
  exp: number;
  /** One review, one intent: the idempotency key is derived from it. */
  n: string;
};

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));

async function hmac(env: Env, msg: string): Promise<Uint8Array> {
  const secret = String((env as { JWT_SECRET?: string }).JWT_SECRET || '');
  if (!secret) throw new Error('review_key_missing');
  const key = await crypto.subtle.importKey('raw', enc.encode(`refund-review:v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

export async function signReview(env: Env, claims: ReviewClaims): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(claims)));
  return `${body}.${b64u(await hmac(env, body))}`;
}

/** The claims of a review this admin signed and that has not expired, or why not. */
export async function verifyReview(env: Env, token: unknown, adminId: number, nowSec = Math.floor(Date.now() / 1000)):
  Promise<{ ok: true; claims: ReviewClaims } | { ok: false; code: 'review_required' | 'review_invalid' | 'review_expired'; message: string }> {
  if (typeof token !== 'string' || token === '') {
    return { ok: false, code: 'review_required', message: 'A refund is issued from a review. Look the payment up, check the review, then confirm it.' };
  }
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return { ok: false, code: 'review_invalid', message: 'This review is not one HQ issued. Look the payment up again.' };
  let claims: ReviewClaims;
  try {
    const want = await hmac(env, body);
    const got = unb64u(sig);
    let diff = want.length ^ got.length;
    for (let i = 0; i < Math.min(want.length, got.length); i += 1) diff |= want[i] ^ got[i];
    if (diff !== 0) return { ok: false, code: 'review_invalid', message: 'This review is not one HQ issued. Look the payment up again.' };
    claims = JSON.parse(new TextDecoder().decode(unb64u(body)));
  } catch {
    return { ok: false, code: 'review_invalid', message: 'This review is not one HQ issued. Look the payment up again.' };
  }
  if (claims.v !== 1 || claims.a !== adminId) return { ok: false, code: 'review_invalid', message: 'This review was made by another admin. Look the payment up yourself.' };
  if (!(claims.exp > nowSec)) return { ok: false, code: 'review_expired', message: 'This review has expired. Look the payment up again: what was refunded may have changed.' };
  return { ok: true, claims };
}

/** The idempotency key one review maps to: a double click on the same review is one refund. */
export async function reviewIdempotencyKey(claims: ReviewClaims): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${claims.a}:${claims.ch}:${claims.n}`)));
  return `refund-review:${[...d.slice(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/* ------------------------------------------------------------------ *
 * The review itself
 * ------------------------------------------------------------------ */

/** The local account a Stripe customer belongs to, when one is recorded. Read-only; a failed read is not "none". */
async function accountOf(env: Env, customer: string | null, meta: Record<string, string>) {
  const metaUser = Number(meta.user_id || meta.target_user_id);
  try {
    const row = customer
      ? await env.DB.prepare(
        'SELECT id, name, email FROM users WHERE stripe_customer_id = ? OR investor_stripe_customer_id = ? LIMIT 1',
      ).bind(customer, customer).first<{ id: number; name: string | null; email: string | null }>()
      : (Number.isSafeInteger(metaUser) && metaUser > 0
        ? await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ? LIMIT 1').bind(metaUser).first<{ id: number; name: string | null; email: string | null }>()
        : null);
    return row ? { known: true as const, user_id: row.id, name: row.name ?? null, email: row.email ?? null } : { known: false as const, reason: customer ? 'No account records this Stripe customer.' : 'The payment names no customer.' };
  } catch {
    return { known: false as const, reason: 'The account table could not be read.' };
  }
}

/** Build the review the operator confirms, and its token. Moves no money and writes nothing. */
export async function buildRefundReview(env: Env, adminId: number, body: Record<string, unknown>, nowMs = Date.now()) {
  const paymentIntent = typeof body.payment_intent === 'string' ? body.payment_intent.trim() : '';
  const charge = typeof body.charge === 'string' ? body.charge.trim() : '';
  if ((paymentIntent && charge) || (!paymentIntent && !charge)) {
    return { ok: false as const, status: 400 as const, code: 'invalid_target', message: 'Provide exactly one of payment_intent or charge.' };
  }
  const resolved = await resolveRefundTarget(env, { paymentIntentId: paymentIntent || undefined, chargeId: charge || undefined });
  if (!resolved.ok) return { ...resolved, ok: false as const };
  const t = resolved.target;
  if (t.remaining <= 0) {
    return { ok: false as const, status: 409 as const, code: 'nothing_refundable', message: 'This charge is already refunded in full. Nothing is left to refund.' };
  }
  const asked = requestedAmount(body, t.currency);
  if (!asked.ok) return { ok: false as const, status: asked.status, code: asked.code, message: asked.message, extra: asked.extra };
  if (asked.stripe !== null && asked.stripe > t.remaining) {
    return {
      ok: false as const, status: 409 as const, code: 'over_remaining',
      message: 'That is more than is left to refund on this charge.',
      extra: { remaining_cents: fromStripe(t.remaining, t.currency), currency: t.currency },
    };
  }
  const requested = asked.stripe ?? t.remaining;
  const policy = await decideRefundPolicy(env, t, nowMs);
  const clawback = await previewReferralClawback(env, {
    paymentIntentId: t.payment_intent, chargeAmountCents: t.gross, refundedToDateAfterCents: t.refunded + requested,
  });
  const account = await accountOf(env, t.customer, t.metadata);
  const iat = Math.floor(nowMs / 1000);
  const claims: ReviewClaims = {
    v: 1, a: adminId, pi: t.payment_intent, ch: t.charge, cur: t.currency, req: asked.stripe, rem: t.remaining,
    ps: policy.state, pk: policy.kind, iat, exp: iat + REVIEW_TTL_SECONDS, n: crypto.randomUUID(),
  };
  const d = (n: number) => fromStripe(n, t.currency);
  return {
    ok: true as const,
    review: {
      payment_intent: t.payment_intent, charge: t.charge, currency: t.currency,
      customer: t.customer, account,
      description: t.description, created_at: t.created ? new Date(t.created * 1000).toISOString() : null,
      gross_cents: d(t.gross), refunded_cents: d(t.refunded), remaining_cents: d(t.remaining),
      requested_cents: d(requested), full: requested === t.remaining,
      policy: { ...policy, override_required: policy.state !== 'allowed' },
      clawback,
      expires_at: new Date(claims.exp * 1000).toISOString(),
    },
    claims,
    review_token: await signReview(env, claims),
  };
}

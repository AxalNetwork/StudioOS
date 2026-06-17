/**
 * Task #6 — Paid event tickets.
 *
 * A paid, non-comp event registration lands as `payment_status='pending'` (the
 * seat is already held by registerPrincipal). We create a simple platform
 * Stripe PaymentIntent — NOT a Connect destination charge (there is no expert
 * to pay out) — and hand the `client_secret` back so the registrant pays via
 * the embedded Axal terminal (Stripe Elements) without leaving the app.
 *
 * Webhook (billing.ts `payment_intent.succeeded`, metadata.kind ===
 * 'event_ticket') calls fulfillEventTicket → flips the row to confirmed/paid,
 * mints a check-in code, and notifies the registrant. Idempotent on the
 * registration.
 *
 * Comp invites and free (price_cents=0) events never reach this path.
 */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';
import { ensurePaymentsCustomer } from '../routes/payments';
import type { TierUser } from '../middleware/requireTier';
import { notify } from './notify';
import { ensureCheckinCode } from './eventCapacity';

export interface EventTicketEventMin {
  id: number;
  slug: string;
  title: string;
  price_cents: number | null;
  currency: string | null;
}

export interface EventTicketRegistrationMin {
  id: number;
  user_id: number | null;
  email: string | null;
}

/**
 * Create a Stripe PaymentIntent for a paid event ticket and return its
 * `client_secret`. Persists the PI id on the registration row. Throws on
 * misconfiguration (no Stripe key) or a free/comp event reaching this path.
 */
export async function createEventTicketPaymentIntent(
  env: Env,
  event: EventTicketEventMin,
  registration: EventTicketRegistrationMin,
  payer: TierUser,
): Promise<{ client_secret: string; payment_intent_id: string; amount_cents: number; currency: string }> {
  if (!env.STRIPE_SECRET_KEY) throw new Error('stripe_not_configured');
  const amount = Number(event.price_cents || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('event_not_paid');
  const currency = (event.currency || 'usd').toLowerCase();

  // Card-on-file via the platform customer, matching /api/payments/intent and
  // the wellbeing booking flow. Plain platform charge — no Connect transfer.
  const customer = await ensurePaymentsCustomer(env, payer);

  const params: Record<string, string> = {
    amount: String(amount),
    currency,
    customer,
    'automatic_payment_methods[enabled]': 'true',
    description: `Ticket · ${event.title}`.slice(0, 500),
    'metadata[kind]': 'event_ticket',
    'metadata[event_id]': String(event.id),
    'metadata[registration_id]': String(registration.id),
    'metadata[user_id]': String(payer.id),
  };

  const intent = await stripeCall<{ id: string; client_secret: string }>(
    env, '/payment_intents', params,
    { idempotencyKey: `pi:event_ticket:${registration.id}` },
  );

  await env.DB.prepare(
    `UPDATE event_registrations SET payment_intent_id = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(intent.id, registration.id).run();

  return {
    client_secret: intent.client_secret,
    payment_intent_id: intent.id,
    amount_cents: amount,
    currency,
  };
}

/**
 * Webhook fulfilment. Flips the registration to confirmed/paid, mints a
 * check-in code, and notifies the registrant. Idempotent — re-running on an
 * already-paid registration is a no-op. The seat was already claimed at
 * registration time, so this never has to re-check capacity.
 */
export async function fulfillEventTicket(env: Env, pi: Record<string, unknown>): Promise<void> {
  const meta = (pi.metadata as Record<string, string> | undefined) ?? {};
  const registrationId = Number(meta.registration_id);
  const eventId = Number(meta.event_id);
  if (!registrationId || !eventId) return;

  const row: any = await env.DB.prepare(
    `SELECT r.id, r.event_id, r.user_id, r.email, r.status, r.payment_status,
            e.title, e.slug
       FROM event_registrations r
       JOIN events e ON e.id = r.event_id
      WHERE r.id = ? LIMIT 1`,
  ).bind(registrationId).first();
  if (!row) return;
  // Idempotent: already settled.
  if (row.payment_status === 'paid' && ['registered', 'confirmed', 'attended'].includes(row.status)) return;

  const received = Number(pi.amount_received);
  const amount = Number.isFinite(received) ? received : Number(pi.amount);
  const piId = (pi.id as string | null) ?? null;

  // A registration cancelled/declined before its PaymentIntent settled must NOT
  // be resurrected into a held seat by a late webhook. Record the payment (money
  // was captured) but only confirm + mint a check-in code + notify when a seat
  // is still held. CASE keeps a non-active status (cancelled/declined) intact.
  const seated = ['registered', 'confirmed', 'attended'].includes(row.status);

  await env.DB.prepare(
    `UPDATE event_registrations
        SET payment_status = 'paid',
            status = CASE WHEN status IN ('registered','confirmed','attended') THEN 'confirmed' ELSE status END,
            payment_intent_id = COALESCE(?, payment_intent_id),
            amount_cents = COALESCE(?, amount_cents),
            updated_at = datetime('now')
      WHERE id = ?`,
  ).bind(piId, Number.isFinite(amount) ? amount : null, registrationId).run();

  if (!seated) return;

  await ensureCheckinCode(env, eventId, registrationId);

  if (row.user_id != null) {
    await notify(env, {
      userId: Number(row.user_id), type: 'event_ticket_paid', category: 'events',
      title: `You're confirmed: ${row.title}`,
      link: `/events/${row.slug}`, payload: { event_id: eventId },
    }).catch(() => {});
  }
}

/**
 * Task #4 — Wellbeing expert booking lifecycle.
 *
 * Owns the cross-cutting flow between routes/wellbeing.ts (create checkout)
 * and routes/billing.ts (webhook fulfilment). Keeping it here means the
 * webhook handler doesn't pull in the entire wellbeing route surface.
 *
 * Flow:
 *   1. Founder hits POST /api/wellbeing/experts/:uid/book with a service_uid.
 *   2. We insert an expert_bookings row with status='pending_payment'.
 *   3. We create a Stripe PaymentIntent with metadata.kind='expert_booking'
 *      and a 15% (default, configurable) application fee on a destination
 *      transfer to the expert's connected account, and hand the client_secret
 *      back so the founder pays via the embedded Axal terminal (Stripe Elements)
 *      without leaving the app. Free-priced services skip Stripe.
 *   4. Webhook flips the row to 'confirmed', writes a calendar_events row,
 *      mints a Meet link, notifies both sides + Slack channel.
 */
import type { Env } from '../../types';
import { stripeCall } from '../../routes/billing';
import { ensurePaymentsCustomer } from '../../routes/payments';
import type { TierUser } from '../../middleware/requireTier';
import { notify } from '../notify';
import { onAxalSessionCreated } from '../calendar/sync';

const DEFAULT_APPLICATION_FEE_PCT = 15;

export interface ExpertRowMin {
  id: number;
  uid: string;
  user_id: number | null;
  name: string;
  stripe_account_id: string | null;
  stripe_charges_enabled: number;
  application_fee_pct: number | null;
}

export interface ServiceRowMin {
  id: number;
  uid: string;
  expert_id: number;
  title: string;
  duration_minutes: number;
  price_cents: number;
  currency: string;
}

export interface BookingRowMin {
  id: number;
  uid: string;
  expert_id: number;
  user_id: number;
  service_id: number | null;
  scheduled_at: string | null;
  duration_minutes: number;
  status: string;
  payment_status: string;
  booker_note: string | null;
  notes: string | null;
  amount_total_cents: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  meet_link: string | null;
}

function feePct(env: Env, expert: ExpertRowMin): number {
  const envDefault = Number((env as any).EXPERT_APPLICATION_FEE_PCT);
  const fallback = Number.isFinite(envDefault) ? envDefault : DEFAULT_APPLICATION_FEE_PCT;
  const v = expert.application_fee_pct ?? fallback;
  if (!Number.isFinite(v) || v < 0 || v > 50) return DEFAULT_APPLICATION_FEE_PCT;
  return v;
}

function jitsiMeet(uid: string): string {
  return `https://meet.jit.si/axal-${uid}`;
}

/**
 * Create a Stripe PaymentIntent for a paid booking and return its
 * `client_secret` so the founder pays via the embedded Axal terminal (Stripe
 * Elements) — no Checkout redirect. The Connect destination-charge mechanics
 * are preserved: `application_fee_amount` keeps Axal's platform fee and
 * `transfer_data[destination]` routes the remainder to the expert's connected
 * account. Throws on failure.
 */
export async function createBookingPaymentIntent(
  env: Env,
  expert: ExpertRowMin,
  service: ServiceRowMin,
  booking: BookingRowMin,
  founderUser: TierUser,
): Promise<{ client_secret: string; payment_intent_id: string; application_fee_cents: number }> {
  if (!env.STRIPE_SECRET_KEY) throw new Error('stripe_not_configured');
  if (!expert.stripe_account_id) throw new Error('expert_connect_missing');
  if (!expert.stripe_charges_enabled) throw new Error('expert_connect_not_ready');

  const pct = feePct(env, expert);
  const applicationFeeCents = Math.round(service.price_cents * (pct / 100));
  // Card-on-file via the platform customer, matching /api/payments/intent. This
  // is a destination charge (no on_behalf_of), so the customer + saved card
  // live on the platform account — no Connect gotcha.
  const customer = await ensurePaymentsCustomer(env, founderUser);

  const params: Record<string, string> = {
    amount: String(service.price_cents),
    currency: service.currency || 'usd',
    customer,
    'automatic_payment_methods[enabled]': 'true',
    setup_future_usage: 'off_session',
    application_fee_amount: String(applicationFeeCents),
    'transfer_data[destination]': expert.stripe_account_id,
    description: `${service.title} · ${expert.name}`.slice(0, 500),
    'metadata[kind]': 'expert_booking',
    'metadata[booking_uid]': booking.uid,
    'metadata[booking_id]': String(booking.id),
    'metadata[expert_id]': String(expert.id),
    'metadata[user_id]': String(booking.user_id),
  };

  const intent = await stripeCall<{ id: string; client_secret: string }>(
    env, '/payment_intents', params,
    { idempotencyKey: `pi:booking:${booking.uid}` },
  );
  return {
    client_secret: intent.client_secret,
    payment_intent_id: intent.id,
    application_fee_cents: applicationFeeCents,
  };
}

/**
 * Shared booking-confirmation core. Flips the row to confirmed/paid (idempotent
 * on an already-confirmed booking), mirrors to the calendar and fans out
 * notifications. Callers map the Stripe object's fields onto these args because
 * a Checkout Session (`amount_total`, has its own `id`) and a PaymentIntent
 * (`amount_received`, no session id) carry different shapes.
 */
async function applyBookingConfirmed(
  env: Env,
  args: {
    bookingUid: string | undefined;
    paymentIntentId: string | null;
    amount: number | null;
    currency: string | null;
    sessionId: string | null;
  },
): Promise<void> {
  const bookingUid = args.bookingUid;
  if (!bookingUid) return;

  const row = await env.DB.prepare(
    `SELECT id, uid, expert_id, user_id, service_id, scheduled_at, duration_minutes,
            status, payment_status, booker_note, notes, amount_total_cents, currency,
            stripe_session_id, stripe_payment_intent_id, meet_link
       FROM expert_bookings WHERE uid = ? LIMIT 1`,
  ).bind(bookingUid).first<BookingRowMin>();
  if (!row) return;
  if (row.status === 'confirmed' && row.payment_status === 'paid') return; // idempotent

  const meetLink = row.meet_link || jitsiMeet(row.uid);
  const amount = args.amount != null && Number.isFinite(args.amount) ? args.amount : null;
  await env.DB.prepare(
    `UPDATE expert_bookings
        SET status = 'confirmed',
            payment_status = 'paid',
            stripe_session_id = COALESCE(?, stripe_session_id),
            stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
            amount_total_cents = COALESCE(?, amount_total_cents),
            currency = COALESCE(?, currency),
            meet_link = COALESCE(meet_link, ?)
      WHERE uid = ?`,
  ).bind(
    args.sessionId, args.paymentIntentId, amount, args.currency, meetLink, bookingUid,
  ).run();

  await mirrorBookingToCalendar(env, row.id);
  await fanoutBookingNotifications(env, row.id, 'confirmed');
}

/**
 * Webhook fulfilment hook for the new embedded-terminal path. Called from
 * billing.ts on `payment_intent.succeeded` when metadata.kind ===
 * 'expert_booking'. Idempotent — re-running on a confirmed booking is a no-op.
 */
export async function confirmBookingFromPaymentIntent(
  env: Env,
  pi: Record<string, unknown>,
): Promise<void> {
  const meta = (pi.metadata as Record<string, string> | undefined) ?? {};
  const received = Number(pi.amount_received);
  const amount = Number.isFinite(received) ? received : Number(pi.amount);
  await applyBookingConfirmed(env, {
    bookingUid: meta.booking_uid,
    paymentIntentId: (pi.id as string | null) ?? null,
    amount,
    currency: (pi.currency as string | null) ?? 'usd',
    sessionId: null,
  });
}

/**
 * Legacy webhook fulfilment hook. Called from billing.ts on
 * checkout.session.completed when metadata.kind === 'expert_booking' — retained
 * to settle any Checkout sessions still in flight from before the embedded
 * terminal migration. Idempotent.
 */
export async function confirmBookingFromStripe(
  env: Env,
  obj: Record<string, unknown>,
): Promise<void> {
  const meta = (obj.metadata as Record<string, string> | undefined) ?? {};
  await applyBookingConfirmed(env, {
    bookingUid: meta.booking_uid,
    paymentIntentId: (obj.payment_intent as string | null) ?? null,
    amount: Number(obj.amount_total),
    currency: (obj.currency as string | null) ?? 'usd',
    sessionId: (obj.id as string | null) ?? null,
  });
}

/** Insert / update calendar_events row + trigger G/Outlook sync. */
export async function mirrorBookingToCalendar(env: Env, bookingId: number): Promise<void> {
  // calendar_events table is owned by services/calendar.ts and may not exist
  // in every D1; wrap in try/catch.
  try {
    const b = await env.DB.prepare(
      `SELECT b.*, e.name AS expert_name, e.user_id AS expert_user_id,
              uf.email AS founder_email, uf.name AS founder_name,
              ue.email AS expert_email
         FROM expert_bookings b
         JOIN experts e ON e.id = b.expert_id
         LEFT JOIN users uf ON uf.id = b.user_id
         LEFT JOIN users ue ON ue.id = e.user_id
        WHERE b.id = ? LIMIT 1`,
    ).bind(bookingId).first<any>();
    if (!b || !b.scheduled_at) return;
    const startIso = new Date(b.scheduled_at).toISOString();
    const endIso = new Date(new Date(b.scheduled_at).getTime() + (b.duration_minutes || 30) * 60_000).toISOString();
    const meetLink = b.meet_link || jitsiMeet(b.uid);
    const title = `Axal · ${b.expert_name} session`;
    const attendees = JSON.stringify([
      b.founder_email ? { email: b.founder_email, name: b.founder_name, role: 'founder' } : null,
      b.expert_email ? { email: b.expert_email, name: b.expert_name, role: 'expert' } : null,
    ].filter(Boolean));
    // calendar_events table shape mirrors what services/calendar.ts emits.
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS calendar_events (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         uid TEXT UNIQUE NOT NULL,
         kind TEXT NOT NULL,
         source_id INTEGER NOT NULL,
         source_uid TEXT NOT NULL,
         title TEXT NOT NULL,
         start_at TEXT NOT NULL,
         end_at TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'confirmed',
         location_kind TEXT,
         location_uri TEXT,
         organizer_email TEXT,
         attendees_json TEXT,
         notes TEXT,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO calendar_events
         (uid, kind, source_id, source_uid, title, start_at, end_at, status,
          location_kind, location_uri, organizer_email, attendees_json, notes)
       VALUES (?, 'expert_booking', ?, ?, ?, ?, ?, 'confirmed', 'video', ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET
         title = excluded.title, start_at = excluded.start_at, end_at = excluded.end_at,
         status = excluded.status, location_uri = excluded.location_uri,
         attendees_json = excluded.attendees_json, notes = excluded.notes`,
    ).bind(
      `expert_booking:${b.uid}`, b.id, b.uid, title, startIso, endIso,
      meetLink, b.expert_email || null, attendees, b.booker_note || null,
    ).run();

    // Sync to Google + Outlook for both attendees (best-effort).
    const event = {
      id: `expert_booking:${b.uid}`,
      kind: 'expert_booking' as const,
      source_id: b.id,
      source_uid: b.uid,
      title,
      start_at: startIso,
      end_at: endIso,
      status: 'confirmed',
      location_kind: 'video',
      location_uri: meetLink,
      organizer_email: b.expert_email || null,
      attendees: JSON.parse(attendees),
      notes: b.booker_note || null,
    };
    // onAxalSessionCreated resolves the relevant user calendars from the
    // event attendees itself, so a single call covers both founder and
    // expert sides without re-deriving per-user_id here.
    try { await onAxalSessionCreated(env, event as any); }
    catch (e: any) { console.warn('[wellbeing] cal sync failed:', String(e?.message || e)); }
  } catch (e: any) {
    console.warn('[wellbeing] mirrorBookingToCalendar failed:', String(e?.message || e));
  }
}

/** In-app + email + slack notify both sides. */
export async function fanoutBookingNotifications(
  env: Env,
  bookingId: number,
  phase: 'created' | 'confirmed' | 'cancelled',
): Promise<void> {
  try {
    const b = await env.DB.prepare(
      `SELECT b.*, e.name AS expert_name, e.user_id AS expert_user_id,
              uf.email AS founder_email, uf.name AS founder_name
         FROM expert_bookings b
         JOIN experts e ON e.id = b.expert_id
         LEFT JOIN users uf ON uf.id = b.user_id
        WHERE b.id = ? LIMIT 1`,
    ).bind(bookingId).first<any>();
    if (!b) return;
    const founderTitle = phase === 'confirmed'
      ? `Session confirmed with ${b.expert_name}`
      : phase === 'cancelled'
        ? `Session with ${b.expert_name} was cancelled`
        : `Session requested with ${b.expert_name}`;
    const expertTitle = phase === 'confirmed'
      ? `New paid session booked`
      : phase === 'cancelled'
        ? `Session cancelled`
        : `New booking request`;
    const founderBody = b.scheduled_at
      ? `Scheduled ${new Date(b.scheduled_at).toUTCString()}. ${b.meet_link ? `Join: ${b.meet_link}` : ''}`.trim()
      : 'Awaiting expert to confirm a time.';
    const expertBody = b.scheduled_at
      ? `Booker note: ${b.booker_note ? b.booker_note.slice(0, 280) : '(none)'}`
      : `Founder request — please confirm a time.`;

    if (b.user_id) {
      await notify(env, {
        userId: b.user_id, type: `expert_booking_${phase}`,
        title: founderTitle, body: founderBody,
        link: `/wellbeing?booking=${b.uid}`,
        channels: ['in_app', 'email'],
        category: 'calendar',
      });
    }
    if (b.expert_user_id) {
      await notify(env, {
        userId: b.expert_user_id, type: `expert_booking_${phase}`,
        title: expertTitle, body: expertBody,
        link: `/wellbeing/expert-dashboard?booking=${b.uid}`,
        channels: ['in_app', 'email', 'slack'],
        category: 'calendar',
      });
    }
  } catch (e: any) {
    console.warn('[wellbeing] fanoutBookingNotifications failed:', String(e?.message || e));
  }
}

/**
 * D794 (#2219) — opt-in auto-reload of AI tokens: the member's saved card is
 * charged off-session for their chosen pack when a settled run takes their
 * top-up balance below their threshold.
 *
 * EVERY RELOAD IS AN ORDINARY PACK PURCHASE (D755). It is priced by the
 * catalogue (`priceCart`), judged by `tokenPackQuote` (on sale, the five orders
 * a day, the $1,000 balance ceiling, the dispute and shortfall holds), written
 * as a pending order with its `ai_topup_purchases` row, and credited by the
 * verified `payment_intent.succeeded` webhook alone, which also renders the
 * order's invoice. A refund or a dispute takes it back as it does any pack.
 *
 * THE ORDER OF A CHARGE. The PaymentIntent is created unconfirmed, the order
 * and its purchase row are written, and only then is it confirmed off-session.
 * Confirming on create could let the webhook arrive before the purchase row,
 * and a payment with no purchase row credits nothing.
 *
 * ONE CROSSING, ONE CHARGE.
 *   - The queue job (`services/aiAutoReloadDue.ts`) runs under a per-member
 *     lock (`member_ai_reload_locks`), so two jobs never charge together.
 *   - The crossing is claimed (`last_crossing`) before Stripe is called, so a
 *     second job for the same crossing finds it taken.
 *   - Stripe's idempotency key is `reload:<user>:<crossing>:<settings version>`,
 *     so a retry of the same attempt returns the same payment, never a second
 *     one. The version is the settings' `updated_at`, which only the member's
 *     own save moves: after a declined card, a re-enabled reload is a new
 *     attempt, not a replay of the decline.
 *   - A transient failure (Stripe 5xx, 429, the network) hands the crossing
 *     back, and the next settlement tries again with the same key.
 *
 * A CARD THAT FAILS TURNS AUTO-RELOAD OFF. A declined card, a bank asking to
 * authenticate, or a saved card Stripe will not charge sets `enabled = 0` with
 * the reason, hands the crossing back (nothing was charged), and tells the
 * member once, in the app and by email. Nothing is credited.
 */
import type { Env } from '../types';
import { AI_USD_SCALE } from './aiBudget';
import { dueState } from './aiAutoReloadDue';

/** The one constant block for D794. */
export const AUTO_RELOAD_LIMITS = Object.freeze({
  /** A threshold is from $0 to $500. */
  maxThresholdMicrousd: 500 * AI_USD_SCALE,
  /** A lock left by a crashed job expires after this. */
  lockSeconds: 120,
});

export type ReloadDisabledReason = 'card_declined' | 'authentication_required' | 'card_unusable' | 'pack_unavailable';
/** What one job did: 'charged', a reason it was not due or not allowed, or the reason it turned auto-reload off. */
export type ReloadOutcome = string;

/** What the member is told when a reason turns auto-reload off. Never the card's details. */
export const DISABLED_WORDS: Readonly<Record<ReloadDisabledReason, string>> = Object.freeze({
  card_declined: 'Auto-reload is off: your card was declined. Update it on Billing.',
  authentication_required: 'Auto-reload is off: your bank asked to confirm the payment. Update your card on Billing.',
  card_unusable: 'Auto-reload is off: your saved card could not be charged. Update it on Billing.',
  pack_unavailable: 'Auto-reload is off: its token pack is no longer sold. Choose another pack on Billing.',
});

async function noteOutcome(env: Env, userId: number, outcome: string): Promise<void> {
  await env.DB.prepare(`UPDATE member_ai_auto_reload SET last_outcome = ?, last_attempt_at = datetime('now') WHERE user_id = ?`)
    .bind(outcome, userId).run();
}

/**
 * Turn auto-reload off for `reason`, hand back any claimed crossing (nothing
 * was charged), and tell the member once: only the write that turned it off
 * sends the notice.
 */
export async function disableAutoReload(env: Env, userId: number, reason: ReloadDisabledReason): Promise<boolean> {
  const r = await env.DB.prepare(`UPDATE member_ai_auto_reload
      SET enabled = 0, disabled_reason = ?, last_outcome = ?, last_crossing = NULL, last_attempt_at = datetime('now')
    WHERE user_id = ? AND enabled = 1`).bind(reason, reason, userId).run();
  const turnedOff = Number(r.meta?.changes ?? 0) === 1;
  if (turnedOff) {
    try {
      const { notify } = await import('./notify');
      await notify(env, {
        userId, type: 'ai_auto_reload_off', category: 'billing', title: 'Auto-reload is off',
        body: DISABLED_WORDS[reason], link: '/account/billing#auto-reload',
        payload: { reason }, channels: ['in_app', 'email'],
      });
    } catch { /* best-effort: the setting is already off */ }
  }
  return turnedOff;
}

/**
 * The platform's stops before a charge. D788 (#2213) adds the member's monthly
 * spend limit and D791 (#2216) adds HQ's Pause AI here, each once it merges;
 * `tokenPackQuote` already applies the five orders a day.
 */
export async function reloadBlocked(_env: Env, _userId: number): Promise<string | null> {
  return null;
}

/** A Stripe failure that may pass on a retry: 5xx, 429, or no answer at all. */
function transient(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  if (typeof status !== 'number') return true;
  return status >= 500 || status === 429;
}

/** Which reason a failed off-session charge turns auto-reload off for. */
export function reasonFor(code: string | null | undefined, status?: number | null): ReloadDisabledReason {
  if (code === 'authentication_required') return 'authentication_required';
  if (status === 402 || code === 'card_declined' || code === 'expired_card' || code === 'insufficient_funds'
    || code === 'incorrect_cvc' || code === 'processing_error') return 'card_declined';
  return 'card_unusable';
}

async function takeLock(env: Env, userId: number): Promise<boolean> {
  const r = await env.DB.prepare(`INSERT INTO member_ai_reload_locks(user_id, locked_until) VALUES(?, datetime('now', ?))
      ON CONFLICT(user_id) DO UPDATE SET locked_until = excluded.locked_until
      WHERE member_ai_reload_locks.locked_until <= datetime('now')`)
    .bind(userId, `+${AUTO_RELOAD_LIMITS.lockSeconds} seconds`).run();
  return Number(r.meta?.changes ?? 0) === 1;
}

/** The queue job: one reload for one member, under their lock. Never throws on a refusal or a card failure. */
export async function runAutoReload(env: Env, userId: number): Promise<ReloadOutcome> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return 'invalid';
  if (!(await takeLock(env, userId))) return 'locked';
  try {
    return await reload(env, userId);
  } finally {
    await env.DB.prepare('DELETE FROM member_ai_reload_locks WHERE user_id = ?').bind(userId).run();
  }
}

async function reload(env: Env, userId: number): Promise<ReloadOutcome> {
  const state = await dueState(env, userId);
  if (!state) return 'off';
  if (!state.due || !state.crossing) return 'not_due';
  const crossing = state.crossing;

  const blocked = await reloadBlocked(env, userId);
  if (blocked) { await noteOutcome(env, userId, blocked); return blocked; }

  const settings = await env.DB.prepare(`SELECT pack_uid, stripe_payment_method, updated_at FROM member_ai_auto_reload WHERE user_id = ?`)
    .bind(userId).first<{ pack_uid: string; stripe_payment_method: string; updated_at: string }>();
  if (!settings) return 'off';
  const pack = await env.DB.prepare('SELECT price_id, archived_at FROM ai_token_packs WHERE uid = ?')
    .bind(settings.pack_uid).first<{ price_id: string; archived_at: string | null }>();
  if (!pack || pack.archived_at !== null) { await disableAutoReload(env, userId, 'pack_unavailable'); return 'pack_unavailable'; }

  const orders = await import('./orders');
  const priced = await orders.priceCart(env, [{ price_id: pack.price_id, quantity: 1 }]);
  if ('error' in priced) { await noteOutcome(env, userId, 'pack_not_on_sale'); return 'pack_not_on_sale'; }
  const { tokenPackQuote } = await import('./aiCredits');
  const quote = await tokenPackQuote(env, userId, priced, '');
  if (!quote) { await noteOutcome(env, userId, 'pack_not_on_sale'); return 'pack_not_on_sale'; }
  if ('error' in quote) {
    const outcome = quote.error === 'token_pack_not_on_sale' ? 'pack_not_on_sale' : quote.error;
    await noteOutcome(env, userId, outcome);
    return outcome;
  }

  const user = await env.DB.prepare('SELECT id, uid, stripe_customer_id FROM users WHERE id = ?')
    .bind(userId).first<{ id: number; uid: string; stripe_customer_id: string | null }>();
  if (!user?.stripe_customer_id) { await disableAutoReload(env, userId, 'card_unusable'); return 'card_unusable'; }
  const last = await env.DB.prepare(`SELECT billing_country FROM orders WHERE user_id = ? AND status = 'paid' AND billing_country IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`).bind(userId).first<{ billing_country: string }>().catch(() => null);
  const billingCountry = last?.billing_country ?? null;
  const cart = priced;
  const vatCents = Math.round(cart.subtotal * orders.vatRate(billingCountry));
  const total = cart.subtotal + vatCents;

  // The attempt: this crossing under these settings. Claimed before Stripe is called.
  const version = String(settings.updated_at).replace(/[^0-9]/g, '');
  const attempt = `reload:${userId}:${crossing}:${version}`;
  const claim = await env.DB.prepare(`UPDATE member_ai_auto_reload SET last_crossing = ?, last_outcome = 'charging', last_attempt_at = datetime('now')
      WHERE user_id = ? AND enabled = 1 AND last_crossing IS NOT ?`).bind(crossing, userId, crossing).run();
  if (Number(claim.meta?.changes ?? 0) !== 1) return 'not_due';
  const handBack = () => env.DB.prepare(`UPDATE member_ai_auto_reload SET last_crossing = ? WHERE user_id = ? AND last_crossing = ?`)
    .bind(state.last_crossing, userId, crossing).run();

  const orderId = `ord_${await orders.sha1Hex(attempt)}`;
  const prior = await env.DB.prepare('SELECT order_ref FROM orders WHERE id = ?').bind(orderId).first<{ order_ref: string }>().catch(() => null);
  const orderRef = prior?.order_ref ?? orders.makeOrderRef();
  const { stripeCall } = await import('../routes/billing');
  try {
    const intent = await stripeCall<{ id: string }>(env, '/payment_intents', {
      customer: user.stripe_customer_id,
      amount: String(total),
      currency: cart.currency,
      payment_method: settings.stripe_payment_method,
      'payment_method_types[0]': 'card',
      'metadata[kind]': 'cart_order',
      'metadata[order_ref]': orderRef,
      'metadata[user_id]': String(userId),
      'metadata[uid]': user.uid,
      'metadata[items]': cart.lines.map((l) => `${l.price_id}:${l.quantity}`).join(',').slice(0, 500),
      'metadata[auto_reload]': '1',
    }, { idempotencyKey: attempt, moneyKind: 'marketplace' });
    await orders.upsertPendingOrder(env, {
      id: orderId, orderRef, userId, currency: cart.currency, subtotal: cart.subtotal, discountCents: 0, vatCents, total,
      promoCode: null, billingCountry, paymentIntentId: intent.id, items: cart.lines,
    });
    const { recordAiTopupPurchase } = await import('./aiTopups');
    await recordAiTopupPurchase(env, { paymentIntentId: intent.id, orderRef, userId, totalCents: total, currency: cart.currency, quote });
    const confirmed = await stripeCall<{ id: string; status: string; last_payment_error?: { code?: string } | null }>(
      env, `/payment_intents/${encodeURIComponent(intent.id)}/confirm`,
      { payment_method: settings.stripe_payment_method, off_session: 'true' },
      { idempotencyKey: `${attempt}:confirm` },
    );
    if (confirmed.status === 'succeeded' || confirmed.status === 'processing') {
      await noteOutcome(env, userId, 'charged');
      return 'charged';
    }
    const reason = confirmed.status === 'requires_action' ? 'authentication_required' : reasonFor(confirmed.last_payment_error?.code ?? null);
    await disableAutoReload(env, userId, reason);
    return reason;
  } catch (e) {
    if (transient(e)) {
      await handBack();
      await noteOutcome(env, userId, 'error');
      return 'error';
    }
    const reason = reasonFor((e as { code?: string | null }).code ?? null, (e as { status?: number }).status ?? null);
    await disableAutoReload(env, userId, reason);
    return reason;
  }
}

/**
 * The verified `payment_intent.payment_failed` webhook, for a reload whose
 * charge failed after it was confirmed. Any other payment is left alone.
 */
export async function onReloadPaymentFailed(env: Env, pi: any): Promise<boolean> {
  const meta = pi?.metadata ?? {};
  if (meta.kind !== 'cart_order' || meta.auto_reload !== '1') return false;
  const userId = Number(meta.user_id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return false;
  return disableAutoReload(env, userId, reasonFor(pi.last_payment_error?.code ?? null));
}


// ---------------------------------------------------------------------------
// The member's settings: read, save, and a card saved for off-session use.
// ---------------------------------------------------------------------------

type Member = { id: number; uid: string; email?: string | null; name?: string | null; stripe_customer_id?: string | null };

/** The settings as the member reads them, with the saved card's brand and last four from Stripe. */
export async function readAutoReload(env: Env, user: Member) {
  const row = await env.DB.prepare(`SELECT enabled, pack_uid, threshold_microusd, stripe_payment_method, last_attempt_at, last_outcome, disabled_reason
    FROM member_ai_auto_reload WHERE user_id = ?`).bind(user.id).first<any>();
  if (!row) return { enabled: false, pack_uid: null, threshold_usd: null, card: null, card_unreadable: false, last_attempt_at: null, last_outcome: null, disabled_reason: null };
  let card: { brand: string | null; last4: string | null } | null = null;
  let cardUnreadable = false;
  if (row.stripe_payment_method) {
    try {
      const { stripeCall } = await import('../routes/billing');
      const pm = await stripeCall<{ customer?: string | null; card?: { brand?: string; last4?: string } }>(
        env, `/payment_methods/${encodeURIComponent(row.stripe_payment_method)}`, {}, { method: 'GET' });
      card = pm.customer && pm.customer === user.stripe_customer_id ? { brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null } : null;
    } catch { cardUnreadable = true; }
  }
  return {
    enabled: row.enabled === 1, pack_uid: row.pack_uid, threshold_usd: row.threshold_microusd / AI_USD_SCALE,
    card, card_unreadable: cardUnreadable,
    last_attempt_at: row.last_attempt_at, last_outcome: row.last_outcome, disabled_reason: row.disabled_reason,
  };
}

export type SaveRefusal = { ok: false; status: 400; error: string; field?: string; message: string };

/** A US-dollar threshold: a number from 0 to the maximum, with at most two decimals. */
export function thresholdMicro(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(String(raw))) return null;
  const micro = Math.round(raw * 100) * (AI_USD_SCALE / 100);
  return micro <= AUTO_RELOAD_LIMITS.maxThresholdMicrousd ? micro : null;
}

/**
 * Save `{ enabled, pack_uid, threshold_usd, setup_intent_id? }`. The pack must
 * be one HQ sells and has not archived, and on sale to be turned on. A card
 * comes only from a SetupIntent this member completed for auto-reload on their
 * own Stripe customer, read back from Stripe here: never a payment method id
 * the browser names.
 */
export async function saveAutoReload(env: Env, user: Member, body: any): Promise<{ ok: true } | SaveRefusal> {
  const bad = (error: string, field: string, message: string): SaveRefusal => ({ ok: false, status: 400, error, field, message });
  if (typeof body?.enabled !== 'boolean') return bad('invalid_enabled', 'enabled', 'Say whether auto-reload is on.');
  const packUid = body.pack_uid;
  if (typeof packUid !== 'string' || !packUid || packUid.length > 64) return bad('invalid_pack', 'pack_uid', 'Choose a token pack.');
  const threshold = thresholdMicro(body.threshold_usd);
  if (threshold === null) return bad('invalid_threshold', 'threshold_usd', 'Enter a threshold from $0 to $500, with at most two decimals.');
  const setupIntentId = body.setup_intent_id;
  if (setupIntentId !== undefined && setupIntentId !== null && (typeof setupIntentId !== 'string' || !/^seti_[A-Za-z0-9]+$/.test(setupIntentId)))
    return bad('invalid_setup_intent', 'setup_intent_id', 'That card setup is not one this page started.');

  const pack = await env.DB.prepare('SELECT price_id, archived_at FROM ai_token_packs WHERE uid = ?').bind(packUid).first<{ price_id: string; archived_at: string | null }>();
  if (!pack || pack.archived_at !== null) return bad('pack_unavailable', 'pack_uid', 'That token pack is not sold.');
  if (body.enabled) {
    const { tokenPackForPrice, packOnSale } = await import('./aiCredits');
    const sold = await tokenPackForPrice(env, pack.price_id);
    if (!sold || !(await packOnSale(env, sold))) return bad('pack_not_on_sale', 'pack_uid', 'That token pack is not on sale now.');
  }

  let newMethod: string | null = null;
  if (typeof setupIntentId === 'string') {
    const { stripeCall } = await import('../routes/billing');
    const si = await stripeCall<{ status?: string; customer?: string | null; usage?: string; payment_method?: string | null; metadata?: Record<string, string> }>(
      env, `/setup_intents/${encodeURIComponent(setupIntentId)}`, {}, { method: 'GET' });
    if (si.status !== 'succeeded' || !user.stripe_customer_id || si.customer !== user.stripe_customer_id || si.usage !== 'off_session'
      || si.metadata?.user_id !== String(user.id) || si.metadata?.purpose !== 'ai_auto_reload'
      || typeof si.payment_method !== 'string' || !/^pm_[A-Za-z0-9]+$/.test(si.payment_method))
      return bad('card_not_saved', 'setup_intent_id', 'The card was not saved. Add it again.');
    newMethod = si.payment_method;
  }
  const existing = await env.DB.prepare('SELECT stripe_payment_method FROM member_ai_auto_reload WHERE user_id = ?')
    .bind(user.id).first<{ stripe_payment_method: string | null }>();
  if (body.enabled && !newMethod && !existing?.stripe_payment_method) return bad('card_required', 'setup_intent_id', 'Add a card before turning auto-reload on.');

  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO member_ai_auto_reload(user_id, enabled, pack_uid, threshold_microusd, stripe_payment_method, updated_at)
        VALUES(?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, pack_uid = excluded.pack_uid,
        threshold_microusd = excluded.threshold_microusd,
        stripe_payment_method = COALESCE(excluded.stripe_payment_method, member_ai_auto_reload.stripe_payment_method),
        disabled_reason = CASE WHEN excluded.enabled = 1 THEN NULL ELSE member_ai_auto_reload.disabled_reason END,
        updated_at = datetime('now')`)
      .bind(user.id, body.enabled ? 1 : 0, packUid, threshold, newMethod),
    env.DB.prepare(`INSERT INTO activity_logs(action, details, actor, user_id) VALUES('ai_auto_reload_saved', ?, ?, ?)`)
      .bind(JSON.stringify({ enabled: body.enabled, pack_uid: packUid, threshold_microusd: threshold, card_changed: Boolean(newMethod) }), String(user.id), user.id),
  ]);
  if (results.some((r) => r.success !== true)) throw new Error('Auto-reload settings unreadable');
  return { ok: true };
}

/**
 * A SetupIntent on the member's own Stripe customer, `usage = off_session`, for
 * a card entered on Stripe's own element. Only its client secret leaves the
 * Worker; the saved card is read back from Stripe when the settings are saved.
 */
export async function createReloadSetup(env: Env, user: Member, nonce: string) {
  const { ensurePaymentsCustomer } = await import('../routes/payments');
  const { stripeCall } = await import('../routes/billing');
  const customer = await ensurePaymentsCustomer(env, user as any);
  const si = await stripeCall<{ id: string; client_secret: string }>(env, '/setup_intents', {
    customer, usage: 'off_session', 'payment_method_types[0]': 'card',
    'metadata[user_id]': String(user.id), 'metadata[uid]': user.uid, 'metadata[purpose]': 'ai_auto_reload',
  }, { idempotencyKey: `si_reload:${user.id}:${nonce}` });
  return { client_secret: si.client_secret, setup_intent_id: si.id };
}

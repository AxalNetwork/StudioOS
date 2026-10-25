/** D1133 (#3013): prepare the caller's failed renewal for an in-page Stripe form.
 * No charge is confirmed here. No card, client secret or provider error is stored.
 * These actions reuse Billing's recent-TOTP policy for card changes.
 */
import type { Env } from '../types';
import { subscriptionOwner } from './planSubscription';

const invoiceId = /^in_[A-Za-z0-9]+$/;
const subscriptionId = /^sub_[A-Za-z0-9]+$/;
const customerId = /^cus_[A-Za-z0-9]+$/;
const ref = (v: unknown): string | null => typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;
export type RecoveryResult = { ok: true; client_secret: string; kind: 'payment' | 'setup'; scope: 'founder' | 'investor' }
  | { ok: false; status: 400 | 404 | 409; error: 'alert_not_found' | 'payment_not_needed' | 'invalid_nonce' };

export async function prepareRenewal(env: Env, userId: number, alertId: number, action: 'pay' | 'update-card', nonce?: unknown): Promise<RecoveryResult> {
  if (!Number.isSafeInteger(alertId) || alertId <= 0) return { ok: false, status: 404, error: 'alert_not_found' };
  const row = await env.DB.prepare(
    `SELECT invoice_id, subscription_id FROM billing_alerts
      WHERE id = ? AND user_id = ? AND kind = 'payment_failed' AND state = 'open'`,
  ).bind(alertId, userId).first<{ invoice_id: string; subscription_id: string }>();
  if (!row || !invoiceId.test(row.invoice_id) || !subscriptionId.test(row.subscription_id)
    || await subscriptionOwner(env, row.subscription_id) !== userId) return { ok: false, status: 404, error: 'alert_not_found' };
  if (action === 'update-card' && (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(nonce))) return { ok: false, status: 400, error: 'invalid_nonce' };
  const user = await env.DB.prepare('SELECT stripe_customer_id, investor_stripe_customer_id, investor_stripe_subscription_id FROM users WHERE id = ?')
    .bind(userId).first<{ stripe_customer_id: string | null; investor_stripe_customer_id: string | null; investor_stripe_subscription_id: string | null }>();
  const { stripeCall } = await import('../routes/billing');
  const invoice = await stripeCall<{ id: string; subscription?: unknown; customer?: unknown; status?: string; paid?: boolean; payment_intent?: { id?: string; client_secret?: string; status?: string; customer?: unknown } }>(
    env, `/invoices/${row.invoice_id}`, { 'expand[]': 'payment_intent' }, { method: 'GET' },
  );
  const customer = ref(invoice.customer);
  if (invoice.id !== row.invoice_id || ref(invoice.subscription) !== row.subscription_id || !customer || !customerId.test(customer)
    || ![user?.stripe_customer_id, user?.investor_stripe_customer_id].includes(customer)) return { ok: false, status: 404, error: 'alert_not_found' };
  if (invoice.paid || invoice.status !== 'open') return { ok: false, status: 409, error: 'payment_not_needed' };
  const scope = row.subscription_id === user?.investor_stripe_subscription_id ? 'investor' : 'founder';
  if (action === 'pay') {
    const pi = invoice.payment_intent;
    if (!pi?.id || !/^pi_[A-Za-z0-9]+$/.test(pi.id) || !pi.client_secret || ref(pi.customer) !== customer
      || !['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(String(pi.status))) return { ok: false, status: 409, error: 'payment_not_needed' };
    return { ok: true, kind: 'payment', client_secret: pi.client_secret, scope };
  }
  const setup = await stripeCall<{ client_secret?: string }>(env, '/setup_intents', {
    customer, usage: 'off_session', 'payment_method_types[0]': 'card',
  }, { idempotencyKey: `renewal_card:${userId}:${alertId}:${nonce}` });
  if (!setup.client_secret) throw new Error('renewal_setup_unavailable');
  return { ok: true, kind: 'setup', client_secret: setup.client_secret, scope };
}

/** One opaque, idempotent activity key. Details contain only an allowlisted family. */
export async function activityKey(action: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${action}:${key}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function paymentActivity(env: Env, userId: number, key: string, reason: string) {
  const uid = await activityKey('payment_refused', key);
  await env.DB.prepare(`INSERT OR IGNORE INTO activity_logs (uid, user_id, action, actor, details) VALUES (?, ?, ?, ?, ?)`)
    .bind(uid, userId, 'payment_refused', 'stripe', JSON.stringify({ reason_family: reason })).run();
}

/** Verified payment_intent.payment_failed, linked to a recorded plan subscription. */
export async function recordCheckoutRefusal(env: Env, eventId: unknown, pi: Record<string, unknown>) {
  if (typeof eventId !== 'string' || !/^evt_[A-Za-z0-9]+$/.test(eventId)) return;
  const id = ref(pi.invoice);
  if (!id || !invoiceId.test(id)) return;
  const { stripeCall } = await import('../routes/billing');
  const invoice = await stripeCall<{ subscription?: unknown; customer?: unknown; billing_reason?: string }>(env, `/invoices/${id}`, {}, { method: 'GET' }).catch(() => { throw new Error('payment_event_unreadable'); });
  if (invoice.billing_reason !== 'subscription_create') return;
  const sub = ref(invoice.subscription);
  if (!sub || !subscriptionId.test(sub)) return;
  let owner = await subscriptionOwner(env, sub);
  // The first decline can precede subscription.created. Read the trusted Stripe
  // subscription and bind its customer to the recorded member, never the browser.
  if (!owner) {
    const subscription = await stripeCall<{ customer?: unknown; metadata?: { kind?: string; user_id?: string } }>(env, `/subscriptions/${sub}`, {}, { method: 'GET' })
      .catch(() => { throw new Error('payment_event_unreadable'); });
    const candidate = Number(subscription.metadata?.user_id);
    const customer = ref(subscription.customer);
    if (!Number.isSafeInteger(candidate) || candidate <= 0 || !customer || !customerId.test(customer)
      || customer !== ref(invoice.customer) || !['tier', 'investor', 'plan', 'mi'].includes(subscription.metadata?.kind || '')) return;
    const member = await env.DB.prepare('SELECT id FROM users WHERE id = ? AND (stripe_customer_id = ? OR investor_stripe_customer_id = ?)')
      .bind(candidate, customer, customer).first<{ id: number }>();
    owner = member?.id ?? null;
  }
  if (!owner) return;
  const e = pi.last_payment_error as { code?: string; type?: string } | null;
  const family = e?.code === 'authentication_required' ? 'authentication' : e?.type === 'card_error' ? 'declined' : 'payment_failed';
  await paymentActivity(env, owner, eventId, family);
}

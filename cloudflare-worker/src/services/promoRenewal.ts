/** D5368 — reserve a renewal discount while its Stripe invoice is editable. */
import type { Env } from '../types';
import { stripeCall } from '../routes/billing';
import { getPromoById, recordSubscriptionRedemption } from './promos';
import { commitPromoReservation, releasePromoReservation, reservePromoRenewal } from './promoRedemption';

const INVOICE_ID = /^in_[A-Za-z0-9]{1,255}$/;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9]{1,255}$/;
const PROMO_ID = /^promo_[A-Za-z0-9]{1,255}$/;

function stripeId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id;
  return '';
}

type Metadata = Record<string, string>;
interface RenewalInvoice {
  id?: unknown;
  subscription?: unknown;
  subscription_details?: { metadata?: Metadata };
  parent?: { subscription_details?: { metadata?: Metadata; subscription?: unknown } };
  billing_reason?: string;
  status?: string;
  currency?: string;
  subtotal?: number;
  discounts?: Array<{ id: string; promotion_code?: unknown }>;
  total_discount_amounts?: Array<{ discount: unknown; amount: number }>;
}

const subscriptionOf = (invoice: RenewalInvoice) =>
  stripeId(invoice.subscription) || stripeId(invoice.parent?.subscription_details?.subscription);

async function holdForReview(env: Env, invoiceId: string) {
  const invoice = await stripeCall<RenewalInvoice>(env, `/invoices/${invoiceId}`, {
    auto_advance: 'false',
    'metadata[axal_promo_review]': 'required',
  }, { idempotencyKey: `promo-renewal-review:${invoiceId}` });
  if (invoice.status !== 'draft') throw new Error('promo renewal is no longer a draft');
}

export async function checkPromoRenewal(env: Env, event: RenewalInvoice): Promise<void> {
  if (event.billing_reason !== 'subscription_cycle') return;
  const invoiceId = stripeId(event.id);
  const subscriptionId = subscriptionOf(event);
  if (!INVOICE_ID.test(invoiceId) || !SUBSCRIPTION_ID.test(subscriptionId)) return;
  const metadata = event.parent?.subscription_details?.metadata ?? event.subscription_details?.metadata
    ?? (await stripeCall<{ metadata?: Metadata }>(env, `/subscriptions/${subscriptionId}`, {}, { method: 'GET' })).metadata;
  const promoId = metadata?.promo_code_id ?? '';
  if (!PROMO_ID.test(promoId)) return;
  try {
    const promo = await getPromoById(env, promoId);
    if (!promo || (promo.duration !== 'repeating' && promo.duration !== 'forever')) return;
    const invoice = await stripeCall<RenewalInvoice>(env, `/invoices/${invoiceId}`, {
      'expand[0]': 'discounts',
    }, { method: 'GET' });
    if (invoice.status !== 'draft') throw new Error('promo renewal is no longer a draft');
    const totals = invoice.total_discount_amounts ?? [];
    if (!totals.length) return;
    const discounts = new Map((invoice.discounts ?? []).map(d => [stripeId(d), d]));
    let amount = 0;
    for (const line of totals) {
      const discount = discounts.get(stripeId(line.discount));
      if (!discount || typeof discount !== 'object' || !Number.isSafeInteger(line.amount) || line.amount < 0) {
        throw new Error('promo renewal discount is unreadable');
      }
      if (stripeId(discount.promotion_code) === promoId) amount += line.amount;
    }
    if (amount === 0) return;
    const userId = Number(metadata?.user_id);
    const currency = invoice.currency ?? '';
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(amount) || !/^[a-z]{3}$/i.test(currency)) {
      throw new Error('promo renewal amount or member is unreadable');
    }
    const stripe = promo.max_redemptions == null ? { times_redeemed: 0 }
      : await stripeCall<{ times_redeemed: number }>(env, `/promotion_codes/${promoId}`, {}, { method: 'GET' });
    if (!Number.isSafeInteger(stripe.times_redeemed) || stripe.times_redeemed < 0) {
      throw new Error('promo renewal usage is unreadable');
    }
    if (await reservePromoRenewal(env, { invoiceId, promoId, userId, currency, discountCents: amount, stripeUses: stripe.times_redeemed })) return;
  } catch (error) {
    await holdForReview(env, invoiceId);
    throw error;
  }
  await holdForReview(env, invoiceId);
}

export async function settlePromoRenewal(env: Env, invoice: RenewalInvoice, paid: boolean) {
  if (invoice.billing_reason !== 'subscription_cycle') return;
  const invoiceId = stripeId(invoice.id);
  if (!INVOICE_ID.test(invoiceId)) return;
  const ref = `renewal:${invoiceId}`;
  const hold = await env.DB.prepare(
    `SELECT promo_id, user_id, amount_cents, currency FROM promo_ceiling_reservations
       WHERE ref = ? AND state IN ('reserved', 'committed')`,
  ).bind(ref).first<{ promo_id: string; user_id: number; amount_cents: number; currency: string }>();
  if (!hold) return;
  if (!paid) {
    await releasePromoReservation(env, ref);
    return;
  }
  const subscriptionId = subscriptionOf(invoice);
  if (!SUBSCRIPTION_ID.test(subscriptionId)) throw new Error('promo renewal subscription is unreadable');
  await commitPromoReservation(env, ref);
  await recordSubscriptionRedemption(env, {
    promoId: hold.promo_id, userId: hold.user_id, subscriptionId, invoiceId,
    detail: {
      productId: null, priceId: null, interval: null,
      amountBeforeCents: Number.isSafeInteger(invoice.subtotal) ? invoice.subtotal ?? null : null,
      discountCents: hold.amount_cents, currency: hold.currency.toLowerCase(),
    },
  });
}

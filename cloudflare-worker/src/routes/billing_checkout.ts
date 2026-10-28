/**
 * D1051 (#2902, part 3 of #2451) — checkout: one route for a new plan or a
 * change, the quote before it, and the plan's status after it. Mounted at
 * /api/billing ahead of `billing.ts`, so `/checkout/*` is this file's.
 *
 *   POST /api/billing/checkout/quote   { plan_key, interval, promo_code? }               read only
 *   POST /api/billing/checkout/start   { plan_key, interval, promo_code?, payment_method?, nonce }
 *   GET  /api/billing/checkout/status?ref=                                                 caller only
 *
 * EVERY PRICE AND TOTAL IS STRIPE'S, read through the Worker: the price from
 * the catalogue mirror, the proration, the tax and the amount due from
 * Stripe's upcoming-invoice preview. Nothing here is charged until the member
 * presses Pay or Confirm: `start` hands back a client secret the page
 * confirms, or applies a change the member confirmed behind its step-up.
 *
 * STEP-UP (#2451 owner question 8, C). A change, and a first plan paid with a
 * saved card, ask for a recent authenticator code (`requireFactor` and
 * `requireStepUp`, as the swap and the cancel do). A first plan paid with a
 * new card does not: the member types the card in and the bank checks it.
 *
 * A CHANGE (owner question 7, A). An upgrade applies now, and the prorated
 * difference is charged today (`always_invoice`, with `pending_if_incomplete`
 * so a declined charge changes nothing). A downgrade is scheduled for the end
 * of the paid period through a subscription schedule, and nothing is charged.
 *
 * WHAT IS LOGGED. `activity_logs` gets `checkout_started`, `plan_changed` and
 * `promo_applied`, with the plan key, interval and the Stripe reference. No
 * card data and no email: `details` carries neither, and neither is read.
 *
 * THE OLD CHECKOUTS STAY. `/tier/checkout`, `/investor/checkout` and
 * `/plan/checkout` still have callers (the paywall, Billing and the investor
 * pricing page). Part 6 (#2905) moves them to the sheet; the 410 lands once
 * no caller is left.
 */
import { Hono, type Context } from 'hono';
import type { Env } from '../types';
import { requireAuth, requireFactor, requireStepUp } from '../auth';
import { stripeCall } from './billing';
import { ensurePaymentsCustomer } from './payments';
import { ensureTierSchema, type TierUser } from '../middleware/requireTier';
import { paidInvestorTier } from '../services/investorTiers';
import { getCatalog } from '../services/catalog';
import { isTokenPackPrice } from '../services/aiCredits';
import { validatePromoForProduct, computeDiscount, normalizeCode, type PromoRow } from '../services/promos';
import { automaticTaxParams, stripeTaxEnabled } from '../util/stripeTax';
import { refuse } from '../util/refusal';
import { moneyKindForCatalogPrice } from '../services/moneyRails';
import {
  adoptInvestorCustomer, ensureInvestorCustomer, heldPlanInStripe, heldPlanSubscription, planMetaFields, planMetaParams,
  storedInvestorCustomer, type PlanMeta,
} from '../services/planSubscription';
import { allowanceFromCharge } from '../services/planAllowance';
import { planByKey, type CatalogueEntry } from '../services/planCatalogue';
import {
  FAILED_STATUSES, ON_STATUSES, changeDirection, checkoutIntervalOf, plannedEntry, priceForEntry, yearlySavingPercent,
  type CheckoutRefusal,
} from '../services/planCheckout';

const checkout = new Hono<{ Bindings: Env }>();
type Ctx = Context<{ Bindings: Env }>;
type CheckoutUser = TierUser & { investor_stripe_customer_id?: string | null };

interface StripeSubLite {
  id: string;
  status: string;
  customer?: string;
  current_period_end?: number;
  schedule?: string | null;
  items?: { data?: Array<{ id: string; current_period_end?: number; price?: { id: string; unit_amount: number | null; currency: string; recurring?: { interval: string; interval_count: number } | null } }> };
  latest_invoice?: { id?: string; status?: string; payment_intent?: { id?: string; status?: string; client_secret?: string } | null } | null;
}
interface StripeUpcoming { currency?: string; amount_due?: number; total?: number; tax?: number | null; subtotal?: number; lines?: { data?: Array<{ amount?: number; proration?: boolean }> } }

const no = (c: Ctx, r: CheckoutRefusal, extra?: Record<string, unknown>) =>
  refuse(c, r.status, { code: r.code, message: r.message, audience: 'member', ...(extra ? { extra } : {}) });

/** A promo code's idempotency fragment: applying or removing one changes the key (the intent's rule). */
const promoPart = (code: string) => (code ? normalizeCode(code).replace(/[^A-Z0-9_-]/g, '').slice(0, 64) || 'none' : 'none');
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const PM_RE = /^pm_[A-Za-z0-9]+$/;

/** The plan key the D1 plan columns hold for a family, recorded before a checkout. Null when unreadable. */
async function heldPlanKey(env: Env, userId: number, family: string): Promise<string | null> {
  try {
    if (family === 'founder' || family === 'investor') {
      const u = await env.DB.prepare('SELECT subscription_tier, subscription_status, investor_tier, investor_subscription_status FROM users WHERE id = ?')
        .bind(userId).first<Record<string, string | null>>();
      if (!u) return null;
      if (family === 'founder') return (u.subscription_tier === 'growth' || u.subscription_tier === 'studio') && ON_STATUSES.has(String(u.subscription_status)) ? `founder:${u.subscription_tier}` : 'founder:free';
      return paidInvestorTier(u.investor_tier) && ON_STATUSES.has(String(u.investor_subscription_status)) ? `investor:${u.investor_tier}` : 'investor:free';
    }
    const row = await env.DB.prepare('SELECT plan_group, status FROM account_subscriptions WHERE user_id = ?').bind(userId).first<{ plan_group: string | null; status: string | null }>();
    return row && row.plan_group === family && ON_STATUSES.has(String(row.status)) ? `${family}:pro` : `${family}:free`;
  } catch {
    return null;
  }
}

/**
 * The Stripe customer a family's subscription lives on (D892 §6): an investor
 * plan on the member's own investor customer, never the general one; every
 * other plan on the general customer. `create` makes the customer when there
 * is none, and is passed only once nothing is held. `held` also reads the
 * general customer for an investor member with no investor customer, where an
 * investor plan made before D892 sits.
 */
async function familyCustomer(env: Env, user: CheckoutUser, meta: PlanMeta, mode: 'create' | 'read' | 'held'): Promise<string | null> {
  if (meta.kind !== 'investor') return mode === 'create' ? await ensurePaymentsCustomer(env, user) : (user.stripe_customer_id ?? null);
  const inv = await storedInvestorCustomer(env, user.id);
  if (inv) return inv;
  if (mode === 'create') return ensureInvestorCustomer(env, user);
  return mode === 'held' ? (user.stripe_customer_id ?? null) : null;
}

/**
 * A plan of this family that Stripe holds and D1 never saw (D892 §6's
 * `heldPlanInStripe`: a subscription made before D892). Throws when Stripe
 * cannot say, so nothing is started on a guess.
 */
async function heldOnlyInStripe(env: Env, user: CheckoutUser, meta: PlanMeta) {
  const investor = meta.kind === 'investor' ? await storedInvestorCustomer(env, user.id) : null;
  const found = await heldPlanInStripe(env, { general: user.stripe_customer_id, investor }, meta);
  return found ? { ...found, adopt: meta.kind === 'investor' && !investor && found.customer === user.stripe_customer_id } : null;
}
const PLAN_CHECK_UNAVAILABLE = { status: 503, code: 'plan_check_unavailable', message: 'Your current plan could not be checked, so nothing was charged. Try again in a moment.' } as CheckoutRefusal;
const SUBSCRIPTION_EXISTS = { status: 409, code: 'subscription_exists', message: 'You already pay for a plan of this kind. Change it from Billing.' } as CheckoutRefusal;

async function logCheckout(env: Env, userId: number, action: 'checkout_started' | 'plan_changed' | 'promo_applied', ref: string, details: Record<string, unknown>) {
  try {
    await env.DB.prepare(`INSERT INTO activity_logs (user_id, action, details, actor, entity_type, entity_id) VALUES (?, ?, ?, 'member', 'stripe_subscription', ?)`)
      .bind(userId, action, JSON.stringify(details), ref).run();
  } catch (e) {
    console.warn('[checkout] activity log not written:', (e as Error).message);
  }
}

/** What the caller asked for, resolved against the catalogue, or the refusal to send. */
async function resolvePlan(c: Ctx, user: CheckoutUser, body: Record<string, unknown>) {
  const planned = plannedEntry(user.role, body.plan_key);
  if ('refusal' in planned) return { refusal: planned.refusal };
  const interval = checkoutIntervalOf(body.interval);
  if (!interval) return { refusal: { status: 400, code: 'invalid_interval', message: 'Choose monthly or yearly.' } as CheckoutRefusal };
  let products;
  try { products = await getCatalog(c.env, 'subscription'); } catch {
    return { refusal: { status: 503, code: 'catalogue_unreadable', message: "This plan's price couldn't be read just now. That doesn't mean it's free." } as CheckoutRefusal };
  }
  const found = priceForEntry(products, planned.entry, interval);
  if (!found) return { refusal: { status: 409, code: 'price_missing', message: "This plan's price couldn't be read just now. That doesn't mean it's free." } as CheckoutRefusal };
  // D755 §9: a token pack is bought only through the order intent, never as a plan.
  if (await isTokenPackPrice(c.env, found.price.id)) return { refusal: { status: 400, code: 'token_pack_checkout_only', message: 'AI tokens are bought from Usage, not as a plan.' } as CheckoutRefusal };
  return { entry: planned.entry, interval, products, ...found };
}

/** The member's subscription for the family as Stripe holds it, if they pay for one already. */
async function heldSubscription(env: Env, user: CheckoutUser, meta: PlanMeta): Promise<StripeSubLite | null> {
  const subId = await heldPlanSubscription(env, user.id, meta);
  if (!subId) return null;
  const sub = await stripeCall<StripeSubLite>(env, `/subscriptions/${subId}`, { 'expand[0]': 'items.data.price' }, { method: 'GET' });
  const customer = await familyCustomer(env, user, meta, 'held');
  // The D1 mirror named it; Stripe confirms it is this member's before anything reads further.
  if (!sub || !customer || sub.customer !== customer) return null;
  return sub;
}

function periodEnd(sub: StripeSubLite): string | null {
  const end = Number(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end);
  return Number.isFinite(end) && end > 0 ? new Date(end * 1000).toISOString() : null;
}

// ---------------------------------------------------------------------------
// POST /checkout/quote — read only
// ---------------------------------------------------------------------------

checkout.post('/checkout/quote', async (c) => {
  const user = (await requireAuth(c)) as CheckoutUser;
  await ensureTierSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return refuse(c, 503, { code: 'stripe_not_configured', message: 'Payments are not set up on this deployment.', audience: 'member' });
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const plan = await resolvePlan(c, user, body);
  if ('refusal' in plan) return no(c, plan.refusal!);
  const { entry, interval, products, product, price, meta } = plan;
  const unit = Number(price.unit_amount);
  const base = {
    plan_key: entry.key, plan_name: entry.name, family: entry.family, interval,
    unit_amount: unit, currency: price.currency, price_id: price.id,
    yearly_saving_percent: yearlySavingPercent(products, entry),
    ai_allowance_microusd: String(price.currency).toLowerCase() === 'usd' ? allowanceFromCharge(unit, price.interval, price.interval_count) : null,
    storage_bytes: entry.storage.bytes, storage_reason: entry.storage.reason,
    includes: entry.included,
    sellable: true, reason: null as string | null,
    // A first plan paid with a saved card asks for the authenticator too (owner question 8, C).
    saved_card_step_up: true,
  };

  let held: StripeSubLite | null;
  try { held = await heldSubscription(c.env, user, meta); } catch {
    return refuse(c, 502, { code: 'quote_failed', message: 'Your current plan could not be read from Stripe. Nothing changed; try again in a moment.', audience: 'member' });
  }

  if (held) {
    // A member already paying: the change, previewed (owner question 7, A).
    const item = held.items?.data?.[0];
    const current = { price_id: item?.price?.id ?? null, unit_amount: item?.price?.unit_amount, interval: item?.price?.recurring?.interval, interval_count: item?.price?.recurring?.interval_count };
    const direction = changeDirection(current, { price_id: price.id, unit_amount: unit, interval: price.interval, interval_count: price.interval_count });
    if (direction === 'same') return refuse(c, 409, { code: 'already_on_plan', message: 'You are on this plan already.', audience: 'member' });
    let proration: number | null = 0;
    let dueToday: number | null = 0;
    let tax: number | null = null;
    if (direction === 'upgrade' && item?.id) {
      try {
        const upcoming = await stripeCall<StripeUpcoming>(c.env, '/invoices/upcoming', {
          customer: String(held.customer), subscription: held.id,
          'subscription_items[0][id]': item.id, 'subscription_items[0][price]': price.id,
          subscription_proration_behavior: 'always_invoice',
        }, { method: 'GET' });
        proration = (upcoming.lines?.data ?? []).filter((l) => l.proration).reduce((s, l) => s + (l.amount || 0), 0);
        dueToday = Math.max(0, proration);
        tax = typeof upcoming.tax === 'number' ? upcoming.tax : null;
      } catch {
        proration = null; dueToday = null;
      }
    }
    return c.json({
      ...base,
      mode: 'change', direction,
      proration_amount: proration,
      change_at: direction === 'upgrade' ? 'now' : periodEnd(held),
      discount: null, discount_reason: 'A code applies to a new plan, not a change.',
      vat: tax == null ? { amount: null, reason: stripeTaxEnabled(c.env) ? 'Not shown in the preview.' : 'Tax is not charged on plans here.' } : { amount: tax, reason: null },
      total_due_today: dueToday,
      total_reason: dueToday == null ? 'The prorated amount could not be read from Stripe. Nothing is charged until you confirm.' : null,
      step_up_required: true,
    });
  }

  // A new subscriber, unless Stripe holds a plan of this family that D1 never saw.
  try { if (await heldOnlyInStripe(c.env, user, meta)) return no(c, SUBSCRIPTION_EXISTS); } catch { return no(c, PLAN_CHECK_UNAVAILABLE); }
  const promoCode = typeof body.promo_code === 'string' ? body.promo_code.trim() : '';
  let promo: PromoRow | undefined;
  let discount: { amount: number; code: string } | null = null;
  let discountReason: string | null = null;
  if (promoCode) {
    const v = await validatePromoForProduct(c.env, promoCode, product.id, unit, price.currency);
    if (v.ok && v.promo) { promo = v.promo; discount = { amount: computeDiscount(v.promo, unit).discountCents, code: v.promo.code }; }
    else discountReason = String(v.reason || 'not_found');
  }
  let vat: { amount: number | null; reason: string | null } = { amount: null, reason: 'Tax is not charged on plans here.' };
  let total: number | null = unit - (discount?.amount ?? 0);
  let totalReason: string | null = null;
  if (stripeTaxEnabled(c.env)) {
    const customer = await familyCustomer(c.env, user, meta, 'read');
    if (!customer) {
      vat = { amount: null, reason: 'Tax is worked out from your billing address when you pay.' };
      total = null; totalReason = 'The total, with tax, shows in the payment form.';
    } else {
      try {
        const upcoming = await stripeCall<StripeUpcoming>(c.env, '/invoices/upcoming', {
          customer, 'subscription_items[0][price]': price.id, 'automatic_tax[enabled]': 'true',
          ...(promo ? { 'discounts[0][promotion_code]': promo.id } : {}),
        }, { method: 'GET' });
        vat = { amount: typeof upcoming.tax === 'number' ? upcoming.tax : null, reason: typeof upcoming.tax === 'number' ? null : 'Not shown in the preview.' };
        total = typeof upcoming.amount_due === 'number' ? upcoming.amount_due : null;
        totalReason = total == null ? 'The total, with tax, shows in the payment form.' : null;
      } catch {
        vat = { amount: null, reason: 'Tax could not be read from Stripe just now.' };
        total = null; totalReason = 'The total, with tax, shows in the payment form.';
      }
    }
  }
  return c.json({
    ...base,
    mode: 'new', direction: null, proration_amount: null, change_at: 'now',
    discount, discount_reason: discountReason,
    vat, total_due_today: total, total_reason: totalReason,
    step_up_required: false,
  });
});

// ---------------------------------------------------------------------------
// POST /checkout/start
// ---------------------------------------------------------------------------

checkout.post('/checkout/start', async (c) => {
  const user = (await requireAuth(c)) as CheckoutUser;
  await ensureTierSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return refuse(c, 503, { code: 'stripe_not_configured', message: 'Payments are not set up on this deployment.', audience: 'member' });
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const nonce = typeof body.nonce === 'string' ? body.nonce : '';
  // The page sends one nonce per press of Pay, so a double press is one charge.
  if (!NONCE_RE.test(nonce)) return refuse(c, 400, { code: 'nonce_required', message: 'The payment could not be started. Reload the page and try again.', audience: 'member' });
  const plan = await resolvePlan(c, user, body);
  if ('refusal' in plan) return no(c, plan.refusal!);
  const { entry, interval, product, price, meta } = plan;
  const moneyKind = moneyKindForCatalogPrice(product, price);
  const before = await heldPlanKey(c.env, user.id, entry.family);

  let held: StripeSubLite | null;
  try { held = await heldSubscription(c.env, user, meta); } catch {
    return refuse(c, 502, { code: 'start_failed', message: 'Your current plan could not be read from Stripe. Nothing was charged; try again in a moment.', audience: 'member' });
  }

  if (held) {
    // A change, behind its step-up (owner question 8).
    await requireFactor(c, 'totp');
    await requireStepUp(c);
    return startChange(c, user, { entry, interval, price, meta, moneyKind, held, nonce, before });
  }
  // Mirror and Stripe disagree: D1 says one is held, Stripe does not confirm it. Never start a second.
  if (await heldPlanSubscription(c.env, user.id, meta)) return no(c, SUBSCRIPTION_EXISTS);
  // Stripe holds one D1 never saw (made before D892). An investor one on the
  // general customer is adopted, so its next event grants it (D892 §6).
  let inStripe: Awaited<ReturnType<typeof heldOnlyInStripe>>;
  try { inStripe = await heldOnlyInStripe(c.env, user, meta); } catch { return no(c, PLAN_CHECK_UNAVAILABLE); }
  if (inStripe) {
    if (inStripe.adopt) await adoptInvestorCustomer(c.env, user.id, inStripe.customer);
    return no(c, SUBSCRIPTION_EXISTS);
  }

  // A new subscriber. A saved card is charged with one press, so it asks for the code too (owner question 8, C).
  const pm = typeof body.payment_method === 'string' && body.payment_method ? body.payment_method : null;
  if (pm && !PM_RE.test(pm)) return refuse(c, 400, { code: 'invalid_payment_method', message: 'That card could not be used. Choose another or add a new one.', audience: 'member' });
  if (pm) { await requireFactor(c, 'totp'); await requireStepUp(c); }
  const customer = (await familyCustomer(c.env, user, meta, 'create'))!;
  if (pm) {
    const card = await stripeCall<{ id: string; customer?: string | null }>(c.env, `/payment_methods/${pm}`, {}, { method: 'GET' }).catch(() => null);
    if (!card || card.customer !== customer) return refuse(c, 404, { code: 'payment_method_not_found', message: 'That card could not be used. Choose another or add a new one.', audience: 'member' });
  }
  const promoCode = typeof body.promo_code === 'string' ? body.promo_code.trim() : '';
  let promo: PromoRow | undefined;
  if (promoCode) {
    const v = await validatePromoForProduct(c.env, promoCode, product.id, Number(price.unit_amount), price.currency);
    if (!v.ok || !v.promo) return refuse(c, 400, { code: 'promo_invalid', message: 'That code does not apply to this plan.', audience: 'member', extra: { reason: v.reason ?? 'not_found' } });
    promo = v.promo;
  }
  const params: Record<string, string> = {
    customer,
    'items[0][price]': price.id,
    'items[0][quantity]': '1',
    payment_behavior: 'default_incomplete',
    'payment_settings[save_default_payment_method]': 'on_subscription',
    'expand[0]': 'latest_invoice.payment_intent',
    'metadata[user_id]': String(user.id),
    'metadata[uid]': user.uid,
    'metadata[price_id]': price.id,
    'metadata[plan_key]': entry.key,
    ...planMetaParams(meta),
    ...automaticTaxParams(stripeTaxEnabled(c.env)),
  };
  if (pm) params.default_payment_method = pm;
  if (promo) { params['discounts[0][promotion_code]'] = promo.id; params['metadata[promo_code_id]'] = promo.id; }
  let sub: StripeSubLite;
  try {
    sub = await stripeCall<StripeSubLite>(c.env, '/subscriptions', params, {
      idempotencyKey: `checkout:${user.id}:${price.id}:${promoPart(promoCode)}:${pm ? 'saved' : 'new'}:${nonce}`, moneyKind,
    });
  } catch (e) {
    return refuse(c, 502, { code: 'start_failed', message: 'The payment could not be started. Nothing was charged; try again in a moment.', raw: e, audience: 'member' });
  }
  await logCheckout(c.env, user.id, 'checkout_started', sub.id, { plan_key: entry.key, interval, price_id: price.id, mode: 'new', before_plan_key: before, saved_card: !!pm });
  if (promo) await logCheckout(c.env, user.id, 'promo_applied', sub.id, { plan_key: entry.key, promo_code_id: promo.id });
  const secret = sub.latest_invoice?.payment_intent?.client_secret;
  if (!secret) {
    // A zero-due first invoice (a 100% code) has no payment to confirm: the plan is on.
    if (ON_STATUSES.has(sub.status)) return c.json({ mode: 'new', free: true, ref: sub.id, status: sub.status });
    return refuse(c, 502, { code: 'start_failed', message: 'The payment could not be started. Nothing was charged; try again in a moment.', audience: 'member' });
  }
  return c.json({ mode: 'new', client_secret: secret, ref: sub.id, status: sub.status, saved_card: !!pm });
});

async function startChange(c: Ctx, user: CheckoutUser, a: {
  entry: CatalogueEntry; interval: string; price: { id: string; unit_amount: number | null; interval: string | null; interval_count: number | null };
  meta: PlanMeta; moneyKind: ReturnType<typeof moneyKindForCatalogPrice>; held: StripeSubLite; nonce: string; before: string | null;
}) {
  const item = a.held.items?.data?.[0];
  if (!item?.id) return refuse(c, 409, { code: 'no_subscription_item', message: 'Your current plan could not be changed here. Open Billing.', audience: 'member' });
  const current = { price_id: item.price?.id ?? null, unit_amount: item.price?.unit_amount, interval: item.price?.recurring?.interval, interval_count: item.price?.recurring?.interval_count };
  const direction = changeDirection(current, { price_id: a.price.id, unit_amount: a.price.unit_amount, interval: a.price.interval, interval_count: a.price.interval_count });
  if (direction === 'same') return refuse(c, 409, { code: 'already_on_plan', message: 'You are on this plan already.', audience: 'member' });
  const metaParams = planMetaParams(a.meta);

  if (direction === 'upgrade') {
    // Now, with the prorated difference charged today. A declined charge leaves the plan as it was.
    let updated: StripeSubLite;
    try {
      updated = await stripeCall<StripeSubLite>(c.env, `/subscriptions/${a.held.id}`, {
        'items[0][id]': item.id, 'items[0][price]': a.price.id,
        proration_behavior: 'always_invoice', payment_behavior: 'pending_if_incomplete',
        'expand[0]': 'latest_invoice.payment_intent',
        'metadata[plan_key]': a.entry.key, ...metaParams,
      }, { idempotencyKey: `checkout-change:${user.id}:${a.held.id}:${a.price.id}:${a.nonce}`, moneyKind: a.moneyKind });
    } catch (e) {
      return refuse(c, 502, { code: 'change_failed', message: 'The plan could not be changed. Nothing was charged; try again in a moment.', raw: e, audience: 'member' });
    }
    await logCheckout(c.env, user.id, 'plan_changed', a.held.id, { plan_key: a.entry.key, interval: a.interval, price_id: a.price.id, mode: 'change', direction, before_plan_key: a.before });
    const pi = updated.latest_invoice?.payment_intent;
    if (pi?.client_secret && (pi.status === 'requires_action' || pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation')) {
      return c.json({ mode: 'change', direction, ref: a.held.id, client_secret: pi.client_secret, change_at: 'now' });
    }
    return c.json({ mode: 'change', direction, ref: a.held.id, paid: true, change_at: 'now' });
  }

  // A downgrade: at the end of the paid period, through a schedule. Nothing is charged.
  const endsAt = periodEnd(a.held);
  if (!endsAt) return refuse(c, 409, { code: 'period_unknown', message: 'The end of your paid period could not be read, so the change was not scheduled.', audience: 'member' });
  try {
    const schedule = a.held.schedule
      ? await stripeCall<{ id: string; phases?: Array<{ start_date: number; end_date: number }> }>(c.env, `/subscription_schedules/${a.held.schedule}`, {}, { method: 'GET' })
      : await stripeCall<{ id: string; phases?: Array<{ start_date: number; end_date: number }> }>(c.env, '/subscription_schedules', { from_subscription: a.held.id },
        { idempotencyKey: `checkout-schedule:${user.id}:${a.held.id}:${a.nonce}`, moneyKind: a.moneyKind });
    const phase = schedule.phases?.[0];
    if (!phase) throw new Error('schedule has no current phase');
    const params: Record<string, string> = {
      end_behavior: 'release',
      proration_behavior: 'none',
      'phases[0][items][0][price]': String(current.price_id),
      'phases[0][start_date]': String(phase.start_date),
      'phases[0][end_date]': String(phase.end_date),
      'phases[1][items][0][price]': a.price.id,
      'phases[1][iterations]': '1',
      'phases[1][metadata][plan_key]': a.entry.key,
    };
    for (const [k, v] of Object.entries(planMetaFields(a.meta))) params[`phases[1][metadata][${k}]`] = v;
    await stripeCall(c.env, `/subscription_schedules/${schedule.id}`, params, { idempotencyKey: `checkout-downgrade:${user.id}:${a.held.id}:${a.price.id}:${a.nonce}`, moneyKind: a.moneyKind });
  } catch (e) {
    return refuse(c, 502, { code: 'change_failed', message: 'The change could not be scheduled. Nothing changed; try again in a moment.', raw: e, audience: 'member' });
  }
  await logCheckout(c.env, user.id, 'plan_changed', a.held.id, { plan_key: a.entry.key, interval: a.interval, price_id: a.price.id, mode: 'change', direction, before_plan_key: a.before, change_at: endsAt });
  return c.json({ mode: 'change', direction, ref: a.held.id, scheduled: true, change_at: endsAt });
}

// ---------------------------------------------------------------------------
// GET /checkout/status?ref= — caller only
// ---------------------------------------------------------------------------

const UNREADABLE = 'Unreadable';
const NOT_RECORDED = (what: string) => `Not recorded: ${what}`;

checkout.get('/checkout/status', async (c) => {
  const user = (await requireAuth(c)) as CheckoutUser;
  const ref = String(c.req.query('ref') || '');
  if (!/^sub_[A-Za-z0-9]+$/.test(ref)) return refuse(c, 400, { code: 'invalid_ref', message: 'That payment reference is not one this page can read.', audience: 'member' });

  // Owner-bound: only a checkout this member started answers. An unrelated
  // reference, another member's included, is "not found", never its state.
  let started: { action: string; details: string | null; created_at: string } | null;
  try {
    started = await c.env.DB.prepare(`SELECT action, details, created_at FROM activity_logs
        WHERE user_id = ? AND entity_type = 'stripe_subscription' AND entity_id = ? AND action IN ('checkout_started', 'plan_changed')
        ORDER BY id DESC LIMIT 1`).bind(user.id, ref).first();
  } catch {
    return refuse(c, 503, { code: 'status_unreadable', message: 'Your payment could not be read just now. That is not the same as a failed payment.', audience: 'member' });
  }
  if (!started) return refuse(c, 404, { code: 'ref_not_found', message: 'No checkout of yours has this reference.', audience: 'member' });
  let asked: Record<string, any> = {};
  try { asked = JSON.parse(started.details || '{}'); } catch { asked = {}; }
  const entry = planByKey(String(asked.plan_key || ''));
  if (!entry || !entry.matches) return refuse(c, 503, { code: 'status_unreadable', message: 'Your payment could not be read just now. That is not the same as a failed payment.', audience: 'member' });

  // The recorded result: the plan columns the webhook writes, and the charge it recorded.
  let charge: { status: string; interval: string | null; interval_count: number | null; amount_cents: number | null; currency: string | null; price_id: string | null; updated_at: string | null } | null = null;
  let chargeRead = true;
  try {
    charge = await c.env.DB.prepare(`SELECT status, interval, interval_count, amount_cents, currency, price_id, updated_at FROM member_subscription_amounts
        WHERE subscription_id = ? AND user_id = ?`).bind(ref, user.id).first();
  } catch { chargeRead = false; }
  let planOn: boolean | null = null;
  try { planOn = await planColumnsHold(c.env, user.id, entry, ref); } catch { planOn = null; }
  if (planOn === null && !chargeRead) {
    return refuse(c, 503, { code: 'status_unreadable', message: 'Your payment could not be read just now. That is not the same as a failed payment.', audience: 'member' });
  }

  const wantedPrice = String(asked.price_id || '');
  const chargeIsNew = !!charge && (!wantedPrice || charge.price_id === wantedPrice);
  let state: 'activating' | 'active' | 'failed' | 'scheduled';
  if (charge && FAILED_STATUSES.has(charge.status) && asked.mode !== 'change') state = 'failed';
  else if (planOn === true && (asked.mode !== 'change' || chargeIsNew)) state = 'active';
  else if (asked.mode === 'change' && asked.direction === 'downgrade') state = 'scheduled';
  else state = 'activating';

  const out: Record<string, unknown> = { ref, state, asked: { plan_key: entry.key, interval: asked.interval ?? null, mode: asked.mode ?? 'new', direction: asked.direction ?? null, at: started.created_at } };
  if (state === 'scheduled') out.change_at = asked.change_at ?? null;
  if (state !== 'active') return c.json(out);

  // Accepted: what the payment actually turned on, from the caller's recorded subscription and the catalogue.
  // Never from the quote, the client, or Stripe.js having said yes.
  const reasons: Record<string, string> = {};
  const recorded = chargeIsNew ? charge : null;
  if (!chargeRead) for (const f of ['interval', 'effective_at', 'ai_allowance_microusd']) reasons[f] = UNREADABLE;
  else if (!recorded) for (const f of ['interval', 'effective_at', 'ai_allowance_microusd']) reasons[f] = NOT_RECORDED('the charge for this plan is not recorded yet.');
  const allowance = recorded && recorded.amount_cents != null && (recorded.currency == null || String(recorded.currency).toLowerCase() === 'usd')
    ? allowanceFromCharge(recorded.amount_cents, recorded.interval, recorded.interval_count ?? 1) : null;
  if (recorded && allowance == null) reasons.ai_allowance_microusd = NOT_RECORDED('the charge is in another currency.');
  if (entry.storage.bytes == null) reasons.storage_bytes = NOT_RECORDED(entry.storage.reason || 'no figure is set.');
  const beforeKey = typeof asked.before_plan_key === 'string' ? asked.before_plan_key : null;
  const beforeEntry = beforeKey ? planByKey(beforeKey) : null;
  out.result = {
    plan_key: entry.key, plan_name: entry.name, family: entry.family,
    interval: recorded?.interval ?? null,
    effective_at: recorded?.updated_at ?? null,
    included: entry.included,
    ai_allowance_microusd: allowance,
    storage_bytes: entry.storage.bytes,
    reasons,
  };
  out.changes = beforeEntry
    ? { before: { plan_key: beforeEntry.key, plan_name: beforeEntry.name }, after: { plan_key: entry.key, plan_name: entry.name } }
    : { before: null, reason: 'The previous plan was not recorded.' };
  return c.json(out);
});

/** Whether the D1 plan columns the webhook writes hold this plan on this subscription. Throws when unreadable. */
async function planColumnsHold(env: Env, userId: number, entry: CatalogueEntry, ref: string): Promise<boolean> {
  const m = entry.matches!;
  if (m.tier) {
    const u = await env.DB.prepare('SELECT subscription_tier, subscription_status, stripe_subscription_id FROM users WHERE id = ?').bind(userId)
      .first<{ subscription_tier: string | null; subscription_status: string | null; stripe_subscription_id: string | null }>();
    return !!u && u.stripe_subscription_id === ref && u.subscription_tier === m.tier && ON_STATUSES.has(String(u.subscription_status));
  }
  if (m.investor_tier) {
    const u = await env.DB.prepare('SELECT investor_tier, investor_subscription_status, investor_stripe_subscription_id FROM users WHERE id = ?').bind(userId)
      .first<{ investor_tier: string | null; investor_subscription_status: string | null; investor_stripe_subscription_id: string | null }>();
    return !!u && u.investor_stripe_subscription_id === ref && u.investor_tier === m.investor_tier && ON_STATUSES.has(String(u.investor_subscription_status));
  }
  const row = await env.DB.prepare('SELECT plan_group, status, subscription_id FROM account_subscriptions WHERE user_id = ?').bind(userId)
    .first<{ plan_group: string | null; status: string | null; subscription_id: string | null }>();
  return !!row && row.subscription_id === ref && row.plan_group === m.plan_group && ON_STATUSES.has(String(row.status));
}

export default checkout;

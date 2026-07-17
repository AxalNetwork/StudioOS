/**
 * One-time CART ORDER endpoints (Worker, prod) — parity with the FastAPI dev
 * backend, conforming to .local/tasks/products-cart-contract.md.
 *
 *   POST /api/orders/intent            create/refresh a combined PaymentIntent
 *   POST /api/orders/confirm           belt-and-suspenders fulfilment
 *   GET  /api/orders/:order_ref        owner-only order view
 *   GET  /api/orders/mine              owner's orders, most recent first
 *   GET  /api/orders/:order_ref/invoice  owner-only PDF download
 *
 * Prices ALWAYS come from the mirrored Stripe catalog — never trusted from the
 * client. Only `one_time` prices may be ordered. VAT (5% UAE) + promo discount
 * are recomputed server-side.
 */
import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../auth';
import { ensureTierSchema, type TierUser } from '../middleware/requireTier';
import { ensurePaymentsCustomer } from './payments';
import { stripeCall } from './billing';
import {
  ensureOrdersSchema,
  priceCart,
  resolveCartPromo,
  vatRate,
  makeOrderRef,
  sha1Hex,
  upsertPendingOrder,
  insertPaidFreeOrder,
  fulfilOrder,
  getOrderForUser,
  getOrderRow,
  listOrdersForUser,
  renderOrderInvoicePdf,
  type OrderItemInput,
  type OrderLine,
  type PricedCart,
} from '../services/orders';

const orders = new Hono<{ Bindings: Env }>();

/** Sanitise the caller-supplied nonce so it can't break the idempotency key. */
function safeNonce(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0) {
    return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'n';
  }
  return 'n';
}

function normItems(raw: unknown): OrderItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it) => ({
    price_id: typeof (it as any)?.price_id === 'string' ? (it as any).price_id : '',
    quantity: Number((it as any)?.quantity),
  }));
}

// A canonical serialisation of the cart for the idempotency signature:
// price_id:qty pairs, sorted, joined by comma.
function cartSignature(items: OrderItemInput[]): string {
  return items
    .map((i) => `${i.price_id}:${i.quantity}`)
    .sort()
    .join(',');
}

// The `items` metadata blob Stripe carries (<=500 chars) — same shape.
function itemsMetaBlob(lines: OrderLine[]): string {
  return lines.map((l) => `${l.price_id}:${l.quantity}`).join(',').slice(0, 500);
}

// ---------------------------------------------------------------------------
// POST /api/orders/intent
// ---------------------------------------------------------------------------
orders.post('/intent', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureTierSchema(c.env);
  await ensureOrdersSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);

  const body = (await c.req.json().catch(() => ({}))) as {
    items?: unknown;
    promo_code?: string;
    billing_country?: string;
    nonce?: string;
  };
  const items = normItems(body.items);
  const promoCode = typeof body.promo_code === 'string' ? body.promo_code.trim() : '';
  const billingCountry =
    typeof body.billing_country === 'string' && body.billing_country.trim()
      ? body.billing_country.trim()
      : null;
  const nonce = safeNonce(body.nonce);

  // 1–2. Price the cart from the catalog (rejects non-one_time / inactive).
  const priced = await priceCart(c.env, items);
  if ('error' in priced) {
    const status = priced.error === 'not_one_time' ? 400 : 400;
    return c.json({ error: priced.error }, status);
  }
  const cart = priced as PricedCart;

  // 3. Promo discount (percent on subtotal; amount_off capped at subtotal).
  let discountCents = 0;
  let resolvedPromoCode: string | null = null;
  if (promoCode) {
    const pr = await resolveCartPromo(c.env, promoCode, cart);
    if ('error' in pr) return c.json({ error: 'promo_invalid', reason: pr.error }, 400);
    discountCents = pr.discountCents;
    resolvedPromoCode = pr.promo.code;
  }

  // 4–5. VAT on (subtotal - discount); total.
  const netAfterDiscount = Math.max(0, cart.subtotal - discountCents);
  const rate = vatRate(billingCountry);
  const vatCents = Math.round(netAfterDiscount * rate);
  const total = cart.subtotal - discountCents + vatCents;

  // 6. Deterministic order id/ref per (user + items + promo + billing_country
  //    + nonce) so a refresh is stable/idempotent.
  const sig = await sha1Hex(
    `${user.id}:${cartSignature(items)}:${promoCode.toUpperCase()}:${billingCountry ?? ''}:${nonce}`,
  );
  const orderId = `ord_${sig}`;

  const itemLineOut = cart.lines.map((l) => ({
    price_id: l.price_id,
    product_id: l.product_id,
    name: l.name,
    kind: l.kind,
    quantity: l.quantity,
    unit_amount: l.unit_amount,
    line_total: l.line_total,
  }));

  // 7. Free (via promo) — fulfil immediately, no PaymentIntent.
  if (total <= 0) {
    // Reuse the existing paid order's ref if this signature was already
    // fulfilled; otherwise mint a fresh ref.
    const priorById = await c.env.DB.prepare('SELECT order_ref FROM orders WHERE id = ?')
      .bind(orderId)
      .first<{ order_ref: string }>();
    const orderRef = priorById?.order_ref ?? makeOrderRef();
    await insertPaidFreeOrder(c.env, {
      id: orderId,
      orderRef,
      userId: user.id,
      currency: cart.currency,
      subtotal: cart.subtotal,
      discountCents,
      vatCents,
      total: 0,
      promoCode: resolvedPromoCode,
      billingCountry,
      paymentIntentId: null,
      items: cart.lines,
    });
    await fulfilOrder(c.env, orderRef);
    return c.json({
      free: true,
      order_ref: orderRef,
      currency: cart.currency,
      subtotal: cart.subtotal,
      discount_cents: discountCents,
      vat_cents: vatCents,
      total: 0,
      items: itemLineOut,
      client_secret: null,
    });
  }

  // 8. Paid — create/refresh ONE combined PaymentIntent for `total`.
  const priorById = await c.env.DB.prepare('SELECT order_ref FROM orders WHERE id = ?')
    .bind(orderId)
    .first<{ order_ref: string }>();
  const orderRef = priorById?.order_ref ?? makeOrderRef();

  const customer = await ensurePaymentsCustomer(c.env, user);
  const idempotencyKey = `order:${user.id}:${sig}:${nonce}`;
  const piParams: Record<string, string> = {
    customer,
    amount: String(total),
    currency: cart.currency,
    'automatic_payment_methods[enabled]': 'true',
    // Embedded card-only checkout: no off-site redirects, so the SPA confirms
    // with `redirect: 'if_required'` and no return_url (parity with FastAPI dev).
    'automatic_payment_methods[allow_redirects]': 'never',
    'metadata[kind]': 'cart_order',
    'metadata[order_ref]': orderRef,
    'metadata[user_id]': String(user.id),
    'metadata[uid]': user.uid,
    'metadata[items]': itemsMetaBlob(cart.lines),
  };
  if (resolvedPromoCode) piParams['metadata[promo_code]'] = resolvedPromoCode;

  let intent: { id: string; client_secret: string; status: string };
  try {
    intent = await stripeCall<{ id: string; client_secret: string; status: string }>(
      c.env,
      '/payment_intents',
      piParams,
      { idempotencyKey },
    );
  } catch (e) {
    return c.json({ error: 'intent_failed', detail: (e as Error).message }, 502);
  }

  await upsertPendingOrder(c.env, {
    id: orderId,
    orderRef,
    userId: user.id,
    currency: cart.currency,
    subtotal: cart.subtotal,
    discountCents,
    vatCents,
    total,
    promoCode: resolvedPromoCode,
    billingCountry,
    paymentIntentId: intent.id,
    items: cart.lines,
  });

  return c.json({
    client_secret: intent.client_secret,
    payment_intent_id: intent.id,
    order_ref: orderRef,
    currency: cart.currency,
    subtotal: cart.subtotal,
    discount_cents: discountCents,
    vat_cents: vatCents,
    total,
    free: false,
    items: itemLineOut,
  });
});

// ---------------------------------------------------------------------------
// POST /api/orders/confirm — belt-and-suspenders fulfilment.
// ---------------------------------------------------------------------------
orders.post('/confirm', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  await ensureOrdersSchema(c.env);
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'stripe_not_configured' }, 503);

  const body = (await c.req.json().catch(() => ({}))) as { payment_intent_id?: string };
  const piId = typeof body.payment_intent_id === 'string' ? body.payment_intent_id.trim() : '';
  if (!piId) return c.json({ error: 'payment_intent_id_required' }, 400);

  let pi: { id: string; status: string; metadata?: Record<string, string> };
  try {
    pi = await stripeCall<{ id: string; status: string; metadata?: Record<string, string> }>(
      c.env,
      `/payment_intents/${encodeURIComponent(piId)}`,
      {},
      { method: 'GET' },
    );
  } catch (e) {
    return c.json({ error: 'pi_lookup_failed', detail: (e as Error).message }, 502);
  }

  const meta = pi.metadata ?? {};
  if (meta.kind !== 'cart_order') return c.json({ error: 'not_cart_order' }, 400);
  if (Number(meta.user_id) !== user.id) return c.json({ error: 'not_owner' }, 403);
  const orderRef = (meta.order_ref || '').trim();
  if (!orderRef) return c.json({ error: 'order_ref_missing' }, 400);

  if (pi.status !== 'succeeded') {
    return c.json({ error: 'not_paid', status: pi.status }, 409);
  }

  const order = await fulfilOrder(c.env, orderRef);
  if (!order) return c.json({ error: 'order_not_found' }, 404);
  return c.json({ order });
});

// ---------------------------------------------------------------------------
// GET /api/orders/mine — most recent first. Declared BEFORE /:order_ref so
// "mine" isn't captured as an order_ref param.
// ---------------------------------------------------------------------------
orders.get('/mine', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  const list = await listOrdersForUser(c.env, user.id);
  return c.json({ orders: list });
});

// ---------------------------------------------------------------------------
// GET /api/orders/:order_ref/invoice — owner-only PDF download.
// ---------------------------------------------------------------------------
orders.get('/:order_ref/invoice', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  const orderRef = c.req.param('order_ref');
  const row = await getOrderRow(c.env, orderRef);
  if (!row || row.user_id !== user.id) return c.json({ error: 'not_found' }, 404);
  let pdf: Uint8Array;
  try {
    pdf = await renderOrderInvoicePdf(c.env, orderRef);
  } catch (e) {
    return c.json({ error: 'invoice_render_failed', detail: (e as Error).message }, 502);
  }
  return new Response(pdf, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${orderRef}.pdf"`,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/orders/:order_ref — owner-only order view.
// ---------------------------------------------------------------------------
orders.get('/:order_ref', async (c) => {
  const user = (await requireAuth(c)) as TierUser;
  const orderRef = c.req.param('order_ref');
  const order = await getOrderForUser(c.env, orderRef, user.id);
  if (!order) return c.json({ error: 'not_found' }, 404);
  return c.json({ order });
});

export default orders;

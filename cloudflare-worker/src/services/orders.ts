/**
 * One-time CART ORDER service (Worker, prod) — parity with the FastAPI dev
 * backend, conforming to .local/tasks/products-cart-contract.md.
 *
 * A cart order combines one or more `one_time` catalog SKUs into a SINGLE
 * combined PaymentIntent. Prices ALWAYS come from the mirrored Stripe catalog
 * (services/catalog.ts) — never trusted from the client. VAT (5% for UAE) and
 * promo discounts are recomputed server-side.
 *
 * Fulfilment (webhook or belt-and-suspenders /confirm) is idempotent on the
 * order_ref / payment_intent_id:
 *   1. Mark the `orders` row paid (no-op if already paid).
 *   2. Insert `user_products` rows (one per line, carrying quantity).
 *   3. Record the promo redemption (reuse promo_redemptions).
 *   4. Render + store a PDF invoice.
 *   5. Send a branded confirmation email (reuse sendBrandedInvoiceEmail).
 */
import type { Env } from '../types';
import { getCatalog, type CatalogProduct, type CatalogPrice } from './catalog';
import {
  validatePromoForProduct,
  computeDiscount,
  recordPaidRedemption,
  type PromoRow,
} from './promos';
import { sendBrandedInvoiceEmail } from './email';

// ---------------------------------------------------------------------------
// Money helpers.
// ---------------------------------------------------------------------------

/** VAT rate for a normalized billing country. 5% for UAE variants, else 0. */
export function vatRate(billingCountry?: string | null): number {
  if (!billingCountry) return 0;
  const norm = billingCountry.trim().toLowerCase();
  const UAE = new Set(['ae', 'uae', 'united arab emirates', 'dubai']);
  return UAE.has(norm) ? 0.05 : 0;
}

// ---------------------------------------------------------------------------
// Shapes.
// ---------------------------------------------------------------------------

export interface OrderItemInput {
  price_id: string;
  quantity: number;
}

export interface OrderLine {
  price_id: string;
  product_id: string;
  name: string;
  kind: string;
  quantity: number;
  unit_amount: number;
  line_total: number;
}

export type OrderStatus = 'pending' | 'paid' | 'failed';

export interface Order {
  order_ref: string;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
  currency: string;
  subtotal: number;
  discount_cents: number;
  vat_cents: number;
  total: number;
  promo_code: string | null;
  items: OrderLine[];
}

interface OrderRow {
  id: string;
  order_ref: string;
  user_id: number;
  status: string;
  currency: string;
  subtotal_cents: number;
  discount_cents: number;
  vat_cents: number;
  total_cents: number;
  promo_code: string | null;
  billing_country: string | null;
  payment_intent_id: string | null;
  items_json: string;
  invoice_number: string | null;
  created_at: string;
  paid_at: string | null;
}

// ---------------------------------------------------------------------------
// Schema bootstrap (idempotent; mirrors sql/migrations/152_cart_orders.sql).
// ---------------------------------------------------------------------------
let _schemaReady = false;
export async function ensureOrdersSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS orders (
      id                TEXT PRIMARY KEY,
      order_ref         TEXT NOT NULL UNIQUE,
      user_id           INTEGER NOT NULL,
      status            TEXT NOT NULL DEFAULT 'pending',
      currency          TEXT NOT NULL DEFAULT 'usd',
      subtotal_cents    INTEGER NOT NULL DEFAULT 0,
      discount_cents    INTEGER NOT NULL DEFAULT 0,
      vat_cents         INTEGER NOT NULL DEFAULT 0,
      total_cents       INTEGER NOT NULL DEFAULT 0,
      promo_code        TEXT,
      billing_country   TEXT,
      payment_intent_id TEXT,
      items_json        TEXT NOT NULL DEFAULT '[]',
      invoice_number    TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at           TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pi ON orders(payment_intent_id) WHERE payment_intent_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS user_products (
      id           TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL,
      order_ref    TEXT NOT NULL,
      product_id   TEXT,
      price_id     TEXT,
      kind         TEXT,
      label        TEXT,
      quantity     INTEGER NOT NULL DEFAULT 1,
      activated_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at   TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_products_user ON user_products(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_user_products_order ON user_products(order_ref)`,
  ];
  for (const s of stmts) {
    try {
      await env.DB.prepare(s).run();
    } catch (e) {
      console.warn('[orders] ensureOrdersSchema stmt failed:', (e as Error).message);
    }
  }
  _schemaReady = true;
}

// ---------------------------------------------------------------------------
// order_ref generation — MRD-YYYY-XXXXX (5 uppercase base36 chars).
// ---------------------------------------------------------------------------
function randomBase36(len: number): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % 36];
  return out;
}

export function makeOrderRef(): string {
  const year = new Date().getUTCFullYear();
  return `MRD-${year}-${randomBase36(5)}`;
}

// ---------------------------------------------------------------------------
// SHA-1 hex — for the idempotency key fragment (items+promo+billing_country).
// ---------------------------------------------------------------------------
export async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Cart pricing — resolve every line from the catalog, reject non-one_time.
// ---------------------------------------------------------------------------
export interface PricedCart {
  lines: OrderLine[];
  subtotal: number;
  currency: string;
}

export type PriceError = { error: string };

/**
 * Resolve + price a cart against the mirrored catalog. Rejects any price that
 * is not an active `one_time` price. Currency is taken from the first line;
 * every line must share it. Returns a PriceError on any invalid line.
 */
export async function priceCart(
  env: Env,
  items: OrderItemInput[],
): Promise<PricedCart | PriceError> {
  if (!Array.isArray(items) || items.length === 0) return { error: 'empty_cart' };
  const catalog = await getCatalog(env);
  // Index price_id → { product, price }.
  const priceIndex = new Map<string, { product: CatalogProduct; price: CatalogPrice }>();
  for (const product of catalog) {
    for (const price of product.prices) priceIndex.set(price.id, { product, price });
  }

  const lines: OrderLine[] = [];
  let subtotal = 0;
  let currency: string | null = null;
  for (const item of items) {
    const priceId = typeof item.price_id === 'string' ? item.price_id : '';
    const quantity = Number(item.quantity);
    if (!priceId || !Number.isInteger(quantity) || quantity < 1) return { error: 'invalid_item' };
    const found = priceIndex.get(priceId);
    if (!found) return { error: 'not_one_time' };
    const { product, price } = found;
    if (!price.active || !product.active) return { error: 'not_one_time' };
    if (price.type !== 'one_time' || price.unit_amount == null) return { error: 'not_one_time' };
    if (currency === null) currency = price.currency;
    else if (currency !== price.currency) return { error: 'currency_mismatch' };
    const lineTotal = price.unit_amount * quantity;
    subtotal += lineTotal;
    lines.push({
      price_id: price.id,
      product_id: product.id,
      name: product.name,
      kind: product.kind,
      quantity,
      unit_amount: price.unit_amount,
      line_total: lineTotal,
    });
  }
  return { lines, subtotal, currency: currency ?? 'usd' };
}

// ---------------------------------------------------------------------------
// Promo — validate against the cart. Percent applies to subtotal; amount_off
// capped at subtotal. Uses the first line's product for the allow-list check.
// ---------------------------------------------------------------------------
export interface CartPromo {
  promo: PromoRow;
  discountCents: number;
}

export async function resolveCartPromo(
  env: Env,
  code: string,
  cart: PricedCart,
): Promise<CartPromo | PriceError> {
  // Validate against EVERY distinct product in the cart. A promo restricted to
  // a subset of products must not discount the whole subtotal — otherwise an
  // attacker could add one eligible SKU to discount ineligible ones. The promo
  // must be valid for all lines; discount is then computed on the full subtotal.
  const productIds = [...new Set(cart.lines.map((l) => l.product_id))];
  let promoRow: PromoRow | null = null;
  for (const productId of productIds) {
    const v = await validatePromoForProduct(env, code, productId, cart.subtotal, cart.currency);
    if (!v.ok || !v.promo) return { error: v.reason || 'promo_invalid' };
    promoRow = v.promo;
  }
  if (!promoRow) return { error: 'promo_invalid' };
  const { discountCents } = computeDiscount(promoRow, cart.subtotal);
  return { promo: promoRow, discountCents };
}

// ---------------------------------------------------------------------------
// Order row helpers.
// ---------------------------------------------------------------------------
function rowToOrder(row: OrderRow): Order {
  let items: OrderLine[] = [];
  try {
    items = JSON.parse(row.items_json) as OrderLine[];
  } catch {
    /* corrupt row → empty items */
  }
  const status: OrderStatus =
    row.status === 'paid' || row.status === 'failed' ? row.status : 'pending';
  return {
    order_ref: row.order_ref,
    status,
    created_at: row.created_at,
    paid_at: row.paid_at,
    currency: row.currency,
    subtotal: row.subtotal_cents,
    discount_cents: row.discount_cents,
    vat_cents: row.vat_cents,
    total: row.total_cents,
    promo_code: row.promo_code,
    items,
  };
}

export async function getOrderRow(env: Env, orderRef: string): Promise<OrderRow | null> {
  await ensureOrdersSchema(env);
  return env.DB.prepare('SELECT * FROM orders WHERE order_ref = ?').bind(orderRef).first<OrderRow>();
}

export async function getOrderRowByPi(env: Env, piId: string): Promise<OrderRow | null> {
  await ensureOrdersSchema(env);
  return env.DB.prepare('SELECT * FROM orders WHERE payment_intent_id = ?')
    .bind(piId)
    .first<OrderRow>();
}

/** Owner-scoped order fetch → Order view or null. */
export async function getOrderForUser(
  env: Env,
  orderRef: string,
  userId: number,
): Promise<Order | null> {
  const row = await getOrderRow(env, orderRef);
  if (!row || row.user_id !== userId) return null;
  return rowToOrder(row);
}

/** All of a user's orders, most recent first. */
export async function listOrdersForUser(env: Env, userId: number): Promise<Order[]> {
  await ensureOrdersSchema(env);
  const res = await env.DB.prepare(
    'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(userId)
    .all<OrderRow>();
  return (res.results ?? []).map(rowToOrder);
}

/**
 * Find an existing order for an idempotency signature (user + items+promo+
 * billing_country hash), stored in payment_intent_id-less lookup via a
 * deterministic order_ref cache in KV. We instead re-use the DB: match on
 * user_id + a stable signature stored in items_json's implicit hash is
 * impractical, so callers pass the computed signature and we look up by a
 * dedicated `sig` we stamp into the order's id prefix.
 */

export interface UpsertPendingArgs {
  id: string;
  orderRef: string;
  userId: number;
  currency: string;
  subtotal: number;
  discountCents: number;
  vatCents: number;
  total: number;
  promoCode: string | null;
  billingCountry: string | null;
  paymentIntentId: string | null;
  items: OrderLine[];
}

/**
 * Insert (or return existing) a pending order keyed by its deterministic id
 * (sha1 signature). Idempotent: if the id already exists, the existing row is
 * returned (its order_ref/payment_intent_id are stable across refreshes).
 */
export async function upsertPendingOrder(
  env: Env,
  args: UpsertPendingArgs,
): Promise<OrderRow> {
  await ensureOrdersSchema(env);
  const existing = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(args.id)
    .first<OrderRow>();
  if (existing) {
    // Refresh mutable pricing fields + payment_intent_id (still pending) so a
    // re-priced cart with the same signature stays consistent, but NEVER touch
    // a row that's already paid.
    if (existing.status === 'pending') {
      await env.DB.prepare(
        `UPDATE orders SET
           currency = ?, subtotal_cents = ?, discount_cents = ?, vat_cents = ?,
           total_cents = ?, promo_code = ?, billing_country = ?,
           payment_intent_id = ?, items_json = ?
         WHERE id = ? AND status = 'pending'`,
      )
        .bind(
          args.currency,
          args.subtotal,
          args.discountCents,
          args.vatCents,
          args.total,
          args.promoCode,
          args.billingCountry,
          args.paymentIntentId,
          JSON.stringify(args.items),
          args.id,
        )
        .run();
      return (await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
        .bind(args.id)
        .first<OrderRow>())!;
    }
    return existing;
  }
  await env.DB.prepare(
    `INSERT INTO orders
       (id, order_ref, user_id, status, currency, subtotal_cents, discount_cents,
        vat_cents, total_cents, promo_code, billing_country, payment_intent_id, items_json)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      args.id,
      args.orderRef,
      args.userId,
      args.currency,
      args.subtotal,
      args.discountCents,
      args.vatCents,
      args.total,
      args.promoCode,
      args.billingCountry,
      args.paymentIntentId,
      JSON.stringify(args.items),
    )
    .run();
  return (await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(args.id)
    .first<OrderRow>())!;
}

/**
 * Insert a free/promo order (no PaymentIntent) as PENDING, so a subsequent
 * fulfilOrder() call atomically flips it to paid and runs the fulfilment
 * side-effects (grants, promo redemption, invoice, email) exactly once.
 * Inserting it as 'paid' would make fulfilOrder see changes=0 and skip them.
 * Idempotent on the deterministic id.
 */
export async function insertPaidFreeOrder(
  env: Env,
  args: UpsertPendingArgs,
): Promise<OrderRow> {
  await ensureOrdersSchema(env);
  const existing = await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(args.id)
    .first<OrderRow>();
  if (existing) return existing;
  await env.DB.prepare(
    `INSERT INTO orders
       (id, order_ref, user_id, status, currency, subtotal_cents, discount_cents,
        vat_cents, total_cents, promo_code, billing_country, payment_intent_id,
        items_json)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      args.id,
      args.orderRef,
      args.userId,
      args.currency,
      args.subtotal,
      args.discountCents,
      args.vatCents,
      args.total,
      args.promoCode,
      args.billingCountry,
      args.paymentIntentId,
      JSON.stringify(args.items),
    )
    .run();
  return (await env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(args.id)
    .first<OrderRow>())!;
}

// ---------------------------------------------------------------------------
// Fulfilment — idempotent on order_ref / payment_intent_id.
// ---------------------------------------------------------------------------

/**
 * Fulfil a paid order idempotently. Safe to call from both the webhook and the
 * /confirm belt-and-suspenders path, and safe to re-call (no-op once paid).
 *   1. Mark orders.status='paid', paid_at=now (no-op if already paid).
 *   2. Insert user_products rows (one per line, carrying quantity).
 *   3. Record promo redemption if a promo was used.
 *   4. Render + store the PDF invoice (invoice_number).
 *   5. Send the branded confirmation email.
 * Returns the fulfilled Order view.
 */
export async function fulfilOrder(env: Env, orderRef: string): Promise<Order | null> {
  await ensureOrdersSchema(env);
  const row = await getOrderRow(env, orderRef);
  if (!row) return null;

  const items = (() => {
    try {
      return JSON.parse(row.items_json) as OrderLine[];
    } catch {
      return [] as OrderLine[];
    }
  })();

  // Step 1 — mark paid. The UPDATE only mutates a still-pending row, so a
  // concurrent/re-delivered fulfilment sees changes=0 and treats the order as
  // already fulfilled (returns the existing view without re-granting).
  const upd = await env.DB.prepare(
    `UPDATE orders SET status = 'paid', paid_at = datetime('now')
       WHERE order_ref = ? AND status != 'paid'`,
  )
    .bind(orderRef)
    .run();
  const wasPending = (upd.meta?.changes ?? 0) === 1;

  if (wasPending) {
    // Step 2 — grant user_products (one row per line). Deterministic id per
    // (order_ref + price_id) so a defensive re-run can't duplicate.
    for (const line of items) {
      const upId = await sha1Hex(`${orderRef}:${line.price_id}`);
      await env.DB.prepare(
        `INSERT OR IGNORE INTO user_products
           (id, user_id, order_ref, product_id, price_id, kind, label, quantity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          upId,
          row.user_id,
          orderRef,
          line.product_id,
          line.price_id,
          line.kind,
          line.name,
          line.quantity,
        )
        .run();
    }

    // Step 3 — promo redemption (idempotent on the PI id / synthetic ref).
    if (row.promo_code) {
      try {
        const { getPromoByCode } = await import('./promos');
        const promo = await getPromoByCode(env, row.promo_code);
        if (promo) {
          await recordPaidRedemption(env, {
            promoId: promo.id,
            userId: row.user_id,
            paymentIntentId: row.payment_intent_id || `order:${orderRef}`,
          });
        }
      } catch (e) {
        console.warn('[orders] promo redemption failed:', (e as Error).message);
      }
    }

    // Step 4 — render + store the PDF invoice (invoice_number = order_ref).
    try {
      await env.DB.prepare('UPDATE orders SET invoice_number = ? WHERE order_ref = ?')
        .bind(orderRef, orderRef)
        .run();
    } catch (e) {
      console.warn('[orders] invoice_number stamp failed:', (e as Error).message);
    }

    // Step 5 — branded confirmation email with the PDF attached (best-effort).
    try {
      const buyer = await env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
        .bind(row.user_id)
        .first<{ email: string; name: string | null }>();
      if (buyer?.email) {
        const pdfBytes = await renderOrderInvoicePdf(env, orderRef).catch(() => null);
        await sendBrandedInvoiceEmail(env, {
          to: buyer.email,
          name: buyer.name,
          amountCents: row.total_cents,
          currency: row.currency,
          description: items.map((l) => `${l.name} ×${l.quantity}`).join(', ') || 'Axal StudioOS',
          invoiceNumber: orderRef,
          pdfBytes: pdfBytes ?? null,
          paidAt: new Date(),
        });
      }
    } catch (e) {
      console.warn('[orders] confirmation email failed:', (e as Error).message);
    }
  }

  const fresh = await getOrderRow(env, orderRef);
  return fresh ? rowToOrder(fresh) : null;
}

// ---------------------------------------------------------------------------
// PDF invoice — reuse the shared pdf-lib renderer. The legal-document renderer
// (renderAgreementPdf) is agreement-specific, so we render a clean itemised
// invoice here using the same pdf-lib primitives already bundled in the worker.
// ---------------------------------------------------------------------------
function formatMoneyCents(cents: number, currency: string): string {
  const cur = (currency || 'usd').toUpperCase();
  return `${(cents / 100).toFixed(2)} ${cur}`;
}

export async function renderOrderInvoicePdf(env: Env, orderRef: string): Promise<Uint8Array> {
  const row = await getOrderRow(env, orderRef);
  if (!row) throw new Error('order_not_found');
  const items = (() => {
    try {
      return JSON.parse(row.items_json) as OrderLine[];
    } catch {
      return [] as OrderLine[];
    }
  })();
  const buyer = await env.DB.prepare('SELECT email, name FROM users WHERE id = ?')
    .bind(row.user_id)
    .first<{ email: string; name: string | null }>();

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${orderRef}`);
  doc.setAuthor('Axal VC');
  doc.setProducer('Axal StudioOS');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 54;
  const INK = rgb(0.13, 0.17, 0.22);
  const MUTED = rgb(0.55, 0.55, 0.58);
  const BRAND = rgb(0.486, 0.227, 0.929);
  const LINE = rgb(0.85, 0.85, 0.85);

  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 64;

  page.drawText('AXAL VC', { x: MARGIN, y, size: 16, font: bold, color: BRAND });
  page.drawText('INVOICE', {
    x: PAGE_W - MARGIN - bold.widthOfTextAtSize('INVOICE', 16),
    y,
    size: 16,
    font: bold,
    color: INK,
  });
  y -= 24;
  page.drawText(`Invoice: ${orderRef}`, { x: MARGIN, y, size: 10, font: regular, color: MUTED });
  y -= 14;
  const paidDate = (row.paid_at || row.created_at || '').slice(0, 10);
  page.drawText(`Date: ${paidDate}`, { x: MARGIN, y, size: 10, font: regular, color: MUTED });
  y -= 14;
  if (buyer?.email) {
    page.drawText(`Billed to: ${buyer.name ? `${buyer.name} · ` : ''}${buyer.email}`, {
      x: MARGIN,
      y,
      size: 10,
      font: regular,
      color: MUTED,
    });
    y -= 14;
  }
  page.drawText(`Status: ${row.status.toUpperCase()}`, {
    x: MARGIN,
    y,
    size: 10,
    font: regular,
    color: MUTED,
  });
  y -= 22;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: LINE,
  });
  y -= 18;

  // Column headers.
  const amountX = PAGE_W - MARGIN - 120;
  const qtyX = amountX - 60;
  page.drawText('Item', { x: MARGIN, y, size: 9.5, font: bold, color: INK });
  page.drawText('Qty', { x: qtyX, y, size: 9.5, font: bold, color: INK });
  page.drawText('Amount', { x: amountX, y, size: 9.5, font: bold, color: INK });
  y -= 16;

  for (const line of items) {
    let label = line.name || line.price_id;
    while (label.length > 4 && regular.widthOfTextAtSize(label, 10) > qtyX - MARGIN - 8) {
      label = label.slice(0, -2);
    }
    page.drawText(label, { x: MARGIN, y, size: 10, font: regular, color: INK });
    page.drawText(String(line.quantity), { x: qtyX, y, size: 10, font: regular, color: INK });
    page.drawText(formatMoneyCents(line.line_total, row.currency), {
      x: amountX,
      y,
      size: 10,
      font: regular,
      color: INK,
    });
    y -= 16;
  }

  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.5,
    color: LINE,
  });
  y -= 18;

  const totalsRow = (label: string, cents: number, strong = false) => {
    const font = strong ? bold : regular;
    page.drawText(label, { x: qtyX - 40, y, size: strong ? 11 : 10, font, color: INK });
    page.drawText(formatMoneyCents(cents, row.currency), {
      x: amountX,
      y,
      size: strong ? 11 : 10,
      font,
      color: INK,
    });
    y -= strong ? 18 : 15;
  };
  totalsRow('Subtotal', row.subtotal_cents);
  if (row.discount_cents > 0) totalsRow('Discount', -row.discount_cents);
  totalsRow('VAT', row.vat_cents);
  totalsRow('Total', row.total_cents, true);

  return await doc.save();
}

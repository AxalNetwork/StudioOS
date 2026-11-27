/**
 * D806 (#2245) — one invoice list for Billing: the member's paid orders
 * (token packs, auto-reloads, other catalogue items) and their Stripe plan
 * invoices, newest first, paged. `GET /api/billing/invoices` (routes/billing.ts)
 * reads Stripe and calls these; everything here is D1 or pure.
 *
 * WHAT A ROW SAYS.
 *   kind         'order' (D1, its PDF rendered by `/api/orders/:ref/invoice`)
 *                or 'stripe' (a plan invoice, its PDF Stripe's `invoice_pdf`,
 *                passed through as a URL: the Worker never proxies the bytes)
 *   status       paid | refunded | partly_refunded | open | void
 *   amount_cents what was charged, tax included
 *
 * REFUNDS. D1 records a refund only for a token pack: each `charge.refunded`
 * writes an `ai_credit_ledger` refund row whose `source_ref` ends in the
 * charge's cumulative amount refunded, in cents (aiCreditReversals.ts). Any
 * other order reads `paid`: no refund of it is recorded here. A Stripe
 * invoice reads its own credit notes (`post_payment_credit_notes_amount`).
 */
import type { Env } from '../types';

export type InvoiceStatus = 'paid' | 'refunded' | 'partly_refunded' | 'open' | 'void';
export interface InvoiceRow {
  kind: 'order' | 'stripe';
  id: string;
  date: string | null;
  description: string;
  amount_cents: number;
  currency: string;
  status: InvoiceStatus;
  pdf_url: string | null;
}

export const INVOICE_PAGE = Object.freeze({ per: 25, maxPer: 100 });

/** `?page&per`: whole numbers from 1, `per` at most 100. Anything else reads as the default. */
export function invoicePaging(page: unknown, per: unknown): { page: number; per: number } {
  const whole = (v: unknown) => (typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : NaN);
  const p = whole(page), n = whole(per);
  return { page: p >= 1 ? p : 1, per: n >= 1 ? Math.min(n, INVOICE_PAGE.maxPer) : INVOICE_PAGE.per };
}

/** D1's `YYYY-MM-DD HH:MM:SS` (UTC) as ISO, so it sorts beside Stripe's. */
function isoOf(sqlTime: string | null): string | null {
  if (!sqlTime) return null;
  const t = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sqlTime) ? `${sqlTime.replace(' ', 'T')}Z` : sqlTime;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function dollars(cents: number): string {
  return `$${cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)}`;
}

/** paid, partly refunded or refunded, from what was refunded of what was paid. */
export function refundStatus(totalCents: number, refundedCents: number | null): InvoiceStatus {
  if (!refundedCents || refundedCents <= 0) return 'paid';
  return refundedCents >= totalCents ? 'refunded' : 'partly_refunded';
}

interface OrderLineView { name?: string; quantity?: number; origin?: string }

/**
 * An order's line on the list: "AI tokens, $25 pack", "AI tokens, auto-reload
 * $25" (a line D794's reload marked `origin: 'auto_reload'`), else the items'
 * names.
 */
export function orderDescription(packFaceCents: number | null, itemsJson: string): string {
  let lines: OrderLineView[] = [];
  try { const parsed = JSON.parse(itemsJson); if (Array.isArray(parsed)) lines = parsed; } catch { /* unreadable items: named below */ }
  if (packFaceCents !== null && packFaceCents > 0) {
    return lines.some((l) => l?.origin === 'auto_reload')
      ? `AI tokens, auto-reload ${dollars(packFaceCents)}`
      : `AI tokens, ${dollars(packFaceCents)} pack`;
  }
  const names = lines.filter((l) => typeof l?.name === 'string' && l.name)
    .map((l) => (Number(l.quantity) > 1 ? `${l.name} × ${l.quantity}` : String(l.name)));
  return names.length ? names.join(', ') : 'Order';
}

/** The member's own paid orders, each with its pack (if a token pack) and the amount refunded of it. */
export async function orderInvoiceRows(env: Env, userId: number): Promise<InvoiceRow[]> {
  const { ensureOrdersSchema } = await import('./orders');
  await ensureOrdersSchema(env);
  const res = await env.DB.prepare(`SELECT o.order_ref, o.total_cents, o.currency, o.paid_at, o.created_at, o.items_json,
      CASE WHEN p.payment_intent_id IS NULL THEN NULL ELSE COALESCE(k.face_cents, p.credit_microusd / 10000) END AS pack_face_cents,
      (SELECT MAX(CAST(substr(l.source_ref, length(rtrim(l.source_ref, '0123456789')) + 1) AS INTEGER))
         FROM ai_credit_ledger l
        WHERE l.kind = 'refund' AND l.user_id = o.user_id AND l.payment_intent_id = p.payment_intent_id) AS refunded_cents
    FROM orders o
    LEFT JOIN ai_topup_purchases p ON p.order_ref = o.order_ref AND p.user_id = o.user_id
    LEFT JOIN ai_token_packs k ON k.uid = p.pack_uid
    WHERE o.user_id = ? AND o.status = 'paid'`).bind(userId).all<{
    order_ref: string; total_cents: number; currency: string; paid_at: string | null; created_at: string; items_json: string;
    pack_face_cents: number | null; refunded_cents: number | null;
  }>();
  return (res.results ?? []).map((o) => ({
    kind: 'order' as const,
    id: o.order_ref,
    date: isoOf(o.paid_at) ?? isoOf(o.created_at),
    description: orderDescription(o.pack_face_cents, o.items_json),
    amount_cents: o.total_cents,
    currency: o.currency,
    status: refundStatus(o.total_cents, o.refunded_cents),
    pdf_url: `/api/orders/${encodeURIComponent(o.order_ref)}/invoice`,
  }));
}

export interface StripeInvoiceView {
  id?: string;
  status?: string | null;
  currency: string;
  total?: number;
  amount_due?: number;
  created?: number;
  invoice_pdf?: string | null;
  post_payment_credit_notes_amount?: number;
  lines?: { data: Array<{ description?: string | null; price?: { id?: string; recurring?: { interval?: string } | null } | null }> };
}

const INTERVAL_WORD: Record<string, string> = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' };

/**
 * A Stripe plan invoice as a row: "[plan] · monthly" from its first recurring
 * line (the plan's name from the mirrored catalogue), Stripe's own words
 * otherwise. Drafts and invoices with no id are not invoices yet: null.
 */
export function stripeInvoiceRow(inv: StripeInvoiceView, planName: (priceId: string) => string | null): InvoiceRow | null {
  if (typeof inv?.id !== 'string' || !inv.id) return null;
  const total = Number.isSafeInteger(inv.total) ? (inv.total as number) : Number.isSafeInteger(inv.amount_due) ? (inv.amount_due as number) : 0;
  let status: InvoiceStatus;
  if (inv.status === 'paid') status = refundStatus(total, inv.post_payment_credit_notes_amount ?? 0);
  else if (inv.status === 'open' || inv.status === 'uncollectible') status = 'open';
  else if (inv.status === 'void') status = 'void';
  else return null;
  const lines = inv.lines?.data ?? [];
  const plan = lines.find((l) => l?.price?.recurring?.interval);
  const name = plan?.price?.id ? planName(plan.price.id) : null;
  const interval = plan?.price?.recurring?.interval ? INTERVAL_WORD[plan.price.recurring.interval] ?? plan.price.recurring.interval : null;
  const description = name && interval ? `${name} · ${interval}` : (lines.find((l) => l?.description)?.description ?? 'Plan invoice');
  const pdf = typeof inv.invoice_pdf === 'string' && /^https:\/\//.test(inv.invoice_pdf) ? inv.invoice_pdf : null;
  return {
    kind: 'stripe', id: inv.id,
    date: Number.isSafeInteger(inv.created) ? new Date((inv.created as number) * 1000).toISOString() : null,
    description, amount_cents: total, currency: inv.currency, status, pdf_url: pdf,
  };
}

/** Newest first (a row with no date last), then one page, with the total. */
export function pageInvoices(rows: InvoiceRow[], page: number, per: number) {
  const sorted = [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id.localeCompare(a.id));
  return { invoices: sorted.slice((page - 1) * per, page * per), page, per, total: sorted.length };
}

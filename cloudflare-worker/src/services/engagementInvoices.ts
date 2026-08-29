/**
 * Issuing an invoice for a marketplace engagement. Schema: migration 188.
 *
 * Kept out of routes/needs.ts because the number sequence and the money
 * conversion are the two things worth being able to point at, and neither
 * belongs inline in a status-transition handler.
 *
 * WHAT AN INVOICE IS HERE. A document this platform issues, with no payment
 * rail invented behind it. Axal does not collect money for an engagement;
 * `status = 'paid'` records that the partner said they were paid directly,
 * and both sides are told that in those words.
 *
 * MONEY CROSSES A BOUNDARY HERE. `quotes.price` and `engagements.price` are
 * legacy REAL dollars — both are on record in scripts/money-cents-baseline
 * .json and converting the live columns is a data migration, not a lint fix.
 * Everything this module writes is an INTEGER of minor units, so the float
 * ends at exactly one line (`toCents`) and is snapshotted immediately: an
 * invoice must not change because someone later edited the quote.
 */
import type { Env } from '../types';

/** Dollars (legacy REAL) → integer cents, at the one boundary that has them. */
export function toCents(price: number | null | undefined): number {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Round the SCALED value. `Math.round(n) * 100` would throw away the cents,
  // and `(n * 100) | 0` truncates 12.99 to 1298 on a float that lands low.
  return Math.round(n * 100);
}

/** Tax in integer cents from a subtotal and a basis-point rate. */
export function taxCents(subtotal: number, rateBps: number): number {
  const s = Math.max(0, Math.trunc(subtotal));
  const r = Math.min(10000, Math.max(0, Math.trunc(rateBps)));
  return Math.round((s * r) / 10000);
}

/**
 * The next invoice number for a year, e.g. 'AX-2026-0007'.
 *
 * Reads from a dedicated counter rather than MAX(invoice_number) over the
 * invoices: parsing a formatted string back into an integer to increment it
 * is how duplicate numbers happen, and a VOID invoice must keep its number
 * rather than freeing it for reuse. The UPSERT is atomic in SQLite, so two
 * concurrent issues cannot take the same value.
 */
export async function nextInvoiceNumber(env: Env, now = new Date()): Promise<string> {
  const year = String(now.getUTCFullYear());
  await env.DB.prepare(
    `INSERT INTO invoice_number_seq (year, last_value) VALUES (?, 1)
       ON CONFLICT(year) DO UPDATE SET last_value = last_value + 1`,
  ).bind(year).run();
  const row = await env.DB.prepare(
    'SELECT last_value FROM invoice_number_seq WHERE year = ?',
  ).bind(year).first<{ last_value: number }>();
  const n = Number(row?.last_value) || 1;
  return `AX-${year}-${String(n).padStart(4, '0')}`;
}

export interface LineItem {
  description: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
}

/**
 * Line items from the accepted quote.
 *
 * `quotes.deliverables` is free text, not a structured list. Splitting it into
 * priced rows would be inventing a breakdown nobody entered — the quote names
 * ONE price for the whole engagement. So the invoice carries one line at the
 * agreed price, with the deliverables as its description. That is what was
 * actually agreed; a table of fabricated sub-amounts that happens to sum
 * correctly would look more convincing and be less true.
 */
export function lineItemsFromQuote(deliverables: string | null, priceCents: number): LineItem[] {
  const text = String(deliverables || '').trim() || 'Engagement';
  return [{
    description: text.slice(0, 2000),
    quantity: 1,
    unit_amount_cents: priceCents,
    amount_cents: priceCents,
  }];
}

export interface IssueInput {
  engagementId: number;
  partnerUserId: number | null;
  founderUserId: number | null;
  billFromName: string | null;
  billToName: string | null;
  priceDollars: number | null;
  deliverables: string | null;
  currency?: string;
  taxRateBps?: number;
  dueAt?: string | null;
  notes?: string | null;
}

/**
 * Issue the invoice, or return the one that already exists.
 *
 * Idempotent by the UNIQUE index on engagement_id: a retried or double-clicked
 * request gets the first invoice back rather than a second number for the same
 * work. The read-before-insert is the fast path; the index is the guarantee.
 */
export async function issueInvoice(env: Env, input: IssueInput, uid: string, nowIso: string) {
  const existing = await env.DB.prepare(
    'SELECT * FROM engagement_invoices WHERE engagement_id = ?',
  ).bind(input.engagementId).first<any>();
  if (existing) return { invoice: existing, created: false };

  const subtotal = toCents(input.priceDollars);
  const rate = Math.min(10000, Math.max(0, Math.trunc(input.taxRateBps ?? 0)));
  const tax = taxCents(subtotal, rate);
  const items = lineItemsFromQuote(input.deliverables, subtotal);
  const number = await nextInvoiceNumber(env, new Date(nowIso));

  await env.DB.prepare(
    `INSERT INTO engagement_invoices
       (uid, invoice_number, engagement_id, partner_user_id, founder_user_id,
        bill_from_name, bill_to_name, line_items_json, subtotal_cents,
        tax_rate_bps, tax_cents, total_cents, currency, notes, status,
        issued_at, due_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'issued', ?,?,?,?)`,
  ).bind(
    uid, number, input.engagementId, input.partnerUserId, input.founderUserId,
    input.billFromName, input.billToName, JSON.stringify(items), subtotal,
    rate, tax, subtotal + tax, (input.currency || 'USD').toUpperCase(),
    input.notes ?? null, nowIso, input.dueAt ?? null, nowIso, nowIso,
  ).run();

  const invoice = await env.DB.prepare(
    'SELECT * FROM engagement_invoices WHERE uid = ?',
  ).bind(uid).first<any>();
  return { invoice, created: true };
}

/** Parse the stored snapshot back out, tolerating a bad row rather than throwing. */
export function invoiceDto(row: any) {
  if (!row) return null;
  let items: LineItem[] = [];
  try { items = JSON.parse(row.line_items_json || '[]'); } catch { items = []; }
  return { ...row, line_items: Array.isArray(items) ? items : [] };
}

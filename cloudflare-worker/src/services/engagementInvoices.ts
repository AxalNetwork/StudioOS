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
 * rather than freeing it for reuse.
 *
 * D4682 — INCREMENT AND READ ARE ONE STATEMENT. This used to bump the counter
 * and read it back in a second statement, so two concurrent issues could both
 * read the larger value and print the same number. `RETURNING` hands each
 * caller the value its own increment produced. `issueInvoice` does not call
 * this (it reserves inside the insert's own batch, so a request that loses to
 * a concurrent one for the same engagement burns no number); it stays for any
 * caller that needs a number on its own.
 */
export async function nextInvoiceNumber(env: Env, now = new Date()): Promise<string> {
  const year = String(now.getUTCFullYear());
  const row = await env.DB.prepare(
    `INSERT INTO invoice_number_seq (year, last_value) VALUES (?, 1)
       ON CONFLICT(year) DO UPDATE SET last_value = last_value + 1
       RETURNING last_value`,
  ).bind(year).first<{ last_value: number }>();
  const n = Number(row?.last_value);
  if (!Number.isInteger(n) || n < 1) throw new Error('invoice_number_unavailable');
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
 * D4682 — ONE BATCH, ONE TRANSACTION, THREE STATEMENTS:
 *
 *   1. reserve the next number for the year, only if this engagement has no
 *      invoice yet and is in a state that can be invoiced;
 *   2. insert the invoice with that number, under the same two conditions;
 *   3. mark the engagement `invoiced`, pointing at the invoice's number.
 *
 * A request that loses to a concurrent one for the same engagement finds the
 * invoice there, reserves nothing (statement 1 is guarded by the same test),
 * and returns the existing invoice. Two engagements issued at once serialise on
 * the counter row and take different numbers. A failure anywhere rolls the
 * whole batch back, so the engagement can never claim a document that was not
 * written, and a retry never issues a second one. An engagement left
 * `delivered` by an older partial failure that already has an invoice is
 * reconciled by statement 3 on the next call, with no new document.
 *
 * Idempotent also by the UNIQUE index on engagement_id, which remains the
 * guarantee underneath.
 */
export async function issueInvoice(env: Env, input: IssueInput, uid: string, nowIso: string) {
  const subtotal = toCents(input.priceDollars);
  const rate = Math.min(10000, Math.max(0, Math.trunc(input.taxRateBps ?? 0)));
  const tax = taxCents(subtotal, rate);
  const items = lineItemsFromQuote(input.deliverables, subtotal);
  const year = String(new Date(nowIso).getUTCFullYear());
  const id = input.engagementId;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO invoice_number_seq (year, last_value)
       SELECT ?, 1
        WHERE NOT EXISTS (SELECT 1 FROM engagement_invoices WHERE engagement_id = ?)
          AND EXISTS (SELECT 1 FROM engagements WHERE id = ? AND status IN ('delivered', 'reviewed', 'invoiced'))
       ON CONFLICT(year) DO UPDATE SET last_value = last_value + 1`,
    ).bind(year, id, id),
    env.DB.prepare(
      `INSERT INTO engagement_invoices
         (uid, invoice_number, engagement_id, partner_user_id, founder_user_id,
          bill_from_name, bill_to_name, line_items_json, subtotal_cents,
          tax_rate_bps, tax_cents, total_cents, currency, notes, status,
          issued_at, due_at, created_at, updated_at)
       SELECT ?, 'AX-' || ? || '-' || printf('%04d', (SELECT last_value FROM invoice_number_seq WHERE year = ?)),
              ?,?,?,?,?,?,?,?,?,?,?,?, 'issued', ?,?,?,?
        WHERE NOT EXISTS (SELECT 1 FROM engagement_invoices WHERE engagement_id = ?)
          AND EXISTS (SELECT 1 FROM engagements WHERE id = ? AND status IN ('delivered', 'reviewed', 'invoiced'))`,
    ).bind(
      uid, year, year,
      id, input.partnerUserId, input.founderUserId,
      input.billFromName, input.billToName, JSON.stringify(items), subtotal,
      rate, tax, subtotal + tax, (input.currency || 'USD').toUpperCase(),
      input.notes ?? null, nowIso, input.dueAt ?? null, nowIso, nowIso,
      id, id,
    ),
    env.DB.prepare(
      `UPDATE engagements
          SET status = 'invoiced',
              invoiced_at = CASE WHEN status = 'invoiced' THEN invoiced_at
                                 ELSE (SELECT issued_at FROM engagement_invoices WHERE engagement_id = ?) END,
              invoice_id = (SELECT invoice_number FROM engagement_invoices WHERE engagement_id = ?),
              updated_at = ?
        WHERE id = ?
          AND status IN ('delivered', 'reviewed', 'invoiced')
          AND EXISTS (SELECT 1 FROM engagement_invoices WHERE engagement_id = ?)
          AND (status != 'invoiced'
               OR invoice_id IS NOT (SELECT invoice_number FROM engagement_invoices WHERE engagement_id = ?))`,
    ).bind(id, id, nowIso, id, id, id),
  ]);

  const invoice = await env.DB.prepare(
    'SELECT * FROM engagement_invoices WHERE engagement_id = ?',
  ).bind(id).first<any>();
  return { invoice, created: !!invoice && invoice.uid === uid };
}

/** Parse the stored snapshot back out, tolerating a bad row rather than throwing. */
export function invoiceDto(row: any, match: { posted_on: string; last_four: string } | null = null, viewerSide: 'founder' | 'partner' = 'founder') {
  if (!row) return null;
  let items: LineItem[] = [];
  try { items = JSON.parse(row.line_items_json || '[]'); } catch { items = []; }
  return { ...row, line_items: Array.isArray(items) ? items : [], bank_matched_on: match?.posted_on ?? null, ...(viewerSide === 'partner' ? { bank_last_four: match?.last_four ?? null } : {}) };
}

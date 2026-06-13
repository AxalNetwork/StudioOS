/**
 * Task #10 — Branded Invoices via Gmail.
 *
 * Turns Stripe payment webhooks into exactly one Axal-branded receipt email per
 * SUCCESSFUL payment, delivered through the existing Gmail sender
 * (services/email.ts):
 *
 *  - `invoice.paid` / `invoice.finalized` — invoice-backed payments
 *    (subscriptions, finalized invoices). We email ONLY when the invoice is
 *    actually paid: `invoice.finalized` can precede settlement for auto-charge
 *    subscriptions and manual invoices finalize unpaid, so a finalize that
 *    isn't yet paid is skipped and the later `invoice.paid` delivery sends it.
 *    The invoice PDF + hosted URL are available, so we download and attach the
 *    PDF. Dedupe (below) guarantees one email regardless of which event fires.
 *  - `charge.succeeded` (non-invoice ONLY) — one-time PaymentIntents that don't
 *    generate a Stripe invoice. No invoice PDF exists, so we link the Stripe
 *    receipt instead. Invoice-backed charges (`charge.invoice` set) are skipped
 *    here because the invoice path already covers them.
 *
 * Idempotency + delivery: `invoice_email_log` records a row ONLY after a
 * confirmed send (keyed by `dedupe_key` = invoice id or charge id, both
 * globally unique). Before sending we check whether a sent row already exists
 * and no-op if so — duplicate / retry deliveries never double-send. If the
 * Gmail send FAILS we throw, which surfaces as a non-2xx from the webhook so
 * Stripe retries the event later (the next attempt re-checks the ledger and
 * re-sends). Recording only on success means a crash before the send leaves no
 * stranded "claim" that would suppress a later retry.
 */
import type { Env } from '../types';
import { sendBrandedInvoiceEmail } from './email';

let _schemaReady = false;
export async function ensureInvoiceEmailSchema(env: Env): Promise<void> {
  if (_schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS invoice_email_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key        TEXT NOT NULL UNIQUE,
      kind              TEXT NOT NULL,
      stripe_invoice_id TEXT,
      recipient         TEXT,
      sent_at           TIMESTAMP,
      created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_email_log_invoice
       ON invoice_email_log(stripe_invoice_id)`,
  ];
  for (const s of stmts) { try { await env.DB.prepare(s).run(); } catch { /* idempotent */ } }
  _schemaReady = true;
}

// True once a branded email has been confirmed-sent for this key. Sequential
// Stripe retries hit this and no-op; only successful sends ever write a row.
async function alreadySent(env: Env, dedupeKey: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS x FROM invoice_email_log WHERE dedupe_key = ? AND sent_at IS NOT NULL LIMIT 1`,
  ).bind(dedupeKey).first<{ x: number }>();
  return !!row;
}

// Record a confirmed send. This runs AFTER the email is already out, so a DB
// failure here is deliberately swallowed, NOT thrown: throwing would make the
// webhook return non-2xx → Stripe retries → a GUARANTEED double-send (the
// retry finds no ledger row and re-sends). Swallowing instead accepts only the
// far rarer "ledger write failed AND a future duplicate delivery arrives" case.
// Do not "fix" this into a throw — that regresses to guaranteed double-send.
async function recordSent(
  env: Env, dedupeKey: string, kind: 'invoice' | 'charge',
  stripeInvoiceId: string | null, recipient: string | null,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO invoice_email_log (dedupe_key, kind, stripe_invoice_id, recipient, sent_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).bind(dedupeKey, kind, stripeInvoiceId, recipient).run();
  } catch (e) {
    console.warn('[invoice-email] recordSent failed:', (e as Error).message);
  }
}

// Download the Stripe invoice PDF bytes. The `invoice_pdf` URL carries its own
// access token, so no Authorization header is needed. Best-effort: a failure
// just sends the branded email without the attachment (hosted URL still links).
async function fetchPdfBytes(url: string | null | undefined): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch { return null; }
}

function str(v: unknown): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

// Pull a human description from the invoice line items (first line wins),
// falling back to a generic label.
function deriveInvoiceDescription(inv: Record<string, unknown>): string {
  const lines = (inv.lines as { data?: Array<{ description?: string | null }> } | undefined)?.data;
  const first = lines?.find((l) => l && typeof l.description === 'string' && l.description.trim());
  if (first?.description) return first.description.trim();
  return 'Axal StudioOS';
}

/**
 * `invoice.paid` / `invoice.finalized` — email an Axal receipt with the invoice
 * PDF attached, but ONLY once the invoice is actually paid. Throws on send
 * failure so the webhook returns non-2xx and Stripe retries.
 */
export async function handleInvoiceEvent(env: Env, inv: Record<string, unknown>): Promise<void> {
  const invoiceId = str(inv.id).trim();
  if (!invoiceId) return;
  // Gate on a successful payment: avoid sending a "receipt" for a finalized but
  // unpaid (or later-failing) invoice. `invoice.paid` carries paid=true.
  const paid = inv.paid === true || str(inv.status).trim() === 'paid';
  if (!paid) return;
  const to = str(inv.customer_email).trim();
  if (!to) return; // can't deliver without a recipient

  await ensureInvoiceEmailSchema(env);
  if (await alreadySent(env, invoiceId)) return;

  const name = str(inv.customer_name).trim() || null;
  const amountCents = Number(inv.amount_paid ?? inv.amount_due ?? inv.total ?? 0);
  const currency = str(inv.currency).trim() || 'usd';
  const invoiceNumber = str(inv.number).trim() || null;
  const hostedInvoiceUrl = str(inv.hosted_invoice_url).trim() || null;
  const pdfBytes = await fetchPdfBytes(str(inv.invoice_pdf).trim() || null);
  const description = deriveInvoiceDescription(inv);

  const sent = await sendBrandedInvoiceEmail(env, {
    to, name, amountCents, currency, description,
    invoiceNumber, hostedInvoiceUrl, pdfBytes,
  });
  if (!sent.ok) {
    // Surface as non-2xx so Stripe retries the event; the retry re-checks the
    // ledger (no row yet) and re-sends. No partial state is written.
    throw new Error(`invoice receipt send failed: ${sent.error || 'unknown'}`);
  }
  await recordSent(env, invoiceId, 'invoice', invoiceId, to);
}

/**
 * `charge.succeeded` — email an Axal receipt for NON-INVOICE one-time charges.
 * Invoice-backed charges are skipped (covered by the invoice path). Throws on
 * send failure so the webhook returns non-2xx and Stripe retries.
 */
export async function handleChargeSucceeded(env: Env, charge: Record<string, unknown>): Promise<void> {
  if (charge.invoice) return;              // invoice path owns this payment
  if (charge.paid !== true) return;        // only successful charges
  const chargeId = str(charge.id).trim();
  if (!chargeId) return;

  const bd = (charge.billing_details as Record<string, unknown> | undefined) ?? {};
  const to = (str(charge.receipt_email).trim() || str(bd.email).trim());
  if (!to) return;

  await ensureInvoiceEmailSchema(env);
  if (await alreadySent(env, chargeId)) return;

  const name = str(bd.name).trim() || null;
  const amountCents = Number(charge.amount_captured ?? charge.amount ?? 0);
  const currency = str(charge.currency).trim() || 'usd';
  const description = str(charge.description).trim() || 'Axal StudioOS';
  // Non-invoice charges have no Stripe invoice PDF — link the Stripe receipt.
  const hostedInvoiceUrl = str(charge.receipt_url).trim() || null;

  const sent = await sendBrandedInvoiceEmail(env, {
    to, name, amountCents, currency, description,
    invoiceNumber: null, hostedInvoiceUrl, pdfBytes: null,
  });
  if (!sent.ok) {
    throw new Error(`charge receipt send failed: ${sent.error || 'unknown'}`);
  }
  await recordSent(env, chargeId, 'charge', null, to);
}

-- Task #10 — Branded Invoices via Gmail.
--
-- Every successful payment is emailed an Axal-branded receipt with the Stripe
-- invoice PDF attached (for invoice-backed payments) or a link to the Stripe
-- receipt (for non-invoice one-time charges), delivered through the existing
-- Gmail sender. This table guarantees EXACTLY ONE branded email per payment
-- across Stripe webhook retries.
--
-- `dedupe_key` is the idempotency anchor: the Stripe invoice id (`in_…`) for
-- the invoice path (`invoice.paid` / `invoice.finalized`) and the charge id
-- (`ch_…`) for the non-invoice `charge.succeeded` path — both globally unique.
-- A row is written ONLY AFTER a confirmed send (with `sent_at` set), so a
-- duplicate / retry delivery finds the sent row and no-ops. If the Gmail send
-- fails the webhook returns non-2xx (no row written) and Stripe retries the
-- event later — recording-on-success means a crash before the send can never
-- strand a "claim" that would suppress the retry.
--
-- D1/SQLite lack ALTER TABLE ... IF NOT EXISTS, so `ensureInvoiceEmailSchema`
-- in services/invoiceEmails.ts lazily bootstraps this table when this migration
-- hasn't been applied; re-running the migration is harmless.

CREATE TABLE IF NOT EXISTS invoice_email_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key        TEXT NOT NULL UNIQUE,  -- stripe invoice id OR charge id
  kind              TEXT NOT NULL,         -- 'invoice' | 'charge'
  stripe_invoice_id TEXT,                  -- set on the invoice.finalized path
  recipient         TEXT,
  sent_at           TIMESTAMP,             -- stamped only after a confirmed send
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invoice_email_log_invoice
  ON invoice_email_log(stripe_invoice_id);

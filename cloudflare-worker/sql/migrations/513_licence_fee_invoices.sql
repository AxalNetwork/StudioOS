-- 513 — the annual licence-fee invoices HQ issues a territory licensee (D802, #2238).
--
-- A territory licence carries an annual fee (migration 187's
-- `annual_fee_cents` and `currency`), and until now nothing invoiced it:
-- D716's `platform_licence_fee_invoice` bills Holdings' platform licence to
-- Management or the GP, never a subsidiary. One row here is one invoice for
-- one licence year, the year running from the licence's anniversary
-- (`territory_licences.starts_on`).
--
-- THE AMOUNT AND THE FIGURES ARE FROZEN AT ISSUE. `amount_cents` and
-- `currency` are the ledger's at the moment HQ issued, and `figures_json` is
-- the invoice as printed, with `figures_sha256` its digest, so the PDF drawn
-- tomorrow is the PDF drawn today even after the ledger's fee is re-termed —
-- the same reason migration 260 stores a statement's owed figure.
--
-- PAID IS HQ-ENTERED (D.8), as on a statement: `paid_cents` is the running
-- total HQ recorded receiving, with `paid_note` for the bank's reference.
-- Nothing reconciles it against a bank.
--
-- ONE INVOICE PER LICENCE YEAR. The unique index refuses a second invoice for
-- the same period, and a voided invoice still holds its period: re-issuing a
-- year is a decision HQ makes deliberately, not a double click.
--
-- NO FOREIGN KEY to `territory_licences`, matching 256 to 260: the licence is
-- named by its uid as a plain value.
CREATE TABLE IF NOT EXISTS licence_fee_invoices (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                  TEXT NOT NULL UNIQUE,
  licence_uid          TEXT NOT NULL,
  period_label         TEXT NOT NULL,
  period_start         TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end           TEXT NOT NULL CHECK (period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_cents         INTEGER NOT NULL CHECK (amount_cents > 0),
  currency             TEXT NOT NULL CHECK (length(currency) = 3),
  reference            TEXT NOT NULL,
  issued_at            TEXT NOT NULL,
  due_at               TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'void')),
  paid_cents           INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0 AND paid_cents <= amount_cents),
  paid_at              TEXT,
  paid_note            TEXT,
  void_note            TEXT,
  figures_json         TEXT NOT NULL,
  figures_sha256       TEXT NOT NULL,
  issued_by_user_id    INTEGER,
  recorded_by_user_id  INTEGER,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (period_end > period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_fee_invoices_period ON licence_fee_invoices (licence_uid, period_start);

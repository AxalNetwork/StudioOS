-- 202611141106 — the one-off initial-fee invoice at licence start (D5954, #5954).
--
-- The owner answered on #1008 (Q10 = A, Q11 = A): a licence's initial fee is a
-- one-off invoice at licence start, and the regulatory surcharge is billed once
-- with it. Until now nothing invoiced either (D5017 §3): an apply records them
-- as accepted on `licence_pricing_decisions` and writes them nowhere else.
--
-- A KIND, NOT A SIBLING TABLE. An initial invoice is a row of
-- `licence_fee_invoices` (migration 513) with `kind = 'initial'`, so paying,
-- voiding, the revision guard (D4694), the PDF, the licensee's read and the
-- receivables ledger (D5036) are the annual invoice's own code. Every existing
-- row is `annual`.
--
-- ITS TWO COMPONENTS ARE STORED. `initial_fee_cents` and
-- `regulatory_surcharge_cents` are the latest pricing decision's accepted
-- figures, frozen at issue with the decision's uid. A surcharge that is not
-- recorded is NULL, never 0, and the amount is the fee plus the surcharge when
-- there is one. An annual row carries neither.
--
-- ONE INITIAL INVOICE PER LICENCE, a voided one included, as a licence year is
-- held by its voided invoice. Its period is the first licence year (it starts
-- on `starts_on`), which an annual invoice also covers, so the one-per-year
-- index is rebuilt to count annual rows only: the annual rule itself does not
-- change.
--
-- FROZEN. Once issued, an initial invoice's kind, amount, currency,
-- components, decision and figures never change; payments and a void are
-- recorded on it as on an annual invoice.
ALTER TABLE licence_fee_invoices ADD COLUMN kind TEXT NOT NULL DEFAULT 'annual' CHECK (kind IN ('annual', 'initial'));
ALTER TABLE licence_fee_invoices ADD COLUMN initial_fee_cents INTEGER CHECK (initial_fee_cents IS NULL OR (typeof(initial_fee_cents) = 'integer' AND initial_fee_cents > 0));
ALTER TABLE licence_fee_invoices ADD COLUMN regulatory_surcharge_cents INTEGER CHECK (regulatory_surcharge_cents IS NULL OR (typeof(regulatory_surcharge_cents) = 'integer' AND regulatory_surcharge_cents >= 0));
ALTER TABLE licence_fee_invoices ADD COLUMN pricing_decision_uid TEXT;

DROP INDEX IF EXISTS idx_licence_fee_invoices_period;
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_fee_invoices_period ON licence_fee_invoices (licence_uid, period_start) WHERE kind = 'annual';
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_fee_invoices_initial ON licence_fee_invoices (licence_uid) WHERE kind = 'initial';

-- The components and the amount agree, and only an initial row has components.
CREATE TRIGGER IF NOT EXISTS trg_licence_fee_invoices_initial_shape
BEFORE INSERT ON licence_fee_invoices
WHEN (NEW.kind = 'initial' AND (NEW.initial_fee_cents IS NULL OR NEW.pricing_decision_uid IS NULL
        OR NEW.amount_cents <> NEW.initial_fee_cents + COALESCE(NEW.regulatory_surcharge_cents, 0)))
  OR (NEW.kind <> 'initial' AND (NEW.initial_fee_cents IS NOT NULL OR NEW.regulatory_surcharge_cents IS NOT NULL OR NEW.pricing_decision_uid IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'licence_fee_invoice_initial_shape');
END;

-- An issued initial invoice keeps what it was issued with; no row becomes one.
CREATE TRIGGER IF NOT EXISTS trg_licence_fee_invoices_initial_frozen
BEFORE UPDATE ON licence_fee_invoices
WHEN NEW.kind IS NOT OLD.kind
  OR (OLD.kind = 'initial' AND (NEW.amount_cents IS NOT OLD.amount_cents OR NEW.currency IS NOT OLD.currency
        OR NEW.initial_fee_cents IS NOT OLD.initial_fee_cents OR NEW.regulatory_surcharge_cents IS NOT OLD.regulatory_surcharge_cents
        OR NEW.pricing_decision_uid IS NOT OLD.pricing_decision_uid OR NEW.figures_json IS NOT OLD.figures_json
        OR NEW.figures_sha256 IS NOT OLD.figures_sha256 OR NEW.licence_uid IS NOT OLD.licence_uid))
BEGIN
  SELECT RAISE(ABORT, 'licence_fee_invoice_initial_frozen');
END;

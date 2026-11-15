-- D5949 (#5949): what a branch reports it has issued and spent against its
-- promo ceiling, on HQ. Migration 260 already has `issued_cents` and
-- `issued_reported_at` on `licence_promo_ceilings`; this adds only what is
-- missing.
--
-- `spent_cents` is the committed part of `issued_cents` (issued also counts
-- live holds). `issued_currency` is the currency the branch reported the
-- figures in, so HQ can tell when it later changes the ceiling's currency and
-- the stored figure no longer matches. Both are NULL until the branch reports,
-- never 0.
ALTER TABLE licence_promo_ceilings ADD COLUMN spent_cents INTEGER;
ALTER TABLE licence_promo_ceilings ADD COLUMN issued_currency TEXT;

-- The branch's latest report, as sent, one row per licence, whether or not
-- HQ had a ceiling row it matched. A report for a period HQ has no ceiling
-- for, or in another currency, is recorded here with its outcome and never
-- written into another ceiling row.
CREATE TABLE IF NOT EXISTS licence_promo_issued_reports (
  licence_uid TEXT PRIMARY KEY,
  branch_code TEXT NOT NULL,
  period TEXT NOT NULL,
  currency TEXT NOT NULL,
  issued_cents INTEGER NOT NULL CHECK (typeof(issued_cents) = 'integer' AND issued_cents >= 0),
  spent_cents INTEGER NOT NULL CHECK (typeof(spent_cents) = 'integer' AND spent_cents >= 0 AND spent_cents <= issued_cents),
  -- The branch's own as-of time (ISO), not HQ's receipt.
  reported_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('written', 'no_ceiling', 'currency_mismatch'))
);

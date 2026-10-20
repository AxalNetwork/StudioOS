-- 512 — licence_terms: a licence's terms schedule, and the branch copy's terms
-- (D797, #2230; part of D795, #2228).
--
-- One new table and one new column.
--
--   licence_terms  one row per licence (`licence_uid`), HQ's structured record
--       of what the signed contract says beyond migration 187's fee, shares and
--       term: the licensor entity and governing law, exclusivity, renewal and
--       notice, payment terms, the deal terms (first look, co-invest, carry,
--       referral, HQ approval) and reporting. Until now only the contract's
--       text (`licence_contracts.body_md`, 259) held these.
--
--       EVERY TERM IS NULLABLE, AND NULL IS "NOT RECORDED", NEVER ZERO. A
--       licence whose cure period HQ has not entered has no cure period on
--       record; it does not have a cure period of 0 days.
--
--       The field list, its types, ranges and labels live once, in
--       `cloudflare-worker/src/services/licenceTerms.ts`; the CHECKs below
--       are the same ranges, so the store refuses what the route refuses.
--       `sections_json` maps a term's key to the contract section that
--       states it, e.g. {"carry_share_bps": "§7.3"}.
--
--       Written only by the Super Admin (`PUT /api/admin/licences/:uid/terms`),
--       which appends a `licence_events` `terms_changed` row for every save.
--
--   branch_licence.terms_json  the terms as HQ pushed them to the licence's
--       branch, through the same copy as migration 256's columns. NULL means
--       the copy predates this column; the JSON `null` means HQ pushed and
--       holds no terms for the licence.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction.

CREATE TABLE IF NOT EXISTS licence_terms (
  licence_uid TEXT PRIMARY KEY,
  -- Parties
  licensor_entity TEXT CHECK (licensor_entity IS NULL OR licensor_entity IN ('management', 'holdings', 'gp', 'fund')),
  governing_law TEXT,
  -- Territory
  exclusive INTEGER CHECK (exclusive IS NULL OR exclusive IN (0, 1)),
  non_compete_months INTEGER CHECK (non_compete_months IS NULL OR non_compete_months BETWEEN 0 AND 120),
  -- Term and renewal
  renewal_mode TEXT CHECK (renewal_mode IS NULL OR renewal_mode IN ('auto', 'on_request')),
  non_renewal_notice_days INTEGER CHECK (non_renewal_notice_days IS NULL OR non_renewal_notice_days BETWEEN 0 AND 3650),
  cure_days INTEGER CHECK (cure_days IS NULL OR cure_days BETWEEN 0 AND 3650),
  termination_note TEXT,
  -- Money
  payment_terms_days INTEGER CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 3650),
  late_interest_bps INTEGER CHECK (late_interest_bps IS NULL OR late_interest_bps BETWEEN 0 AND 10000),
  minimum_guarantee_cents INTEGER CHECK (minimum_guarantee_cents IS NULL OR minimum_guarantee_cents >= 0),
  fee_invoiced TEXT CHECK (fee_invoiced IS NULL OR fee_invoiced IN ('annually', 'quarterly')),
  -- Deal terms
  first_look_business_days INTEGER CHECK (first_look_business_days IS NULL OR first_look_business_days BETWEEN 0 AND 3650),
  co_invest_max_bps INTEGER CHECK (co_invest_max_bps IS NULL OR co_invest_max_bps BETWEEN 0 AND 10000),
  carry_share_bps INTEGER CHECK (carry_share_bps IS NULL OR carry_share_bps BETWEEN 0 AND 10000),
  referral_fee_bps INTEGER CHECK (referral_fee_bps IS NULL OR referral_fee_bps BETWEEN 0 AND 10000),
  hq_approval_above_cents INTEGER CHECK (hq_approval_above_cents IS NULL OR hq_approval_above_cents >= 0),
  conflicts_note TEXT,
  -- Reporting
  usage_report_day INTEGER CHECK (usage_report_day IS NULL OR usage_report_day BETWEEN 1 AND 28),
  statement_period TEXT CHECK (statement_period IS NULL OR statement_period IN ('quarter', 'month')),
  data_role TEXT CHECK (data_role IS NULL OR data_role IN ('licensee_controller', 'hq_controller')),
  audit_right INTEGER CHECK (audit_right IS NULL OR audit_right IN (0, 1)),
  -- Contract sections, by term key
  sections_json TEXT,
  -- Bookkeeping
  updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE branch_licence ADD COLUMN terms_json TEXT;

-- 617 — KYC & KYB part 4 (D1232, #3240): how long a check lasts, as HQ's
-- setting. Assigned to #3240 by S21 (D1228 §6).
--
-- #2384 owner question 3: 24 months for KYC and KYB, 12 for accreditation;
-- HQ may change them, and a new period applies only to new approvals.
--
-- One row per check whose period HQ has set. NO ROW MEANS THE CODE'S DEFAULT
-- (`services/trust.ts` ROLE_MATRIX: kyc_v1 and kyb_v1 24 months,
-- accreditation_v1 12), so nothing is seeded and an unset period never reads
-- as a choice someone made.
--
-- A NEW PERIOD NEVER MOVES A DATE. `legal_obligations.expires_at` is written
-- once, when a check is satisfied (`resyncKycKyb`), from the period in force at
-- that moment; nothing re-reads this table to recompute a stored date.
--
-- `updated_by` is the Super Admin who last set it; each change is also an
-- `admin_audit_log` row (`kyc_periods_changed`) with the old and new months.
--
-- Grep first (D689 D-t): no renewal-period setting exists in the schema or in
-- code; the periods were constants in `services/trust.ts`.
CREATE TABLE IF NOT EXISTS kyc_renewal_periods (
  obligation_key TEXT PRIMARY KEY CHECK (obligation_key IN ('kyc_v1', 'kyb_v1', 'accreditation_v1')),
  months INTEGER NOT NULL CHECK (months BETWEEN 1 AND 120),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

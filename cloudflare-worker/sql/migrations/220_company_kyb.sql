-- 220 — a company's own KYB record, beside the account's, never instead of it.
--
-- TASK #108 asked whether KYB should be per-company rather than per-user. The
-- answer is BESIDE, and D40/D42 had already argued it twice before the question
-- was asked: "The account's entity is who signs your contracts; the company's
-- is who the workspace belongs to. They must not drift into each other."
--
-- WHAT IS PER-USER TODAY, and stays that way. `corporate_profiles.user_id` is
-- not a column, it is the PRIMARY KEY — one row per account, structurally — and
-- `trust.ts` upserts it `ON CONFLICT(user_id)`. That record is the account
-- holder's own legal entity and it is correct as it stands. This migration does
-- not touch it, does not move a row out of it, and does not deprecate it.
--
-- THE GAP THIS FILLS. `TrustCenterPage`'s Entity tab carries a comment saying
-- the Trust Center v2 canvas draws a "Your companies" card — a row per company,
-- each with its own KYB pill — and that the page states the model instead of
-- drawing a selector over it, because "one user has one KYB" and a selector
-- would have changed nothing when clicked. ROUTE_MAP records the same thing and
-- names task #108 as carrying it. This table is what makes the card honest.
--
-- ============================================================================
-- IT REFERENCES `company_profiles`, NOT `companies`, AND THAT IS A FINDING
-- ============================================================================
--
-- Migration 034 creates a `companies` table. It is recorded as applied in
-- `schema_migrations` (2026-06-30 14:15:40) and IT DOES NOT EXIST ON
-- PRODUCTION. Checked 2026-09-08:
--
--   SELECT COUNT(*) FROM companies;   ->  no such table: companies
--
-- It is also absent from `schema_baseline.sql`, and `grep` across
-- `cloudflare-worker/src/` finds ZERO references to it — no FROM, no JOIN, no
-- REFERENCES. Company identity in this product is `company_profiles` joined
-- through `user_company_links`, which is what `resolveActiveCompany` verifies
-- and what `user_company_links.company_id` has always meant.
--
-- So `REFERENCES companies(id)` would have shipped a foreign key pointing at
-- nothing. SQLite would not have complained — it does not verify a REFERENCES
-- target until the constraint is enforced, and D1 does not enforce them by
-- default — so this would have looked correct for as long as nobody looked.
-- The drift is recorded in DECISIONS D65; this file only has to not repeat it.
--
-- ============================================================================
-- NULL IS NOT A COMPANY
-- ============================================================================
--
-- `company_id` is NOT NULL here, and that is deliberate in the same way
-- migration 219's nullable column was. In 189/193/194 `company_id` narrows an
-- ownership predicate that already holds, so NULL widens harmlessly. Here the
-- company IS the ownership key — there is no second owner to fall back on — so
-- a row with no company would be a KYB record belonging to nobody, readable by
-- whoever asked. The column refuses it at the schema.
--
-- UNIQUE (company_id): one company, one KYB, exactly as one account has one
-- `corporate_profiles` row. The upsert in `trust.ts` relies on it.
--
-- MIGRATES ZERO ROWS AND BACKFILLS NOTHING. Production on 2026-09-08:
-- `corporate_profiles` 0, `sanctions_screenings` 0, `kyc_partner_imports` 0,
-- `company_profiles` 3, `user_company_links` 3 (all three belonging to one
-- account). There is no per-user KYB row to reshape, and inventing a company
-- KYB from an account's would be asserting something nobody entered. The cost
-- of this change only goes up from here, which is the argument for doing it
-- while the tables are empty.
--
-- No transaction statements and no pragma: D1's HTTP API rejects the first and
-- ignores the second (see `scripts/check-sql-migrations.mjs`).

CREATE TABLE IF NOT EXISTS company_kyb_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  company_id INTEGER NOT NULL REFERENCES company_profiles(id) ON DELETE CASCADE,
  -- Who started it. Not who owns it — the company owns it — but a record with
  -- no author is one nobody can be asked about.
  started_by_user_id INTEGER NOT NULL REFERENCES users(id),
  -- The same vocabulary `users.kyc_status` uses, so one reader can render both
  -- without a translation table that drifts.
  status TEXT NOT NULL DEFAULT 'not_started',
  entity_name TEXT,
  entity_type TEXT,
  jurisdiction TEXT,
  registration_number TEXT,
  registered_address TEXT,
  -- Provider fields mirror `users.kyc_*`: a KYB that is only ever self-declared
  -- is a form, not a check, and the shape has to admit a provider from the day
  -- one is wired rather than needing a reshape then.
  provider TEXT,
  provider_reference TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS idx_company_kyb_company ON company_kyb_records (company_id);
CREATE INDEX IF NOT EXISTS idx_company_kyb_status ON company_kyb_records (status);

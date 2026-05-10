-- Task #16 — Profile expansion (corporate + identity).
--
-- Slice 1: extend `users` with personal identity columns + add a one-per-user
-- `corporate_profiles` table for the legal-entity block. PII columns
-- (tax_id, phone) are stored as column-cipher v1 ciphertext via
-- services/columnCipher.ts; the `*_last4` plaintext columns let lists
-- render `••••1234` without decrypting.
--
-- Idempotent via the standard "wrap each ALTER in BEGIN/COMMIT-friendly
-- per-statement try" pattern used by the worker's runtime ensureSchema.
-- D1 will error "duplicate column name" if re-run from the CLI; that is
-- expected and harmless when applying via wrangler — rerun the file and
-- it will skip the columns it already has.
--
-- Apply via:
--   wrangler d1 execute studioos-db --remote --env="" \
--     --file=cloudflare-worker/sql/migrations/015_profile_expansion.sql

-- --- users: personal identity --------------------------------------------
ALTER TABLE users ADD COLUMN full_legal_name TEXT;
ALTER TABLE users ADD COLUMN date_of_birth TEXT;            -- ISO 8601 YYYY-MM-DD
ALTER TABLE users ADD COLUMN nationality TEXT;              -- ISO alpha-2
ALTER TABLE users ADD COLUMN tax_residency_country TEXT;    -- ISO alpha-2
ALTER TABLE users ADD COLUMN tax_id_number_enc TEXT;        -- column-cipher v1
ALTER TABLE users ADD COLUMN tax_id_last4 TEXT;
ALTER TABLE users ADD COLUMN phone_e164_enc TEXT;           -- column-cipher v1
ALTER TABLE users ADD COLUMN phone_last4 TEXT;
ALTER TABLE users ADD COLUMN address_line1 TEXT;
ALTER TABLE users ADD COLUMN address_line2 TEXT;
ALTER TABLE users ADD COLUMN city TEXT;
ALTER TABLE users ADD COLUMN state_or_region TEXT;
ALTER TABLE users ADD COLUMN postal_code TEXT;
ALTER TABLE users ADD COLUMN country TEXT;                  -- ISO alpha-2
ALTER TABLE users ADD COLUMN profile_completion_pct INTEGER DEFAULT 0;

-- --- corporate_profiles: one per user -----------------------------------
CREATE TABLE IF NOT EXISTS corporate_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  entity_name TEXT,
  entity_type TEXT,                                          -- e.g. LLC, C-Corp, Ltd, GmbH
  registration_number TEXT,
  tax_id_number_enc TEXT,                                    -- e.g. EIN, ciphertext
  tax_id_last4 TEXT,
  registered_country TEXT,                                   -- ISO alpha-2
  registered_address_line1 TEXT,
  registered_address_line2 TEXT,
  registered_city TEXT,
  registered_state TEXT,
  registered_postal TEXT,
  signing_authority_name TEXT,
  signing_authority_title TEXT,
  signing_authority_email TEXT,
  ubos_json TEXT NOT NULL DEFAULT '[]',                      -- [{name, dob, nationality, ownership_pct}]
  directors_json TEXT NOT NULL DEFAULT '[]',                 -- [{name, title, email}]
  insurance_carriers_json TEXT NOT NULL DEFAULT '[]',        -- [{kind, carrier, policy_no, expiry}]
  ubo_disclosed INTEGER NOT NULL DEFAULT 0,
  aml_high_risk_jurisdiction INTEGER NOT NULL DEFAULT 0,
  sanctions_last_checked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_corp_profiles_high_risk
  ON corporate_profiles(aml_high_risk_jurisdiction)
  WHERE aml_high_risk_jurisdiction = 1;

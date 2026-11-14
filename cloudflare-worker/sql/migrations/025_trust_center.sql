-- 025_trust_center.sql — Task #3 (Y-1 Trust Center backend)
--
-- Adds two tables that anchor the Trust Center:
--
--   legal_obligations  — per-user role-conditional obligations (ToS,
--                        Privacy, role-NDA, KYC, Accreditation, KYB).
--                        Status is one of:
--                          'pending'   — required but not started
--                          'in_review' — evidence submitted, awaiting issuer
--                          'satisfied' — green check (e.g. signed envelope)
--                          'expired'   — was satisfied, TTL elapsed
--                          'waived'    — admin-waived (rare; audited)
--                        evidence_envelope_uuid points at the esign envelope
--                        that proves it (NDA / ToS), or NULL when satisfied
--                        out-of-band (e.g. KYC provider callback).
--
--   pairwise_ndas      — Founder ↔ Investor NDA pairs, intermediated by
--                        Axal. Until status='active' AND now < valid_until,
--                        investor surfaces must mask founder data via
--                        services/trust.ts:maskFounderForInvestor().
--                        TTL = 12 months; nightly cron expires past rows.
--
-- Both tables enforce one-row-per-pair via UNIQUE constraints so the seeder
-- is idempotent on re-runs (signup + role change can both fire).
--
-- All CREATEs are IF NOT EXISTS so re-applying the migration on remote D1
-- is a no-op — no manual rollback required.

CREATE TABLE IF NOT EXISTS legal_obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  obligation_key TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,         -- 1=must satisfy, 0=optional
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMP,
  evidence_envelope_uuid TEXT,
  evidence_meta TEXT,                           -- JSON: provider refs etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, obligation_key)
);
CREATE INDEX IF NOT EXISTS idx_legal_obligations_user   ON legal_obligations(user_id);
CREATE INDEX IF NOT EXISTS idx_legal_obligations_status ON legal_obligations(status);
CREATE INDEX IF NOT EXISTS idx_legal_obligations_expiry ON legal_obligations(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS pairwise_ndas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Convention: party_a is ALWAYS the founder user_id, party_b is the
  -- investor user_id. The seeder enforces this so UNIQUE works correctly.
  party_a_user_id INTEGER NOT NULL,
  party_b_user_id INTEGER NOT NULL,
  intermediary TEXT NOT NULL DEFAULT 'axal',
  nda_envelope_uuid TEXT,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending|partially_signed|active|expired|revoked
  valid_until TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(party_a_user_id, party_b_user_id)
);
CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_a       ON pairwise_ndas(party_a_user_id);
CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_b       ON pairwise_ndas(party_b_user_id);
CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_status  ON pairwise_ndas(status);
CREATE INDEX IF NOT EXISTS idx_pairwise_ndas_expiry  ON pairwise_ndas(valid_until)
  WHERE valid_until IS NOT NULL;

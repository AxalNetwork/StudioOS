-- Task #11 — Incorporation Stripe Checkout: paid incorporation pipeline.
--
-- Additive-only. CREATE TABLE / CREATE INDEX are IF NOT EXISTS and safe to replay.
-- The Worker also carries services/incorporations.ts::ensureIncorporationsSchema() as a
-- lazy bootstrap (mirrors ensureTierSchema / ensureAuthBlockersSchema), so prod works on
-- first hit without a hot-path migration. Apply via:
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/086_incorporations.sql

-- ── TABLE ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incorporations (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER NOT NULL,
  project_id             INTEGER NOT NULL,
  jurisdiction_id        TEXT NOT NULL,
  company_name           TEXT NOT NULL,
  registered_agent_name  TEXT,
  registered_agent_address TEXT,
  amount_cents           INTEGER NOT NULL,
  currency               TEXT NOT NULL DEFAULT 'usd',
  stripe_session_id      TEXT UNIQUE,
  stripe_payment_intent  TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending_payment',
  -- 'pending_payment' -> 'paid' -> 'packet_processing' -> 'packet_ready' | 'failed'
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at                TIMESTAMP
);

-- ── INDEX ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_incorporations_user_status ON incorporations(user_id, status);

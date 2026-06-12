-- Task #15 — Partner Matching.
--
-- Adds `accepting_intros` opt-in to the `partners` table so partners can
-- exclude themselves from founder intent-matching results when off.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/095_partner_accepting_intros.sql
--
-- Idempotent caveat: D1 ALTER TABLE … ADD COLUMN does NOT support IF NOT
-- EXISTS. Re-running this migration after first apply will report
-- "duplicate column name: accepting_intros" — that error is expected and
-- harmless; the index step is wrapped in IF NOT EXISTS and will be a no-op
-- on re-run.

ALTER TABLE partners ADD COLUMN accepting_intros INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_partners_accepting_intros
  ON partners (accepting_intros, status);

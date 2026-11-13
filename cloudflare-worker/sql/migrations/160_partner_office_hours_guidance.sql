-- Task — Partner office-hours booking guidance (Spin-Out Lab / Office Hours).
--
-- Adds partner-authored booking guidance to the `partners` table so the
-- founder-facing Office Hours drawer can show "When to book <name>",
-- "Best for stage", "One session gets you" and "Bring to the session"
-- with the partner's OWN words. No column is populated by this migration:
-- absent guidance renders as an explicit empty state in the UI, never as
-- invented copy about a real person.
--
-- Apply with the ledger-driven runner (NOT a raw `wrangler d1 execute`):
--   npm run d1:migrate:remote      # === node scripts/migrate-d1.mjs --remote
--
-- Why: this file is NON-idempotent (D1 ALTER TABLE … ADD COLUMN has no
-- IF NOT EXISTS). The runner executes it exactly once and writes the
-- `schema_migrations` ledger row. A hand-apply leaves no ledger row, so the
-- next `npm run deploy` (predeploy → migrate-d1 --remote) re-executes it, D1
-- returns "duplicate column name: oh_when_to_book", and the plan ABORTS on
-- that first failure — blocking this migration and every later one.
--
-- If it has already been hand-applied: insert the ledger row by hand (the
-- runner prints the exact `INSERT OR REPLACE INTO schema_migrations …`)
-- before the next deploy.
--
-- The worker also self-heals on cold isolates via
-- ensurePartnerGuidanceColumns() (services/partnerGuidanceSchema.ts).

ALTER TABLE partners ADD COLUMN oh_when_to_book TEXT;
ALTER TABLE partners ADD COLUMN oh_stage_fit TEXT;
ALTER TABLE partners ADD COLUMN oh_session_outcome TEXT;
ALTER TABLE partners ADD COLUMN oh_bring_json TEXT DEFAULT '[]';
ALTER TABLE partners ADD COLUMN oh_guidance_updated_at TEXT;

-- No index: nothing in the codebase filters, joins or sorts on any of these
-- columns (guidance is always read by partner id / via SELECT p.*). Add one
-- only when a query actually needs it.

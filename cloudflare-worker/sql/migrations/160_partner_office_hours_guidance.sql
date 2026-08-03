-- Task — Partner office-hours booking guidance (Spin-Out Lab / Office Hours).
--
-- Adds partner-authored booking guidance to the `partners` table so the
-- founder-facing Office Hours drawer can show "When to book <name>",
-- "Best for stage", "One session gets you" and "Bring to the session"
-- with the partner's OWN words. No column is populated by this migration:
-- absent guidance renders as an explicit empty state in the UI, never as
-- invented copy about a real person.
--
-- Apply with:
--   wrangler d1 execute studioos-db --remote \
--     --file=cloudflare-worker/sql/migrations/160_partner_office_hours_guidance.sql
--
-- Idempotent caveat: D1 ALTER TABLE … ADD COLUMN does NOT support IF NOT
-- EXISTS. Re-running this migration after first apply reports
-- "duplicate column name: oh_when_to_book" — expected and harmless; the
-- index step is IF NOT EXISTS and is a no-op on re-run. The worker also
-- self-heals via ensurePartnerGuidanceColumns() (services/partnerGuidanceSchema.ts).

ALTER TABLE partners ADD COLUMN oh_when_to_book TEXT;
ALTER TABLE partners ADD COLUMN oh_stage_fit TEXT;
ALTER TABLE partners ADD COLUMN oh_session_outcome TEXT;
ALTER TABLE partners ADD COLUMN oh_bring_json TEXT DEFAULT '[]';
ALTER TABLE partners ADD COLUMN oh_guidance_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_partners_oh_guidance
  ON partners (oh_guidance_updated_at);

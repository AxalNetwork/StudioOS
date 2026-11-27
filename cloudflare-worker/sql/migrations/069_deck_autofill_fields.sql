-- Task #14 — Deck autofill: missing template-bound columns.
--
-- Twelve pitch-deck templates (see services/decks/methods.ts) bind to
-- project columns that didn't exist, so autofill rendered "—" for
-- whole slides. This adds the missing columns to `projects`.
--
-- All other template sources are JSON-on-financial_models.computed_json
-- or derived from cap_table_holders rows, so no other tables need a
-- schema change (see DECK_AUTOFILL_AUDIT.md at repo root).
--
-- Additive only. D1 has no `ADD COLUMN IF NOT EXISTS`; the consuming
-- routes/decks.ts carries an `ensureProjectAutofillColumns()` lazy
-- bootstrap (mirrors `ensureAdvisorWeekColumn`) so the columns
-- materialise on first autofill hit even before this file is run
-- through wrangler.
--
-- Apply with:
--   export PATH=/nix/store/51gywl5jn4nna7al9waj142pw4vfhy0k-nodejs-22.19.0/bin:$PATH
--   wrangler d1 execute studioos-db --remote --env production \
--     --file=cloudflare-worker/sql/migrations/069_deck_autofill_fields.sql

ALTER TABLE projects ADD COLUMN tagline TEXT;
ALTER TABLE projects ADD COLUMN logo_url TEXT;
ALTER TABLE projects ADD COLUMN som REAL;
ALTER TABLE projects ADD COLUMN cac REAL;
ALTER TABLE projects ADD COLUMN gross_margin_pct REAL;
ALTER TABLE projects ADD COLUMN contact_email TEXT;
ALTER TABLE projects ADD COLUMN vision TEXT;
ALTER TABLE projects ADD COLUMN traction_summary TEXT;

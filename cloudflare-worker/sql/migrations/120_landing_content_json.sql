-- Task #3 — template-driven editable content for landing pages.
-- Stores per-template content blocks as JSON, keyed by template:
--   { "<templateKey>": { "<field>": "<string>" | [ {item}, ... ] } }
-- The renderer reads it via landingContent() in landingTemplates.ts and falls
-- back to the schema default (LANDING_CONTENT_SCHEMA) when a field is blank, so
-- existing rows keep rendering. Additive-only; replay-safety on prod is
-- guaranteed by ensureLandingPageBrandKitColumns in landingPageSchema.ts (the
-- ALTER is wrapped in try/catch — D1/SQLite has no ADD COLUMN IF NOT EXISTS).

ALTER TABLE landing_pages ADD COLUMN content_json TEXT;

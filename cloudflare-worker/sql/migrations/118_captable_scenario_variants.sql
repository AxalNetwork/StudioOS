-- Task #29 — multiple cap-table scenarios per project.
--
-- Adds an explicit canonical-vs-draft marker so a project can keep ONE
-- canonical cap table (is_variant=0 — the only row the Demo Day deck Slide 08
-- and the one-per-project upsert/by-project lookups ever read) while founders
-- model named DRAFT variants (is_variant=1) shown only in the read-only
-- compare view.
--
-- Additive-only. Prod replay-safety is guaranteed by ensureCapTableVariantColumn
-- in cloudflare-worker/src/services/captableSchema.ts — D1/SQLite has no
-- `ADD COLUMN IF NOT EXISTS`, so the self-heal wraps the ALTER in try/catch
-- (a duplicate column or not-yet-created table throws and is swallowed).
ALTER TABLE cap_table_scenarios ADD COLUMN is_variant INTEGER NOT NULL DEFAULT 0;

-- Canonical lookups filter (project_id, is_variant) then order by updated_at.
CREATE INDEX IF NOT EXISTS idx_captable_project_variant
  ON cap_table_scenarios(project_id, is_variant, updated_at DESC);

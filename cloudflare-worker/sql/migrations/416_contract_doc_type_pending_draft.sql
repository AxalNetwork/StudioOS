-- 416 — a published contract document type keeps a pending draft beside its
-- live values (D615, #1313).
--
-- Saving a draft used to UPDATE the row's title, layer, party roles and
-- required fields while leaving status = 'published', so the live type
-- changed with no reason and no step-up. These columns hold that save until
-- publish copies them onto the live columns and clears them.
--
-- A row whose status is still draft keeps its values in the original columns.
-- Nothing is backfilled: a published type has no pending draft until somebody
-- saves one.
--
-- Not re-runnable (SQLite has no ADD COLUMN IF NOT EXISTS); the migration
-- ledger stops the replay.
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_title TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_layer TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_party_roles_json TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_required_fields_json TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_updated_at TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_updated_by INTEGER;

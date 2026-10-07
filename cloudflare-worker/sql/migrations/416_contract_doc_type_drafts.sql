-- 416 — contract_doc_type_registry: hold pending drafts for published types (D615, #1313).
--
-- When a contract document type is published, saving a draft stores pending changes
-- in draft_* columns rather than overwriting live published values. Publishing applies
-- draft_* to the live columns and clears them.
--
-- Additive only.
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_title TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_layer TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_party_roles_json TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_required_fields_json TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_updated_at TEXT;
ALTER TABLE contract_doc_type_registry ADD COLUMN draft_updated_by INTEGER;

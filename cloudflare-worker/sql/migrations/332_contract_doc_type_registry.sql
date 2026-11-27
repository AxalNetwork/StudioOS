-- D480 — HQ · Contracts doc-type registry store (draft + published rows).
-- Code maps remain the bootstrap catalog; this table holds HQ-authored types
-- and published overrides. Migration number fixed by issue #1014.

CREATE TABLE IF NOT EXISTS contract_doc_type_registry (
  doc_type TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  layer TEXT NOT NULL,
  party_roles_json TEXT NOT NULL DEFAULT '[]',
  required_fields_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  overlap_note TEXT,
  published_at TIMESTAMP,
  published_by INTEGER,
  publish_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  updated_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_contract_doc_type_registry_status
  ON contract_doc_type_registry(status);

CREATE INDEX IF NOT EXISTS idx_contract_doc_type_registry_layer
  ON contract_doc_type_registry(layer);

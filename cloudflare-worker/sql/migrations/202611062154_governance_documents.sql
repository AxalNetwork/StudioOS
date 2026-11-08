-- 202611062154_governance_documents.sql — D4563 (#4563): HQ Contracts ›
-- Corporate Governance. Additive: three new tables, no existing table changes.
--
-- 1. `governance_documents`: one row per governance document of an Axal
--    entity: Axal VC Holdings LLC, Axal VC Management LLC or Axal VC GP LLC
--    (`services/legalDocFormat.ts` `AXAL_ENTITIES`). The document is the
--    record; its files are its versions (2.). A link to the template library
--    (`template_slug`) or to a signed envelope (`envelope_id`) is a reference,
--    never a copy of that row.
--    - `status`: draft, review, approved, executed or archived. The Worker
--      allows `executed` only when the document has a version recorded as
--      signed, or a linked envelope that completed, and names it in
--      `executed_version` / `envelope_id`. An unsigned draft is never executed.
--    - `confidential`: 1 makes the document the Super Admin's alone, to read,
--      preview or download. The Worker enforces it on every route.
-- 2. `governance_document_versions`: one row per uploaded file, numbered from
--    1 per document. Hashes, sizes and types only; the file is in R2 at
--    `r2_key`. Append-only (two triggers, as D711 seals `legal_document_files`):
--    a corrected file is a new version, and history is never rewritten.
-- 3. `governance_entity_profiles`: each entity's ownership relationships, as
--    restricted, editable metadata (`ownership_json`), read and written by the
--    Super Admin only and never drawn from a hard-coded list.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS governance_documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE,
  entity_key       TEXT NOT NULL CHECK (entity_key IN ('holdings','management','gp')),
  category         TEXT NOT NULL CHECK (category IN ('operating_agreement','formation_certificate','member_register','resolution','signing_authority')),
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','executed','archived')),
  effective_date   TEXT CHECK (effective_date IS NULL OR effective_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  confidential     INTEGER NOT NULL DEFAULT 1 CHECK (confidential IN (0, 1)),
  template_slug    TEXT,
  envelope_id      INTEGER,
  executed_version INTEGER CHECK (executed_version IS NULL OR (typeof(executed_version) = 'integer' AND executed_version >= 1)),
  created_by       INTEGER,
  updated_by       INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- An executed document names what was signed: a signed version or a signed envelope.
  CHECK (status <> 'executed' OR executed_version IS NOT NULL OR envelope_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_governance_documents_entity ON governance_documents(entity_key, category, status);

CREATE TABLE IF NOT EXISTS governance_document_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  document_uid  TEXT NOT NULL REFERENCES governance_documents(uid),
  version       INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  signed        INTEGER NOT NULL DEFAULT 0 CHECK (signed IN (0, 1)),
  r2_key        TEXT NOT NULL,
  file_sha256   TEXT NOT NULL CHECK (length(file_sha256) = 64),
  file_bytes    INTEGER NOT NULL CHECK (typeof(file_bytes) = 'integer' AND file_bytes > 0),
  content_type  TEXT NOT NULL CHECK (content_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  note          TEXT CHECK (note IS NULL OR length(note) <= 500),
  uploaded_by   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (document_uid, version)
);

CREATE TRIGGER IF NOT EXISTS governance_document_versions_block_update
BEFORE UPDATE ON governance_document_versions
BEGIN
    SELECT RAISE(ABORT, 'governance_document_versions is append-only (D4563). Upload a new version instead.');
END;

CREATE TRIGGER IF NOT EXISTS governance_document_versions_block_delete
BEFORE DELETE ON governance_document_versions
BEGIN
    SELECT RAISE(ABORT, 'governance_document_versions is append-only (D4563). A version records a file that existed.');
END;

CREATE TABLE IF NOT EXISTS governance_entity_profiles (
  entity_key      TEXT PRIMARY KEY CHECK (entity_key IN ('holdings','management','gp')),
  ownership_json  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(ownership_json) AND json_type(ownership_json) = 'array'),
  updated_by      INTEGER,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Task #8 — Worker-owned (D1) legal template store becomes canonical.
-- Holds the markdown body, category, merge-fields and version metadata
-- for every legal template the admin Templates surface can read/edit.
-- The dev FastAPI templates remain in place as the migration source;
-- this store is the new source of truth for prod doc-generation + e-sign.
--
-- Additive only. The worker carries a lazy `ensureLegalTemplatesSchema`
-- bootstrap (services/legalTemplateStore.ts) so reads self-heal on a
-- D1 that has not yet had this migration applied; the seed (085) is the
-- canonical content load.

CREATE TABLE IF NOT EXISTS legal_templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- slug MUST equal the existing `doc_type` literal (incl. legacy spaced
  -- strings like 'Subscription Booklet & LPA') — it is the join key for
  -- esign_envelopes.document_type, contract usage counts, and
  -- templateKeyForDocType. Do NOT slugify.
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT 'gp',   -- gp | fund | portfolio | compliance
  body_md      TEXT NOT NULL DEFAULT '',
  merge_fields TEXT NOT NULL DEFAULT '[]',   -- JSON array of {{field}} names
  version      INTEGER NOT NULL DEFAULT 1,
  is_active    INTEGER NOT NULL DEFAULT 1,    -- 0 = soft-deleted
  is_stub      INTEGER NOT NULL DEFAULT 0,    -- 1 = catalog placeholder, no body yet
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by   INTEGER,
  updated_by   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_legal_templates_category ON legal_templates(category);
CREATE INDEX IF NOT EXISTS idx_legal_templates_active   ON legal_templates(is_active);

-- Append-only version history. The current row in legal_templates is the
-- latest version (fast reads); on every edit the PRE-update row is copied
-- here before legal_templates is updated and its version bumped. Prior
-- versions stay readable (never editable).
CREATE TABLE IF NOT EXISTS legal_template_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id  INTEGER NOT NULL,
  slug         TEXT NOT NULL,
  version      INTEGER NOT NULL,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  merge_fields TEXT NOT NULL DEFAULT '[]',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by   INTEGER,
  UNIQUE(template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_legal_template_versions_tpl ON legal_template_versions(template_id);

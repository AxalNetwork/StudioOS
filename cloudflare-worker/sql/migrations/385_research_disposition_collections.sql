-- D549: a reader's decisions, document metadata and owned Library collections.
-- Existing saved answers stay saved; no year or use note is inferred.
ALTER TABLE research_ask_answers ADD COLUMN discarded INTEGER NOT NULL DEFAULT 0
  CHECK (discarded IN (0, 1) AND (discarded = 0 OR saved = 0));
ALTER TABLE research_ask_answers ADD COLUMN use_note TEXT;
ALTER TABLE research_documents ADD COLUMN source_year INTEGER
  CHECK (source_year IS NULL OR (typeof(source_year) = 'integer' AND source_year BETWEEN 1000 AND 2100));
CREATE TABLE IF NOT EXISTS research_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_research_collections_owner ON research_collections(owner_user_id, id);
CREATE TABLE IF NOT EXISTS research_collection_documents (
  collection_id INTEGER NOT NULL REFERENCES research_collections(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection_id, document_id)
);

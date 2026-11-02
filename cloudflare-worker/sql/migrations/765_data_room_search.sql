-- #3938 part 2 (D1478 task 4, owner answer G = b): the data room's search index.
-- The vectors live in the Vectorize index `axal-dataroom` (qwen3-embedding-0.6b,
-- 1024 dimensions, cosine). D1 keeps what a hit is re-checked against and
-- shown from: one row per passage (its file, its order, its text and its
-- vector id), and one row per file saying whether and when it was indexed.
-- A file's passages and vectors are deleted with the file; a file replaced
-- after its index time reads as stale and is indexed again.
-- Additive; no transaction statements (D1 rejects them).
CREATE TABLE IF NOT EXISTS data_room_passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  file_id INTEGER NOT NULL,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  text TEXT NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (file_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_dr_passages_project ON data_room_passages (project_id, file_id);

CREATE TABLE IF NOT EXISTS data_room_search_state (
  file_id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('indexed', 'no_text', 'failed')),
  passages INTEGER NOT NULL DEFAULT 0 CHECK (passages >= 0),
  error TEXT,
  indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dr_search_state_project ON data_room_search_state (project_id, status);

-- D6897 part 2 (#6897, canvas D6054 RA-28 C, RA-29, RA-30 B): the PDF copies a founder downloaded.
--
-- A link (raise_evidence_share_links) can be stopped and its opens are counted. A downloaded PDF can be
-- neither: once it is on someone's disk it is out of Axal's reach. This table is the record of what left
-- as a PDF, so Shared links can list it beside the links ("A PDF is a copy: it cannot be stopped and its
-- opens are not counted"). It keeps no token and no copy of the content: only what was shared, for whom,
-- how many items, its hash, who downloaded it and when.
--
-- `output` takes the same three values as the link store; this migration's code writes 'pack' and
-- 'readiness'. The Raise status page (RA-31) follows with #6045.
CREATE TABLE IF NOT EXISTS raise_share_pdf_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  output TEXT NOT NULL CHECK (output IN ('pack','readiness','status')),
  label TEXT NOT NULL,
  reader TEXT NOT NULL CHECK (reader IN ('before_nda','after_nda')),
  nda_signed_on TEXT,
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  content_hash TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_raise_share_pdf_copies_project ON raise_share_pdf_copies(project_id, created_at);

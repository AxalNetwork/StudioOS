-- D5583 part 3 (#5583): transfer sessions for checksummed multipart media uploads.
-- Progress only, never a second blob ledger: a finished upload is recorded in the
-- existing work_graph_blobs row like a buffered one, and nothing here is counted
-- by the storage meter. No content, prompt or provenance text is stored; the
-- admission context is a digest the finishing call must match. The running hash
-- is eight SHA-256 state words at a part boundary, never bytes.
CREATE TABLE IF NOT EXISTS work_graph_media_uploads (
  upload_uid TEXT PRIMARY KEY CHECK (length(upload_uid) BETWEEN 1 AND 80),
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  project_id INTEGER NOT NULL DEFAULT 0 CHECK (project_id >= 0),
  object_class TEXT NOT NULL CHECK (object_class IN ('master','snapshot','rendition','thumbnail')),
  asset_uid TEXT NOT NULL,
  access_class TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  part_bytes INTEGER NOT NULL CHECK (part_bytes > 0 AND part_bytes % 64 = 0),
  part_count INTEGER NOT NULL CHECK (part_count > 1),
  residency TEXT CHECK (residency IS NULL OR length(residency) <= 40),
  r2_upload_id TEXT NOT NULL,
  context_digest TEXT NOT NULL CHECK (length(context_digest) = 64),
  next_part INTEGER NOT NULL DEFAULT 1 CHECK (next_part >= 1),
  hash_words TEXT NOT NULL CHECK (length(hash_words) = 64),
  admission_json TEXT NOT NULL,
  author_user_id INTEGER NOT NULL CHECK (author_user_id > 0),
  agent_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','abandoned','failed')),
  close_code TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_graph_media_uploads_open
  ON work_graph_media_uploads (tenant_id, company_id, status, expires_at);

CREATE TABLE IF NOT EXISTS work_graph_media_upload_parts (
  upload_uid TEXT NOT NULL,
  part_number INTEGER NOT NULL CHECK (part_number >= 1),
  digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  etag TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  PRIMARY KEY (upload_uid, part_number)
);

-- A session's identity and declared object never change; only its progress and close do.
CREATE TRIGGER IF NOT EXISTS work_graph_media_uploads_fixed BEFORE UPDATE ON work_graph_media_uploads
WHEN NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id OR NEW.project_id IS NOT OLD.project_id
  OR NEW.object_class IS NOT OLD.object_class OR NEW.asset_uid IS NOT OLD.asset_uid OR NEW.digest IS NOT OLD.digest
  OR NEW.byte_length IS NOT OLD.byte_length OR NEW.part_bytes IS NOT OLD.part_bytes OR NEW.part_count IS NOT OLD.part_count
  OR NEW.r2_upload_id IS NOT OLD.r2_upload_id OR NEW.context_digest IS NOT OLD.context_digest
  OR NEW.author_user_id IS NOT OLD.author_user_id OR NEW.created_at IS NOT OLD.created_at
  OR OLD.status IS NOT 'open'
BEGIN SELECT RAISE(ABORT, 'work_graph_media_uploads: only an open session progresses or closes (D5583 part 3).'); END;
-- A part's bytes are fixed once acknowledged; a retry of the same bytes may only refresh its etag.
CREATE TRIGGER IF NOT EXISTS work_graph_media_upload_parts_fixed BEFORE UPDATE ON work_graph_media_upload_parts
WHEN NEW.upload_uid IS NOT OLD.upload_uid OR NEW.part_number IS NOT OLD.part_number
  OR NEW.digest IS NOT OLD.digest OR NEW.byte_length IS NOT OLD.byte_length
BEGIN SELECT RAISE(ABORT, 'work_graph_media_upload_parts: a part keeps its digest (D5583 part 3).'); END;

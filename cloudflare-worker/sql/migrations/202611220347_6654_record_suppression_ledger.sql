-- D6654 (#6654): the record-file suppression ledger. One row per record object the one audited
-- erasure path (cloudflare-worker/src/services/recordErasure.ts) deleted, written before the delete
-- in the same operation, so a restore from an older file snapshot (scripts/file-recovery.py) can skip
-- every erased object. A row holds no file content and no object key: only the SHA-256 of the key,
-- its bucket and inventory class (documentation/operations/R2_INVENTORY.json), the closed reason,
-- the erasure request (or operation) id, an actor category and the time. Append-only.
CREATE TABLE IF NOT EXISTS record_suppression_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  key_hash TEXT NOT NULL CHECK (length(key_hash) = 64 AND key_hash NOT GLOB '*[^0-9a-f]*'),
  record_class TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('owner_removed', 'retention_expired', 'purge', 'erasure_request', 'unreferenced')),
  request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 128),
  actor TEXT NOT NULL CHECK (actor IN ('member', 'operator', 'system')),
  erased_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_record_suppression_ledger_key ON record_suppression_ledger (bucket, key_hash);

CREATE TRIGGER IF NOT EXISTS record_suppression_ledger_no_update
BEFORE UPDATE ON record_suppression_ledger
BEGIN
  SELECT RAISE(ABORT, 'record_suppression_ledger: rows are append-only (D6654)');
END;

CREATE TRIGGER IF NOT EXISTS record_suppression_ledger_no_delete
BEFORE DELETE ON record_suppression_ledger
BEGIN
  SELECT RAISE(ABORT, 'record_suppression_ledger: rows are append-only (D6654)');
END;

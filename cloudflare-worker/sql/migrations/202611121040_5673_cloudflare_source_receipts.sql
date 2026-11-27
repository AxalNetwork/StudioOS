-- D5673: Cloudflare source checkpoints and metadata receipts. Not an incident ledger or Slack delivery store.
CREATE TABLE IF NOT EXISTS cf_source_cursors (
  source_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  through_ms INTEGER NOT NULL DEFAULT 0,
  active_id TEXT,
  active_versions TEXT NOT NULL DEFAULT '[]',
  write_token TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cf_source_receipts (
  receipt_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  observed_ms INTEGER NOT NULL,
  receipt_json TEXT NOT NULL,
  forwarded_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cf_source_pending ON cf_source_receipts(forwarded_ms,observed_ms);

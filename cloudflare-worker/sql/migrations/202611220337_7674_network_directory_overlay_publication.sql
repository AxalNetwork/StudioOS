-- D7674 (#7674): a member's private overlay on a directory person, and the ledger of reviewed publication changes.
-- Additive only. Neither table is written by the #7672 importer; neither creates a relationship, an account or a notice.

-- One member's own note and saved mark on a canonical directory person. Never read by another member,
-- never a relationship, never a consent. Deleting the member's account removes their overlay.
CREATE TABLE IF NOT EXISTS network_directory_overlays (
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_uid TEXT NOT NULL,
  entry_kind TEXT NOT NULL DEFAULT 'person' CHECK (entry_kind = 'person'),
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  private_note TEXT CHECK (private_note IS NULL OR length(private_note) <= 2000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_user_id, entry_uid),
  FOREIGN KEY (entry_uid, entry_kind) REFERENCES network_directory_entries(uid, kind)
);
CREATE INDEX IF NOT EXISTS idx_network_directory_overlays_entry ON network_directory_overlays(entry_uid);

-- Every publication change an operator makes, with the source snapshot it was checked against.
-- The idempotency key makes a retried request a no-op instead of a second change.
CREATE TABLE IF NOT EXISTS network_directory_publication_events (
  uid TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  entry_uid TEXT NOT NULL REFERENCES network_directory_entries(uid),
  action TEXT NOT NULL CHECK (action IN ('publish', 'suppress')),
  from_status TEXT NOT NULL CHECK (from_status IN ('staged', 'published', 'suppressed', 'archived')),
  to_status TEXT NOT NULL CHECK (to_status IN ('staged', 'published', 'suppressed', 'archived')),
  checked_source_record_uid TEXT REFERENCES network_directory_source_records(uid),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_network_directory_publication_entry ON network_directory_publication_events(entry_uid, created_at);

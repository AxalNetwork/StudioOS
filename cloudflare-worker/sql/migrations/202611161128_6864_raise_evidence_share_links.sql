-- D6864 (#6864, canvas D6054 RA-27 to RA-29): a dated evidence pack shared outside Axal as a link.
--
-- One row is one link the founder made. The link is a capability: the raw token is never stored, only its
-- SHA-256 (as captable_share_tokens, migration 170), so a dump of this table opens nothing. The pack is
-- frozen at creation in `snapshot_json` ("dated; it does not update"): the reader always sees what left on
-- `created_at`, and `pack_hash` lets the founder's list say "Changed since sent" without touching the copy.
-- Views, expiry and revocation are checked and counted by one conditional UPDATE, so a link at its limit
-- cannot be opened twice by two readers at once. Expired, used-up and revoked rows are kept: Shared links is
-- the record of what left Axal.
--
-- `output` names the three outputs the canvas draws; this migration's code writes 'pack' only. The readiness
-- snapshot (RA-30) and the Raise status page (RA-31) are follow-ups and reuse this table.
CREATE TABLE IF NOT EXISTS raise_evidence_share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  output TEXT NOT NULL DEFAULT 'pack' CHECK (output IN ('pack','readiness','status')),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  reader TEXT NOT NULL CHECK (reader IN ('before_nda','after_nda')),
  -- After an NDA only: the day the founder says the NDA outside Axal was signed, and who confirmed it.
  nda_signed_on TEXT,
  nda_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- The items the founder ticked, or NULL for every item shared beyond Private at creation.
  item_uids_json TEXT,
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  snapshot_json TEXT NOT NULL,
  pack_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  view_limit INTEGER NOT NULL CHECK (view_limit BETWEEN 1 AND 100),
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_viewed_at TEXT,
  revoked_at TEXT,
  revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (reader = 'before_nda' OR (nda_signed_on IS NOT NULL AND nda_confirmed_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_raise_evidence_share_links_project ON raise_evidence_share_links(project_id, created_at);

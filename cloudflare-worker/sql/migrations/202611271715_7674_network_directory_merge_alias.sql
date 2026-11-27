-- D7674 part 3 (#7674): reviewed merge, stable redirects, organisation aliases and review decisions
-- for the shared Network directory. Additive only: four new tables, no change to an existing table.
-- A merge rewrites no evidence. The merged-away entry keeps its source observations, private source
-- rows, affiliations, overlays, introduction requests and book links; it is archived and redirected,
-- and readers follow the redirect. No row here creates an account, a relationship or a notice.

-- One row per reviewed merge. An entry is merged away at most once.
CREATE TABLE IF NOT EXISTS network_directory_merges (
  uid TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  kind TEXT NOT NULL CHECK (kind IN ('person', 'organization')),
  from_uid TEXT NOT NULL,
  to_uid TEXT NOT NULL,
  -- What members could see of the merged-away entry before the merge, so a later reversal can restore it.
  from_publication_status TEXT NOT NULL CHECK (from_publication_status IN ('staged', 'published', 'suppressed')),
  review_uid TEXT REFERENCES network_directory_reviews(uid),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (from_uid, kind) REFERENCES network_directory_entries(uid, kind),
  FOREIGN KEY (to_uid, kind) REFERENCES network_directory_entries(uid, kind),
  CHECK (from_uid <> to_uid)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_directory_merges_from ON network_directory_merges(from_uid);
CREATE INDEX IF NOT EXISTS idx_network_directory_merges_to ON network_directory_merges(to_uid);

-- The stable redirect of a merged-away entry to its canonical entry. Always one hop: a later merge of
-- the canonical entry moves the redirects that pointed at it, and the merges table keeps the history.
CREATE TABLE IF NOT EXISTS network_directory_redirects (
  from_uid TEXT PRIMARY KEY REFERENCES network_directory_entries(uid),
  to_uid TEXT NOT NULL REFERENCES network_directory_entries(uid),
  merge_uid TEXT NOT NULL REFERENCES network_directory_merges(uid),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_uid <> to_uid)
);
CREATE INDEX IF NOT EXISTS idx_network_directory_redirects_to ON network_directory_redirects(to_uid);

-- An operator's decision on one review item. The review row itself stays, so it remains inspectable.
-- 'resolved' is only ever written by a reviewed merge that names the review.
CREATE TABLE IF NOT EXISTS network_directory_review_decisions (
  uid TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  review_uid TEXT NOT NULL UNIQUE REFERENCES network_directory_reviews(uid),
  decision TEXT NOT NULL CHECK (decision IN ('kept_separate', 'resolved', 'dismissed')),
  merge_uid TEXT REFERENCES network_directory_merges(uid),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((decision = 'resolved') = (merge_uid IS NOT NULL))
);

-- Another name an organisation is known by. Organisations only: no person alias is kept here.
-- alias_key is the lower-cased, space-collapsed form one organisation may hold once while active.
CREATE TABLE IF NOT EXISTS network_directory_aliases (
  uid TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 120),
  entry_uid TEXT NOT NULL,
  entry_kind TEXT NOT NULL DEFAULT 'organization' CHECK (entry_kind = 'organization'),
  alias TEXT NOT NULL CHECK (length(trim(alias)) BETWEEN 1 AND 300),
  alias_key TEXT NOT NULL CHECK (length(alias_key) BETWEEN 1 AND 300),
  origin TEXT NOT NULL CHECK (origin IN ('operator', 'merge')),
  merge_uid TEXT REFERENCES network_directory_merges(uid),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  withdrawn_key TEXT UNIQUE CHECK (withdrawn_key IS NULL OR length(withdrawn_key) BETWEEN 8 AND 120),
  withdrawn_by INTEGER REFERENCES users(id),
  withdrawn_reason TEXT CHECK (withdrawn_reason IS NULL OR length(trim(withdrawn_reason)) BETWEEN 3 AND 500),
  withdrawn_at TEXT,
  FOREIGN KEY (entry_uid, entry_kind) REFERENCES network_directory_entries(uid, kind),
  CHECK ((origin = 'merge') = (merge_uid IS NOT NULL)),
  CHECK ((status = 'active' AND withdrawn_key IS NULL AND withdrawn_by IS NULL AND withdrawn_reason IS NULL AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND withdrawn_key IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawn_reason IS NOT NULL AND withdrawn_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_directory_aliases_active ON network_directory_aliases(entry_uid, alias_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_network_directory_aliases_key ON network_directory_aliases(alias_key) WHERE status = 'active';

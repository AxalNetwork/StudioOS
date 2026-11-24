-- D7742 (#7742) — Research imports: the private staging store. A source record is kept whole and
-- unchanged, apart from the reviewed catalogue, with stable ids, row hashes and a run record.
-- Public DDL, no rows. Only files named researchSource* or research_source_* may name these tables
-- (research_source_records_7742.test.ts holds every file under cloudflare-worker/src to that).

-- One import run. The acting user has no foreign key, so the run outlives the account.
CREATE TABLE IF NOT EXISTS research_source_runs (
  uid               TEXT PRIMARY KEY,
  idempotency_key   TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  acted_by_user_id  INTEGER,
  worker_version    TEXT,
  payload_sha256    TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  hash_recipe_id    TEXT,
  manifest_json     TEXT NOT NULL CHECK (json_valid(manifest_json)),
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'complete', 'partial', 'failed', 'uncertain')),
  counts_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json)),
  uncertain_chunks_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(uncertain_chunks_json)),
  started_at        TEXT NOT NULL,
  verified_at       TEXT
);

-- A record as captured. The same (source, id, stated hash) again is a no-op; a changed record is a new row
-- beside the old one. body_json holds the non-contact columns as [[column, value], …] in source order.
CREATE TABLE IF NOT EXISTS research_source_records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key         TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 100),
  provider_record_id TEXT NOT NULL CHECK (length(provider_record_id) BETWEEN 1 AND 200),
  stated_row_hash    TEXT NOT NULL CHECK (length(stated_row_hash) BETWEEN 1 AND 200),
  body_sha256        TEXT NOT NULL CHECK (length(body_sha256) = 64),
  hash_checked       INTEGER NOT NULL DEFAULT 0 CHECK (hash_checked IN (0, 1)),
  columns_json       TEXT NOT NULL CHECK (json_valid(columns_json)),
  body_json          TEXT NOT NULL CHECK (json_valid(body_json)),
  captured_at        TEXT,
  first_run_uid      TEXT NOT NULL REFERENCES research_source_runs(uid),
  UNIQUE (source_key, provider_record_id, stated_row_hash)
);
CREATE INDEX IF NOT EXISTS idx_research_source_records_identity
  ON research_source_records (source_key, provider_record_id);

-- Stored content is never rewritten: a correction is a new version, a removal is a DELETE.
CREATE TRIGGER IF NOT EXISTS research_source_records_no_update
BEFORE UPDATE ON research_source_records
BEGIN
  SELECT RAISE(ABORT, 'research_source_records: stored content is never updated');
END;

-- What each run saw, by id and hash. No content. Ids, hashes and counts stay after content is removed.
-- cells_json maps each manifest column to s (stored), w (withheld) or b (blank): column names only.
CREATE TABLE IF NOT EXISTS research_source_run_records (
  run_uid            TEXT NOT NULL REFERENCES research_source_runs(uid),
  source_key         TEXT NOT NULL,
  provider_record_id TEXT NOT NULL,
  stated_row_hash    TEXT NOT NULL,
  body_sha256        TEXT,
  hash_checked       INTEGER NOT NULL DEFAULT 0 CHECK (hash_checked IN (0, 1)),
  outcome            TEXT NOT NULL CHECK (outcome IN ('new', 'unchanged', 'new_version', 'refused')),
  refusal_code       TEXT,
  cells_json         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cells_json)),
  chunk_index        INTEGER NOT NULL CHECK (chunk_index >= 0),
  PRIMARY KEY (run_uid, source_key, provider_record_id),
  CHECK ((outcome = 'refused') = (refusal_code IS NOT NULL))
);

-- A record's held contact-class values, as column-cipher ciphertext bound to table, column and row.
-- Held is off for the four-source package (#7739 Q3 = B): no caller enables it.
CREATE TABLE IF NOT EXISTS research_source_private_fields (
  record_id   INTEGER NOT NULL REFERENCES research_source_records(id) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  ciphertext  TEXT NOT NULL CHECK (ciphertext LIKE 'v1.%'),
  PRIMARY KEY (record_id, column_name)
);

-- Flags supplied with the package, kept as supplied. Detail names record ids and column names, never a value.
CREATE TABLE IF NOT EXISTS research_source_flags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id    INTEGER NOT NULL REFERENCES research_source_records(id) ON DELETE CASCADE,
  column_name  TEXT,
  flag_code    TEXT NOT NULL CHECK (length(flag_code) BETWEEN 1 AND 80),
  detail       TEXT CHECK (detail IS NULL OR length(detail) <= 500),
  rule_version TEXT NOT NULL CHECK (length(rule_version) BETWEEN 1 AND 40)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_source_flags_once
  ON research_source_flags (record_id, COALESCE(column_name, ''), flag_code, rule_version);

-- Per source and column: the class, fixed when the source's first run opens. A contact column is withheld
-- (never written, only counted; the default) or held (encrypted). A contact column can never be served.
CREATE TABLE IF NOT EXISTS research_source_column_rules (
  source_key       TEXT NOT NULL,
  column_name      TEXT NOT NULL,
  column_order     INTEGER NOT NULL CHECK (column_order >= 0),
  class            TEXT NOT NULL CHECK (class IN ('fact', 'prose', 'contact')),
  contact_handling TEXT CHECK (contact_handling IN ('withheld', 'held')),
  role             TEXT CHECK (role IS NULL OR length(role) BETWEEN 1 AND 40),
  destination      TEXT NOT NULL DEFAULT 'none',
  serve            INTEGER NOT NULL DEFAULT 0 CHECK (serve IN (0, 1)),
  fixed_at         TEXT NOT NULL,
  fixed_by_run_uid TEXT NOT NULL REFERENCES research_source_runs(uid),
  PRIMARY KEY (source_key, column_name),
  CHECK ((class = 'contact') = (contact_handling IS NOT NULL)),
  CHECK (NOT (class = 'contact' AND serve = 1))
);

-- Each removal, recorded. No content. An active removal (lifted_at NULL) refuses later runs for its scope.
CREATE TABLE IF NOT EXISTS research_source_removals (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id      INTEGER,
  removed_at         TEXT NOT NULL,
  scope              TEXT NOT NULL CHECK (scope IN ('private_fields', 'record', 'source')),
  source_key         TEXT NOT NULL,
  provider_record_id TEXT,
  counts_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts_json)),
  lifted_at          TEXT,
  lifted_by_user_id  INTEGER,
  CHECK ((scope = 'source') = (provider_record_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_research_source_removals_active
  ON research_source_removals (source_key, provider_record_id) WHERE lifted_at IS NULL;

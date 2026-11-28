-- D7746 (#7746) — Research imports: what each staged source record is and what is to happen to it.
-- Two empty tables, named research_source_* so #7742's table-name check covers them. Public DDL, no rows.
-- Kinds, decisions, grounds, target types and reason codes are lists exported and checked by
-- services/researchSourceMapping.ts, not CHECKs, so a later plan can add a kind or a target without a rebuild.
-- A staged record with no link row is unresolved. No organisation column: the Companies plan adds its own.
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611271037_7746_research_source_record_links.fix.sql

-- One row per (source key, provider record id): the decision standing now. `revision` counts the decisions
-- taken, so a change between a preview and its apply is seen. The promotion mark is set only by
-- markPromoted (#7751, through the service). The note is private: it is never logged, audited or copied into
-- the history.
CREATE TABLE IF NOT EXISTS research_source_record_links (
  source_key          TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 100),
  provider_record_id  TEXT NOT NULL CHECK (length(provider_record_id) BETWEEN 1 AND 200),
  kind                TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  decision            TEXT NOT NULL CHECK (length(decision) BETWEEN 1 AND 40),
  ground_code         TEXT CHECK (ground_code IS NULL OR length(ground_code) BETWEEN 1 AND 40),
  target_type         TEXT CHECK (target_type IS NULL OR length(target_type) BETWEEN 1 AND 40),
  target_source_key   TEXT CHECK (target_source_key IS NULL OR length(target_source_key) BETWEEN 1 AND 100),
  target_id           TEXT CHECK (target_id IS NULL OR length(target_id) BETWEEN 1 AND 200),
  reason_code         TEXT CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 40),
  note                TEXT CHECK (note IS NULL OR length(note) <= 280),
  decided_by_user_id  INTEGER,
  decided_at          TEXT NOT NULL,
  revision            INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  promoted_uid        TEXT CHECK (promoted_uid IS NULL OR length(promoted_uid) BETWEEN 1 AND 200),
  promoted_at         TEXT,
  PRIMARY KEY (source_key, provider_record_id),
  CHECK ((target_type IS NULL) = (target_id IS NULL)),
  CHECK ((promoted_uid IS NULL) = (promoted_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_research_source_record_links_target
  ON research_source_record_links (target_type, target_source_key, target_id);

-- One row per decision ever taken (and per promotion mark), written in the same batch as the link row.
-- Ids, codes, the actor and the time only: no note, no field value. Append-only, as 612_closings.sql's events.
CREATE TABLE IF NOT EXISTS research_source_link_history (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uid           TEXT NOT NULL CHECK (length(batch_uid) BETWEEN 1 AND 80),
  event               TEXT NOT NULL CHECK (event IN ('decided', 'promoted')),
  source_key          TEXT NOT NULL,
  provider_record_id  TEXT NOT NULL,
  revision            INTEGER NOT NULL CHECK (revision >= 1),
  kind                TEXT NOT NULL,
  decision            TEXT NOT NULL,
  ground_code         TEXT,
  target_type         TEXT,
  target_source_key   TEXT,
  target_id           TEXT,
  reason_code         TEXT,
  promoted_uid        TEXT,
  actor_user_id       INTEGER,
  at                  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_source_link_history_record
  ON research_source_link_history (source_key, provider_record_id, id);
CREATE INDEX IF NOT EXISTS idx_research_source_link_history_batch
  ON research_source_link_history (batch_uid);

CREATE TRIGGER IF NOT EXISTS research_source_link_history_no_update
BEFORE UPDATE ON research_source_link_history
BEGIN
  SELECT RAISE(ABORT, 'research_source_link_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS research_source_link_history_no_delete
BEFORE DELETE ON research_source_link_history
BEGIN
  SELECT RAISE(ABORT, 'research_source_link_history is append-only');
END;

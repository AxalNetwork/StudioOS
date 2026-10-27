-- 644 — Notion part 4: a look-alike roadmap item or must-have waits as
-- "Link to [existing]?" (D1088, #2953). Number given on #2953 by S21 for S1,
-- 2026-10-27 (answer A).
--
-- notion_proposals.kind gains 'fact_link': a Notion row of Product roadmap or
-- Prototype / MVP whose title matches an item already there. It is never
-- imported as a second row (#2405 § Module map, rule 4). payload_json holds
-- the matched row ({ local_table, local_id, existing, fed_by }); Accept gives
-- a hand-entered row Notion's ledger link, and a row another connection feeds
-- is never linked (`fedOwnership.canLink`).
--
-- SQLite cannot widen a CHECK in place, so the table is rebuilt with the same
-- columns, defaults, keys and index, and every row is copied as it is. No row
-- changes and none is added: nothing is backfilled. notion_proposals has no
-- foreign key into it and no trigger on it.
--
-- Grep first (D689 D-t): no migration after 640 alters notion_proposals, and
-- schema_baseline.sql does not hold it.

CREATE TABLE notion_proposals_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  source_id INTEGER,
  module TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('interview', 'design_note', 'prospect', 'prospect_link', 'data_room_snapshot', 'fact_link')),
  source_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  extract TEXT,
  url TEXT,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  changed INTEGER NOT NULL DEFAULT 0 CHECK (changed IN (0, 1)),
  local_table TEXT,
  local_id INTEGER,
  decided_by INTEGER,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, kind, source_key)
);

INSERT INTO notion_proposals_new (id, integration_id, project_id, source_id, module, kind, source_key, fingerprint, title, extract, url,
  payload_json, status, changed, local_table, local_id, decided_by, decided_at, created_at, updated_at)
SELECT id, integration_id, project_id, source_id, module, kind, source_key, fingerprint, title, extract, url,
  payload_json, status, changed, local_table, local_id, decided_by, decided_at, created_at, updated_at
FROM notion_proposals;

DROP TABLE notion_proposals;
ALTER TABLE notion_proposals_new RENAME TO notion_proposals;

CREATE INDEX IF NOT EXISTS idx_notion_proposals_project
  ON notion_proposals (project_id, module, status, id);

-- 586 — Notion part 2: the sources a founder picks, and the proposals they decide (D1086, #2951).
--
-- Two new tables, no change to an existing one.
--
--   notion_sources    one picked Notion page, page tree or database per
--       venture per module. The founder picks it on the connector page and
--       maps its properties once (`field_map_json`, checked against the
--       module's allowed fields and values). `status = 'removed'` is "Stop
--       using": Axal VC no longer reads it, and the rows already read stay
--       in their module, marked no longer synced. `last_result` and
--       `last_counts_json` are the last founder-pressed sync's outcome, as
--       counts only: never page text, a title or a value.
--   notion_proposals  an item that waits for the founder's Accept, as
--       GitHub's `solution_design_proposals` (migration 500): it creates a
--       person record, is shared outside the team, or turns a free-text page
--       into a structured record (#2405 § Module map). `fingerprint` is the
--       SHA-256 of what the item says now: a sync that finds the same
--       fingerprint leaves the row alone, whatever its status, so a dismissed
--       proposal stays dismissed; a changed fingerprint puts it back to
--       `pending` with `changed = 1` ("Changed in Notion"). Nothing here is
--       in `connector_fed_items` until it is accepted: a proposal is
--       judgement, not a fact.
--
-- A fact (a mapped database row) lands through its module's own writer with
-- a `connector_fed_items` row (migration 445), so a re-sync updates it and a
-- row the founder deleted stays deleted. Page text is untrusted: it is stored
-- as text and drawn as text. D1 rejects BEGIN/COMMIT, so there is no
-- transaction.

CREATE TABLE IF NOT EXISTS notion_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  module TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('page', 'page_tree', 'database')),
  notion_id TEXT NOT NULL,
  title TEXT,
  url TEXT,
  field_map_json TEXT,
  default_source TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  last_synced_at TEXT,
  last_result TEXT CHECK (last_result IS NULL OR last_result IN ('ok', 'partial', 'unreadable')),
  last_counts_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, module, notion_id)
);

CREATE INDEX IF NOT EXISTS idx_notion_sources_project
  ON notion_sources (project_id, module, status);

CREATE TABLE IF NOT EXISTS notion_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  source_id INTEGER,
  module TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('interview', 'design_note', 'prospect', 'prospect_link', 'data_room_snapshot')),
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

CREATE INDEX IF NOT EXISTS idx_notion_proposals_project
  ON notion_proposals (project_id, module, status, id);

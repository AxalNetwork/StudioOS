-- Task #5 — Carta integration. Adds two tables for the live cap table
-- (separate from the simulator's `cap_table_scenarios`) plus a `source`
-- column on each so we can distinguish manual rows from Carta-synced ones.
--
-- D1 (SQLite) re-runs of CREATE … IF NOT EXISTS are idempotent. Safe to
-- re-apply.

CREATE TABLE IF NOT EXISTS cap_table_holders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  name TEXT NOT NULL,
  email TEXT,
  security_type TEXT,
  shares REAL DEFAULT 0,
  ownership_pct REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  carta_stakeholder_id TEXT,
  carta_security_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cap_table_holders_user ON cap_table_holders(user_id);
CREATE INDEX IF NOT EXISTS idx_cap_table_holders_project ON cap_table_holders(project_id);
CREATE INDEX IF NOT EXISTS idx_cap_table_holders_carta ON cap_table_holders(carta_stakeholder_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cap_table_holders_carta ON cap_table_holders(user_id, carta_stakeholder_id, carta_security_id) WHERE carta_stakeholder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cap_table_securities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  name TEXT NOT NULL,
  share_class TEXT,
  shares_authorized REAL,
  shares_issued REAL,
  source TEXT NOT NULL DEFAULT 'manual',
  carta_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cap_table_securities_user ON cap_table_securities(user_id);
CREATE INDEX IF NOT EXISTS idx_cap_table_securities_project ON cap_table_securities(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cap_table_securities_carta ON cap_table_securities(user_id, carta_id) WHERE carta_id IS NOT NULL;

-- Per-user issuer pointer + last sync timestamp lives on the integration
-- row (config_json + last_synced_at). No separate table needed.

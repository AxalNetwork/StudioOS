-- D1175 / #3102: model v1's scenarios, fixed sections and costed milestones.
-- Data is copied lazily, once, by services/useOfFunds/legacy.ts in a bound
-- transaction. No project/JSON value is guessed by this schema migration.
-- #2431 provenance matches migration 544; copied legacy values say Recorded,
-- not Typed/Connector/Signed when the old store did not record their source.
CREATE TABLE IF NOT EXISTS uof_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_base INTEGER NOT NULL DEFAULT 0 CHECK (is_base IN (0, 1)),
  model_version INTEGER NOT NULL DEFAULT 1 CHECK (model_version = 1),
  currency TEXT NOT NULL DEFAULT 'usd',
  amount_to_raise_cents INTEGER CHECK (amount_to_raise_cents IS NULL OR (typeof(amount_to_raise_cents) = 'integer' AND amount_to_raise_cents >= 0)),
  target_runway_months INTEGER CHECK (target_runway_months IS NULL OR (typeof(target_runway_months) = 'integer' AND target_runway_months BETWEEN 1 AND 120)),
  start_month TEXT,
  raise_month TEXT,
  cash_cents INTEGER CHECK (cash_cents IS NULL OR typeof(cash_cents) = 'integer'),
  legacy_copied_at TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_uof_scenarios_base ON uof_scenarios(project_id) WHERE is_base = 1;
CREATE INDEX IF NOT EXISTS idx_uof_scenarios_project ON uof_scenarios(project_id, id);

CREATE TABLE IF NOT EXISTS uof_scenario_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  scenario_id INTEGER NOT NULL REFERENCES uof_scenarios(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL CHECK (category_key IN ('product', 'go-to-market', 'infrastructure', 'operations', 'reserve')),
  share_pct INTEGER CHECK (share_pct IS NULL OR (typeof(share_pct) = 'integer' AND share_pct BETWEEN 0 AND 100)),
  sublabel TEXT,
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('eadwyn', 'connector', 'module')),
  source_ref TEXT,
  source_label TEXT CHECK (source_label IS NULL OR source_label IN ('connector', 'document', 'recorded', 'signed', 'typed')),
  prior_value TEXT,
  undone_at TEXT,
  undone_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scenario_id, category_key)
);

CREATE TABLE IF NOT EXISTS uof_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  scenario_id INTEGER NOT NULL REFERENCES uof_scenarios(id) ON DELETE CASCADE,
  category_key TEXT CHECK (category_key IS NULL OR category_key IN ('product', 'go-to-market', 'infrastructure', 'operations', 'reserve')),
  label TEXT NOT NULL,
  due_on TEXT,
  cost_cents INTEGER CHECK (cost_cents IS NULL OR (typeof(cost_cents) = 'integer' AND cost_cents >= 0)),
  okr_id INTEGER REFERENCES roadmap_okrs(id) ON DELETE SET NULL,
  legacy_ref TEXT,
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('eadwyn', 'connector', 'module')),
  source_ref TEXT,
  source_label TEXT CHECK (source_label IS NULL OR source_label IN ('connector', 'document', 'recorded', 'signed', 'typed')),
  prior_value TEXT,
  undone_at TEXT,
  undone_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scenario_id, legacy_ref)
);
CREATE INDEX IF NOT EXISTS idx_uof_milestones_scenario ON uof_milestones(scenario_id, due_on, id);
CREATE INDEX IF NOT EXISTS idx_uof_milestones_okr ON uof_milestones(okr_id);

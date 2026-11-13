-- D662: founder Build cycle. Additive; the analyst-only risk overrides in
-- migration 114 remain separate from the founder's own risk register.
ALTER TABLE mvp_features ADD COLUMN pain_group_id INTEGER REFERENCES pain_groups(id);
ALTER TABLE mvp_features ADD COLUMN hypothesis_id INTEGER REFERENCES hypotheses(id);
ALTER TABLE mvp_features ADD COLUMN is_must_have INTEGER CHECK (is_must_have IN (0, 1));
ALTER TABLE mvp_features ADD COLUMN done_at TEXT;
ALTER TABLE mvp_features ADD COLUMN owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE mvp_features ADD COLUMN due_date TEXT;
ALTER TABLE projects ADD COLUMN mvp_target_date TEXT;
ALTER TABLE projects ADD COLUMN spinout_ip_meta TEXT;

CREATE INDEX IF NOT EXISTS idx_mvp_features_pain ON mvp_features(project_id, pain_group_id);
CREATE INDEX IF NOT EXISTS idx_mvp_features_hypothesis ON mvp_features(project_id, hypothesis_id);

-- The existing MVP-scope writer continues to own delivery_status. Record the
-- transition here so both old and new writes share one completion history.
CREATE TRIGGER IF NOT EXISTS trg_mvp_feature_done_insert
AFTER INSERT ON mvp_features WHEN NEW.delivery_status = 'Done' AND NEW.done_at IS NULL
BEGIN UPDATE mvp_features SET done_at = NEW.created_at WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_mvp_feature_done_update
AFTER UPDATE OF delivery_status ON mvp_features
WHEN NEW.delivery_status = 'Done' AND OLD.delivery_status <> 'Done'
BEGIN UPDATE mvp_features SET done_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_mvp_feature_undone_update
AFTER UPDATE OF delivery_status ON mvp_features
WHEN NEW.delivery_status <> 'Done' AND OLD.delivery_status = 'Done'
BEGIN UPDATE mvp_features SET done_at = NULL WHERE id = NEW.id; END;

CREATE TABLE IF NOT EXISTS venture_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  owner_user_id INTEGER REFERENCES users(id),
  mitigation TEXT,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'mitigating', 'closed')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_venture_risks_project ON venture_risks(project_id, state, severity);

ALTER TABLE roadmap_okrs ADD COLUMN owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE roadmap_okrs ADD COLUMN target_date TEXT;
ALTER TABLE roadmap_okrs ADD COLUMN kpi_key TEXT;
ALTER TABLE cap_table_holders ADD COLUMN founder_role TEXT;
ALTER TABLE entity_obligations ADD COLUMN proof_file_key TEXT;

CREATE TABLE IF NOT EXISTS formation_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  due_date TEXT,
  state TEXT NOT NULL DEFAULT 'todo' CHECK (state IN ('todo', 'doing', 'done')),
  proof_file_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_formation_steps_project ON formation_steps(project_id, sort_order, id);

-- Explicit mapping avoids guessing a tool's purpose from its provider name.
-- A mapping is visible only while integration_companies still enables the
-- connector for the project's company. Credentials stay with their owner.
CREATE TABLE IF NOT EXISTS project_core_systems (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bank', 'accounting', 'payroll', 'crm', 'product_analytics')),
  integration_id INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
  used_by TEXT,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_project_core_systems_integration ON project_core_systems(integration_id);

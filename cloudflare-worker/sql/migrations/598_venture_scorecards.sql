-- D1144 (#3030): the shared SCORING store; PMF is its first scope.
CREATE TABLE IF NOT EXISTS scoring_model_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  version TEXT NOT NULL,
  model_json TEXT NOT NULL CHECK(json_valid(model_json)),
  published_at TEXT NOT NULL,
  published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope, version)
);
CREATE TABLE IF NOT EXISTS venture_scorecards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  value REAL CHECK(value BETWEEN 0 AND 100),
  band TEXT CHECK(band IN ('Strong','Fair','Weak')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  coverage REAL NOT NULL CHECK(coverage BETWEEN 0 AND 1),
  inputs_json TEXT NOT NULL CHECK(json_valid(inputs_json)),
  inputs_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  model_version TEXT NOT NULL,
  trigger TEXT NOT NULL,
  -- Historical actor id stays stable for the signed snapshot after account removal.
  computed_by INTEGER,
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(scope, model_version) REFERENCES scoring_model_versions(scope, version),
  CHECK((value IS NULL AND band IS NULL) OR (value IS NOT NULL AND band IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_venture_scorecards_scope_history ON venture_scorecards(project_id, scope, id);

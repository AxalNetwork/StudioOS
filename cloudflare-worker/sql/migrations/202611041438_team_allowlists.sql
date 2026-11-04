-- D4422 (#4422): a company policy inherited by its projects, or a standalone project's policy.
-- Null lists retain plan/sponsor defaults; [] allows none. Actor/time and activity_logs audit are atomic.
CREATE TABLE team_allowlists (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company', 'project')),
  scope_id INTEGER NOT NULL,
  model_ids_json TEXT CHECK (model_ids_json IS NULL OR (json_valid(model_ids_json) AND json_type(model_ids_json) = 'array')),
  tool_grants_json TEXT CHECK (tool_grants_json IS NULL OR (json_valid(tool_grants_json) AND json_type(tool_grants_json) = 'array')),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope_kind, scope_id)
);

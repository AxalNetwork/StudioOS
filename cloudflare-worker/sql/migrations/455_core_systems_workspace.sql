-- D686 #1593: Workspace replaces the unused product analytics mapping.
PRAGMA defer_foreign_keys = TRUE;
CREATE TABLE project_core_systems_workspace_copy AS
SELECT project_id, kind, integration_id, used_by, updated_by, updated_at
FROM project_core_systems WHERE kind <> 'product_analytics';
DROP TABLE project_core_systems;
CREATE TABLE project_core_systems (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bank', 'accounting', 'payroll', 'crm', 'workspace')),
  integration_id INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
  provider_key TEXT CHECK (provider_key IS NULL OR provider_key IN ('google_calendar', 'microsoft_365')),
  used_by TEXT,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, kind),
  CHECK ((kind = 'workspace') = (provider_key IS NOT NULL)),
  CHECK (provider_key IS NULL OR integration_id IS NULL)
);
INSERT INTO project_core_systems(project_id, kind, integration_id, used_by, updated_by, updated_at)
SELECT project_id, kind, integration_id, used_by, updated_by, updated_at FROM project_core_systems_workspace_copy;
DROP TABLE project_core_systems_workspace_copy;
CREATE INDEX idx_project_core_systems_integration ON project_core_systems(integration_id);

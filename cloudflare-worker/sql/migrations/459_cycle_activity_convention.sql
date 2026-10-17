-- D690, #1690: creator attribution for existing cycle stores and a scoped
-- activity lookup. Existing rows keep NULL creators; no content is backfilled.
ALTER TABLE pain_groups ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE hypotheses ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE mvp_features ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE roadmap_okrs ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_activity_logs_project_entity
  ON activity_logs(project_id, entity_type, entity_id, created_at DESC);

-- D548: an explicit focus; legacy rows remain unrecorded.
ALTER TABLE metric_targets ADD COLUMN is_focus INTEGER CHECK (is_focus IN (0, 1));
CREATE UNIQUE INDEX idx_metric_targets_focus ON metric_targets(project_id) WHERE is_focus = 1;

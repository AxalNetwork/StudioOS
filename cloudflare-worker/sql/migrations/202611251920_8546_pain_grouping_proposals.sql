-- D8546 (#8546, part of #6006): a pending Problem discovery grouping proposal.
-- One row is a set of existing phrases from one venture, possibly said in several
-- interviews, offered for one target: an existing theme, or a proposed new title.
-- Nothing here changes a theme's membership; only an accepted decision does, through
-- the same alias upsert as POST /api/progress/pain-groups/:projectId/assign-many.
--
-- The original (members_json, target_*) is never rewritten. A writer's edit lands in
-- edited_members_json / edited_title, so the two stay distinguishable. `decision_token`
-- is set by the one statement that claims the row and is what every other statement of
-- the accept batch is guarded on, so a concurrent or replayed accept writes nothing.
CREATE TABLE IF NOT EXISTS pain_grouping_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'discarded')),
  target_group_id INTEGER,
  target_title TEXT,
  members_json TEXT NOT NULL,
  edited_members_json TEXT,
  edited_title TEXT,
  edited_by INTEGER,
  edited_at TEXT,
  source_key TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by INTEGER,
  decided_at TEXT,
  decision_token TEXT,
  accepted_group_id INTEGER,
  CHECK ((target_group_id IS NOT NULL AND target_title IS NULL) OR (target_group_id IS NULL AND target_title IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_pain_grouping_proposals_project
  ON pain_grouping_proposals (project_id, status, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pain_grouping_proposals_source
  ON pain_grouping_proposals (project_id, source_key)
  WHERE source_key IS NOT NULL;

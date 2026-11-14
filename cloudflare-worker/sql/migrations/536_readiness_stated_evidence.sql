-- D891 / #2447: typed traction is stated, never measured.
-- Rebuild without changing IDs, history, score, actor, source or timestamps.
-- Every historical computed traction row came from typed project fields;
-- it cannot be retrospectively upgraded using a later verified receipt.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE readiness_scores_v536 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES readiness_items(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  evidence TEXT NOT NULL CHECK (evidence IN ('anecdote', 'pattern', 'stated', 'measured')),
  missing TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'computed')),
  scored_by INTEGER REFERENCES users(id),
  scored_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO readiness_scores_v536 (id,item_id,project_id,score,evidence,missing,source,scored_by,scored_at)
SELECT s.id,s.item_id,s.project_id,s.score,
  CASE WHEN s.source='computed' AND s.evidence='measured'
    AND EXISTS (SELECT 1 FROM readiness_items i WHERE i.id=s.item_id AND i.item_key='traction')
    THEN 'stated' ELSE s.evidence END,
  s.missing,s.source,s.scored_by,s.scored_at FROM readiness_scores s;
DROP TABLE readiness_scores;
ALTER TABLE readiness_scores_v536 RENAME TO readiness_scores;
CREATE INDEX idx_readiness_scores_project ON readiness_scores(project_id, scored_at);
CREATE INDEX idx_readiness_scores_item ON readiness_scores(item_id, scored_at);

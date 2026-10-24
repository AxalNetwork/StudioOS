-- D890 / #2448: a check with no comparable evidence has no numeric score.
-- Preserve history, table constraints, indexes and the AUTOINCREMENT high-water mark.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE readiness_scores_d890 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES readiness_items(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  score INTEGER CHECK (score BETWEEN 0 AND 10),
  evidence TEXT NOT NULL CHECK (evidence IN ('anecdote', 'pattern', 'stated', 'measured')),
  missing TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'computed')),
  scored_by INTEGER REFERENCES users(id),
  scored_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO readiness_scores_d890 (id,item_id,project_id,score,evidence,missing,source,scored_by,scored_at)
SELECT id,item_id,project_id,score,evidence,missing,source,scored_by,scored_at FROM readiness_scores;
INSERT INTO sqlite_sequence(name,seq)
SELECT 'readiness_scores_d890', seq FROM sqlite_sequence WHERE name='readiness_scores'
AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name='readiness_scores_d890');
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='readiness_scores'),seq)) WHERE name='readiness_scores_d890';
DROP TABLE readiness_scores;
ALTER TABLE readiness_scores_d890 RENAME TO readiness_scores;
CREATE INDEX idx_readiness_scores_project ON readiness_scores(project_id, scored_at);
CREATE INDEX idx_readiness_scores_item ON readiness_scores(item_id, scored_at);

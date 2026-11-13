-- Task #12 — User personal-values vector storage.
CREATE TABLE IF NOT EXISTS user_values (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  dimension_id INTEGER NOT NULL REFERENCES value_dimensions(id),
  score       REAL NOT NULL,    -- −2..+2, deterministic per-dimension score
  confidence  REAL NOT NULL,    -- 0..1, how many questions backed this dimension
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, dimension_id)
);

CREATE INDEX IF NOT EXISTS idx_user_values_user
  ON user_values (user_id, updated_at);

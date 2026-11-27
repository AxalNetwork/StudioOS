-- D5306 (#5306): a retried Add filing create returns the first filing rather
-- than inserting a second row. The key is scoped to one member and venture;
-- the same literal key in another scope is a different create.
ALTER TABLE formation_steps ADD COLUMN idempotency_key TEXT
  CHECK (idempotency_key IS NULL OR (length(idempotency_key) BETWEEN 8 AND 128 AND idempotency_key NOT GLOB '*[^A-Za-z0-9_-]*'));

CREATE UNIQUE INDEX idx_formation_steps_idempotency
  ON formation_steps(project_id, created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

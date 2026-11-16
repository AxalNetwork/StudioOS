-- D5580 part 4 (#5580): the WorkGraph snapshot store.
--
-- The hourly pr-overlap job (.github/workflows/pr-overlap.yml) posts its
-- advisory snapshot (schema studioos-pr-overlap-snapshot/v2, built by
-- scripts/lib/prRisk.mjs snapshot()) to POST /api/admin/workgraph/snapshots.
-- The HQ WorkGraph page reads the latest one through
-- GET /api/admin/workgraph/in-flight (Super Admin).
--
-- One row per scan. The body is the snapshot as posted; the columns beside it
-- are what the read needs without parsing it. sha256 is the body's digest, so a
-- re-posted scan is stored once. The route keeps the latest rows and deletes
-- older ones on each ingest; nothing else writes this table.

CREATE TABLE IF NOT EXISTS workgraph_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  schema        TEXT NOT NULL,
  generated_at  TEXT NOT NULL,
  partial       INTEGER NOT NULL DEFAULT 0 CHECK (partial IN (0, 1)),
  sha256        TEXT NOT NULL UNIQUE,
  bytes         INTEGER NOT NULL,
  body_json     TEXT NOT NULL,
  received_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workgraph_snapshots_generated ON workgraph_snapshots(generated_at DESC, id DESC);

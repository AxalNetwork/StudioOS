-- #5314 part 1 (D4822): the client's first open of a shared deliverable.
--
-- `engagement_deliverables.opened_at` has existed since migration 208 and was
-- always the client's to set; nothing wrote it, so every sent deliverable read
-- "Read status unavailable". The client route `POST /api/client/deliverables/:uid/open`
-- now writes it, once, when the engagement's client founder opens the shared
-- link. These columns say who opened it and which version they were shown:
--   opened_by        the client's user id
--   opened_revision  the row's `revision` (D4682) at the open, so an edit made
--                    after it is not passed off as the version the client read
--   opened_version   the `version` label shown to the client at the open
--
-- `delivery_read_instrumentation` holds one row: when opens began to be
-- recorded. A deliverable sent before it was never openable through the
-- platform, so its silence stays "Not recorded" rather than "Never opened".
ALTER TABLE engagement_deliverables ADD COLUMN opened_by INTEGER;
ALTER TABLE engagement_deliverables ADD COLUMN opened_revision INTEGER;
ALTER TABLE engagement_deliverables ADD COLUMN opened_version TEXT;

CREATE TABLE IF NOT EXISTS delivery_read_instrumentation (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL
);
INSERT OR IGNORE INTO delivery_read_instrumentation (id, started_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- The first open is a fact about the past: once recorded, nothing rewrites it.
CREATE TRIGGER IF NOT EXISTS trg_deliverable_first_open_kept
BEFORE UPDATE OF opened_at, opened_by, opened_revision, opened_version
ON engagement_deliverables
WHEN OLD.opened_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'deliverable_open_recorded');
END;

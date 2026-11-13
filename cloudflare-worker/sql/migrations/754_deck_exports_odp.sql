-- 754 / D1603 / #3882: the deck export ledger takes the slides-suite file (.odp).
-- Assigned by S1 on #3882, 2026-10-31. Forward migration only.
--
-- Same rebuild as 266, 331 and 553: SQLite cannot widen a CHECK in place, so
-- `deck_exports` (537) is rebuilt with `format` taking 'odp' beside 'pdf',
-- 'pptx', 'html' and 'google_slides'. Every column, default and the other
-- CHECKs are 537's, verbatim; every row is copied with its id; the one index
-- is recreated. 537 has no trigger to re-run.
--
--   format        pdf, pptx, html, google_slides or odp.
--   content_hash  SHA-256 of the exact bytes handed out, lowercase hex; NULL
--                 only for google_slides, which records its file in external_ref.
--
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

CREATE TABLE IF NOT EXISTS deck_exports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL,
  version INTEGER,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'pptx', 'html', 'google_slides', 'odp')),
  content_hash TEXT CHECK (content_hash IS NULL OR (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*')),
  external_ref TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (content_hash IS NOT NULL OR format = 'google_slides')
);

INSERT INTO deck_exports_new (id, deck_id, version, format, content_hash, external_ref, created_by, created_at)
  SELECT id, deck_id, version, format, content_hash, external_ref, created_by, created_at FROM deck_exports;

DROP TABLE deck_exports;

ALTER TABLE deck_exports_new RENAME TO deck_exports;

CREATE INDEX IF NOT EXISTS idx_deck_exports_deck ON deck_exports(deck_id, created_at);

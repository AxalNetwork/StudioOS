-- 537 / D901 / #2680: the deck export ledger.
-- Assigned by S1 on #2680, 2026-10-24. Forward migration only.

-- One row per file handed out by an export of a pitch deck version
-- (`pitch_decks` keeps one row per version, so `deck_id` names the version
-- and `version` is its number, copied so the row reads alone).
--   format        pdf, pptx, html or google_slides (part 10 writes the last).
--   content_hash  SHA-256 of the exact bytes handed out, lowercase hex.
--                 NULL only for a format that hands out no bytes
--                 (google_slides, which records its file in external_ref).
--   external_ref  the created file's id elsewhere (Google Drive); NULL else.
--   created_by    the user who exported. Never a figure, never the content.
CREATE TABLE IF NOT EXISTS deck_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL,
  version INTEGER,
  format TEXT NOT NULL CHECK (format IN ('pdf', 'pptx', 'html', 'google_slides')),
  content_hash TEXT CHECK (content_hash IS NULL OR (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*')),
  external_ref TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (content_hash IS NOT NULL OR format = 'google_slides')
);

CREATE INDEX IF NOT EXISTS idx_deck_exports_deck ON deck_exports(deck_id, created_at);

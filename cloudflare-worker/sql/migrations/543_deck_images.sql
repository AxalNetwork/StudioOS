-- 543 — images for the pitch deck's cards and backgrounds (D903, #2682,
-- part 9 of #2434). The number is the issue's; S1 confirmed it free on main on
-- 2026-10-27. Applied like any pending file (the runner applies a pending file
-- whatever its number).
--
-- One row per image: an Eadwyn proposal (`source = 'generated'`, drawn through
-- run() on FLUX.1 Schnell, #2434 owner question 1, A) or the founder's upload.
-- The bytes live in R2 (`FILES`, `deck-images/<project>/<uid>.<ext>`) and are
-- served at an https app URL (`GET /api/decks/images/:uid/file`), never a
-- data: URL.
--
--   use       where the image goes: a content image, a card background or the
--             deck background (PD12, PD12b, PD12c)
--   overlay   a background's overlay in the brand ink: none, light or strong.
--             "Keep as background" is refused until the text reads at 4.5:1.
--   state     proposed → kept, or discarded. Only a kept image is served to a
--             deck's readers (a share, an export); a proposal only to the
--             venture's own writers.
--   ai_usage_log_id, charged_microusd  the run that drew it and what it was
--             charged (D903: every image keeps its usage row and its charge).
--   shows_person, person_consent_at/_by  #2434 owner question 7, A: Eadwyn
--             never draws a real person; a photo of a person is an upload, and
--             the founder records that person's agreement on its row. A row
--             showing a person without a recorded agreement cannot be written,
--             and a generated image never shows one.
--
-- Grep first (D689 D-t): no table named deck_images exists in
-- schema_baseline.sql or any migration.

CREATE TABLE IF NOT EXISTS deck_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deck_id INTEGER REFERENCES pitch_decks(id) ON DELETE SET NULL,
  card INTEGER CHECK (card IS NULL OR (card >= 0 AND card <= 59)),
  r2_key TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  width INTEGER,
  height INTEGER,
  source TEXT NOT NULL CHECK (source IN ('generated', 'upload')),
  prompt TEXT,
  style TEXT,
  aspect TEXT,
  use TEXT NOT NULL CHECK (use IN ('content', 'card', 'deck')),
  overlay TEXT CHECK (overlay IS NULL OR overlay IN ('none', 'light', 'strong')),
  alt TEXT,
  state TEXT NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'kept', 'discarded')),
  model TEXT,
  ai_usage_log_id INTEGER,
  charged_microusd INTEGER CHECK (charged_microusd IS NULL OR charged_microusd >= 0),
  shows_person INTEGER NOT NULL DEFAULT 0 CHECK (shows_person IN (0, 1)),
  person_consent_at TEXT,
  person_consent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kept_at TEXT,
  kept_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (shows_person = 0 OR person_consent_at IS NOT NULL),
  CHECK (source = 'upload' OR shows_person = 0)
);
CREATE INDEX IF NOT EXISTS idx_deck_images_project ON deck_images(project_id, state, created_at);

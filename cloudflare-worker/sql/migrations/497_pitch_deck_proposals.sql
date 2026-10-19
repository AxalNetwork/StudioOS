-- 497 — D767 (#2096): "Fill from project" proposes a deck version instead of
-- overwriting one.
--
-- A fill writes one row here and nothing in pitch_decks. The founder sees it
-- beside the current version and chooses: Keep writes it as a new current
-- version (the same insert every save makes), Discard deletes this row and
-- nothing else (D720 §9: nothing is written to a record until the member
-- accepts). A proposal is never a deck version, so no read of pitch_decks
-- (the version list, share links, round calls, Raise records) can see one.
--
-- Additive only: one new table and one index; nothing is altered or
-- backfilled. `ensureSchema` in routes/decks.ts creates the same table on a
-- fresh database. Idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS pitch_deck_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  -- The deck version the fill was asked from, kept to show what it sat beside.
  base_deck_id INTEGER NOT NULL,
  slides TEXT NOT NULL,
  title TEXT,
  method_id TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_proposals_project ON pitch_deck_proposals(project_id, id);

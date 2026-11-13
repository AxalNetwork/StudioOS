-- 734 — D1538 (#3787, deck v2 B11): the figures a founder types for a deck.
--
-- Number given by #3787 (Decision D1538, migration 734).
--
-- deck_typed_values: one figure per venture and key, typed rather than read
-- from a store, so every reader grades it Stated ("✎ Stated", "Typed by …").
-- Keyed by the venture, not by one deck version: a new version of the deck
-- reads the same typed figures. deck_id is the version it was typed on, for
-- the record only.
--
--   key        [a-z0-9_]{1,40}, unique per venture
--   label      what the figure is, as the founder named it
--   value_num  the figure, when it is a number
--   value_text the figure, when it is words; exactly one of the two is set
--   unit       count, usd, percent, months or text (services/decks/sources.ts)
--   typed_by   the member who typed it last; typed_at, when
--
-- A figure nobody typed has no row: readers show "Not recorded", never 0.
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

CREATE TABLE IF NOT EXISTS deck_typed_values (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  deck_id     INTEGER NOT NULL,
  key         TEXT NOT NULL,
  label       TEXT NOT NULL,
  value_num   REAL,
  value_text  TEXT,
  unit        TEXT NOT NULL CHECK (unit IN ('count', 'usd', 'percent', 'months', 'text')),
  typed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  typed_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((value_num IS NULL) <> (value_text IS NULL)),
  UNIQUE (project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_deck_typed_values_project ON deck_typed_values(project_id, key);

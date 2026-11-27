-- D4596 (#4596, Pitch audit 2/5) — the working copy's deck-level state.
--
-- `pitch_deck_cards` (715) holds each card of a version's working copy. It cannot say which cards
-- the working copy KEEPS, in what order, or which theme and audience it has, so a removal, a theme
-- change or an audience change never reached the Worker and came back on reopen. This row is that
-- state, one per deck version, revised with its own `rev` (PUT /api/decks/:id/draft-doc, If-Match).
-- Additive and re-runnable; it deletes with its deck version, like the cards.
CREATE TABLE IF NOT EXISTS pitch_deck_draft_doc (
  deck_id    INTEGER PRIMARY KEY REFERENCES pitch_decks(id) ON DELETE CASCADE,
  rev        INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),
  order_json TEXT    NOT NULL CHECK (json_valid(order_json) AND json_type(order_json) = 'array'),
  theme_json TEXT    CHECK (theme_json IS NULL OR json_valid(theme_json)),
  audience   TEXT,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

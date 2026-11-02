-- 715 — a deck version's working copy, one row per card (D1501, #3751).
-- Number given by #3751 (S1's revision, 2026-11-01).
--
-- Paid generations and inserts used to live only in the browser until Save.
-- Each card the founder changes is kept here as soon as it changes, keyed by
-- the version it was edited from and the card's own uid (D1500), with a
-- revision for `If-Match`. "Save as version" stays an explicit press: it writes
-- a new `pitch_decks` row as before, and nothing here is ever read by a share
-- route, an export or a reader. Deleting a version deletes its working copy.
CREATE TABLE IF NOT EXISTS pitch_deck_cards (
  deck_id    INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  card_uid   TEXT    NOT NULL CHECK (length(card_uid) BETWEEN 1 AND 40),
  ord        INTEGER NOT NULL DEFAULT 0 CHECK (ord BETWEEN 0 AND 59),
  json       TEXT    NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 1 CHECK (rev >= 1),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (deck_id, card_uid)
);

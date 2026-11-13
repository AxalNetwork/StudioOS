-- 730 — a deck version as a list of card hashes (D1539, #3789, deck v2 B13).
-- Number given by #3789.
--
-- Until now every saved version copied every card into `pitch_decks.slides`,
-- so a 60-card deck saved ten times held 600 cards. From this migration each
-- card's JSON is kept once, under the SHA-256 of its canonical JSON (keys
-- sorted at every depth), in `pitch_card_blobs`, and a version also records
-- the ordered list of its cards' hashes in `pitch_decks.card_hashes`. A save
-- that changes two cards adds two blob rows; the other 58 are already there.
--
--   pitch_card_blobs.hash        lowercase hex SHA-256 of the canonical card JSON
--   pitch_card_blobs.json        the card's JSON as it was first written
--   pitch_card_blobs.created_at  when the blob was first written; pruning never
--                                touches a blob younger than its grace window
--   pitch_decks.card_hashes      JSON array of hashes, in card order. NULL is a
--                                version written before this migration, or by a
--                                writer that does not go through insertVersion;
--                                it is read from `slides` as before.
--
-- Transition: `pitch_decks.slides` is still written in full on every save, and
-- every reader that is not `getDeckRow` still reads it. Nothing is backfilled.
-- A blob no version names is removed by the daily prune (D1539 §3).
CREATE TABLE IF NOT EXISTS pitch_card_blobs (
  hash       TEXT PRIMARY KEY CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*'),
  json       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE pitch_decks ADD COLUMN card_hashes TEXT CHECK (card_hashes IS NULL OR json_valid(card_hashes));

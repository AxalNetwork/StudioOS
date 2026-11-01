-- 714 — card uids on the four stores that key a card by its place (D1500, #3750).
-- Number given by #3750 (S1's revision, 2026-11-01): main jumps from 713 to
-- 748, and no open pull request uses 714.
--
-- A deck card now carries its own uid (`services/decks/slideModel.ts`,
-- `assignCardUids`), kept across saves and reorders. Each store that recorded
-- a card by its position on a version also records that card's uid, so a
-- result made for a card lands on that card even after the founder reorders,
-- hides or adds cards mid-run. The old position columns stay, for rows written
-- before this migration and for a rolled-back Worker.
--
--   deck_images.card_uid            the card an image was made or uploaded for
--   deck_notes.card_uid             the card an admin note is about
--   deck_view_slides.card_uid       the card a reader's seconds were counted on
--   deck_share_feedback.slide_reactions_by_uid
--                                   the reader's reactions keyed by card uid (a
--                                   JSON map, as slide_reactions is keyed by
--                                   place), so a reaction follows its card
--
-- Nullable and not backfilled: a row written before 714 reads by its position,
-- as it always has. Grep first (D689 D-t): no card_uid column exists on any
-- table in schema_baseline.sql or a migration.
--
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

ALTER TABLE deck_images ADD COLUMN card_uid TEXT CHECK (card_uid IS NULL OR length(card_uid) BETWEEN 1 AND 40);
ALTER TABLE deck_notes ADD COLUMN card_uid TEXT CHECK (card_uid IS NULL OR length(card_uid) BETWEEN 1 AND 40);
ALTER TABLE deck_view_slides ADD COLUMN card_uid TEXT CHECK (card_uid IS NULL OR length(card_uid) BETWEEN 1 AND 40);
ALTER TABLE deck_share_feedback ADD COLUMN slide_reactions_by_uid TEXT;

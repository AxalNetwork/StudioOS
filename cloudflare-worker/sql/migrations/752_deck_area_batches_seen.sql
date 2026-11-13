-- 752 — a deck generation run that was retried, seen and announced (D1600, #3879, deck v2).
-- Number given by #3879 (S1's ruling, 2026-11-02: "still free on main"); #3753's 716 has merged, so nothing is folded.
--
-- deck_area_batches.seen_at: when a writer of the deck opened the run's
-- proposals from the return banner ("Your build finished while you were
-- away"), `POST /api/decks/areas/batches/:uid/seen`. NULL until then; the
-- banner lists only finished runs whose `seen_at` is NULL.
-- deck_area_batches.notified_at: when the run's one in-app notice was written
-- (a run that ended with no live stream attached). Set before the notice is
-- sent, so a run notifies at most once.
-- deck_area_batches.parent_batch_uid: the run whose failed areas this run
-- retries (`POST …/retry-failed`). Always the first run of the family, so a
-- retry of a retry still draws on the first run's quote. NULL for a first run.
--
-- Additive; no row is changed. Not idempotent (SQLite has no ADD COLUMN IF NOT
-- EXISTS): the ledger applies it once.

ALTER TABLE deck_area_batches ADD COLUMN seen_at TEXT;
ALTER TABLE deck_area_batches ADD COLUMN notified_at TEXT;
ALTER TABLE deck_area_batches ADD COLUMN parent_batch_uid TEXT;
CREATE INDEX IF NOT EXISTS idx_deck_area_batches_unseen ON deck_area_batches (deck_id, state, seen_at);

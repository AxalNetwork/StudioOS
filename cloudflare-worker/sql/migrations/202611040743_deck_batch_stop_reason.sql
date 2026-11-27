-- D4374 (#4374): why a deck generation run stopped, when the owner did not stop it.
-- `timed_out`: the stuck-run sweep (services/decks/batchSweep.ts) found the run
-- still active with no step started or ended for STUCK_AFTER_MS, marked it
-- `cancelled` (the run's "Stopped" state, migration 716) and settled its hold.
-- NULL for every other run, including one its owner stopped.
ALTER TABLE deck_area_batches ADD COLUMN stop_reason TEXT;

-- D5071 (#5071) — a computed readiness score keeps a fingerprint of the exact inputs it read.
--
--   readiness_scores.input_hash  SHA-256 (hex) of the canonical JSON of the rows and fields the
--       item's check read when it scored. A score is Current while a fresh run of the check
--       gives the same hash, and Stale when it gives another. A row written before this
--       column (or by a person) has none, and reads "Not recorded", never "Current".
--
-- Existing rows read NULL.

ALTER TABLE readiness_scores ADD COLUMN input_hash TEXT;

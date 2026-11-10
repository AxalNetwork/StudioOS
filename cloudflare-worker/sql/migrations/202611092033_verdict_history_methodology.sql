-- 202611092033 — D4586 part 3 (#4586): the methodology each verdict-history row was observed under, and
-- whether the row was written only because the method changed. Named by its UTC minute (D4106).
--
-- WHY. Claim status moves from v1 to methodology v2 (D4586 § 3): contradiction is read before the bar,
-- `contested` is new, and an unrecorded fit makes the status unknown only when it could change it. A
-- claim whose evidence did not change can still read differently on its first v2 read. That row must not
-- look like new evidence in `Recently moved` (D4586 § 6).
--
--   methodology_version  NULL on every row written before this migration: those were observed under v1
--                        and keep reading as v1. Never backfilled, never recomputed.
--   method_change        1 when the row was written because the method changed and the evidence did not
--                        (the v1 rule, recomputed on the same evidence, still gives the last v1 row).
--
-- Mirrored by `ensureVerdictHistorySchema` (`services/verdictHistory.ts`), whose ADD COLUMN statements
-- skip a column that already exists.
ALTER TABLE hypothesis_verdict_history ADD COLUMN methodology_version INTEGER;
ALTER TABLE hypothesis_verdict_history ADD COLUMN method_change INTEGER NOT NULL DEFAULT 0;

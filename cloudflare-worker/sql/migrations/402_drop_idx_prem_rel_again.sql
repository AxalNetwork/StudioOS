-- #1224 — drop idx_prem_rel again.
--
-- Migration 343 (D513) drops this index, and was applied on 2026-10-06 at
-- 09:14. The Worker that served until that afternoon was the 4 October build,
-- whose partnernet.ts still ran `CREATE INDEX IF NOT EXISTS idx_prem_rel` on
-- each request, so the index came back. The current Worker no longer creates
-- it, and check-baseline-drift reports it as on production but not in the
-- repository's schema. Dropping it again carries out D513 as written; no
-- query depends on it (idx_prem_due serves the reminder reads).
DROP INDEX IF EXISTS idx_prem_rel;

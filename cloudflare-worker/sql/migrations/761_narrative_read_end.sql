-- 761 — an admin ends their narrative read early (#4020, D1465 G1; part of #3713).
-- Number assigned on #4020 by S21: main is at 759 and #4019 holds 760.
--
-- narrative_read_reasons.ended_at: when the admin ended this read before its
-- 8 hours ran out (`DELETE /api/cycles/raise/narrative/reads/mine`). NULL for a
-- read that ran its course or is still live. `activeReason` admits a read only
-- while it is unexpired AND not ended. The founder's list keeps the row and
-- shows "Ended early" from it. Additive; no row is changed.
--
-- Not idempotent (SQLite has no ADD COLUMN IF NOT EXISTS): the ledger applies
-- it once, and the baseline runner records it without executing it.

ALTER TABLE narrative_read_reasons ADD COLUMN ended_at TEXT;

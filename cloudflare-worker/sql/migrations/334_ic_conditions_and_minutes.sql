-- 334_ic_conditions_and_minutes.sql — IC conditions and meeting minutes
-- (D461, wave 8, Session 17, item 2).
--
-- Canvas ID3 (Pages · Investor Deals, /deals/commit) draws two records the IC
-- store did not hold:
--
--   CONDITIONS. "Approved with conditions" is how a fund actually votes, and
--   the Closing artboard's blocking item "arrived from the Commit vote" —
--   but ic_decisions carried a free-text memo and a terms blob, and neither
--   is an object a later stage can block on. `ic_conditions` is one row per
--   condition: the decision it attaches to, the text, and an open | met |
--   waived state with who set it and when. An OPEN condition is what item
--   3's recorded transfer refuses on.
--
--   MINUTES. ic_meetings carried an agenda — written BEFORE the room — and
--   nothing recorded what the room concluded beyond the votes themselves.
--   Three additive columns hold the minutes, who recorded them and when. One
--   minutes body per meeting (a PATCH replaces it), not a versioned series:
--   the votes are the ledger; the minutes are the narrative.
--
-- STANDS ALONE: depends on no other wave-8 migration. The CREATE is
-- idempotent; the ALTERs are not (D1's ALTER TABLE has no IF NOT EXISTS) and
-- run exactly once through the ledger-driven runner:
--
--   npm run d1:migrate:remote
--
-- ic.ts carries no runtime bootstrap for these (it has none for ic_decisions
-- either): the deploy workflow applies migrations before the worker ships.

CREATE TABLE IF NOT EXISTS ic_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  ic_decision_id INTEGER NOT NULL REFERENCES ic_decisions(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'met', 'waived')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ic_conditions_decision ON ic_conditions(ic_decision_id, status);

ALTER TABLE ic_meetings ADD COLUMN minutes TEXT;
ALTER TABLE ic_meetings ADD COLUMN minutes_recorded_by INTEGER REFERENCES users(id);
ALTER TABLE ic_meetings ADD COLUMN minutes_recorded_at TEXT;

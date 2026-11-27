-- 489 — the findings store an interview's accepted suggestions land in when no
-- Validate module table holds them (D757 §2.6 and §2.16-B, #1923).
--
-- WHAT IT HOLDS. One row per finding the founder accepted from an interview:
-- a firmographic (company size, industry, geography, stage, tools), a job to
-- be done, a market fact, an alternative, and the five demand kinds (budget,
-- timing, urgency, buying trigger, objection). Every other kind lands in its
-- module's own table through its own writer, as before.
--
-- `kind` IS VALIDATED IN CODE (`services/interviewFindings.ts`), as
-- `demand_signals.kind` is, so a new kind needs no table rebuild. `module`
-- keeps a CHECK over the five Validate modules that take one.
--
-- ONE ROW PER (interview, kind, key). `key_norm` is the kind's own dedupe key,
-- so a retried accept upserts the same row instead of writing a second one.
--
-- THE QUOTE IS THE INTERVIEWEE'S WORDS, so it goes with its session: deleting
-- the session or withdrawing consent clears `quote`, `cite_from` and
-- `cite_to` (§2.13), and deleting the interview deletes its rows explicitly,
-- because D1 may run with foreign keys off.
--
-- No transaction statements: D1 rejects them in a migration file.

CREATE TABLE IF NOT EXISTS interview_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  interview_id INTEGER NOT NULL REFERENCES discovery_interviews(id) ON DELETE CASCADE,
  session_id INTEGER,
  proposal_id INTEGER,
  module TEXT NOT NULL CHECK (module IN ('customer-research', 'ideal-customer-profile', 'market-intelligence', 'demand-signals', 'experiments')),
  kind TEXT NOT NULL,
  key_norm TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  quote TEXT,
  cite_from INTEGER,
  cite_to INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (interview_id, kind, key_norm)
);

CREATE INDEX IF NOT EXISTS idx_interview_findings_module ON interview_findings (project_id, module, created_at DESC);

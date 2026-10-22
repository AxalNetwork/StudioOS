-- 526 — multi-connector flows: one run, its steps, and each attempt's hold (D853, #2476).
--
-- Additive. A flow is a recipe in code (`services/flows.ts`): trigger, read,
-- map, proposal, the founder's accept, publish, and the result back. A run is
-- one execution of a recipe for one member and, where it has one, one of their
-- companies. Each step attempt is one row, holds its AI tokens under its own
-- key (`flow:<run>:<step>:<attempt>`, through `meteredCall`, D844), and runs
-- on JOB_QUEUE.
--
-- Grep first (D-t): no table, column or index named connector_flow* exists
-- in schema_baseline.sql or any earlier migration. Migration 525 (D844) adds
-- `ai_budget_reservations.idempotency_key`, which these keys are written to.
-- No BEGIN/COMMIT.
--
-- Unknown is NULL, never 0: `company_id` (a flow with no company),
-- `charged_microusd` (not yet settled, or in review), `error_class`,
-- `output_json`. Amounts are integer micro-USD. No row holds a secret, a
-- token, an error message or a provider's raw reply: an error is a class from
-- a fixed list.
--
--   connector_flow_runs
--     status         queued (made, or accepted, and waiting for its next step)
--                    running, waiting_accept (a proposal waits for the
--                    founder), done, failed, cancelled.
--     execution_id   The one execution every step's hold is filed under.
--     current_step   The step the run is at, for the reads.
--
--   connector_flow_steps
--     status         pending (queued), running (leased until lease_until),
--                    ran (its work finished and is recorded; settlement
--                    pending), done (finished: see outcome).
--     outcome        ok, failed, cancelled; NULL until done.
--     idempotency_key  flow:<run uid>:<step key>:<attempt>; unique.
--     reservation_uid  The attempt's hold, or NULL when the step is free.
CREATE TABLE IF NOT EXISTS connector_flow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  company_id INTEGER,
  recipe_key TEXT NOT NULL,
  recipe_version INTEGER NOT NULL CHECK (recipe_version >= 1),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting_accept', 'done', 'failed', 'cancelled')),
  execution_id TEXT NOT NULL UNIQUE,
  current_step TEXT,
  input_json TEXT,
  result_json TEXT,
  error_class TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_connector_flow_runs_user ON connector_flow_runs(user_id, created_at);

CREATE TABLE IF NOT EXISTS connector_flow_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_uid TEXT NOT NULL REFERENCES connector_flow_runs(uid),
  step_key TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'ran', 'done')),
  outcome TEXT CHECK (outcome IN ('ok', 'failed', 'cancelled')),
  error_class TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  reservation_uid TEXT,
  quote_microusd INTEGER CHECK (quote_microusd >= 0),
  cost_microusd INTEGER CHECK (cost_microusd >= 0),
  charged_microusd INTEGER CHECK (charged_microusd >= 0),
  output_json TEXT,
  lease_until TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (run_uid, step_key, attempt)
);
CREATE INDEX IF NOT EXISTS idx_connector_flow_steps_status ON connector_flow_steps(status, lease_until);

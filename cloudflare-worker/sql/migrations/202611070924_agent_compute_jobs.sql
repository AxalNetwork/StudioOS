-- D4557 (#4557, Part of): one bounded compute job of an agent run, for the
-- general container runner the owner approved in shape (Q2–Q4 A, Q1 B,
-- 2026-11-07). Its host (a separate Worker owning the container) waits on
-- D4554; this table and `services/agents/compute.ts` are the host-independent
-- part, and nothing writes here while AGENT_COMPUTE is off (the default).
--
-- WHAT IT HOLDS: who and what, the limits it ran under, its single-use run
-- grant (the jti and expiry only, never the token), and its bounded outcome.
-- Never a file, an input, stdout or a prompt: inputs and outputs live in R2
-- under `agent-compute/<scope_kind>/<scope_id>/<run_uid>/`, and only their
-- keys are kept here.
--
-- One job per idempotency key, so a redelivered dispatch is the same job; one
-- grant per job, claimed at most once (`grant_claimed_at`), so a replayed grant
-- is refused. A job ends once: the terminal statuses are written by a guarded
-- UPDATE, so a callback after a cancel, or a second callback, changes nothing.
-- No transaction statements (D1 rejects them).

CREATE TABLE IF NOT EXISTS agent_compute_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE CHECK (length(uid) = 32),
  run_uid TEXT NOT NULL REFERENCES agent_task_runs(uid) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES team_agents(id) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('project', 'company')),
  scope_id INTEGER NOT NULL,
  workload TEXT NOT NULL CHECK (workload IN ('python', 'document_convert', 'spreadsheet')),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
  -- [{ name, bytes }] as the caller declared them; names only, never content.
  inputs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(inputs_json) AND json_type(inputs_json) = 'array'),
  input_bytes INTEGER NOT NULL DEFAULT 0 CHECK (input_bytes >= 0),
  grant_jti TEXT UNIQUE,
  grant_expires_at TEXT,
  grant_claimed_at TEXT,
  -- The bounded outcome: resource use and an exit, never output text.
  output_bytes INTEGER CHECK (output_bytes IS NULL OR output_bytes >= 0),
  artifact_keys_json TEXT CHECK (artifact_keys_json IS NULL OR (json_valid(artifact_keys_json) AND json_type(artifact_keys_json) = 'array')),
  cpu_ms INTEGER CHECK (cpu_ms IS NULL OR cpu_ms >= 0),
  wall_ms INTEGER CHECK (wall_ms IS NULL OR wall_ms >= 0),
  peak_rss_bytes INTEGER CHECK (peak_rss_bytes IS NULL OR peak_rss_bytes >= 0),
  exit_code INTEGER,
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TEXT,
  ended_at TEXT,
  cancelled_at TEXT
);

-- Per-scope concurrency: the live jobs of one scope.
CREATE INDEX IF NOT EXISTS idx_agent_compute_jobs_scope_live
  ON agent_compute_jobs (scope_kind, scope_id) WHERE status IN ('queued', 'dispatched', 'running');
CREATE INDEX IF NOT EXISTS idx_agent_compute_jobs_run ON agent_compute_jobs (run_uid);

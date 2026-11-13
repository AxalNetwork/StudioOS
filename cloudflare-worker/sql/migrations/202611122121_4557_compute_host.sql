-- D4557 part 2: small request/execution/object metadata; bytes remain in private R2.
CREATE TABLE IF NOT EXISTS agent_compute_requests (
  uid TEXT PRIMARY KEY,
  task_id INTEGER NOT NULL UNIQUE REFERENCES scope_tasks(id) ON DELETE CASCADE,
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workload TEXT NOT NULL CHECK(workload IN ('python','document_convert','spreadsheet')),
  operation TEXT NOT NULL CHECK(operation IN ('sum','count','extract')),
  inputs_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS agent_compute_executions (
  job_uid TEXT PRIMARY KEY REFERENCES agent_compute_jobs(uid) ON DELETE CASCADE,
  request_uid TEXT NOT NULL REFERENCES agent_compute_requests(uid) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1 CHECK(generation > 0),
  spec_json TEXT NOT NULL,
  sponsor_json TEXT NOT NULL,
  cleanup_required INTEGER NOT NULL DEFAULT 1 CHECK(cleanup_required IN (0,1))
);
CREATE TABLE IF NOT EXISTS agent_compute_run_requests (
  run_uid TEXT PRIMARY KEY REFERENCES agent_task_runs(uid) ON DELETE CASCADE,
  request_uid TEXT REFERENCES agent_compute_requests(uid) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS agent_compute_objects (
  uid TEXT PRIMARY KEY,
  request_uid TEXT NOT NULL REFERENCES agent_compute_requests(uid) ON DELETE CASCADE,
  job_uid TEXT REFERENCES agent_compute_jobs(uid) ON DELETE CASCADE,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('input','output')),
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_compute_input_name ON agent_compute_objects(request_uid, name) WHERE kind = 'input';
CREATE UNIQUE INDEX IF NOT EXISTS agent_compute_output_name ON agent_compute_objects(job_uid, name) WHERE kind = 'output';
CREATE INDEX IF NOT EXISTS agent_compute_objects_owner ON agent_compute_objects(owner_user_id);
CREATE INDEX IF NOT EXISTS agent_compute_objects_expiry ON agent_compute_objects(expires_at);

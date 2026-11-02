-- D4160 (#4160, H2 of #4137): the lifecycle of Axal's own skills ("From Axal").
--
-- draft → in_review → published → retired. `agent_skills.status` keeps its
-- three values (draft, published, retired); "in review" is a draft with an
-- open review request on its current text, read from `agent_skill_reviews`,
-- so no table is rebuilt.
--
-- A draft's text is named by `draft_hash`: SHA-256 of its parts (name,
-- purpose, steps, tools, output, tags, roles), computed by
-- `services/agents/skillLifecycle.ts`. An approval and an eval result count
-- only for the hash they were given on; editing the draft makes a new hash,
-- so publish needs a fresh approval and fresh results.
--
--   agent_skill_reviews      a review asked of a named Super Admin, and its answer
--   agent_skill_cases        golden cases per skill: inputs and the expected output shape
--   agent_skill_eval_results one run of one case on one model, for one draft
--   agent_skill_retirements  a retired skill's replacement and the reason
--
-- Additive only: four new tables, their indexes and two triggers.

CREATE TABLE IF NOT EXISTS agent_skill_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  draft_hash TEXT NOT NULL CHECK (length(draft_hash) = 64),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'changes_requested', 'withdrawn')),
  comment TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TEXT,
  CHECK (reviewer_id <> requested_by),
  CHECK ((status = 'requested') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_reviews_skill ON agent_skill_reviews (skill_id, draft_hash, status);
-- One open request per skill at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_skill_reviews_open ON agent_skill_reviews (skill_id) WHERE status = 'requested';

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_reviews_kept
BEFORE DELETE ON agent_skill_reviews
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_reviews rows are kept');
END;

CREATE TABLE IF NOT EXISTS agent_skill_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  -- { "records": { "<read key>": <made-up record> } }: references to what the
  -- skill reads, never a member's email (checked on write).
  input_json TEXT NOT NULL,
  -- { "output": "draft|record_change|brief", "must_include": [...], "must_say_not_recorded": [...], "must_not_include": [...] }
  expect_json TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_cases_skill ON agent_skill_cases (skill_id, removed_at);

CREATE TABLE IF NOT EXISTS agent_skill_eval_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES agent_skill_cases(id),
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  draft_hash TEXT NOT NULL CHECK (length(draft_hash) = 64),
  model_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'not_run')),
  -- Why it failed or did not run, in words; null on a pass.
  detail TEXT,
  usage_log_id INTEGER,
  run_by INTEGER NOT NULL REFERENCES users(id),
  run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_eval_results_latest ON agent_skill_eval_results (skill_id, draft_hash, case_id, model_id, id);

CREATE TABLE IF NOT EXISTS agent_skill_retirements (
  skill_id INTEGER PRIMARY KEY REFERENCES agent_skills(id),
  replacement_skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 500),
  pinned_agents INTEGER NOT NULL CHECK (pinned_agents >= 0),
  retired_by INTEGER NOT NULL REFERENCES users(id),
  retired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (replacement_skill_id <> skill_id)
);

CREATE TRIGGER IF NOT EXISTS trg_agent_skill_retirements_kept
BEFORE DELETE ON agent_skill_retirements
BEGIN
  SELECT RAISE(ABORT, 'agent_skill_retirements rows are kept');
END;

-- D1612 part D (#3954, of #3945) — skills on the agent run path, and their
-- golden cases on the evaluation board.
--
--   ai_usage_logs.skill_id / skill_version   the skill and the pinned version a
--                                            run used, so consumption reads per
--                                            skill. NULL on every run that used none.
--   agent_skill_version_evals                one run of one golden case on one
--                                            model, for one PUBLISHED version of an
--                                            Axal (HQ) skill. A case that passed
--                                            before and fails now is a regression.
--
-- Additive only: two nullable columns, one table and its indexes.

ALTER TABLE ai_usage_logs ADD COLUMN skill_id INTEGER;
ALTER TABLE ai_usage_logs ADD COLUMN skill_version INTEGER;
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_skill ON ai_usage_logs (skill_id, created_at) WHERE skill_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_skill_version_evals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  -- 'starter' for the case shipped with the skill (services/agents/skills/cases/<slug>.json),
  -- else the uid of an agent_skill_cases row.
  case_key TEXT NOT NULL CHECK (length(case_key) BETWEEN 1 AND 64),
  case_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'not_run')),
  detail TEXT,
  usage_log_id INTEGER,
  run_by INTEGER NOT NULL REFERENCES users(id),
  run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_version_evals_case ON agent_skill_version_evals (skill_id, case_key, model_id, id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_version_evals_version ON agent_skill_version_evals (skill_id, version, id);

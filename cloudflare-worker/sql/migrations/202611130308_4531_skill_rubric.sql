-- 202611130308 — D4531 part 5 (#4531, section C): the model-judged rubric, on synthetic golden cases only.
-- Named by its UTC minute and its issue (D4106, D5398).
--
--   agent_skill_rubric_labels   HQ's own score for one calibration item (a synthetic output committed in
--                               a scenario pack), per rubric version; one label per item and version
--   agent_skill_rubric_results  one judge run: the score, the rubric version and the judge model
--
-- NO OUTPUT IS STORED. A calibration item is named by its key (`<case_id>:r<revision>#correct` or
-- `#incorrect.<i>`); its text is in the repository. A case result names the skill draft, the case
-- and the generating model; the generated output is judged and dropped. `detail` is a sentence the
-- Worker wrote (why a run has no score), never model text.
--
-- Rubric results are not read by the publish gate (`releaseDecision` reads agent_skill_eval_results).
-- The spend cap reads ai_usage_logs by surface, so nothing here holds money. Additive only.

CREATE TABLE IF NOT EXISTS agent_skill_rubric_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 160),
  rubric_version INTEGER NOT NULL CHECK (rubric_version >= 1),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  labelled_by INTEGER NOT NULL REFERENCES users(id),
  labelled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (item_key, rubric_version)
);

CREATE TABLE IF NOT EXISTS agent_skill_rubric_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('calibration', 'case')),
  -- calibration: the item judged
  item_key TEXT CHECK (item_key IS NULL OR length(item_key) BETWEEN 1 AND 160),
  -- case: the HQ skill draft, the live case (and its text's fingerprint) and the model that wrote the output
  skill_id INTEGER REFERENCES agent_skills(id),
  draft_hash TEXT CHECK (draft_hash IS NULL OR length(draft_hash) = 64),
  case_uid TEXT,
  case_sha256 TEXT CHECK (case_sha256 IS NULL OR length(case_sha256) = 64),
  model_id TEXT,
  rubric_version INTEGER NOT NULL CHECK (rubric_version >= 1),
  judge_model TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('scored', 'not_run')),
  score INTEGER CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  detail TEXT,
  usage_log_id INTEGER,
  judge_usage_log_id INTEGER,
  run_by INTEGER NOT NULL REFERENCES users(id),
  run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((result = 'scored') = (score IS NOT NULL)),
  CHECK ((kind = 'calibration') = (item_key IS NOT NULL)),
  CHECK (kind = 'calibration' OR (skill_id IS NOT NULL AND draft_hash IS NOT NULL AND case_uid IS NOT NULL AND model_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_rubric_results_item ON agent_skill_rubric_results (item_key, rubric_version, judge_model, id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_rubric_results_skill ON agent_skill_rubric_results (skill_id, draft_hash, id);

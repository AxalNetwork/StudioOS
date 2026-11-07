-- D4668 (#4668, of #4531): a global evaluation of Axal's published skills that
-- resumes past the first SKILLS_PER_RUN (20) instead of re-selecting them.
--
--   agent_skill_eval_campaigns        one global evaluation: the models it runs
--                                     on, its status (running | complete |
--                                     cancelled) and a short lease, so two
--                                     presses never run the same batch at once.
--   agent_skill_eval_campaign_skills  its MANIFEST, written when it starts: each
--                                     eligible published Axal skill at the
--                                     version it had then, in id order. A skill
--                                     is pending, done or skipped (with why).
--                                     Skills published later are not in it; the
--                                     next campaign takes them.
--   agent_skill_eval_campaign_items   one row per skill, version, case and model
--                                     the campaign ran, naming its result row in
--                                     agent_skill_version_evals. Its UNIQUE key is
--                                     what makes a resumed press skip work done:
--                                     a unit is never run, or charged, twice in
--                                     one campaign. A new attempt is a new campaign.
--
-- Additive only: three tables and their indexes. agent_skill_version_evals,
-- its meanings (pass | fail | not_run) and the regression rule are unchanged.

CREATE TABLE IF NOT EXISTS agent_skill_eval_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE CHECK (length(uid) = 32),
  models_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'complete', 'cancelled')),
  started_by INTEGER NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- ISO time until which one press holds the next batch; NULL when none does.
  lease_until TEXT,
  finished_at TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  CHECK (status = 'running' OR finished_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_eval_campaigns_status ON agent_skill_eval_campaigns (status, id);

CREATE TABLE IF NOT EXISTS agent_skill_eval_campaign_skills (
  campaign_id INTEGER NOT NULL REFERENCES agent_skill_eval_campaigns(id),
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'skipped')),
  -- Why a skill was skipped when its turn came: not_eligible (retired, unpublished or
  -- suspended), version_changed (republished since the campaign started), version_unreadable.
  skip_reason TEXT CHECK (skip_reason IS NULL OR skip_reason IN ('not_eligible', 'version_changed', 'version_unreadable')),
  finished_at TEXT,
  PRIMARY KEY (campaign_id, skill_id),
  CHECK ((state = 'skipped') = (skip_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_agent_skill_eval_campaign_skills_next ON agent_skill_eval_campaign_skills (campaign_id, state, skill_id);

CREATE TABLE IF NOT EXISTS agent_skill_eval_campaign_items (
  campaign_id INTEGER NOT NULL REFERENCES agent_skill_eval_campaigns(id),
  skill_id INTEGER NOT NULL REFERENCES agent_skills(id),
  version INTEGER NOT NULL,
  case_key TEXT NOT NULL,
  model_id TEXT NOT NULL,
  eval_id INTEGER NOT NULL REFERENCES agent_skill_version_evals(id),
  PRIMARY KEY (campaign_id, skill_id, version, case_key, model_id)
);

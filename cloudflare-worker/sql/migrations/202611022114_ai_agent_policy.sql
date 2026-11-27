-- D4162 (#4162, H4 of #4137): the platform's AI policy for agents, on the one
-- row H5's migration created (`ai_agent_policy`, id 1), and the models locked
-- off platform-wide.
--
--   default_team_cap_microusd   the monthly cap a new team agent starts with
--   max_team_cap_microusd       no team agent's cap may be set above it
--   per_run_ceiling_microusd    a run whose quote passes it is refused before it starts
--   area_models_json            per radar area: up to 3 suggested models, in order, and a default
--   read_tools_json             the read-only connector tools skills may request
--   paused / paused_at / paused_by / paused_reason
--                               the kill switch: while paused = 1 the agent runtime admits no run
--
-- NULL is "not set": no cap, no ceiling. The routes write the switch with its
-- time, author and reason together, and clear all three on resume.
ALTER TABLE ai_agent_policy ADD COLUMN default_team_cap_microusd INTEGER CHECK (default_team_cap_microusd IS NULL OR default_team_cap_microusd > 0);
ALTER TABLE ai_agent_policy ADD COLUMN max_team_cap_microusd INTEGER CHECK (max_team_cap_microusd IS NULL OR max_team_cap_microusd > 0);
ALTER TABLE ai_agent_policy ADD COLUMN per_run_ceiling_microusd INTEGER CHECK (per_run_ceiling_microusd IS NULL OR per_run_ceiling_microusd > 0);
ALTER TABLE ai_agent_policy ADD COLUMN area_models_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(area_models_json) AND json_type(area_models_json) = 'object');
ALTER TABLE ai_agent_policy ADD COLUMN read_tools_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(read_tools_json) AND json_type(read_tools_json) = 'array');
ALTER TABLE ai_agent_policy ADD COLUMN paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1));
ALTER TABLE ai_agent_policy ADD COLUMN paused_at TEXT;
ALTER TABLE ai_agent_policy ADD COLUMN paused_by INTEGER REFERENCES users(id);
ALTER TABLE ai_agent_policy ADD COLUMN paused_reason TEXT CHECK (paused_reason IS NULL OR length(trim(paused_reason)) BETWEEN 1 AND 500);

-- The row every read and write addresses; its absence would read as "never set".
INSERT OR IGNORE INTO ai_agent_policy (id) VALUES (1);

CREATE TABLE IF NOT EXISTS ai_model_locks (
  model TEXT PRIMARY KEY CHECK (length(model) BETWEEN 1 AND 120),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_by INTEGER NOT NULL REFERENCES users(id)
);

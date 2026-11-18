-- D7074 (#7074, part of #7072) — agent capacity from the task list and the
-- budget: sub-agent lanes and elastic scopes.
--
--   agent_task_runs.lane            the lane a run holds: 0 is the agent, 1 and
--                                   up are its sub-agents. A sub-agent is the
--                                   same agent row, so it has the same role,
--                                   rule book, sponsor, tools and monthly cap.
--   idx_agent_task_runs_live        one live run per agent AND lane (it was per
--                                   agent). Every existing row is lane 0, so
--                                   the rule for a team that sets nothing is
--                                   the one it had.
--   agent_scope_settings            capacity_mode ('fixed' keeps
--                                   max_parallel_runs, 'elastic' reads
--                                   elastic_max_runs), lanes_per_agent, and the
--                                   two limits that were constants in code: the
--                                   review backlog stop (5) and the daily runs
--                                   per agent (20). NULL means the constant.
--   ai_agent_policy                 the platform's two ceilings. NULL, which is
--                                   every row today, means elastic mode and
--                                   sub-agents are not offered.
--
-- The CHECK ranges are the loosest that keep a row meaningful; the service
-- holds the product rule (a team never above HQ's ceiling).
--
-- Order of deploy does not matter: a Worker from before this file inserts runs
-- with no lane, which is lane 0, and the index then holds its old rule.
-- Columns are added once; the index statements can be re-run.

ALTER TABLE agent_task_runs ADD COLUMN lane INTEGER NOT NULL DEFAULT 0 CHECK (lane BETWEEN 0 AND 49);

DROP INDEX IF EXISTS idx_agent_task_runs_live;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_task_runs_live
  ON agent_task_runs (agent_id, lane) WHERE status IN ('admitted', 'running');

ALTER TABLE agent_scope_settings ADD COLUMN capacity_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (capacity_mode IN ('fixed', 'elastic'));
ALTER TABLE agent_scope_settings ADD COLUMN elastic_max_runs INTEGER CHECK (elastic_max_runs IS NULL OR elastic_max_runs BETWEEN 1 AND 500);
ALTER TABLE agent_scope_settings ADD COLUMN lanes_per_agent INTEGER NOT NULL DEFAULT 1 CHECK (lanes_per_agent BETWEEN 1 AND 50);
ALTER TABLE agent_scope_settings ADD COLUMN review_backlog_max INTEGER CHECK (review_backlog_max IS NULL OR review_backlog_max BETWEEN 1 AND 200);
ALTER TABLE agent_scope_settings ADD COLUMN daily_runs_per_agent INTEGER CHECK (daily_runs_per_agent IS NULL OR daily_runs_per_agent BETWEEN 1 AND 1000);

ALTER TABLE ai_agent_policy ADD COLUMN elastic_runs_ceiling INTEGER CHECK (elastic_runs_ceiling IS NULL OR elastic_runs_ceiling BETWEEN 1 AND 500);
ALTER TABLE ai_agent_policy ADD COLUMN lanes_ceiling INTEGER CHECK (lanes_ceiling IS NULL OR lanes_ceiling BETWEEN 1 AND 50);

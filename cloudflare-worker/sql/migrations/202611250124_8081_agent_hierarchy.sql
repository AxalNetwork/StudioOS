-- D8081 (#8081): planner, worker and reviewer roles over agent_handoffs. Expand only: nullable columns.
--
-- agent_handoffs.hierarchy_role     what the target is asked to be: planner | worker | reviewer.
--                                   NULL on rows written before this file; the service reads NULL as worker.
-- agent_handoffs.reviews_run_uid    a reviewer step names the run it reviews (agent_task_runs.uid). Only a
--                                   reviewer step may carry one; the service refuses a reviewer whose agent
--                                   is that run's agent (`self_review`).
-- agent_scope_settings.planner_max_workers  how many worker steps one planner's task may hand off.
--                                   NULL is the service's default (3).
--
-- The rules themselves (depth, roles, the parent's share) are held by services/agentHierarchy.ts. A child's
-- share is its task's budget_tokens_cap (D8071); no second ledger is kept.

ALTER TABLE agent_handoffs ADD COLUMN hierarchy_role TEXT
  CHECK (hierarchy_role IS NULL OR hierarchy_role IN ('planner', 'worker', 'reviewer'));
ALTER TABLE agent_handoffs ADD COLUMN reviews_run_uid TEXT
  CHECK (reviews_run_uid IS NULL OR (hierarchy_role = 'reviewer' AND length(reviews_run_uid) BETWEEN 1 AND 80));
ALTER TABLE agent_scope_settings ADD COLUMN planner_max_workers INTEGER
  CHECK (planner_max_workers IS NULL OR planner_max_workers BETWEEN 1 AND 20);

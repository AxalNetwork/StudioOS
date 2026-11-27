-- D8533 (#8533): each scheduled task's outcome inside the trigger's row.
--
-- `cron_run_history` recorded the trigger: `completed`, `partial` (D4703: a task's own catch fired, named in
-- `error`) or `failed`. A `completed` row could hold a task that ran and did nothing, and the record could not
-- show it. `task_outcomes` is a JSON array, one entry per task the tick reported:
--   {"task": "<name>", "outcome": "done" | "skipped" | "failed", "error_class": "<class>", "note": "<detail>"}
-- `error_class` only on `failed`; `note` optional. NULL on rows written before this column, and on a tick that
-- reported no task (a lease-held tick, D201). Written by util/cronHistory.ts (writeCronRunHistory).
-- Nullable and without a default: the Worker one version back writes rows without it.
ALTER TABLE cron_run_history ADD COLUMN task_outcomes TEXT;

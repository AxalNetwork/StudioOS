-- D1614 W4 (#3972): workload on the Calendar.
--
-- scope_tasks.scheduled_start / scheduled_end
--   An optional time block a person schedules for a project task, UTC
--   ('YYYY-MM-DD HH:MM:SS'). Both or neither; the end after the start. The
--   calendar's "Work items" source shows a scheduled task in its block, and an
--   unscheduled one on its due day. The workload counts a task in the week of
--   its block, else of its due date.
--
-- work_capacity
--   A person's weekly capacity in points on one project, set in their Team
--   profile. No row is "Not recorded", never 0, and never over capacity.
--
-- Additive only: two nullable columns and one new table.

ALTER TABLE scope_tasks ADD COLUMN scheduled_start TEXT;
ALTER TABLE scope_tasks ADD COLUMN scheduled_end TEXT
  CHECK (scheduled_end IS NULL OR (scheduled_start IS NOT NULL AND scheduled_end > scheduled_start));

CREATE INDEX IF NOT EXISTS idx_scope_tasks_scheduled ON scope_tasks (project_id, scheduled_start) WHERE scheduled_start IS NOT NULL;

CREATE TABLE IF NOT EXISTS work_capacity (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekly_capacity_points REAL NOT NULL CHECK (weekly_capacity_points >= 0 AND weekly_capacity_points <= 1000),
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

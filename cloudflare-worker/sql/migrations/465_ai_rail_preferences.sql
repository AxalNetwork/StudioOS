-- 465 — the Eadwyn AI rail's preferences, on the Worker (D698, #1660).
--
-- ai_rail_preferences  one row per member, rail section and router task.
--   id          row id.
--   uid         an opaque id for the row (crypto.randomUUID()).
--   user_id     the member the preference belongs to. Only that member reads
--               or writes it (routes/ai.ts): no route takes a user id.
--   section     the rail's `workspace`, trimmed and lower-cased, as the
--               browser's keys already are (`ui/railModelChoice.js`,
--               `hooks/useAssistMode.js`), for example 'validate' or
--               'perks & products'.
--   task        a router task (`services/aiRouter.ts` ROUTE) for a model row,
--               or '' for the section's mode row.
--   model       the router model id the member picked for that task, or NULL.
--               Only set on a task row. The router still checks the task's
--               `alternates` at run time, because a stored pick goes stale
--               when they change.
--   mode        'eadwyn' or 'manual', the section's assist mode. Only set on
--               the '' row.
--   created_at, updated_at  when the row was first written and last changed.
--
-- A display preference, like `worker_rail_collapsed`: it is not a venture
-- write, so no activity_logs row is written for it. localStorage stays the
-- cache; one read per page load seeds it, and a server row wins.
--
-- Retention: a row is kept until the member changes it (a null clears it), and
-- it goes with the account (ON DELETE CASCADE from users). The routes cap a
-- member at 200 rows.
--
-- Additive: CREATE TABLE IF NOT EXISTS only. No BEGIN/COMMIT.
CREATE TABLE IF NOT EXISTS ai_rail_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT '',
  model TEXT,
  mode TEXT CHECK (mode IS NULL OR mode IN ('eadwyn', 'manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, section, task),
  CHECK ((task = '' AND model IS NULL) OR (task <> '' AND mode IS NULL))
);

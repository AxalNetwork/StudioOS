-- #3959: a member's own learning plan. Each row is one planned course, lesson,
-- video, webinar, exercise, exam or study block on the member's calendar,
-- optionally repeating (daily, or weekly on chosen weekdays until a date),
-- with a reminder. `goal_json` holds an optional target ("Finish Fundraising
-- 101 by Dec 15"). `learning_plan_reminders` records each reminder sent, one
-- per item and occurrence, so the sweep never sends one twice. Additive only;
-- the ledger runner applies it. (757 is reserved for #3951.)
CREATE TABLE IF NOT EXISTS learning_plan_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  item_kind         TEXT NOT NULL CHECK (item_kind IN ('course', 'lesson', 'video', 'webinar', 'exercise', 'exam', 'study_block')),
  item_uid          TEXT,
  title_override    TEXT,
  starts_at         TEXT NOT NULL,
  duration_min      INTEGER NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 480),
  repeat            TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekly')),
  repeat_weekdays   TEXT,
  repeat_until      TEXT,
  remind_min_before INTEGER CHECK (remind_min_before IS NULL OR remind_min_before BETWEEN 0 AND 10080),
  status            TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped', 'missed')),
  done_at           TEXT,
  goal_json         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((item_kind = 'study_block') = (item_uid IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_learning_plan_user ON learning_plan_items(user_id, starts_at);
CREATE TABLE IF NOT EXISTS learning_plan_reminders (
  item_id       INTEGER NOT NULL REFERENCES learning_plan_items(id),
  occurrence_at TEXT NOT NULL,
  sent_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, occurrence_at)
);

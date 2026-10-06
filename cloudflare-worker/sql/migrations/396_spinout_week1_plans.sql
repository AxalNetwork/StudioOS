-- 396 — D576 (#1189): a Spin-Out Lab member's Week 1 plan, ordered by their
-- tech-transfer answer.
--
-- spinout_week1_plans holds ONE plan per member: the catalog's Week 1
-- milestone keys in the order the member's rule gives them (steps_json), the
-- rule that produced it (rule_key, a key of RULES in
-- services/week1Plan.ts), whether Week 1 had started when it was computed,
-- and who wrote it (computed_by, 'user:<id>'). The catalog itself
-- (spinoutLabCatalog.ts) is never edited: a plan orders its keys and adds or
-- drops none.
--
-- spinout_week1_plan_history keeps every write, append-only, with its actor
-- and why it was written ('applied' when an application's answer was saved,
-- 'started' when Week 1 began with no plan yet), so a recompute never loses
-- the plan it replaced.
CREATE TABLE IF NOT EXISTS spinout_week1_plans (
  user_id        INTEGER PRIMARY KEY,
  application_id INTEGER,
  rule_key       TEXT NOT NULL,
  steps_json     TEXT NOT NULL,
  started        INTEGER NOT NULL DEFAULT 0,
  computed_by    TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS spinout_week1_plan_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  application_id INTEGER,
  rule_key       TEXT NOT NULL,
  steps_json     TEXT NOT NULL,
  started        INTEGER NOT NULL DEFAULT 0,
  reason         TEXT NOT NULL,
  actor          TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spinout_week1_plan_history_user ON spinout_week1_plan_history (user_id, id);

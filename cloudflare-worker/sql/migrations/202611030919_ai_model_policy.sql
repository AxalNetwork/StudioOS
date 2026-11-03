-- D4251 (#4251, deck v2 B10a): HQ's AI model policy, the kill switch without a deploy.
--
-- One row per model HQ has a policy for, keyed on the catalogue id
-- (`services/ai/catalogue.ts`, D760: no second model list; the route refuses
-- an id the catalogue does not hold). No row is no policy: the model runs as
-- the catalogue and the feature flags say.
--
--   enabled   0 switches the model off for everyone, at once: the run path
--             (`modelsOffFor`) and every reply that asks the catalogue
--             (`flagsFor`) read this table on each call, so no deploy and no
--             cache stand between the write and the next refusal.
--   plan_min  the lowest plan that may run it ('free', 'growth' or 'studio');
--             NULL is any plan.
--   note      HQ's own words on why, shown on the HQ page.
--
-- Additive: a table no reader has seen reads as no policy (every model as before).
CREATE TABLE IF NOT EXISTS ai_model_policy (
  model_id   TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  plan_min   TEXT CHECK (plan_min IS NULL OR plan_min IN ('free', 'growth', 'studio')),
  note       TEXT CHECK (note IS NULL OR length(note) <= 500),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

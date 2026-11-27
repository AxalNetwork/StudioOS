-- D1536 (#3785, deck v2 B9): where Cloudflare's live Workers AI model list
-- and our catalogue (services/ai/catalogue.ts, D760) disagree.
-- Named by its UTC minute (D4106); #3785 named this file 731.
--
-- The weekly job (services/ai/catalogueDrift.ts) writes one row per model and
-- field it finds out of step: `listed` (the catalogue has a model Cloudflare
-- no longer lists, or Cloudflare lists one the catalogue lacks) and `kind`
-- (the model's task). A row stays while the drift holds, its `seen_at` moved
-- to the latest run, and is removed by the first run that no longer sees it.
-- HQ is told once, when a row first appears or its values change.
-- No member data: model ids and the two values only.
CREATE TABLE IF NOT EXISTS ai_catalogue_drift (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id        TEXT    NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
  field           TEXT    NOT NULL CHECK (field IN ('listed', 'kind')),
  catalogue_value TEXT    CHECK (catalogue_value IS NULL OR length(catalogue_value) <= 200),
  live_value      TEXT    CHECK (live_value IS NULL OR length(live_value) <= 200),
  first_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  seen_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (model_id, field)
);

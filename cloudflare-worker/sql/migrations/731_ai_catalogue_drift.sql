-- D1536 (#3785, deck v2 B9): the weekly catalogue drift job's findings.
-- Each row is one field where Cloudflare's live model list and
-- `cloudflare-worker/src/services/ai/catalogue.ts` disagree, as the job saw it:
-- `field` is `listed` (a model on one side only), `kind`, `context_window` or
-- `beta`; either value is null where that side has none. The job only reads
-- Cloudflare and writes here; it never edits the catalogue, which stays the
-- reviewed source of every model id (D760). Additive; no transaction statements
-- (D1 rejects them).
CREATE TABLE IF NOT EXISTS ai_catalogue_drift (
  model_id TEXT NOT NULL,
  field TEXT NOT NULL,
  catalogue_value TEXT,
  live_value TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_catalogue_drift_seen ON ai_catalogue_drift (seen_at);
CREATE INDEX IF NOT EXISTS idx_ai_catalogue_drift_model ON ai_catalogue_drift (model_id, field);

-- D8522 (#8522) — the usage-row contract: three columns every `ai_usage_logs` row now carries.
--
--   provider         who ran the model ('workers-ai', 'bria', ...), or the words 'not reported'.
--   request_id       the id of the request that made the call, or the words 'not reported'.
--   tokens_reported  1 when the token columns hold what the provider reported, 0 when they read 0
--                    only because the provider reported nothing. NULL is a row written before D8522.
--
-- Expand only: nothing is read, backfilled or dropped. `recordUsage` (aiRouter.ts) is the one writer.
ALTER TABLE ai_usage_logs ADD COLUMN provider TEXT;
ALTER TABLE ai_usage_logs ADD COLUMN request_id TEXT;
ALTER TABLE ai_usage_logs ADD COLUMN tokens_reported INTEGER CHECK (tokens_reported IS NULL OR tokens_reported IN (0, 1));

-- D9033 (#9033): the nightly log prune (src/services/logRetention.ts) walks
-- each log table by its time column. system_metrics (idx_metrics_ts),
-- error_logs (idx_errlog_ts) and cf_dlq_mirror (idx_cf_dlq_time) already have
-- an index that leads with it; rate_limit_logs only has (blocked, created_at)
-- and (user_id, created_at), so its prune would scan the whole table.
CREATE INDEX IF NOT EXISTS idx_rl_ts ON rate_limit_logs(created_at);

-- Both HQ Support reads fetch the latest 25 current decisions in this order.
CREATE INDEX IF NOT EXISTS idx_hq_escalations_recent_decisions
  ON hq_escalations(answered_at DESC, uid DESC)
  WHERE status IN ('answered', 'declined') AND answer IS NOT NULL AND answer <> '';

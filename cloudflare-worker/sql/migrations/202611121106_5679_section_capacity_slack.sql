-- #5679: delivery state for the two public-safe transitions of an HQ D1-size episode.
CREATE TABLE IF NOT EXISTS section_capacity_slack_deliveries (
  alert_id INTEGER NOT NULL REFERENCES platform_capacity_alerts(id),
  stage TEXT NOT NULL CHECK (stage IN ('firing','recovery')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','delivered','uncertain','exhausted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  claim_token TEXT,
  last_reason TEXT,
  channel_id TEXT,
  message_ts TEXT,
  PRIMARY KEY (alert_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_section_capacity_slack_due ON section_capacity_slack_deliveries (state, next_at);

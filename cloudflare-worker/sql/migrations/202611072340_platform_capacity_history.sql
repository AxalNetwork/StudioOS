-- D4559 (#4559) part 2 — platform capacity history and alert state.
--
-- platform_capacity_snapshots: one row per (scope, UTC day, metric key), the
-- last reading of that day. Deployment-wide figures only: the metric keys are
-- the fixed set services/platformCapacity.ts reads (D1 size, queue backlog and
-- age). No member, company, tenant, file name, SQL or secret is stored. A
-- metric that could not be read is stored with value NULL and availability
-- 'unavailable', never as 0.
--
-- platform_capacity_alerts: one row per alert episode. At most one OPEN row
-- per (scope, metric key), enforced by the partial unique index, so a level
-- that stays raised is one episode, not one alert per sweep. A recovery to a
-- measured ok clears the open row; an unreadable source neither opens a level
-- alert nor clears one.
CREATE TABLE IF NOT EXISTS platform_capacity_snapshots (
  scope TEXT NOT NULL,
  day TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL,
  availability TEXT NOT NULL,
  level TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (scope, day, metric_key)
);

CREATE TABLE IF NOT EXISTS platform_capacity_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  opened_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_value REAL,
  cleared_at TEXT,
  muted_until TEXT,
  muted_by INTEGER,
  mute_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_capacity_alerts_open
  ON platform_capacity_alerts (scope, metric_key) WHERE state = 'open';

CREATE INDEX IF NOT EXISTS idx_platform_capacity_alerts_recent
  ON platform_capacity_alerts (scope, opened_at);

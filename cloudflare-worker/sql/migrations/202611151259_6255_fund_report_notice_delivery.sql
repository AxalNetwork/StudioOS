-- D6255: durable delivery receipt for an issued period's in-app LP notices.
CREATE TABLE IF NOT EXISTS fund_report_notice_delivery (
  period_id INTEGER PRIMARY KEY REFERENCES fund_report_periods(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('complete', 'failed')),
  delivered_count INTEGER CHECK (delivered_count >= 0),
  unlinked_count INTEGER CHECK (unlinked_count >= 0),
  delivered_at TEXT,
  CHECK ((status = 'complete' AND delivered_count IS NOT NULL AND unlinked_count IS NOT NULL
            AND (delivered_at IS NOT NULL) = (delivered_count > 0))
      OR (status = 'failed' AND delivered_count IS NULL AND unlinked_count IS NULL AND delivered_at IS NULL))
);

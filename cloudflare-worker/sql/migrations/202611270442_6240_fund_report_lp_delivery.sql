-- D6240 (#6240): one delivery row per (issued reporting period, LP).
-- Written beside the D6255 period receipt when a period's notices are
-- published, and moved to 'opened' when that LP's linked account reads the
-- issued report. A period issued before this table has no rows and reads
-- Not recorded, never 0 delivered.
--   not_sent        the LP row has no active linked account (shown as No account)
--   made_available  the in-app notice reached the linked account
--   opened          that account read the issued report
--   failed          the notice transaction failed for this LP
-- lp_id carries no foreign key: a removed LP row keeps its delivery history.
CREATE TABLE IF NOT EXISTS fund_report_lp_delivery (
  period_id INTEGER NOT NULL REFERENCES fund_report_periods(id) ON DELETE CASCADE,
  lp_id INTEGER NOT NULL,
  user_id INTEGER,
  state TEXT NOT NULL CHECK (state IN ('not_sent', 'made_available', 'opened', 'failed')),
  recorded_at TEXT NOT NULL,
  made_available_at TEXT,
  opened_at TEXT,
  PRIMARY KEY (period_id, lp_id),
  CHECK ((state = 'not_sent') = (user_id IS NULL)),
  CHECK ((state IN ('made_available', 'opened')) = (made_available_at IS NOT NULL)),
  CHECK ((state = 'opened') = (opened_at IS NOT NULL))
);

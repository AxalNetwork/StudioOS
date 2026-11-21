-- D6039: one notification attempt per filing, recipient and reminder window.
CREATE TABLE IF NOT EXISTS filing_reminder_deliveries (
  source TEXT NOT NULL CHECK (source IN ('step', 'obligation')),
  filing_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (source, filing_id, user_id, due_date, reminder_date)
);

CREATE INDEX IF NOT EXISTS idx_filing_reminder_deliveries_record
  ON filing_reminder_deliveries (project_id, source, filing_id, reminder_date);

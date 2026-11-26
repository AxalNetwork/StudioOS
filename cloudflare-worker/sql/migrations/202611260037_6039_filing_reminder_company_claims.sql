-- D6039 part 2 (#6039): company-level compliance_events as a filing reminder
-- source, and one reminder per formation pack item (D6713) across sources.
--
-- Additive only (the owner, 2026-11-26): filing_reminder_deliveries stays as
-- it is, and the step and obligation sources keep writing there.
--
-- filing_reminder_event_deliveries is the company events' own ledger: one
-- attempt per event, recipient, due date and reminder day; sent_at is set only
-- when the notification service records an inbox entry.
--
-- filing_reminder_pack_claims is claimed first by any reminder whose filing
-- carries a pack_item_key, from either source. The primary key admits one
-- claim per pack item, recipient, due date and reminder day, and the claim
-- names the source row that won it, so a step and an event for one item, a
-- rerun or a concurrent run never send it twice.
CREATE TABLE IF NOT EXISTS filing_reminder_event_deliveries (
  event_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  pack_item_key TEXT,
  sent_at TEXT,
  PRIMARY KEY (event_id, user_id, due_date, reminder_date)
);

CREATE INDEX IF NOT EXISTS idx_filing_reminder_event_deliveries_company
  ON filing_reminder_event_deliveries (company_id, event_id, reminder_date);

CREATE TABLE IF NOT EXISTS filing_reminder_pack_claims (
  pack_item_key TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('step', 'event')),
  filing_id INTEGER NOT NULL,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pack_item_key, user_id, due_date, reminder_date)
);

-- D6039 part 2 (#6039): the filing reminder ledger admits company-level
-- compliance_events ('event') and carries the formation pack item key (D6713).
--
-- A company event has no project, so project_id becomes nullable and the row
-- names its company instead; a row names a project, a company or both, never
-- neither. pack_item_key is the stable case/form/item key #6713 writes on both
-- formation_steps and compliance_events. The partial unique index claims one
-- reminder per pack item, recipient, due date and reminder day, whichever
-- source reaches it first, so an item seeded as a step and as an event is
-- never reminded twice.
--
-- SQLite cannot widen a CHECK in place, so the table is rebuilt under its own
-- name (GOTCHAS): copied aside, dropped, recreated, copied back with every row
-- and sent_at intact. Nothing references it. The columns the previous Worker
-- writes are unchanged, so a rollback keeps working. No transaction statements.
CREATE TABLE filing_reminder_deliveries_keep_6039 AS SELECT * FROM filing_reminder_deliveries;

DROP TABLE filing_reminder_deliveries;

CREATE TABLE filing_reminder_deliveries (
  source TEXT NOT NULL CHECK (source IN ('step', 'obligation', 'event')),
  filing_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  reminder_date TEXT NOT NULL,
  project_id INTEGER,
  sent_at TEXT,
  company_id INTEGER,
  pack_item_key TEXT,
  PRIMARY KEY (source, filing_id, user_id, due_date, reminder_date),
  CHECK (project_id IS NOT NULL OR company_id IS NOT NULL)
);

INSERT INTO filing_reminder_deliveries (source, filing_id, user_id, due_date, reminder_date, project_id, sent_at)
SELECT source, filing_id, user_id, due_date, reminder_date, project_id, sent_at FROM filing_reminder_deliveries_keep_6039;

DROP TABLE filing_reminder_deliveries_keep_6039;

CREATE INDEX IF NOT EXISTS idx_filing_reminder_deliveries_record
  ON filing_reminder_deliveries (project_id, source, filing_id, reminder_date);

CREATE INDEX IF NOT EXISTS idx_filing_reminder_deliveries_company
  ON filing_reminder_deliveries (company_id, source, filing_id, reminder_date);

CREATE UNIQUE INDEX IF NOT EXISTS ux_filing_reminder_deliveries_pack_item
  ON filing_reminder_deliveries (pack_item_key, user_id, due_date, reminder_date)
  WHERE pack_item_key IS NOT NULL;

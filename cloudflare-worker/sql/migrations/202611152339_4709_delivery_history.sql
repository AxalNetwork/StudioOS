-- #4709 (D4709): Delivery histories that stay what was sent, with corrections
-- kept beside them.
--
-- BLOCKERS AT SEND. A status report's list showed today's open blockers
-- against every report, sent ones included, so a report sent in March looked
-- blocked on something raised in June. `blockers_at_send` records the
-- engagement's open blockers (side, summary, raised_at) as JSON at the moment
-- the report is marked sent. It is NULL on every report sent before this
-- migration, and the read returns that as "Not recorded", never as "nothing
-- blocked": what was open then was never written down and is not inferred.
--
-- REPORT AMENDMENTS. A sent report stays frozen (D4682's triggers). A
-- correction is a new row here, naming the report, who wrote it and when; it
-- never edits the report. Append-only (the two triggers).
--
-- DELIVERABLE CORRECTIONS. Once a deliverable is sent, changing its title,
-- version, link or sent date needs a reason, and each change keeps the values
-- it replaced here with that reason, who changed it and when. Append-only.
--
-- No transaction statements: D1 rejects `BEGIN;`/`COMMIT;` (see 200's header).

ALTER TABLE engagement_status_reports ADD COLUMN blockers_at_send TEXT;

-- Part of what the client received, so frozen with the rest of a sent report.
CREATE TRIGGER IF NOT EXISTS trg_status_report_sent_blockers_frozen
BEFORE UPDATE OF blockers_at_send
ON engagement_status_reports
WHEN OLD.state = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'status_report_sent');
END;

CREATE TABLE IF NOT EXISTS engagement_status_report_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES engagement_status_reports(id),
  note TEXT NOT NULL,
  amended_by INTEGER NOT NULL,
  amended_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_status_report_amendments_report
  ON engagement_status_report_amendments(report_id, id);

CREATE TRIGGER IF NOT EXISTS trg_status_report_amendments_append_only
BEFORE UPDATE ON engagement_status_report_amendments
BEGIN
  SELECT RAISE(ABORT, 'status_report_amendments_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_status_report_amendments_kept
BEFORE DELETE ON engagement_status_report_amendments
BEGIN
  SELECT RAISE(ABORT, 'status_report_amendments_append_only');
END;

CREATE TABLE IF NOT EXISTS engagement_deliverable_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deliverable_id INTEGER NOT NULL REFERENCES engagement_deliverables(id),
  -- The deliverable's revision before the correction, and the values it held.
  revision INTEGER NOT NULL,
  title TEXT,
  version TEXT,
  link_url TEXT,
  sent_at TEXT,
  reason TEXT NOT NULL,
  corrected_by INTEGER NOT NULL,
  corrected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliverable_corrections_deliverable
  ON engagement_deliverable_corrections(deliverable_id, id);

CREATE TRIGGER IF NOT EXISTS trg_deliverable_corrections_append_only
BEFORE UPDATE ON engagement_deliverable_corrections
BEGIN
  SELECT RAISE(ABORT, 'deliverable_corrections_append_only');
END;
CREATE TRIGGER IF NOT EXISTS trg_deliverable_corrections_kept
BEFORE DELETE ON engagement_deliverable_corrections
BEGIN
  SELECT RAISE(ABORT, 'deliverable_corrections_append_only');
END;

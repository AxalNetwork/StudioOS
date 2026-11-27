-- D4682 (#4682): Delivery records carry a revision, and a sent report is frozen
-- in the database.
--
-- Every edit to a milestone, blocker, deliverable, seat or status report now
-- states the revision it read and bumps it, so a request that read an older
-- row cannot overwrite a newer one (the route checks the affected-row count).
-- `sent_revision` is the revision the report had when it was sent: the exact
-- text the client received.
--
-- The triggers keep two promises whatever code runs next: a sent report's text,
-- sender and send time never change and it is never deleted; a revoked seat is
-- history, so none of its fields change.
ALTER TABLE engagement_milestones ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagement_blockers ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagement_deliverables ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagement_seats ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagement_status_reports ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagement_status_reports ADD COLUMN sent_revision INTEGER;

CREATE TRIGGER IF NOT EXISTS trg_status_report_sent_frozen
BEFORE UPDATE OF shipped, next_up, period, engagement_id, state, sent_at, sent_by, sent_revision
ON engagement_status_reports
WHEN OLD.state = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'status_report_sent');
END;

CREATE TRIGGER IF NOT EXISTS trg_status_report_sent_kept
BEFORE DELETE ON engagement_status_reports
WHEN OLD.state = 'sent'
BEGIN
  SELECT RAISE(ABORT, 'status_report_sent');
END;

CREATE TRIGGER IF NOT EXISTS trg_seat_revoked_frozen
BEFORE UPDATE OF scope, holder_user_id, granted_at, revoked_at, engagement_id
ON engagement_seats
WHEN OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'seat_revoked');
END;

-- Forward fix for 202611271037_7746_research_source_record_links.sql (D7746, #7746).
--
-- That migration adds two new, empty tables and two append-only triggers on the new history table. No table the
-- previous Worker reads or writes changes, so a Worker rollback needs nothing: the old Worker never names either
-- table. What a manual recovery can lose is the history's guards. This fix puts them back as the migration wrote them:
--   - the trigger refusing UPDATE on research_source_link_history;
--   - the trigger refusing DELETE on it.
-- Never weaken them, and never delete a history row.
--
-- Idempotent: every statement is IF NOT EXISTS. The release-window rehearsal runs it on the migrated database and on a
-- clean build (D8532, step 5).

CREATE TRIGGER IF NOT EXISTS research_source_link_history_no_update
BEFORE UPDATE ON research_source_link_history
BEGIN
  SELECT RAISE(ABORT, 'research_source_link_history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS research_source_link_history_no_delete
BEFORE DELETE ON research_source_link_history
BEGIN
  SELECT RAISE(ABORT, 'research_source_link_history is append-only');
END;

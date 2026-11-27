-- Forward fix for 202611260840_5585_swarm_admission_events_render_codes.sql (D5585-p15, #5585).
--
-- That migration rebuilds `swarm_admission_events` (create under a new name, copy, drop, rename) and recreates its
-- index and two append-only triggers. D1 applies the file as one transaction, so it lands whole or not at all. The
-- wider code CHECK accepts every row the previous Worker writes, so a Worker rollback needs nothing. What a manual
-- recovery can lose is the table's guards. This fix puts them back, as D5586-p2 wrote them:
--   - the ticket index;
--   - the trigger refusing UPDATE;
--   - the trigger refusing DELETE.
-- Never weaken them.
--
-- Idempotent: every statement is IF NOT EXISTS. The release-window rehearsal runs it on the migrated database and on a
-- clean build (D8532, step 5).

CREATE INDEX IF NOT EXISTS idx_swarm_admission_events_ticket ON swarm_admission_events (tenant_id, company_id, ticket_uid);

CREATE TRIGGER IF NOT EXISTS swarm_admission_events_append_only
BEFORE UPDATE ON swarm_admission_events
BEGIN
  SELECT RAISE(ABORT, 'swarm_admission_events is append-only (D5586 part 2).');
END;

CREATE TRIGGER IF NOT EXISTS swarm_admission_events_no_delete
BEFORE DELETE ON swarm_admission_events
BEGIN
  SELECT RAISE(ABORT, 'swarm_admission_events is append-only (D5586 part 2).');
END;

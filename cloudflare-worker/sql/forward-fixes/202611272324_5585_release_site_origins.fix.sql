-- Forward fix for 202611272324_5585_release_site_origins.sql (D5585-p18, #5585).
--
-- That migration adds `work_graph_release_site_origins` and three triggers: the next seq of a company, and refusing
-- UPDATE and DELETE. A Worker one version back never reads or writes the table, so a rollback needs nothing; its public
-- route simply sends no CORS headers. What a manual recovery can lose is the table's guards. This fix puts them back
-- as the migration wrote them, with its index. Never weaken them.
--
-- Idempotent: every statement is IF NOT EXISTS. The release-window rehearsal runs it on the migrated database and on a
-- clean build (D8532, step 5).

CREATE INDEX IF NOT EXISTS idx_work_graph_release_site_origins_origin ON work_graph_release_site_origins (tenant_id, company_id, origin, seq);

CREATE TRIGGER IF NOT EXISTS work_graph_release_site_origins_next_seq
BEFORE INSERT ON work_graph_release_site_origins
WHEN NEW.seq <> 1 + COALESCE((SELECT MAX(x.seq) FROM work_graph_release_site_origins x
                               WHERE x.tenant_id = NEW.tenant_id AND x.company_id = NEW.company_id), 0)
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_site_origins.seq: a row must be the next of its company (D5585 part 18).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_site_origins_append_only
BEFORE UPDATE ON work_graph_release_site_origins
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_site_origins is append-only; remove an origin with a new row (D5585 part 18).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_site_origins_no_delete
BEFORE DELETE ON work_graph_release_site_origins
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_site_origins is append-only (D5585 part 18).');
END;

-- Forward fix for 202611261004_5585_release_line_names.sql (D5585-p16, #5585).
--
-- That migration adds `work_graph_release_line_names` and four triggers: the next seq, the line's own tenant and company,
-- and refusing UPDATE and DELETE. A Worker one version back never reads or writes the table, so a rollback needs nothing.
-- What a manual recovery can lose is the table's guards. This fix puts them back as the migration wrote them, with its
-- index. Never weaken them.
--
-- Idempotent: every statement is IF NOT EXISTS. The release-window rehearsal runs it on the migrated database and on a
-- clean build (D8532, step 5).

CREATE INDEX IF NOT EXISTS idx_work_graph_release_line_names_scope ON work_graph_release_line_names (tenant_id, company_id, line_asset_uid);

CREATE TRIGGER IF NOT EXISTS work_graph_release_line_names_next_seq
BEFORE INSERT ON work_graph_release_line_names
WHEN NEW.seq <> 1 + COALESCE((SELECT MAX(x.seq) FROM work_graph_release_line_names x WHERE x.line_asset_uid = NEW.line_asset_uid), 0)
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_line_names.seq: a row must be the next of its line (D5585 part 16).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_line_names_scope
BEFORE INSERT ON work_graph_release_line_names
WHEN NOT EXISTS (SELECT 1 FROM work_graph_release_lines l
                  WHERE l.line_asset_uid = NEW.line_asset_uid AND l.tenant_id = NEW.tenant_id AND l.company_id = NEW.company_id)
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_line_names.tenant_id: a name belongs to its line''s tenant and company (D5585 part 16).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_line_names_append_only
BEFORE UPDATE ON work_graph_release_line_names
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_line_names is append-only; rename with a new row (D5585 part 16).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_line_names_no_delete
BEFORE DELETE ON work_graph_release_line_names
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_line_names is append-only (D5585 part 16).');
END;

-- D5585 part 16 (#5585): a release line's name, as an append-only history.
--
--   work_graph_release_line_names   one row per name a Super Admin gave one release line. The line's name is its latest
--                                   row. A rename is a later row, never an edit, so every earlier name is kept.
--
-- Why a table and not a column: `work_graph_release_lines` is fixed (its BEFORE UPDATE trigger refuses every edit,
-- D5585), so a name set after the line is registered cannot live on that row. Like
-- `work_graph_release_authority_events`:
--   - `seq` numbers one line's rows 1, 2, 3…;
--   - a trigger requires each row to be the next number;
--   - a writer names the `seq` it saw, so two Super Admins renaming at once cannot both land;
--   - another trigger refuses a row whose tenant and company are not its line's.
-- UPDATE and DELETE are refused.
--
-- Additive only: no row elsewhere changes. Dropping the table returns every read to `lineName: null`,
-- `lineNameReason: 'not_recorded'` (D5585-p11 §3).
--
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611261004_5585_release_line_names.fix.sql

CREATE TABLE IF NOT EXISTS work_graph_release_line_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_asset_uid TEXT NOT NULL REFERENCES work_graph_release_lines(line_asset_uid),
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND name = trim(name)),
  actor_user_id INTEGER NOT NULL CHECK (actor_user_id > 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (line_asset_uid, seq),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
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

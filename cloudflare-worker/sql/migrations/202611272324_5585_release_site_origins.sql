-- D5585 part 18 (#5585): the origins a company's published release site records may be read from in a browser.
--
--   work_graph_release_site_origins   one row per change to one company's list of allowed origins: an `allow` or a
--                                     `remove` of one origin (`https://host[:port]`). The list is each origin whose
--                                     latest row is an `allow`. Every change is kept, with who made it and when.
--
-- Like `work_graph_release_line_names`:
--   - `seq` numbers one company's rows 1, 2, 3…;
--   - a trigger requires each row to be the next number;
--   - a writer names the `seq` of the list it saw, so two Super Admins editing at once cannot both land.
-- UPDATE and DELETE are refused. The public site-record route (D5585-p9) adds `Access-Control-Allow-Origin` only for a
-- listed origin of the record's own tenant and company.
--
-- Additive only: no row elsewhere changes. Dropping the table returns the public route to sending no CORS headers.
--
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611272324_5585_release_site_origins.fix.sql

CREATE TABLE IF NOT EXISTS work_graph_release_site_origins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  op TEXT NOT NULL CHECK (op IN ('allow', 'remove')),
  origin TEXT NOT NULL CHECK (length(origin) BETWEEN 12 AND 262 AND origin GLOB 'https://*' AND origin = lower(origin)
    AND origin NOT GLOB '*/*/*/*' AND origin NOT GLOB '*[?#@ ]*'),
  actor_user_id INTEGER NOT NULL CHECK (actor_user_id > 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, company_id, seq),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
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

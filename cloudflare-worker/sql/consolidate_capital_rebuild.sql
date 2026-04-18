-- consolidate_capital_rebuild.sql
--
-- Phase 2 of the capital-table consolidation. Rebuilds `capital_calls` to
-- relax the legacy NOT NULL constraint on `lp_investor_id` so new inserts
-- can be written via `limited_partner_id` only.
--
-- Idempotency model: the deploy script always invokes this file. The script
-- below is wrapped in a single transaction so a partial failure rolls back
-- to the original `capital_calls` table; on retry the rebuild starts from a
-- clean state. The leading `DROP TABLE IF EXISTS capital_calls_new` defends
-- against any rare residue from a non-transactional execution path. On a
-- second clean run the rebuild is a no-op (same column shape, INSERT/SELECT
-- copies the same rows back, DROP+RENAME yields an identical table).

BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS _capital_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Defensive cleanup: a previous non-transactional failure could have left
-- `capital_calls_new` behind. Inside this transaction it is also a no-op
-- on the happy path.
DROP TABLE IF EXISTS capital_calls_new;

-- New shape: lp_investor_id is now NULLABLE; limited_partner_id is the
-- canonical FK. All other columns preserved.
CREATE TABLE capital_calls_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    limited_partner_id INTEGER REFERENCES limited_partners(id),
    lp_investor_id INTEGER REFERENCES lp_investors(id),
    project_id INTEGER REFERENCES projects(id),
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    due_date TEXT,
    paid_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO capital_calls_new (id, uid, limited_partner_id, lp_investor_id, project_id, amount, status, due_date, paid_date, created_at)
SELECT id, uid, limited_partner_id, lp_investor_id, project_id, amount, status, due_date, paid_date, created_at
FROM capital_calls;

DROP TABLE capital_calls;
ALTER TABLE capital_calls_new RENAME TO capital_calls;

CREATE INDEX IF NOT EXISTS idx_capital_calls_lp        ON capital_calls(limited_partner_id);
CREATE INDEX IF NOT EXISTS idx_capital_calls_lp_legacy ON capital_calls(lp_investor_id);
CREATE INDEX IF NOT EXISTS idx_capital_calls_project   ON capital_calls(project_id);

-- Idempotent marker insert: tolerates duplicates on re-runs.
INSERT OR IGNORE INTO _capital_migrations (name) VALUES ('capital_calls_relax_lp_investor_id_notnull');

COMMIT;

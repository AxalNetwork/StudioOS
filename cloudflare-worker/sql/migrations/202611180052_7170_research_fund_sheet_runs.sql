-- D7170 (#7170) — a record of each Google Sheets export or import run.
--
-- `research_fund_sheet_links` kept two clocks and a last error, so a run that
-- wrote to Axal and then timed out before its identifiers reached the sheet
-- looked like a failure, and a retry created the same funds a second time.
-- One row per run fixes that:
--
--   * `idempotency_key` is unique per owner. The page sends one key per
--     reviewed run; a second request with the same key answers the first run
--     instead of writing again.
--   * `status` is running, complete, partial, failed or uncertain. Complete
--     is set only after the counts were read back. Uncertain means Axal was
--     written and the identifiers on the sheet are not confirmed; a new
--     import is refused until the run is reconciled.
--   * `pending_json` lists the sheet cells that should hold the new
--     identifiers, so the reconcile step can read them and write only the
--     missing ones.
--   * `counts_json` is what the card shows as the last result per direction.
--
-- Every statement on this table names its owner. Additive, no BEGIN/COMMIT
-- (D1 rejects transaction statements in a migration file).

CREATE TABLE IF NOT EXISTS research_fund_sheet_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('export', 'import')),
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'complete', 'partial', 'failed', 'uncertain')),
    spreadsheet_id TEXT NOT NULL,
    sheet_gid INTEGER NOT NULL,
    sheet_title TEXT,
    fields_json TEXT NOT NULL DEFAULT '{}',
    counts_json TEXT NOT NULL DEFAULT '{}',
    pending_json TEXT NOT NULL DEFAULT '[]',
    detail TEXT,
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (owner_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_research_fund_sheet_runs_owner
    ON research_fund_sheet_runs (owner_user_id, direction, created_at DESC);

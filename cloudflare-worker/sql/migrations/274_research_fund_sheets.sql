-- 274 — Google Sheets sync for founder fund research.
--
-- `/research/funds` already stores the founder's own reading in
-- `research_funds`. This migration adds the two things a Worker job needs
-- to copy that list to a spreadsheet the founder names, and to copy edits
-- back, without Sheets ever talking to D1:
--
--   1. `google_sheets_oauth_tokens` — a dedicated refresh-token row, NOT
--      `google_oauth_tokens`. Calendar's client asks for calendar + gmail
--      scopes; adding spreadsheets there would force every connected
--      calendar to re-consent. Sheets is its own consent and its own row.
--      The refresh token is encrypted at rest the same way calendar's is
--      (`cryptoBox`).
--
--   2. `research_fund_sheet_links` — which spreadsheet, and which tab
--      (gid), this founder pointed at. One link per owner. The spreadsheet
--      id is theirs to set; nothing in the product hard-codes a sheet as
--      the only target. `last_pulled_at` / `last_pushed_at` are clocks on
--      the last successful direction, and `last_error` is the last failure
--      so the zone can say why rather than look idle.
--
-- NO DELETE ON PUSH. A row that leaves the sheet is not a delete in D1 —
-- a pass is a state, and a fund nobody reached is indistinguishable from
-- one that was quietly dropped. Pull overwrites the sheet's data rows;
-- push only POSTs and PATCHes.
--
-- Additive, IF-NOT-EXISTS-shaped, and deliberately NO BEGIN/COMMIT — D1
-- rejects transaction statements in a migration file (the #26 lesson).

CREATE TABLE IF NOT EXISTS google_sheets_oauth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    google_email TEXT,
    google_sub TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS research_fund_sheet_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    spreadsheet_id TEXT NOT NULL,
    sheet_gid INTEGER NOT NULL DEFAULT 0,
    sheet_title TEXT,
    last_pulled_at TEXT,
    last_pushed_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_research_fund_sheet_links_owner
    ON research_fund_sheet_links (owner_user_id);

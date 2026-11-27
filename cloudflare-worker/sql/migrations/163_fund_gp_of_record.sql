-- Fund GP of record + service providers — the fiduciary facts an LP-facing
-- document has to state.
--
-- WHY THIS EXISTS. `vc_funds` records what a fund IS (name, vintage, size,
-- fee, carry) but not WHO IS RESPONSIBLE FOR IT. Every LP-facing document
-- — the quarterly report above all — is signed by a fiduciary and names the
-- administrator, auditor and counsel who stand behind its numbers. With no
-- column for any of that, the only way to render those lines was to hard-code
-- a person's name and four firms' names into the frontend, which then asserts
-- a fiduciary relationship the database has never been told about and cannot
-- vary per fund.
--
-- So: the GP of record and the service providers become fund data the GP owns.
-- Nothing here is populated by this migration. An unset column renders as an
-- explicit "not recorded" in the report — never as an invented name. That is
-- deliberate: a quarterly report that names the wrong auditor is worse than one
-- that admits the auditor has not been entered.
--
-- gp_user_id vs gp_name: the platform account is the link (so the app can tell
-- whether the signer is a real user and reach them), while gp_name/gp_title/
-- gp_email are the strings AS THEY APPEAR ON THE DOCUMENT. Those are not always
-- the account's profile fields — an LP report is signed in a legal capacity,
-- and gp_entity carries the management company that actually holds the duty.
--
-- Apply with the ledger-driven runner (NOT a raw `wrangler d1 execute`):
--   npm run d1:migrate:remote      # === node scripts/migrate-d1.mjs --remote
--
-- Why that matters: this file is NON-idempotent (D1 ALTER TABLE … ADD COLUMN
-- has no IF NOT EXISTS). The runner executes it exactly once and writes the
-- `schema_migrations` ledger row. A hand-apply leaves no ledger row, so the
-- next `npm run deploy` re-executes it, D1 returns "duplicate column name:
-- gp_user_id", and the plan ABORTS on that first failure — blocking this
-- migration and every later one. If it has already been hand-applied, insert
-- the ledger row by hand (the runner prints the exact statement) first.
--
-- The worker also self-heals on cold isolates via ensureFundGpColumns()
-- (services/fundGpSchema.ts), matching the partnerGuidanceSchema pattern.

-- Fiduciary of record.
ALTER TABLE vc_funds ADD COLUMN gp_user_id INTEGER REFERENCES users(id);
ALTER TABLE vc_funds ADD COLUMN gp_name TEXT;
ALTER TABLE vc_funds ADD COLUMN gp_title TEXT;
ALTER TABLE vc_funds ADD COLUMN gp_email TEXT;
ALTER TABLE vc_funds ADD COLUMN gp_entity TEXT;

-- Service providers named in the report's "Fund administration" block.
ALTER TABLE vc_funds ADD COLUMN fund_admin TEXT;
ALTER TABLE vc_funds ADD COLUMN auditor TEXT;
ALTER TABLE vc_funds ADD COLUMN legal_counsel TEXT;
ALTER TABLE vc_funds ADD COLUMN custodian TEXT;
ALTER TABLE vc_funds ADD COLUMN valuation_policy TEXT;

-- Stable handle so the app can resolve "the Spin-Out Lab fund" without matching
-- on a display name an admin can rename at any time.
ALTER TABLE vc_funds ADD COLUMN slug TEXT;

-- Partial unique index: many funds may have no slug yet, but a slug that exists
-- must identify exactly one fund, or `fundBySlug` would silently pick a row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vc_funds_slug ON vc_funds(slug) WHERE slug IS NOT NULL;

-- Reporting periods that have actually been issued.
--
-- The capital account can be reconstructed as-of any date from dated
-- capital_calls and fund_distributions rows, but portfolio MARKS cannot: the
-- position values live in an operator-maintained model with no history, so a
-- report for a closed quarter would silently carry today's marks under last
-- quarter's heading. This table records the issue of a report so a re-download
-- reproduces the same document, and so the archive lists periods that were
-- really issued instead of guessing.
CREATE TABLE IF NOT EXISTS fund_report_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fund_id INTEGER NOT NULL REFERENCES vc_funds(id),
    period TEXT NOT NULL,                 -- 'Q2 2026'
    period_start TEXT NOT NULL,           -- ISO date, inclusive
    period_end TEXT NOT NULL,             -- ISO date, inclusive
    issued_at TEXT,                       -- NULL until the GP issues it
    issued_by INTEGER REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'draft', -- draft | issued
    -- Frozen fund-level figures at issue, as JSON. Written once, at issue, so a
    -- re-download of an issued period is byte-identical rather than re-marked.
    snapshot_json TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fund_report_periods_fund_period
    ON fund_report_periods(fund_id, period);
CREATE INDEX IF NOT EXISTS idx_fund_report_periods_status
    ON fund_report_periods(fund_id, status);

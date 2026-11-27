-- LP applications — the Spin-Out Fund I request-for-access flow.
--
-- WHY THIS EXISTS. The LP & Investor Workspace has always ended in an
-- application step, and it has always been a dead end: the design's self-serve
-- form had no endpoint behind it, so the page routed applicants through the
-- support ticket queue and said so out loud rather than posting to something
-- that would silently discard them. This table is that endpoint's store.
--
-- WHAT IT IS NOT. It is not an entitlement table. Nothing downstream reads it
-- to decide what a viewer may see: the workspace's access ladder is derived
-- from `limited_partners` rows (a countersigned LPA, a real commitment), and a
-- submitted application only moves a viewer from 'visitor' to 'pending' —
-- which unlocks nothing. No reporting archive, no data room, no allocation.
-- That is precisely what makes it safe for the applicant to author their own
-- row: the worst a hostile submitter can do is tell the GP they are interested.
--
-- `target_commitment` is a stated INTENTION, in DOLLARS — the same unit as
-- `limited_partners.commitment_amount`, so the two can never be compared
-- across a unit boundary. It is not capital and it is not counted anywhere:
-- GET /api/spinout-lab/fund-metrics reads `limited_partners`, never this table,
-- so an application can never move the raise bar.
--
-- Apply with the ledger-driven runner (NOT a raw `wrangler d1 execute`):
--   npm run d1:migrate:remote      # === node scripts/migrate-d1.mjs --remote
--
-- Idempotent (CREATE TABLE / CREATE INDEX IF NOT EXISTS), and the worker
-- self-heals on a cold isolate via ensureLpApplicationsSchema(), matching the
-- spinoutDeckOverrides pattern — so a preview D1 that has not been migrated
-- still serves the route instead of 500ing on "no such table".

CREATE TABLE IF NOT EXISTS lp_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    -- Slug, not fund_id: an admin can rename a fund at any moment, and the
    -- workspace already resolves this fund by slug (SPINOUT_FUND_SLUG) for the
    -- same reason. Applications are per (applicant, fund).
    fund_slug TEXT NOT NULL DEFAULT 'spinout-fund-i',

    investor_type TEXT NOT NULL,
    -- DOLLARS. See the header note on units.
    target_commitment REAL,
    -- JSON array of informational preference areas. They never restrict fund
    -- strategy; they exist so the GP can route the conversation.
    preference_areas TEXT NOT NULL DEFAULT '[]',
    -- Rule 501 self-certification. Stored because it is a legal precondition
    -- of participation, and the route refuses a submission without it.
    accredited INTEGER NOT NULL DEFAULT 0,
    note TEXT,

    -- pending | approved | declined | withdrawn. Only the GP moves an
    -- application off 'pending'; an applicant may withdraw their own.
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    -- The reason recorded at review. Returned to the applicant on their own
    -- row: someone who was declined is entitled to know why.
    review_note TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One live application per applicant per fund — the upsert target. A
-- re-submission updates the existing row rather than stacking duplicates in
-- the GP's review queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lp_applications_user_fund
    ON lp_applications(user_id, fund_slug);

-- The GP's review queue reads status-first.
CREATE INDEX IF NOT EXISTS idx_lp_applications_status
    ON lp_applications(fund_slug, status, created_at);

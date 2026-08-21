-- 171 — right-of-first-refusal notices on secondary listings.
--
-- A ROFR is the legal gate on a secondary sale: until the company and
-- its existing investors have declined, waived, or run out the clock,
-- the seller may not transfer. Before this table the platform had no
-- record of where that stood, so nothing could tell a seller whether
-- they were actually allowed to sell — services/secondaryProceeds.ts
-- computed the answer but had no state to compute it from.
--
-- One live notice per listing. A re-served notice overwrites the row:
-- the earlier notice is superseded in fact, and keeping both would let
-- rofrStatus() pick the wrong deadline.
--
-- UNITS: no money in this table. Share counts only. The rest of the
-- liquidity surface transits integer cents (see routes/liquidity.ts);
-- nothing here is denominated, so there is nothing to confuse.

CREATE TABLE IF NOT EXISTS secondary_rofr_notices (
    listing_id        INTEGER PRIMARY KEY REFERENCES secondary_listings(id) ON DELETE CASCADE,
    -- ISO date (YYYY-MM-DD) the transfer notice was served on the company.
    -- NULL means no notice served yet, which reads as 'not_started' and
    -- therefore NOT clear to transfer.
    notice_date       TEXT,
    -- Contractual election window. 30 days is the common default in a
    -- Delaware shareholders' agreement, but it is a term of the specific
    -- agreement, so it is stored per notice rather than assumed.
    window_days       INTEGER NOT NULL DEFAULT 30,
    shares_offered    REAL NOT NULL DEFAULT 0,
    company_elected   REAL NOT NULL DEFAULT 0,
    investors_elected REAL NOT NULL DEFAULT 0,
    -- Explicit written waiver. Separate from an expired window: a waiver
    -- is an affirmative act, an expiry is the absence of one, and a
    -- seller's counsel will want to know which happened.
    waived            INTEGER NOT NULL DEFAULT 0,
    notes             TEXT,
    created_by        INTEGER REFERENCES users(id),
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rofr_notice_date ON secondary_rofr_notices(notice_date);

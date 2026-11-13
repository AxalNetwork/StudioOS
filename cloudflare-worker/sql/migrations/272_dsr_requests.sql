-- 272 — HQ could watch a statutory clock and could not stop it (D168).
--
-- THE DEFECT, measured end to end before this table was written:
--
--   the member requests   settings.ts POST /account/delete-request —
--                         UPDATE users SET deletion_requested_at = COALESCE(...)
--   the member cancels    settings.ts POST /account/delete-request/cancel —
--                         sets it back to NULL
--   HQ reads it           admin_security.ts GET /overview, against
--                         DSR_CLOCK_DAYS = 30, whose comment is exactly right:
--                         "GDPR Art. 12(3): one month from receipt. Counted
--                         from the request, not from triage."
--   HQ renders it         SecurityPage.jsx — an amber zone, `Nd overdue` in
--                         red, and a headline count of requests inside
--                         deadline pressure
--   HQ acts on it         NOTHING. admin_security.ts declared exactly four
--                         handlers — two GETs and the two force-reauth POSTs —
--                         and the only writers of deletion_requested_at in the
--                         whole worker were the member's own two.
--
-- So the only way a row left HQ's list was the subject cancelling their own
-- request. HQ watched a legal deadline, painted it red when it ran out, and
-- had no way to stop it. This table is the record that lets HQ close one.
--
-- WHAT "CLOSE" MEANS HERE, AND WHAT IT DELIBERATELY DOES NOT. There is no
-- DELETE FROM users, no deleted_at and no anonymisation anywhere in this
-- codebase, and this migration does not invent one: erasure needs a retention
-- and legal-hold policy that has not been written. An `outcome` of `fulfilled`
-- therefore records that the manual act was DONE, by whom and when — it is a
-- decision record, not a deletion. Saying that here matters because the
-- alternative is an audit row that implies an erasure nobody performed, and a
-- false claim is worst in the one store that exists to be trusted.
--
-- WHY A SIDE TABLE AND NOT COLUMNS ON `users`. Two reasons, and the second is
-- the one that decides it. `users` is at D1's 100-column cap — the reason
-- `super_admins` exists as a side table at all (D35, migration 199). And a
-- request is an EVENT WITH A LIFECYCLE THAT RECURS: a subject denied once may
-- request again, and a column set can hold one request per account forever.
-- The shape is migration 264's, one ladder over.
--
-- `users.deletion_requested_at` STAYS AND STAYS AUTHORITATIVE FOR "OPEN".
-- It is what HQ's list and the subject's own Settings already read, so leaving
-- it in place is what lets rows that predate this table keep working with no
-- backfill: the close route DERIVES the ledger row from the timestamp already
-- stored when one is absent. That is carrying a fact the database already
-- holds, which is a different act from D136's refused backfill — that one
-- would have written an acceptance on somebody's behalf.
--
-- Every writer moves BOTH in one DB.batch, so the two cannot disagree: the
-- request opens a row and sets the column, the cancel closes it `withdrawn`
-- and clears the column, and HQ's close writes the outcome and clears the
-- column.
--
-- NO `kind` COLUMN. Erasure is the only data-subject request this platform
-- records — `deletion_requested_at` is the only signal, and the page already
-- labels each row `· erasure`. A column that can only ever hold one value is
-- the D129 mistake, so the table is named for what it holds and this comment
-- is where a second kind would have to argue for itself.
--
-- D1 REJECTS BEGIN/COMMIT (the #26 lesson), so there is no transaction here.

CREATE TABLE IF NOT EXISTS dsr_requests (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The subject. CASCADE because a request is about a person: if the row
    -- they are the subject of is gone, the request has no subject left.
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SQL format ('YYYY-MM-DD HH:MM:SS'), copied from or written the same way
    -- as `users.deletion_requested_at` so the statutory clock is computed off
    -- one format. The clock runs from HERE — receipt — never from triage.
    requested_at        TEXT NOT NULL,
    -- NULL while the request is open. `fulfilled` records that the manual
    -- erasure was carried out; it does not perform one.
    outcome             TEXT
                        CHECK (outcome IS NULL
                               OR outcome IN ('fulfilled', 'denied', 'withdrawn')),
    closed_at           TEXT,
    -- NULL for `withdrawn`: the subject closed that one themselves, and
    -- naming an operator would be recording an act nobody performed.
    closed_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    close_reason        TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AT MOST ONE OPEN REQUEST PER SUBJECT, enforced rather than checked.
-- `POST /account/delete-request` is already idempotent on the users column
-- (COALESCE keeps the first timestamp), and this is the same rule for the
-- ledger: the insert is `OR IGNORE`, so a second request while one is open is
-- a no-op on both halves rather than a second clock. Partial unique indexes
-- have precedent in the baseline (idx_users_founder_public_id and four more).
CREATE UNIQUE INDEX IF NOT EXISTS uq_dsr_requests_open
    ON dsr_requests(user_id) WHERE outcome IS NULL;

-- HQ's list: the open rows, oldest first, which is the order the statutory
-- clock makes correct — `outcome` leads because it is the selective half once
-- most requests have been closed.
CREATE INDEX IF NOT EXISTS idx_dsr_requests_open
    ON dsr_requests(outcome, requested_at);

-- "Has this subject asked before?" — the history HQ's row carries, so a
-- repeat request is visible as one rather than reading as a first.
CREATE INDEX IF NOT EXISTS idx_dsr_requests_user
    ON dsr_requests(user_id, requested_at DESC);

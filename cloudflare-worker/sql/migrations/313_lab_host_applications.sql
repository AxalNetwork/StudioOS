-- 313_lab_host_applications.sql — who may host Spin-Out Lab office hours
-- (D377, wave 8, Session 9).
--
-- /spinout-lab/office-hours listed every row in `partners`, so any partner
-- profile on the platform appeared to Lab founders as bookable. The owner's
-- rule: only people who APPLIED to the Spin-Out Lab as an Investor, Advisor
-- or Partner, and whom an admin (or super admin) APPROVED, appear there.
--
-- ONE ROW PER APPLICATION, FROM THE HOST'S OWN BOOKABLE PROFILE. A founder
-- books a real calendar, so the application names which one:
--
--   host_kind = 'partner'  → a `partners` row (booked via partner office-hour
--                            slots); capacity is Investor, Advisor or Partner.
--   host_kind = 'advisor'  → an `advisors` row (booked via advisor slots);
--                            capacity is Advisor.
--
-- host_id is that row's id. The route resolves it from the CALLER's own
-- account (users.partner_id, or the advisor row whose user_id is theirs) —
-- never from the request — so nobody applies on another person's profile.
--
-- STATUS. pending → approved | rejected (an admin's decision, recorded with
-- who and when); pending → withdrawn (the applicant); approved → revoked (an
-- admin). At most one live (pending or approved) application per profile,
-- held by the partial unique index below, so a second application is refused
-- rather than stacked. A decided application is never deleted; a new one can
-- follow a rejection, withdrawal or revocation.
--
-- The directory reads status = 'approved' only. Nothing is approved by this
-- migration: the directory starts empty and fills as admins approve (the
-- owner's choice, D377).
--
-- STANDS ALONE: one new table and its indexes; no BEGIN/COMMIT.
--
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS lab_host_applications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    uid           TEXT    NOT NULL UNIQUE,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    host_kind     TEXT    NOT NULL CHECK (host_kind IN ('partner', 'advisor')),
    host_id       INTEGER NOT NULL,
    capacity      TEXT    NOT NULL CHECK (capacity IN ('investor', 'advisor', 'partner')),
    statement     TEXT,
    status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'revoked')),
    reviewed_by   INTEGER REFERENCES users(id),
    reviewed_at   TEXT,
    review_note   TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (host_kind = 'partner' OR capacity = 'advisor')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_host_applications_live
  ON lab_host_applications(host_kind, host_id) WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_lab_host_applications_status
  ON lab_host_applications(status, created_at);

CREATE INDEX IF NOT EXISTS idx_lab_host_applications_user
  ON lab_host_applications(user_id, created_at);

-- 264 — the compliance ladder's evidence and its clock (D135).
--
-- WHAT THE LADDER IS, in the owner's words: "Super admin (HQ) should be able to
-- notify admins and send warnings or notifications, on licence renewal terms,
-- fees, term violations … if admins do not respect the terms of the contracts
-- and agreement terms of the Super admin (HQ), admin accounts can be
-- terminated, but first admins get notified; if admins do not act on
-- notifications, admin accounts are frozen until they act on things from what
-- they have been notified; and lastly if they don't comply admin accounts are
-- terminated."
--
--   ACTIVE ──notice issued──▶ ISSUED ──deadline passes, no response──▶ OVERDUE
--                               │                                        │
--                     admin responds                            admin responds
--                               │                                        │
--                               ▼                                        ▼
--                          RESPONDED ──HQ accepts──▶ ACCEPTED (the freeze lifts)
--                               │
--                        HQ rejects ──▶ REJECTED (the freeze stays; HQ's next
--                                       move is a new notice or a termination)
--
-- THE STATE OF THE LICENCE IS NOT IN THIS TABLE, AND THAT IS THE POINT.
-- `territory_licences.status` already carries the ladder's two end states, with
-- the comments that prove the semantics were chosen deliberately (migration
-- 187): `suspended` — "not trading, STILL HOLDS ITS TERRITORY" — and
-- `terminated` — "over; territory released" — beside `suspended_at`,
-- `terminated_at` and `status_note`. `/suspend`, `/reinstate` and `/terminate`
-- exist, are super-admin-only, and are audited through `licence_events`' own
-- CHECK. A second `frozen` flag beside that status would be two answers to one
-- question, and the day they disagreed nobody would know which was true.
--
-- So: THE LICENCE SUPPLIES THE STATE; THIS TABLE SUPPLIES THE REASON AND THE
-- CLOCK. That reuse is only sound because the subjects match — renewal terms,
-- fees and term violations are licence matters, and `licence_admins` is
-- UNIQUE(user_id), so one admin holds exactly one licence.
--
-- WHY NOT THE EXISTING INBOX. `notifications_inbox` has `read_at` and nothing
-- else: no acknowledge, no action-required, no response. Marking read is
-- dismissal, and a ladder whose first rung can be cleared by dismissing it is
-- not a ladder. Migration 244 already wrote the general argument for a claim
-- table beside the inbox — "a reader can mark rows read and the UI can clear
-- them, and its `payload` is opaque JSON with no index to match on." The notice
-- is the record; the inbox is how the person hears about it.
--
-- `respond_by` IS NAMED SO THE TIMESTAMP GUARD CAN SEE IT, and
-- `scripts/check-timestamp-comparisons.mjs`'s `TTL_COLUMN` gains it in the same
-- commit that creates this table. That guard has NO ALLOWLIST by design, and a
-- deadline swept against the clock is precisely the defect class it exists for:
-- an ISO string compared against CURRENT_TIMESTAMP is always the greater one,
-- so a TTL written that way does not expire until the UTC date rolls over. It
-- has bitten the magic link, the support code and two trust sweeps. Every write
-- to this column goes through `datetime('now', '+N days')` — SQL format, the
-- writer's own — so the guard's required `datetime()` wrap is belt-and-braces
-- rather than the only thing holding it up.
--
-- D1 REJECTS BEGIN/COMMIT (the #26 lesson), so there is no transaction here.

CREATE TABLE IF NOT EXISTS admin_notices (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    uid                 TEXT NOT NULL UNIQUE,
    -- The addressee. An account, not a licence: the person answers, and the
    -- response route is gated on being THIS row's addressee.
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The licence the notice is about, and whose status the ladder moves.
    -- Nullable so a notice survives a licence being deleted rather than
    -- cascading the evidence away with it.
    licence_id          INTEGER REFERENCES territory_licences(id) ON DELETE SET NULL,
    kind                TEXT NOT NULL
                        CHECK (kind IN ('renewal_terms', 'fees', 'term_violation', 'other')),
    subject             TEXT NOT NULL,
    body                TEXT NOT NULL,
    issued_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    -- SQL format ('YYYY-MM-DD HH:MM:SS'), written by datetime('now','+N days').
    respond_by          TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'issued'
                        CHECK (status IN ('issued', 'overdue', 'responded',
                                          'accepted', 'rejected', 'withdrawn')),
    response            TEXT,
    responded_at        TEXT,
    reviewed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at         TEXT,
    review_note         TEXT,
    -- When the sweep moved this notice to `overdue` and froze the licence for
    -- it. Stamped with the COMPUTED deadline, never the sweep's own clock, so
    -- the cadence affects when the row is written and never what it says —
    -- the D122 rule, which exists because an audit must not be late in the one
    -- direction that flatters the operator.
    froze_at            TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The sweep's predicate: rows still in the pre-transition state whose deadline
-- has passed. Leading on `status` because that is the selective half — a
-- database of mostly-accepted notices has few `issued` rows and every one of
-- them has a deadline.
CREATE INDEX IF NOT EXISTS idx_admin_notices_sweep
    ON admin_notices(status, respond_by);

-- "What does this account still owe?" — the addressee's own list, and the
-- freeze gate's lookup.
CREATE INDEX IF NOT EXISTS idx_admin_notices_user
    ON admin_notices(user_id, status);

-- "What is open against this licence?" — HQ's view, and the predicate that
-- decides whether accepting one notice lifts the freeze.
CREATE INDEX IF NOT EXISTS idx_admin_notices_licence
    ON admin_notices(licence_id, status);

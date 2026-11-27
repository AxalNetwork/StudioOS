-- 553 — Program grants (D982, #2773, part 1 of #2376).
--
-- WHAT HQ GRANTS A STUDIO, AND ON WHAT TERMS. One row per licence and program
-- key, keyed on the same strings as the Programs catalogue (D953) and the
-- canvas's grid (`frontend/src/lib/programGrants.js`, D981). Every term is
-- nullable: a term nobody set reads "Not recorded" (D797's rule), never a
-- zero or a default passed off as a decision.
--
-- THE TERMS ARE THE CANVAS'S (GR4, GR6, GR8). Not every program carries every
-- term (credits are Refer & Earn's and Perks', cohorts the Lab's and Mentor
-- cohorts'); `services/programGrants.ts` holds which apply to which, and the
-- route refuses a term that does not apply. Capacity is two columns, because
-- the canvas's "No cap" is a decision and an empty cell is not:
--   capacity_cap = N           → "Up to N"
--   capacity_uncapped = 1      → "No cap"
--   both NULL                  → "Not recorded"
--
-- "STARTS ONLY WHEN THE SCHEDULE IS SIGNED" IS A TERM, ON BY DEFAULT (D981 §5,
-- decision 3). `schedule_signed_at` records when the program schedule was
-- signed; a grant that waits for it is granted but not in force.
--
-- THE PROGRAM FEE IS STORED, NOT BILLED. Where it is billed (the annual fee
-- invoice or the statements) is still the owner's (D981 §5, decision 2).

CREATE TABLE IF NOT EXISTS program_grants (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    uid                       TEXT NOT NULL UNIQUE,
    licence_id                INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    program_key               TEXT NOT NULL
                              CHECK (program_key IN ('spinout-lab', 'ai-native-venture', 'mentor-cohorts',
                                                     'investor-cohorts', 'referral-partners', 'refer-and-earn',
                                                     'perks', 'learning', 'product-testing')),
    state                     TEXT NOT NULL CHECK (state IN ('granted', 'paused', 'ended')),
    -- The terms.
    starts_on                 TEXT CHECK (starts_on IS NULL OR starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    ends_on                   TEXT CHECK (ends_on IS NULL OR ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    ends_with_licence         INTEGER CHECK (ends_with_licence IS NULL OR ends_with_licence IN (0, 1)),
    capacity_cap              INTEGER CHECK (capacity_cap IS NULL OR capacity_cap > 0),
    capacity_uncapped         INTEGER CHECK (capacity_uncapped IS NULL OR capacity_uncapped IN (0, 1)),
    cohorts_per_year          INTEGER CHECK (cohorts_per_year IS NULL OR cohorts_per_year >= 0),
    credits_per_quarter       INTEGER CHECK (credits_per_quarter IS NULL OR credits_per_quarter >= 0),
    fee_cents                 INTEGER CHECK (fee_cents IS NULL OR fee_cents >= 0),
    currency                  TEXT CHECK (currency IS NULL OR length(currency) = 3),
    hq_share_bps              INTEGER CHECK (hq_share_bps IS NULL OR (hq_share_bps >= 0 AND hq_share_bps <= 10000)),
    hq_approves_each_cohort   INTEGER CHECK (hq_approves_each_cohort IS NULL OR hq_approves_each_cohort IN (0, 1)),
    hq_approval_above_cents   INTEGER CHECK (hq_approval_above_cents IS NULL OR hq_approval_above_cents >= 0),
    playbook                  TEXT CHECK (playbook IS NULL OR playbook IN ('as_written', 'may_adapt')),
    brand                     TEXT CHECK (brand IS NULL OR brand IN ('axal', 'studio')),
    reporting                 TEXT CHECK (reporting IS NULL OR reporting IN ('monthly', 'quarterly', 'yearly')),
    requires_signed_schedule  INTEGER CHECK (requires_signed_schedule IS NULL OR requires_signed_schedule IN (0, 1)),
    -- The program schedule this grant runs under, and when it was signed.
    schedule_contract_uid     TEXT,
    schedule_signed_at        TEXT,
    -- HQ's note to the studio; the studio reads it.
    note                      TEXT CHECK (note IS NULL OR length(note) <= 2000),
    paused_at                 TEXT,
    ended_at                  TEXT,
    set_by_user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    set_at                    TEXT NOT NULL,
    created_at                TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (licence_id, program_key)
);

CREATE INDEX IF NOT EXISTS idx_program_grants_program ON program_grants(program_key, state);

-- The terms a new grant starts from, one row per program, and whether HQ may
-- grant it at all. Grants in force keep their own terms until HQ changes them.
CREATE TABLE IF NOT EXISTS program_grant_defaults (
    program_key               TEXT PRIMARY KEY
                              CHECK (program_key IN ('spinout-lab', 'ai-native-venture', 'mentor-cohorts',
                                                     'investor-cohorts', 'referral-partners', 'refer-and-earn',
                                                     'perks', 'learning', 'product-testing')),
    grantable                 INTEGER NOT NULL DEFAULT 0 CHECK (grantable IN (0, 1)),
    ends_with_licence         INTEGER CHECK (ends_with_licence IS NULL OR ends_with_licence IN (0, 1)),
    capacity_cap              INTEGER CHECK (capacity_cap IS NULL OR capacity_cap > 0),
    capacity_uncapped         INTEGER CHECK (capacity_uncapped IS NULL OR capacity_uncapped IN (0, 1)),
    cohorts_per_year          INTEGER CHECK (cohorts_per_year IS NULL OR cohorts_per_year >= 0),
    credits_per_quarter       INTEGER CHECK (credits_per_quarter IS NULL OR credits_per_quarter >= 0),
    fee_cents                 INTEGER CHECK (fee_cents IS NULL OR fee_cents >= 0),
    currency                  TEXT CHECK (currency IS NULL OR length(currency) = 3),
    hq_share_bps              INTEGER CHECK (hq_share_bps IS NULL OR (hq_share_bps >= 0 AND hq_share_bps <= 10000)),
    hq_approves_each_cohort   INTEGER CHECK (hq_approves_each_cohort IS NULL OR hq_approves_each_cohort IN (0, 1)),
    hq_approval_above_cents   INTEGER CHECK (hq_approval_above_cents IS NULL OR hq_approval_above_cents >= 0),
    playbook                  TEXT CHECK (playbook IS NULL OR playbook IN ('as_written', 'may_adapt')),
    brand                     TEXT CHECK (brand IS NULL OR brand IN ('axal', 'studio')),
    reporting                 TEXT CHECK (reporting IS NULL OR reporting IN ('monthly', 'quarterly', 'yearly')),
    requires_signed_schedule  INTEGER CHECK (requires_signed_schedule IS NULL OR requires_signed_schedule IN (0, 1)),
    updated_by_user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at                TEXT
);

-- One row per program. Only the flag and the schedule rule are seeded: every
-- money and capacity default is HQ's to enter, so it starts "Not recorded".
-- Product testing stays at HQ and the two unbuilt programs cannot be granted
-- (D981 §3), so they ship off; the route refuses switching them on.
INSERT OR IGNORE INTO program_grant_defaults (program_key, grantable, requires_signed_schedule) VALUES
    ('spinout-lab', 1, 1),
    ('ai-native-venture', 0, 1),
    ('mentor-cohorts', 1, 1),
    ('investor-cohorts', 0, 1),
    ('referral-partners', 1, 1),
    ('refer-and-earn', 1, 1),
    ('perks', 1, 1),
    ('learning', 1, 1),
    ('product-testing', 0, 1);

-- ─────────────────────────────────────────────── licence history
--
-- ONE GENERIC EVENT, `program_changed`, with the detail in `detail_json`
-- ({ action, program_key, before, after, changed, reason }). D982 §4 records
-- why: one rebuild now, and parts 2–5 add actions without another.
--
-- Same rebuild as 266 and 331: SQLite cannot widen a CHECK in place.
--
-- THE SEAL IS RE-RUN. DROP TABLE drops a table's triggers, and migration 269
-- says any rebuild of a sealed table must re-run them. Migration 331 did not,
-- so `licence_events` has carried no append-only seal since 331 (found while
-- building D982; D982 §5). The two triggers below are 269's, verbatim, and
-- `cloudflare-worker/test/program_grants_d982.test.ts` asserts them on the
-- full migration chain.

CREATE TABLE IF NOT EXISTS licence_events_553 (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    licence_id   INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    event        TEXT NOT NULL
                 CHECK (event IN ('created', 'territory_changed', 'seats_changed',
                                  'terms_changed', 'activated', 'suspended',
                                  'reinstated', 'renewed', 'terminated',
                                  'contract_instantiated',
                                  'contract_sent',
                                  'program_changed')),
    detail_json  TEXT,
    note         TEXT,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO licence_events_553 (id, licence_id, event, detail_json, note, actor_user_id, created_at)
    SELECT id, licence_id, event, detail_json, note, actor_user_id, created_at FROM licence_events;

DROP TABLE licence_events;

ALTER TABLE licence_events_553 RENAME TO licence_events;

CREATE INDEX IF NOT EXISTS idx_licence_events_licence ON licence_events(licence_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS licence_events_block_update
BEFORE UPDATE ON licence_events
BEGIN
    SELECT RAISE(ABORT,
        'licence_events is append-only (D156, and migration 187 said so in prose). A licence transition already recorded cannot be rewritten; append the correcting event.'
    );
END;

CREATE TRIGGER IF NOT EXISTS licence_events_block_delete
BEFORE DELETE ON licence_events
BEGIN
    SELECT RAISE(ABORT,
        'licence_events is append-only (D156). Deleting an event would remove the record of a licence transition that happened.'
    );
END;

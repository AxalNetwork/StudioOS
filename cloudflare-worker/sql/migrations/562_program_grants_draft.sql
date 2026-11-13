-- 562 — Programs part 3: a program grant may be a DRAFT (D956, #2789).
-- Reserved for this part by #2789.
--
-- WHAT A DRAFT IS. A proposal HQ approves "for this studio only" (D955,
-- migration 561) writes a registry row for the new program; from here on it
-- also opens a `draft` grant of that program for the proposing studio's
-- licence, carrying the proposal's uid. A draft is HQ's: nothing runs on it,
-- the studio reads "Not granted" until HQ grants it, and D982's grant write is
-- its one way out (`draft` → `granted`). Pause, resume, end and a terms change
-- are refused on a draft.
--
-- WHY A REBUILD. Migration 553 allows only `granted`, `paused` and `ended`,
-- and holds `program_key` to the nine keys of D982's grid. A studio-only
-- program's key is any registry key (D955's `PROGRAM_KEY_RE`, at most 60
-- characters), so the key check becomes the registry's slug rule; whether the
-- program exists is the registry's (`programs`), which the routes read.
-- SQLite cannot widen a CHECK in place, so the table is rebuilt as 553 rebuilt
-- `licence_events`: every row is copied with its id, and D982's index is
-- recreated. No trigger and no foreign key names `program_grants`, so none is
-- lost; its history lives in `licence_events`, which this does not touch.
--
-- THE BACKFILL. Each proposal already approved for one studio gets its draft,
-- dated and attributed as its decision was, and one `program_changed` event
-- (`draft_opened`, `backfilled: true`), as an approval writes one from now on.
-- A proposal whose studio has no licence row any more gets none. Both inserts
-- skip what is already there, so the file can be applied twice.
--
-- Grep first (D689 D-t): no `proposal_uid` column and no `draft` grant state
-- exists in an earlier migration or in schema_baseline.sql.

CREATE TABLE IF NOT EXISTS program_grants_562 (
    id                        INTEGER PRIMARY KEY AUTOINCREMENT,
    uid                       TEXT NOT NULL UNIQUE,
    licence_id                INTEGER NOT NULL REFERENCES territory_licences(id) ON DELETE CASCADE,
    program_key               TEXT NOT NULL
                              CHECK (length(program_key) BETWEEN 1 AND 60 AND program_key NOT GLOB '*[^a-z0-9-]*'),
    state                     TEXT NOT NULL CHECK (state IN ('draft', 'granted', 'paused', 'ended')),
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
    schedule_contract_uid     TEXT,
    schedule_signed_at        TEXT,
    note                      TEXT CHECK (note IS NULL OR length(note) <= 2000),
    paused_at                 TEXT,
    ended_at                  TEXT,
    set_by_user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    set_at                    TEXT NOT NULL,
    created_at                TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (licence_id, program_key)
);

INSERT INTO program_grants_562 (
    id, uid, licence_id, program_key, state, starts_on, ends_on, ends_with_licence, capacity_cap, capacity_uncapped,
    cohorts_per_year, credits_per_quarter, fee_cents, currency, hq_share_bps, hq_approves_each_cohort,
    hq_approval_above_cents, playbook, brand, reporting, requires_signed_schedule, schedule_contract_uid,
    schedule_signed_at, note, paused_at, ended_at, set_by_user_id, set_at, created_at)
SELECT
    id, uid, licence_id, program_key, state, starts_on, ends_on, ends_with_licence, capacity_cap, capacity_uncapped,
    cohorts_per_year, credits_per_quarter, fee_cents, currency, hq_share_bps, hq_approves_each_cohort,
    hq_approval_above_cents, playbook, brand, reporting, requires_signed_schedule, schedule_contract_uid,
    schedule_signed_at, note, paused_at, ended_at, set_by_user_id, set_at, created_at
  FROM program_grants;

DROP TABLE program_grants;

ALTER TABLE program_grants_562 RENAME TO program_grants;

CREATE INDEX IF NOT EXISTS idx_program_grants_program ON program_grants(program_key, state);

-- The proposal a draft was opened for (D955's `program_proposals.uid`); NULL
-- on every grant HQ made from its grid. Added after the rebuild, so that a
-- second application, whose rebuild leaves it out, adds it again.
ALTER TABLE program_grants ADD COLUMN proposal_uid TEXT;

-- One draft per proposal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_program_grants_proposal ON program_grants(proposal_uid) WHERE proposal_uid IS NOT NULL;

-- ─────────────────────────────────────────────── the backfill

-- The copy above does not carry `proposal_uid`, so a second application
-- would leave it NULL. A studio-only program's key is unique in
-- the registry, so its proposal is found again from the licence and the key.
UPDATE program_grants
   SET proposal_uid = (SELECT p.uid FROM program_proposals p JOIN territory_licences l ON l.uid = p.licence_uid
                        WHERE l.id = program_grants.licence_id AND p.program_key = program_grants.program_key
                          AND p.status = 'approved' AND p.decision = 'studio')
 WHERE proposal_uid IS NULL
   AND EXISTS (SELECT 1 FROM program_proposals p JOIN territory_licences l ON l.uid = p.licence_uid
                WHERE l.id = program_grants.licence_id AND p.program_key = program_grants.program_key
                  AND p.status = 'approved' AND p.decision = 'studio');

INSERT OR IGNORE INTO program_grants (uid, licence_id, program_key, state, proposal_uid, set_by_user_id, set_at)
SELECT lower(hex(randomblob(16))), l.id, p.program_key, 'draft', p.uid,
       (SELECT u.id FROM users u WHERE u.id = p.decided_by_user_id),
       COALESCE(p.decided_at, p.updated_at)
  FROM program_proposals p
  JOIN territory_licences l ON l.uid = p.licence_uid
 WHERE p.status = 'approved' AND p.decision = 'studio' AND p.program_key IS NOT NULL;

INSERT INTO licence_events (licence_id, event, detail_json, note, actor_user_id, created_at)
SELECT g.licence_id, 'program_changed',
       json_object('action', 'draft_opened', 'program_key', g.program_key, 'proposal_uid', g.proposal_uid,
                   'changed', json_array(json_object('key', 'state', 'before', NULL, 'after', 'draft')),
                   'backfilled', json('true')),
       'Opened by migration 562 for a proposal HQ approved for this studio only before drafts existed.',
       g.set_by_user_id, g.set_at
  FROM program_grants g
 WHERE g.state = 'draft' AND g.proposal_uid IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM licence_events e
                    WHERE e.licence_id = g.licence_id AND e.event = 'program_changed'
                      AND json_valid(e.detail_json)
                      AND json_extract(e.detail_json, '$.action') = 'draft_opened'
                      AND json_extract(e.detail_json, '$.proposal_uid') = g.proposal_uid);

-- D5059 (#5059, user licences 3/4 under #5047) — program entitlements derived from held user licences.
--
-- THREE THINGS ARE KEPT APART, as the issue asks:
--   · ELIGIBILITY: which licence types may access a program. A versioned rule per program and licence type
--     (`program_licence_rules`). The issue's examples are seeded below as data (`origin = 'seed_d5059'`); the
--     evaluation (services/programEntitlements.ts) holds no program or licence name.
--   · THE GRANT: HQ's actual assignment of a program to an account (`user_program_grants`). One row per account and
--     program, whatever number of licences make it eligible, so a multi-licence account never holds a duplicate.
--     The row names no licence: the licences that source it are derived on every read from what is held then.
--   · LEGAL READINESS: a rule may require an executed program licence agreement (`agreement_required`). The
--     agreement is D5048's `licence_program_agreements` row on the SOURCE licence's uid (slot
--     `program_licence:<program>`), which D5057 lets a user licence anchor. Nothing here writes it.
-- Suspension and termination are the licence's own status (D5058); this file adds no copy of it.
--
-- TERRITORY PROGRAM GRANTS (`program_grants`, migration 553) are untouched: they are what HQ grants a studio, keyed
-- on the territory licence. This file reads and writes none of them.
--
-- RULES ARE VERSIONED CONFIGURATION. A change is a new version of the (program, licence type) pair, never an
-- edit: the rows are append-only (triggers). The version in force on a day is the highest version whose
-- `effective_from` is on or before it; a version dated later is scheduled. `eligible = 0` is a version that
-- withdraws a type's eligibility, recorded with its reason like any other.

CREATE TABLE IF NOT EXISTS program_licence_rules (
  uid                 TEXT PRIMARY KEY,
  program_key         TEXT NOT NULL CHECK (length(program_key) BETWEEN 1 AND 60 AND program_key NOT GLOB '*[^a-z0-9-]*'),
  licence_type        TEXT NOT NULL CHECK (licence_type IN ('founder', 'investor', 'operating_partner', 'advisor')),
  version             INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  eligible            INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  agreement_required  INTEGER NOT NULL CHECK (agreement_required IN (0, 1)),
  effective_from      TEXT NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason              TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  origin              TEXT NOT NULL CHECK (origin IN ('seed_d5059', 'hq')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (program_key, licence_type, version),
  -- A version that withdraws eligibility requires nothing.
  CHECK (eligible = 1 OR agreement_required = 0)
);
CREATE INDEX IF NOT EXISTS idx_program_licence_rules_type ON program_licence_rules (licence_type, program_key, version);

CREATE TRIGGER IF NOT EXISTS program_licence_rules_no_update
BEFORE UPDATE ON program_licence_rules
BEGIN
  SELECT RAISE(ABORT, 'program_licence_rules rows are append-only (D5059): a change is the next version.');
END;

CREATE TRIGGER IF NOT EXISTS program_licence_rules_no_delete
BEFORE DELETE ON program_licence_rules
BEGIN
  SELECT RAISE(ABORT, 'program_licence_rules rows are append-only (D5059).');
END;

CREATE TABLE IF NOT EXISTS user_program_grants (
  uid                 TEXT PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id),
  program_key         TEXT NOT NULL CHECK (length(program_key) BETWEEN 1 AND 60 AND program_key NOT GLOB '*[^a-z0-9-]*'),
  state               TEXT NOT NULL CHECK (state IN ('granted', 'paused', 'ended')),
  revision            INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- One grant per account and program: the union of licences never yields a second row.
  UNIQUE (user_id, program_key)
);

-- Every change moves the revision by exactly one, and the identity is frozen.
CREATE TRIGGER IF NOT EXISTS user_program_grants_revision
BEFORE UPDATE ON user_program_grants
WHEN NEW.revision <> OLD.revision + 1 OR NEW.uid <> OLD.uid OR NEW.user_id <> OLD.user_id OR NEW.program_key <> OLD.program_key
BEGIN
  SELECT RAISE(ABORT, 'user_program_grants: the identity is frozen and each change moves revision by one (D5059).');
END;

CREATE TRIGGER IF NOT EXISTS user_program_grants_no_delete
BEFORE DELETE ON user_program_grants
BEGIN
  SELECT RAISE(ABORT, 'user_program_grants rows are never deleted; end the grant instead (D5059).');
END;

CREATE TABLE IF NOT EXISTS user_program_grant_events (
  id                 INTEGER PRIMARY KEY,
  grant_uid          TEXT NOT NULL REFERENCES user_program_grants(uid),
  user_id            INTEGER NOT NULL,
  program_key        TEXT NOT NULL,
  action             TEXT NOT NULL CHECK (action IN ('grant', 'pause', 'resume', 'end')),
  from_state         TEXT,
  to_state           TEXT NOT NULL,
  revision           INTEGER NOT NULL,
  -- The licences that sourced the program when the write was made (uids, JSON array). A record, not a cache:
  -- every read derives the sources afresh.
  sources_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sources_json)),
  reason             TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  actor_id           INTEGER,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_user_program_grant_events_user ON user_program_grant_events (user_id, id);

CREATE TRIGGER IF NOT EXISTS user_program_grant_events_no_update
BEFORE UPDATE ON user_program_grant_events
BEGIN
  SELECT RAISE(ABORT, 'user_program_grant_events rows are append-only (D5059).');
END;

CREATE TRIGGER IF NOT EXISTS user_program_grant_events_no_delete
BEFORE DELETE ON user_program_grant_events
BEGIN
  SELECT RAISE(ABORT, 'user_program_grant_events rows are append-only (D5059).');
END;

-- THE SEED: the issue's example policies, version 1 of each pair, as data HQ may version. Program keys are the
-- Programs catalogue's (migration 553). Which seeded program requires an agreement is a policy input too (D5059 §3):
-- the venture-building programs and investor cohorts, after #5047's "stronger program-specific agreements".
-- INSERT OR IGNORE on the pair's version 1, so a second run inserts nothing.
INSERT OR IGNORE INTO program_licence_rules (uid, program_key, licence_type, version, eligible, agreement_required, effective_from, reason, origin)
VALUES
  ('plr_seed_founder_spinout-lab',              'spinout-lab',       'founder',           1, 1, 1, '2026-11-12', 'Seeded from the #5059 example policy for the Founder licence.', 'seed_d5059'),
  ('plr_seed_founder_ai-native-venture',        'ai-native-venture', 'founder',           1, 1, 1, '2026-11-12', 'Seeded from the #5059 example policy for the Founder licence.', 'seed_d5059'),
  ('plr_seed_founder_learning',                 'learning',          'founder',           1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Founder licence.', 'seed_d5059'),
  ('plr_seed_founder_perks',                    'perks',             'founder',           1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Founder licence.', 'seed_d5059'),
  ('plr_seed_founder_refer-and-earn',           'refer-and-earn',    'founder',           1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Founder licence.', 'seed_d5059'),
  ('plr_seed_investor_investor-cohorts',        'investor-cohorts',  'investor',          1, 1, 1, '2026-11-12', 'Seeded from the #5059 example policy for the Investor licence.', 'seed_d5059'),
  ('plr_seed_investor_referral-partners',       'referral-partners', 'investor',          1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Investor licence.', 'seed_d5059'),
  ('plr_seed_investor_learning',                'learning',          'investor',          1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Investor licence.', 'seed_d5059'),
  ('plr_seed_investor_perks',                   'perks',             'investor',          1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Investor licence.', 'seed_d5059'),
  ('plr_seed_advisor_mentor-cohorts',           'mentor-cohorts',    'advisor',           1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Advisor licence.', 'seed_d5059'),
  ('plr_seed_advisor_learning',                 'learning',          'advisor',           1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Advisor licence.', 'seed_d5059'),
  ('plr_seed_operating_partner_spinout-lab',    'spinout-lab',       'operating_partner', 1, 1, 1, '2026-11-12', 'Seeded from the #5059 example policy for the Operating Partner licence.', 'seed_d5059'),
  ('plr_seed_operating_partner_ai-native-venture', 'ai-native-venture', 'operating_partner', 1, 1, 1, '2026-11-12', 'Seeded from the #5059 example policy for the Operating Partner licence.', 'seed_d5059'),
  ('plr_seed_operating_partner_mentor-cohorts', 'mentor-cohorts',    'operating_partner', 1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Operating Partner licence.', 'seed_d5059'),
  ('plr_seed_operating_partner_learning',       'learning',          'operating_partner', 1, 1, 0, '2026-11-12', 'Seeded from the #5059 example policy for the Operating Partner licence.', 'seed_d5059');

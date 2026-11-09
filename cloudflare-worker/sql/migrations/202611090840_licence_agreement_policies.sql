-- 202611090840 — D5052 (#5052, part 5 of #5047): which agreement a package or program needs, when it must be
-- signed, and the history of a licence's legal readiness. Named by its UTC minute (D4106).
--
-- THREE NEW TABLES. Nothing existing changes shape.
--
--   licence_agreement_policies          HQ's configuration for one package or program, VERSIONED: every
--                                       change is a new row (version n+1), never an update. A row says:
--                                         strategy    per_program | package_master | none
--                                         legal_gate  optional | required_before_grant | required_before_in_force
--                                         programs_json             (package) the programs the package includes
--                                         required_schedules_json   (package_master) the included programs that
--                                                                   also need their own schedule under the master
--   licence_agreement_policy_holdings   the policy version a LICENCE holds for a package or program, frozen when
--                                       the package offer was accepted or the program granted. A later policy
--                                       version reaches no existing holder: the holding names its version. A new
--                                       acceptance (a move to another package, or HQ re-accepting on purpose)
--                                       writes a new holding and marks the old one superseded, once.
--   licence_legal_events                append-only: policy versioned, policy frozen on a licence, replacement
--                                       required, replacement prepared, legal gate satisfied / unsatisfied. The
--                                       agreement's own lifecycle (drafted, sent, executed, voided, superseded)
--                                       stays in `licence_agreement_events` (D5048); the history route reads both.
--
-- NO SEED AND NO BACKFILL. A program or package with no policy row has no recorded strategy, and a licence with
-- no holding has no frozen one: both read as "not recorded" and keep the D1120/D4805 schedule rule, exactly as
-- before this file. Nothing here infers a strategy for a grant made before it.
--
-- `licence_uid` holds `territory_licences.uid` until #5057, as in D5048 (no foreign key, so #5057 can repoint it).

CREATE TABLE IF NOT EXISTS licence_agreement_policies (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                      TEXT NOT NULL UNIQUE,
  scope_kind               TEXT NOT NULL CHECK (scope_kind IN ('program', 'package')),
  scope_key                TEXT NOT NULL CHECK (length(scope_key) BETWEEN 1 AND 60 AND scope_key NOT GLOB '*[^a-z0-9_-]*'),
  version                  INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  strategy                 TEXT NOT NULL CHECK (strategy IN ('per_program', 'package_master', 'none')),
  legal_gate               TEXT NOT NULL CHECK (legal_gate IN ('optional', 'required_before_grant', 'required_before_in_force')),
  programs_json            TEXT,
  required_schedules_json  TEXT,
  reason                   TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  created_at               TEXT NOT NULL,
  created_by_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- A master agreement is a package's; a program's own policy is per program or none.
  CHECK (strategy <> 'package_master' OR scope_kind = 'package'),
  -- Nothing to sign means nothing to gate on.
  CHECK (strategy <> 'none' OR legal_gate = 'optional'),
  -- Only a package lists programs, and only a package master lists schedules.
  CHECK (scope_kind = 'package' OR (programs_json IS NULL AND required_schedules_json IS NULL)),
  CHECK (strategy = 'package_master' OR required_schedules_json IS NULL),
  UNIQUE (scope_kind, scope_key, version)
);

CREATE TRIGGER IF NOT EXISTS licence_agreement_policies_append_only_update
BEFORE UPDATE ON licence_agreement_policies
BEGIN
  SELECT RAISE(ABORT, 'licence_agreement_policies is versioned (D5052): write a new version, never change one.');
END;

CREATE TRIGGER IF NOT EXISTS licence_agreement_policies_append_only_delete
BEFORE DELETE ON licence_agreement_policies
BEGIN
  SELECT RAISE(ABORT, 'licence_agreement_policies keeps every version (D5052).');
END;

CREATE TABLE IF NOT EXISTS licence_agreement_policy_holdings (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  licence_uid         TEXT NOT NULL,
  scope_kind          TEXT NOT NULL CHECK (scope_kind IN ('program', 'package')),
  scope_key           TEXT NOT NULL,
  policy_uid          TEXT NOT NULL REFERENCES licence_agreement_policies(uid),
  policy_version      INTEGER NOT NULL CHECK (policy_version >= 1),
  origin              TEXT NOT NULL CHECK (origin IN ('program_granted', 'package_offer_accepted')),
  package_offer_uid   TEXT,
  frozen_at           TEXT NOT NULL,
  frozen_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  superseded_at       TEXT,
  superseded_by_uid   TEXT
);

-- One current holding per licence and scope; superseded ones are history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_agreement_policy_holdings_current
  ON licence_agreement_policy_holdings (licence_uid, scope_kind, scope_key) WHERE superseded_at IS NULL;
-- One current PACKAGE per licence (D5048 owner question 1, answer A: one package master slot).
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_agreement_policy_holdings_one_package
  ON licence_agreement_policy_holdings (licence_uid) WHERE scope_kind = 'package' AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_licence_agreement_policy_holdings_licence
  ON licence_agreement_policy_holdings (licence_uid, id);

-- The frozen version never changes; the only write a holding takes is being superseded, once.
CREATE TRIGGER IF NOT EXISTS licence_agreement_policy_holdings_frozen
BEFORE UPDATE ON licence_agreement_policy_holdings
WHEN OLD.uid IS NOT NEW.uid OR OLD.licence_uid IS NOT NEW.licence_uid OR OLD.scope_kind IS NOT NEW.scope_kind
  OR OLD.scope_key IS NOT NEW.scope_key OR OLD.policy_uid IS NOT NEW.policy_uid OR OLD.policy_version IS NOT NEW.policy_version
  OR OLD.origin IS NOT NEW.origin OR OLD.package_offer_uid IS NOT NEW.package_offer_uid
  OR OLD.frozen_at IS NOT NEW.frozen_at OR OLD.frozen_by_user_id IS NOT NEW.frozen_by_user_id
  OR OLD.superseded_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'licence_agreement_policy_holdings: a frozen policy version never changes (D5052). Accept again to hold a new one.');
END;

CREATE TRIGGER IF NOT EXISTS licence_agreement_policy_holdings_block_delete
BEFORE DELETE ON licence_agreement_policy_holdings
BEGIN
  SELECT RAISE(ABORT, 'licence_agreement_policy_holdings keeps every holding (D5052).');
END;

CREATE TABLE IF NOT EXISTS licence_legal_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  licence_uid     TEXT,
  action          TEXT NOT NULL CHECK (action IN (
                    'policy_versioned', 'policy_frozen', 'replacement_required', 'replacement_prepared',
                    'gate_satisfied', 'gate_unsatisfied')),
  scope_kind      TEXT CHECK (scope_kind IS NULL OR scope_kind IN ('program', 'package')),
  scope_key       TEXT,
  program_key     TEXT,
  package_key     TEXT,
  policy_uid      TEXT,
  policy_version  INTEGER,
  agreement_uid   TEXT,
  agreement_revision INTEGER,
  -- For replacement_required: the grant terms revision the executed agreement no longer matches (one line per revision).
  terms_revision  INTEGER,
  actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT,
  detail_json     TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licence_legal_events_licence ON licence_legal_events (licence_uid, id);
CREATE INDEX IF NOT EXISTS idx_licence_legal_events_scope ON licence_legal_events (scope_kind, scope_key, id);
-- A replacement is required once per executed agreement and grant terms revision, however often it is detected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_legal_events_replacement_once
  ON licence_legal_events (agreement_uid, terms_revision) WHERE action = 'replacement_required';

CREATE TRIGGER IF NOT EXISTS licence_legal_events_block_update
BEFORE UPDATE ON licence_legal_events
BEGIN
  SELECT RAISE(ABORT, 'licence_legal_events is append-only (D5052). Append the correcting event.');
END;

CREATE TRIGGER IF NOT EXISTS licence_legal_events_block_delete
BEFORE DELETE ON licence_legal_events
BEGIN
  SELECT RAISE(ABORT, 'licence_legal_events is append-only (D5052).');
END;

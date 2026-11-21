-- D6686 (#6686, E6 of #6680): the formation case store.
--
-- An incorporation was a payment row with two hand steps. A case gives it
-- stages, a party it is waiting on and a timeline. One service writes every
-- stage change and the order status it projects to
-- (cloudflare-worker/src/services/formationCase.ts). The paid orders already
-- on record get their cases in 202611151734_6686_formation_cases_backfill.sql.
--
-- The runtime mirror of these four tables is ensureIncorporationsSchema in
-- cloudflare-worker/src/services/incorporations.ts; the two declare the same
-- columns.

CREATE TABLE IF NOT EXISTS formation_cases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                   TEXT NOT NULL UNIQUE,
  user_id               INTEGER NOT NULL,
  intent                TEXT NOT NULL CHECK (intent IN ('convert_project', 'incorporate_company', 'new_company')),
  project_id            INTEGER,
  company_id            INTEGER,
  track                 TEXT NOT NULL CHECK (track IN ('legacy_v1', 'v2')),
  path                  TEXT CHECK (path IS NULL OR path IN ('simple', 'specialist')),
  stage                 TEXT NOT NULL CHECK (stage IN ('draft', 'options_shown', 'chosen', 'structure_review', 'details', 'quoted', 'paid', 'preparing', 'ready_to_file', 'submitted', 'registry_query', 'registered', 'activating', 'handed_off')),
  stage_entered_at      TEXT NOT NULL DEFAULT (datetime('now')),
  waiting_on            TEXT NOT NULL DEFAULT 'nobody' CHECK (waiting_on IN ('founder', 'hq', 'partner', 'counsel', 'registry', 'nobody')),
  hold_reason           TEXT,
  form_key              TEXT,
  catalogue_version_id  INTEGER,
  structure_gate        TEXT,
  partner_id            INTEGER,
  hq_owner_user_id      INTEGER,
  revision              INTEGER NOT NULL DEFAULT 0,
  closed_at             TEXT,
  close_reason          TEXT CHECK (close_reason IS NULL OR close_reason IN ('cancelled', 'declined', 'rejected', 'refunded', 'handed_off', 'abandoned')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One open v2 case per project and per company. Legacy cases are exempt: a
-- project may hold several paid orders, each with its own case.
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_cases_open_project
  ON formation_cases(project_id) WHERE track = 'v2' AND closed_at IS NULL AND project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_cases_open_company
  ON formation_cases(company_id) WHERE track = 'v2' AND closed_at IS NULL AND company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_formation_cases_user ON formation_cases(user_id, stage);

-- The orders a case was paid with. incorporation_id is a plain integer with no
-- declared foreign key, so a later rebuild of incorporations is safe. A
-- retried payment adds a row.
CREATE TABLE IF NOT EXISTS formation_case_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id           INTEGER NOT NULL,
  incorporation_id  INTEGER NOT NULL UNIQUE,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formation_case_orders_case ON formation_case_orders(case_id);

-- The playbook's record of each stage: who is responsible, the named owner,
-- the evidence, and who completed it and when.
CREATE TABLE IF NOT EXISTS formation_case_stages (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id            INTEGER NOT NULL,
  stage              TEXT NOT NULL,
  responsible_role   TEXT,
  owner_user_id      INTEGER,
  evidence_json      TEXT,
  completed_by       INTEGER,
  completed_at       TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (case_id, stage)
);

-- Append-only timeline. A stage change carries to_revision, the case's
-- revision after it; two events can never claim the same one.
CREATE TABLE IF NOT EXISTS formation_case_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  at              TEXT NOT NULL DEFAULT (datetime('now')),
  actor_user_id   INTEGER,
  party           TEXT NOT NULL CHECK (party IN ('founder', 'hq', 'partner', 'counsel', 'registry', 'system')),
  kind            TEXT NOT NULL,
  from_stage      TEXT,
  to_stage        TEXT,
  to_revision     INTEGER,
  visibility      TEXT NOT NULL DEFAULT 'hq_only' CHECK (visibility IN ('all', 'hq_partner', 'hq_only')),
  detail_json     TEXT
);
CREATE INDEX IF NOT EXISTS idx_formation_case_events_case ON formation_case_events(case_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_case_events_revision
  ON formation_case_events(case_id, to_revision) WHERE to_revision IS NOT NULL;

-- Orders the backfill left without a case because their status is none of the
-- five it knows. The backfill's report: read it, never write it by hand.
CREATE TABLE IF NOT EXISTS formation_backfill_skips (
  incorporation_id  INTEGER PRIMARY KEY,
  status            TEXT,
  recorded_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

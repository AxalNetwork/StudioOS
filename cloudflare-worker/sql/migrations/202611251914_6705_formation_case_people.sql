-- D6705: private formation participants, capital, consent and screening.
CREATE TABLE IF NOT EXISTS formation_case_people (
  id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))), case_id INTEGER NOT NULL REFERENCES formation_cases(id),
  name TEXT NOT NULL, user_id INTEGER REFERENCES users(id), residence_country TEXT,
  nationality TEXT, date_of_birth TEXT, notice_email TEXT, ownership_bps INTEGER NOT NULL CHECK(typeof(ownership_bps)='integer' AND ownership_bps BETWEEN 0 AND 10000),
  is_entity INTEGER NOT NULL CHECK(is_entity IN (0,1)),
  verification_state TEXT NOT NULL DEFAULT 'unverified', verification_reference TEXT,
  verified_by_party TEXT, verified_at TEXT, notice_sent_at TEXT,
  notice_partner_id INTEGER REFERENCES partners(id), consent_to_act_at TEXT,
  removed_at TEXT, revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_formation_people_case ON formation_case_people(case_id);
CREATE TABLE IF NOT EXISTS formation_case_person_roles (
  person_id INTEGER NOT NULL REFERENCES formation_case_people(id) ON DELETE CASCADE,
  role TEXT NOT NULL, PRIMARY KEY(person_id, role)
);
CREATE TABLE IF NOT EXISTS formation_case_capital (
  case_id INTEGER PRIMARY KEY REFERENCES formation_cases(id), amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0),
  currency TEXT NOT NULL, share_count INTEGER NOT NULL CHECK(share_count > 0),
  evidence_document_id INTEGER REFERENCES documents(id)
);
CREATE TABLE IF NOT EXISTS formation_case_consents (
  id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL REFERENCES formation_cases(id),
  kind TEXT NOT NULL, partner_id INTEGER NOT NULL REFERENCES partners(id), scope TEXT NOT NULL,
  text_hash TEXT NOT NULL, lawful_basis_key TEXT NOT NULL, given_by INTEGER NOT NULL REFERENCES users(id),
  given_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, withdrawn_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_formation_consent_active ON formation_case_consents(case_id, kind, partner_id, scope) WHERE withdrawn_at IS NULL;
CREATE TABLE IF NOT EXISTS formation_case_screenings (
  id INTEGER PRIMARY KEY, person_id INTEGER NOT NULL REFERENCES formation_case_people(id),
  person_revision INTEGER NOT NULL, checkpoint TEXT NOT NULL, provider_lists TEXT NOT NULL,
  severity TEXT NOT NULL, matches TEXT NOT NULL, screened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by INTEGER REFERENCES users(id), decided_at TEXT, decision TEXT, hq_reason TEXT
);
CREATE INDEX IF NOT EXISTS ix_formation_screenings_person ON formation_case_screenings(person_id, person_revision, id);
CREATE TRIGGER IF NOT EXISTS formation_details_ownership
BEFORE UPDATE OF stage ON formation_cases
WHEN OLD.track = 'v2' AND OLD.stage = 'details' AND NEW.stage IN ('quoted','paid')
AND (SELECT coalesce(sum(ownership_bps),0) FROM formation_case_people WHERE case_id = OLD.id AND removed_at IS NULL) <> 10000
BEGIN
  SELECT RAISE(ABORT, 'formation_ownership_incomplete');
END;

-- HQ can place a hold without advancing revision. Check again in the stage
-- transaction, after the potentially asynchronous lists read.
CREATE TRIGGER IF NOT EXISTS formation_checkpoint_hold
BEFORE UPDATE OF stage ON formation_cases
WHEN OLD.track = 'v2' AND NEW.stage <> OLD.stage AND NEW.stage IN ('paid','submitted')
AND (OLD.hold_reason IS NOT NULL OR OLD.closed_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'formation_checkpoint_held');
END;

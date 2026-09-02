-- 204 — proof of what an advisor claims, and the consent behind it.
--
-- WHAT IS MISSING TODAY. The Expertise canvas's Proof zone distinguishes what
-- an advisor SAYS about their work from what somebody else has CONFIRMED about
-- it. `AdvisorBucketRoutes.jsx` renders that zone as a hardcoded empty state
-- because there is no record of either — no claim, and no attestation over it.
--
-- MODELLED ON `reference_checks` (`sql/t13_t14_t15.sql:202`), which is the one
-- table in this repository that records consent as a fact rather than as an
-- assumption: `consent_given`, `consent_given_at`, `consent_text`,
-- `consent_captured_by`. Same subject shape, different object — a reference
-- check attests to a DEAL, these attest to a claim an advisor makes about their
-- own work. Copying its consent columns verbatim means the two can be audited
-- by the same query.
--
-- ATTESTED IS DERIVED, NEVER STORED. Whether an item is attested is "a consent
-- row exists for it with consent_given = 1", computed at read time. A boolean
-- on the item would be a second source of truth for the same fact, and the two
-- would disagree the first time a consent was withdrawn through any path that
-- forgot to clear the flag. The item carries only what the ADVISOR asserts; the
-- consent row carries what the ATTESTER confirmed, and only the attester's own
-- row can say the second thing.
--
-- WITHDRAWAL IS A STATE, NOT A DELETE. `consent_given` going back to 0 with
-- `withdrawn_at` set keeps the record that consent was once given and then
-- taken back. Deleting the row would erase the fact that it happened, and an
-- attestation that can silently vanish is not evidence of anything.
--
-- NO OUTBOUND MAIL HERE. A request is recorded with `requested_at` and a token;
-- who delivers it is a separate decision and not one this migration takes.

CREATE TABLE IF NOT EXISTS advisor_proof_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  advisor_id INTEGER NOT NULL REFERENCES advisors(id),
  kind TEXT NOT NULL DEFAULT 'engagement'
    CHECK (kind IN ('engagement', 'outcome', 'role', 'credential')),
  title TEXT NOT NULL,
  detail TEXT,
  organization TEXT,
  period_note TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_advisor_proof_items_advisor
  ON advisor_proof_items(advisor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS advisor_proof_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  proof_item_id INTEGER NOT NULL REFERENCES advisor_proof_items(id),
  attester_name TEXT NOT NULL,
  attester_email TEXT,
  attester_role TEXT,
  relationship TEXT,
  requested_at TEXT,
  requested_by INTEGER,
  request_token TEXT UNIQUE,
  consent_given INTEGER NOT NULL DEFAULT 0,
  consent_given_at TEXT,
  consent_text TEXT,
  consent_captured_by INTEGER,
  statement TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_advisor_proof_consents_item
  ON advisor_proof_consents(proof_item_id, consent_given);

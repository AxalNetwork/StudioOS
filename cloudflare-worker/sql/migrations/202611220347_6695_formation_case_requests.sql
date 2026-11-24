-- D6695 (#6695, plan key E10 of #6680): requests on a formation case.
--
-- HQ or a partner asks the founder (or one another) for a document, an
-- answer, a signature, an identity check, a payment or an approval, and the
-- answer stays on the case. It is not messaging: every request is tied to the
-- evidence that answers it. One service writes this table
-- (cloudflare-worker/src/services/formationRequests.ts): each change is a
-- conditional UPDATE on (state, revision), plus a formation_case_events row
-- and the case's waiting_on, in one batch.
--
-- A note is not a row here: it is a formation_case_events row of kind 'note'
-- with its own visibility (202611151733_6686_formation_cases.sql).
--
-- New table only. Nothing on formation_cases, formation_case_events or
-- formation_filings changes shape here.

CREATE TABLE IF NOT EXISTS formation_case_requests (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                  TEXT NOT NULL UNIQUE,
  case_id              INTEGER NOT NULL,
  asked_by_party       TEXT NOT NULL CHECK (asked_by_party IN ('hq', 'partner', 'counsel')),
  asked_by_user_id     INTEGER NOT NULL,
  asked_of_party       TEXT NOT NULL CHECK (asked_of_party IN ('founder', 'hq', 'partner', 'counsel')),
  -- The person asked. For the founder it is the case's owner.
  asked_of_user_id     INTEGER,
  kind                 TEXT NOT NULL CHECK (kind IN ('document', 'answer', 'signature', 'identity', 'payment', 'approval')),
  title                TEXT NOT NULL,
  body                 TEXT,
  due_on               TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  state                TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'answered', 'accepted', 'returned', 'cancelled')),
  answer_text          TEXT,
  -- A document or signature answer: a documents row already stored through the
  -- classified upload (services/recordStore.ts). This table holds no bytes.
  answer_document_id   INTEGER,
  -- An identity request: only the partner's own reference for its check (owner decision 13, S1).
  partner_reference    TEXT,
  -- An approval: the hash the asker bound it to, and the filing whose pack it is.
  bound_sha256         TEXT CHECK (bound_sha256 IS NULL OR (length(bound_sha256) = 64 AND bound_sha256 NOT GLOB '*[^0-9a-f]*')),
  filing_id            INTEGER,
  return_reason        TEXT,
  -- The case's waiting_on before the first of the requests open with this one,
  -- and the case revision it was read at; the last to close restores it.
  prior_waiting_on     TEXT NOT NULL CHECK (prior_waiting_on IN ('founder', 'hq', 'partner', 'counsel', 'registry', 'nobody')),
  prior_case_revision  INTEGER NOT NULL,
  answered_by          INTEGER,
  answered_at          TEXT,
  closed_by            INTEGER,
  closed_at            TEXT,
  -- Each change adds one; a change is written only from the revision it read.
  revision             INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  -- An identity request carries no file.
  CHECK (kind <> 'identity' OR answer_document_id IS NULL),
  -- Only an approval is bound to a hash, and an approval always is.
  CHECK (kind = 'approval' OR (bound_sha256 IS NULL AND filing_id IS NULL)),
  CHECK (kind <> 'approval' OR bound_sha256 IS NOT NULL),
  CHECK (state <> 'returned' OR return_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_formation_case_requests_case ON formation_case_requests(case_id, state, id);
CREATE INDEX IF NOT EXISTS idx_formation_case_requests_asked_of ON formation_case_requests(asked_of_user_id, state);

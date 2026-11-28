-- D6710 (#6710, P2 of the global incorporation plan #6680): which partner
-- firm a formation case is offered to, and what the firm is told when the
-- case leaves it.
--
--   formation_case_assignments  one offer of one service on a case to one
--                               firm, and what became of it: offered, then
--                               accepted / declined / expired / withdrawn,
--                               and an accepted one later completed or
--                               withdrawn (a reassignment).
--   formation_partner_notices   a deletion or return request sent to a firm
--                               whose assignment ended, and the firm's
--                               acknowledgement.
--
-- The rules are the service's (services/formationAssignments.ts): who may be
-- offered a case, the re-screen before an offer, the access check
-- `canAccessFormationCase`, and the batch a reassignment writes. Tested in
-- cloudflare-worker/test/formation_assignments_6710.test.ts.
--
-- Grep first: no table named formation_case_assignments or
-- formation_partner_notices exists in schema_baseline.sql or any migration.
-- Additive only: two new tables and their indexes, each `IF NOT EXISTS`.

CREATE TABLE IF NOT EXISTS formation_case_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  case_id INTEGER NOT NULL REFERENCES formation_cases(id),
  formation_partner_id INTEGER NOT NULL REFERENCES formation_partners(id),
  -- The firm's `partners.id`, the id formation_cases.partner_id and
  -- formation_case_consents.partner_id carry. Copied from formation_partners
  -- in the same statement that writes the row.
  partner_id INTEGER NOT NULL REFERENCES partners(id),
  service TEXT NOT NULL CHECK (service IN (
    'formation', 'registered_agent', 'registered_office', 'company_secretary',
    'resident_director', 'contact_person', 'identity_verification',
    'structure_memo', 'tax_registration', 'bank_introduction')),
  state TEXT NOT NULL DEFAULT 'offered'
    CHECK (state IN ('offered', 'accepted', 'declined', 'expired', 'withdrawn', 'completed')),
  offered_by INTEGER NOT NULL REFERENCES users(id),
  offered_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- UTC, 'YYYY-MM-DD HH:MM:SS'. An offer not accepted by then expires.
  expires_at TEXT NOT NULL,
  -- Who answered the offer and when: the firm's member on accept or decline,
  -- HQ on a withdrawal before an answer, nobody (NULL) on an expiry.
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  -- An accepted assignment that ended: completed, or withdrawn by HQ.
  ended_by INTEGER REFERENCES users(id),
  ended_at TEXT,
  end_reason TEXT,
  replaces_assignment_id INTEGER REFERENCES formation_case_assignments(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- One live (offered or accepted) assignment per case and service.
CREATE UNIQUE INDEX IF NOT EXISTS idx_formation_case_assignments_live
  ON formation_case_assignments(case_id, service) WHERE state IN ('offered', 'accepted');
CREATE INDEX IF NOT EXISTS idx_formation_case_assignments_partner
  ON formation_case_assignments(formation_partner_id, state);
CREATE INDEX IF NOT EXISTS idx_formation_case_assignments_expiry
  ON formation_case_assignments(expires_at) WHERE state = 'offered';

CREATE TABLE IF NOT EXISTS formation_partner_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  case_id INTEGER NOT NULL REFERENCES formation_cases(id),
  assignment_id INTEGER NOT NULL REFERENCES formation_case_assignments(id),
  formation_partner_id INTEGER NOT NULL REFERENCES formation_partners(id),
  kind TEXT NOT NULL CHECK (kind IN ('deletion_request', 'return_request')),
  -- 'awaiting_counsel' until counsel-approved wording exists: the request is
  -- recorded and nothing is sent. 'sent' carries sent_at.
  delivery TEXT NOT NULL DEFAULT 'awaiting_counsel' CHECK (delivery IN ('awaiting_counsel', 'sent')),
  sent_at TEXT,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_by INTEGER REFERENCES users(id),
  acknowledged_at TEXT,
  acknowledgement_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_formation_partner_notices_partner
  ON formation_partner_notices(formation_partner_id, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_formation_partner_notices_case
  ON formation_partner_notices(case_id);

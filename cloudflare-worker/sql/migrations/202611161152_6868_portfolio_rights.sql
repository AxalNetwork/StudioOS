-- D6868 (#6868, the build of the #6228 brief): an investor's rights in a
-- company they hold, beyond the reporting duties, each with its document and
-- clause, and the investor's request that HQ record one.
--
--   portfolio_rights          one right one holder has in one company, as HQ
--                             recorded it from the signed paper at closing:
--                             its type (pro rata, information rights, board
--                             seat, observer seat, liquidation preference or
--                             anti-dilution), the document's title, the
--                             clause, the terms in words, and the date the
--                             document was signed when known. One row per
--                             company, holder and type. A type with no row is
--                             "Not recorded at closing" on read, never "none".
--   portfolio_right_requests  an investor asks HQ to record a right of one
--                             type, saying where it is written. Open until HQ
--                             answers it: recorded (linking the right it
--                             recorded) or declined (with the reason the
--                             investor reads). One open request per company,
--                             investor and type, held by the partial unique
--                             index below, not only by the route.
--
-- The reporting duties stay in `reporting_duties` (migration 579): this table
-- does not repeat them.
--
-- MONEY. Neither table holds an amount. A pro rata share or a preference
-- multiple is written in the terms, as the document says it.
--
-- Grep first (D689 D-t): no `portfolio_rights` or `portfolio_right_requests`
-- table, and no rights column on `portfolio_positions`, `closing_lines` or
-- `reporting_duties`, exists in schema_baseline.sql or any migration.
--
-- Additive and idempotent: CREATE ... IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS portfolio_rights (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  holder_user_id     INTEGER NOT NULL REFERENCES users(id),
  right_type         TEXT NOT NULL CHECK (right_type IN ('pro_rata', 'information_rights', 'board_seat', 'observer_seat', 'liquidation_preference', 'anti_dilution')),
  document_title     TEXT NOT NULL CHECK (length(trim(document_title)) BETWEEN 1 AND 200),
  clause             TEXT CHECK (clause IS NULL OR length(clause) <= 120),
  terms              TEXT NOT NULL CHECK (length(trim(terms)) BETWEEN 1 AND 500),
  signed_on          TEXT CHECK (signed_on IS NULL OR (length(signed_on) = 10 AND date(signed_on) = signed_on)),
  recorded_by        INTEGER REFERENCES users(id),
  recorded_at        TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_rights_one_per_type
  ON portfolio_rights (project_id, holder_user_id, right_type);

CREATE TABLE IF NOT EXISTS portfolio_right_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id),
  requester_user_id  INTEGER NOT NULL REFERENCES users(id),
  right_type         TEXT NOT NULL CHECK (right_type IN ('pro_rata', 'information_rights', 'board_seat', 'observer_seat', 'liquidation_preference', 'anti_dilution')),
  description        TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
  state              TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'recorded', 'declined')),
  answered_by        INTEGER REFERENCES users(id),
  answered_at        TEXT,
  right_uid          TEXT,
  answer_note        TEXT CHECK (answer_note IS NULL OR length(answer_note) <= 2000),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  -- An open request carries no answer; an answered one says who and when.
  CHECK ((state = 'open') = (answered_at IS NULL)),
  CHECK ((state = 'open') = (answered_by IS NULL)),
  -- Only a recorded request links a right, and it always does; a decline always says why.
  CHECK ((state = 'recorded') = (right_uid IS NOT NULL)),
  CHECK (state <> 'declined' OR answer_note IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_portfolio_right_requests_one_open
  ON portfolio_right_requests (project_id, requester_user_id, right_type) WHERE state = 'open';

CREATE INDEX IF NOT EXISTS ix_portfolio_right_requests_state
  ON portfolio_right_requests (state, created_at);

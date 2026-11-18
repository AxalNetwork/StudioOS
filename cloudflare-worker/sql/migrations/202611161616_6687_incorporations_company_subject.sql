-- D6687 (#6687, plan key E7 of #6680): an order's subject may be a company.
--
-- An order needed a project. The owner wants a company with no legal record
-- to be incorporated directly, so `incorporations` is rebuilt:
--   project_id          now nullable (an order for a company has none);
--   subject_company_id  new, nullable → company_profiles(id): the company the
--                       order is FOR, set when it is placed;
--   CHECK               project_id IS NOT NULL OR subject_company_id IS NOT NULL.
-- `company_id` keeps its meaning (685, D1415): the company the filing linked
-- or created, NULL until the order is filed.
--
-- The plan's one table rebuild (SQLite cannot drop NOT NULL in place). Every
-- other column, default, foreign key and the UNIQUE are as the baseline, 411
-- and 685 left them; every row is copied with its id; both indexes are
-- recreated. Nothing references `incorporations` by foreign key
-- (`formation_case_orders.incorporation_id` is a plain integer, D6686), and no
-- trigger is defined on it.
--
-- THE COPY IS CHECKED BEFORE THE OLD TABLE GOES: the row count, the sum of
-- `amount_cents` and the set of `stripe_session_id` must be equal in both, or
-- the CHECK on `_incorporations_rebuild_6687` aborts the batch and nothing
-- changes. D1 applies this file as one batch. No BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS incorporations_new (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                  INTEGER NOT NULL,
  project_id               INTEGER,
  jurisdiction_id          TEXT NOT NULL,
  company_name             TEXT NOT NULL,
  registered_agent_name    TEXT,
  registered_agent_address TEXT,
  amount_cents             INTEGER NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'usd',
  stripe_session_id        TEXT UNIQUE,
  stripe_payment_intent    TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending_payment',
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  paid_at                  TIMESTAMP,
  packet_document_id       INTEGER REFERENCES documents(id),
  packet_ready_at          TEXT,
  packet_ready_by          INTEGER REFERENCES users(id),
  filed_on                 TEXT,
  filed_recorded_at        TEXT,
  filed_by                 INTEGER REFERENCES users(id),
  company_id               INTEGER REFERENCES company_profiles(id),
  subject_company_id       INTEGER REFERENCES company_profiles(id),
  CHECK (project_id IS NOT NULL OR subject_company_id IS NOT NULL)
);

INSERT INTO incorporations_new (id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name, registered_agent_address,
    amount_cents, currency, stripe_session_id, stripe_payment_intent, status, created_at, updated_at, paid_at,
    packet_document_id, packet_ready_at, packet_ready_by, filed_on, filed_recorded_at, filed_by, company_id, subject_company_id)
  SELECT id, user_id, project_id, jurisdiction_id, company_name, registered_agent_name, registered_agent_address,
    amount_cents, currency, stripe_session_id, stripe_payment_intent, status, created_at, updated_at, paid_at,
    packet_document_id, packet_ready_at, packet_ready_by, filed_on, filed_recorded_at, filed_by, company_id, NULL
  FROM incorporations;

CREATE TABLE IF NOT EXISTS _incorporations_rebuild_6687 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _incorporations_rebuild_6687 (ok)
  SELECT CASE WHEN (SELECT COUNT(*) FROM incorporations) = (SELECT COUNT(*) FROM incorporations_new)
    AND (SELECT COALESCE(SUM(amount_cents), 0) FROM incorporations) = (SELECT COALESCE(SUM(amount_cents), 0) FROM incorporations_new)
    AND NOT EXISTS (SELECT stripe_session_id FROM incorporations WHERE stripe_session_id IS NOT NULL
                    EXCEPT SELECT stripe_session_id FROM incorporations_new WHERE stripe_session_id IS NOT NULL)
    AND NOT EXISTS (SELECT stripe_session_id FROM incorporations_new WHERE stripe_session_id IS NOT NULL
                    EXCEPT SELECT stripe_session_id FROM incorporations WHERE stripe_session_id IS NOT NULL)
  THEN 1 ELSE 0 END;
DROP TABLE _incorporations_rebuild_6687;

DROP TABLE incorporations;

ALTER TABLE incorporations_new RENAME TO incorporations;

CREATE INDEX IF NOT EXISTS idx_incorporations_user_status ON incorporations(user_id, status);
CREATE INDEX IF NOT EXISTS idx_incorporations_subject_company ON incorporations(subject_company_id) WHERE subject_company_id IS NOT NULL;

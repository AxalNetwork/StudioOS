-- 202611212328 — D5585 part 8 (#5585, WorkGraph P1 under #5577): the per-company release-authority store, the owner's
-- answer A of 2026-11-21 to D5585-p7 §3. Named by its UTC minute and its issue (D4106, D5398).
-- Decision: documentation/architecture/decisions/D5585-p8.md.
--
--   work_graph_release_authority_events   one row per grant or revocation of one release authority (`maintainer`,
--                                         `brand_owner`, `marketing_lead`, `founder`, `partner`, `counsel`,
--                                         `authorized_signatory`, `security_officer`) to one person in one tenant and
--                                         company, with who did it, when and why.
--
-- ONE APPEND-ONLY TABLE, LIKE `work_graph_release_decisions`. Who holds an authority now is the latest row of its key
-- (tenant, company, user, authority): a grant is held, a revocation is not. A revocation is a later row, never an
-- edit or a delete, so the history is the store. `seq` numbers the rows of one key 1, 2, 3…; grants and revocations
-- alternate, so an odd `seq` is a grant and an even one a revocation (CHECK), and a row must be the next number of its
-- key (trigger). A writer names the `seq` it saw: two writers racing on one key cannot both land.
--
-- The authority names are the release services' vocabulary (`POLICY_PROFILES`, `REQUIREMENT_AUTHORITY`,
-- `TAKEDOWN_AUTHORITIES`); the CHECK refuses any other, and a test pins the two lists together. Ids and codes only: the
-- reason is the Super Admin's own sentence, at most 500 characters. Additive only: dropping the table returns every
-- release route to resolving no authority (D5585-p7 §3); nothing else reads it.

CREATE TABLE IF NOT EXISTS work_graph_release_authority_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  user_id INTEGER NOT NULL CHECK (user_id > 0),
  authority TEXT NOT NULL CHECK (authority IN ('maintainer', 'brand_owner', 'marketing_lead', 'founder', 'partner',
    'counsel', 'authorized_signatory', 'security_officer')),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  op TEXT NOT NULL CHECK (op IN ('grant', 'revoke')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  actor_user_id INTEGER NOT NULL CHECK (actor_user_id > 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  CHECK ((op = 'grant') = (seq % 2 = 1)),
  UNIQUE (tenant_id, company_id, user_id, authority, seq),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_authority_events_company ON work_graph_release_authority_events (company_id, tenant_id);

CREATE TRIGGER IF NOT EXISTS work_graph_release_authority_events_next_seq
BEFORE INSERT ON work_graph_release_authority_events
WHEN NEW.seq <> 1 + COALESCE((SELECT MAX(x.seq) FROM work_graph_release_authority_events x
                                WHERE x.tenant_id = NEW.tenant_id AND x.company_id = NEW.company_id
                                  AND x.user_id = NEW.user_id AND x.authority = NEW.authority), 0)
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_authority_events.seq: a row must be the next of its key (D5585 part 8).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_authority_events_append_only
BEFORE UPDATE ON work_graph_release_authority_events
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_authority_events is append-only; revoke with a new row (D5585 part 8).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_authority_events_no_delete
BEFORE DELETE ON work_graph_release_authority_events
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_authority_events is append-only (D5585 part 8).');
END;

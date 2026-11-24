-- D6697 (#6697, H1 of #6680): HQ's formation case reads.
--
-- formation_case_access_log: one row each time a read returns a case's people,
-- documents or answers (the assigned HQ owner or a Super Admin). Append-only.
--
-- formation_case_waiting_log: when a case started waiting on each party. Nothing
-- recorded this before: formation_cases.waiting_on holds only the present value,
-- and its writers (formationCase.ts, formationRequests.ts) record no waiting_on in
-- their events. Two triggers write a row when a case is created and whenever its
-- waiting_on changes, so no writer is edited. Each existing case gets one row,
-- source 'migration', dated when this migration runs: its earlier waiting history
-- is not recorded, and services/formationQueue.ts says so rather than guessing it.
-- Append-only.

CREATE TABLE IF NOT EXISTS formation_case_access_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  viewer_user_id  INTEGER NOT NULL,
  what            TEXT NOT NULL CHECK (what IN ('people', 'documents', 'answers')),
  at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formation_case_access_log_case ON formation_case_access_log(case_id, id);
CREATE TRIGGER IF NOT EXISTS formation_case_access_log_no_update BEFORE UPDATE ON formation_case_access_log
BEGIN SELECT RAISE(ABORT, 'formation_case_access_log: append only'); END;
CREATE TRIGGER IF NOT EXISTS formation_case_access_log_no_delete BEFORE DELETE ON formation_case_access_log
BEGIN SELECT RAISE(ABORT, 'formation_case_access_log: append only'); END;

CREATE TABLE IF NOT EXISTS formation_case_waiting_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id   INTEGER NOT NULL,
  party     TEXT NOT NULL CHECK (party IN ('founder', 'hq', 'partner', 'counsel', 'registry', 'nobody')),
  at        TEXT NOT NULL,
  source    TEXT NOT NULL CHECK (source IN ('created', 'changed', 'migration'))
);
CREATE INDEX IF NOT EXISTS idx_formation_case_waiting_log_case ON formation_case_waiting_log(case_id, id);
CREATE TRIGGER IF NOT EXISTS formation_case_waiting_log_no_update BEFORE UPDATE ON formation_case_waiting_log
BEGIN SELECT RAISE(ABORT, 'formation_case_waiting_log: append only'); END;
CREATE TRIGGER IF NOT EXISTS formation_case_waiting_log_no_delete BEFORE DELETE ON formation_case_waiting_log
BEGIN SELECT RAISE(ABORT, 'formation_case_waiting_log: append only'); END;

CREATE TRIGGER IF NOT EXISTS formation_cases_waiting_created AFTER INSERT ON formation_cases
BEGIN
  INSERT INTO formation_case_waiting_log (case_id, party, at, source) VALUES (NEW.id, NEW.waiting_on, NEW.created_at, 'created');
END;
CREATE TRIGGER IF NOT EXISTS formation_cases_waiting_changed AFTER UPDATE OF waiting_on ON formation_cases
WHEN NEW.waiting_on IS NOT OLD.waiting_on
BEGIN
  INSERT INTO formation_case_waiting_log (case_id, party, at, source) VALUES (NEW.id, NEW.waiting_on, datetime('now'), 'changed');
END;

-- Existing cases: their present party, from now. Earlier history is not recorded.
INSERT INTO formation_case_waiting_log (case_id, party, at, source)
  SELECT c.id, c.waiting_on, datetime('now'), 'migration' FROM formation_cases c
   WHERE NOT EXISTS (SELECT 1 FROM formation_case_waiting_log w WHERE w.case_id = c.id);

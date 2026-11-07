-- #4678 (D4678): a licence carries a revision, and `terminated` is terminal.
--
-- Every lifecycle write (activate, suspend, reinstate, renew, terminate, and
-- the compliance sweep's suspend) used to validate a status it had read
-- earlier and then UPDATE by id. A request that read `suspended` could
-- therefore reinstate a licence another request had terminated in the
-- meantime. `revision` is the compare-and-swap token: each write states the
-- revision it read, bumps it, and checks that exactly one row changed.
-- Edits to territory, seats and terms bump it too, so an activation that
-- passed its prerequisites on an older revision loses to the edit.
ALTER TABLE territory_licences ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

-- Terminated is final. No path, stale or not, turns it back into another status.
CREATE TRIGGER IF NOT EXISTS trg_licence_terminated_is_terminal
BEFORE UPDATE OF status ON territory_licences
WHEN OLD.status = 'terminated' AND NEW.status <> 'terminated'
BEGIN
  SELECT RAISE(ABORT, 'licence_terminated');
END;

-- A terminated licence cannot gain or change an administrator binding. The
-- appointment route also refuses it with a 409; this is the floor under it.
CREATE TRIGGER IF NOT EXISTS trg_licence_admins_not_on_terminated_insert
BEFORE INSERT ON licence_admins
WHEN (SELECT status FROM territory_licences WHERE id = NEW.licence_id) = 'terminated'
BEGIN
  SELECT RAISE(ABORT, 'licence_terminated');
END;

CREATE TRIGGER IF NOT EXISTS trg_licence_admins_not_on_terminated_update
BEFORE UPDATE ON licence_admins
WHEN (SELECT status FROM territory_licences WHERE id = NEW.licence_id) = 'terminated'
BEGIN
  SELECT RAISE(ABORT, 'licence_terminated');
END;

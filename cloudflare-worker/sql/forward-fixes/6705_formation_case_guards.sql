-- D8532 forward fix for migrations/202611251914_6705_formation_case_people.sql (#6705).
--
-- That migration adds two triggers on formation_cases, which the rollback
-- classifier calls manual recovery. If the migration applied and the Worker
-- publish then failed, the earlier Worker serves a schema that holds them. They
-- only refuse a v2 case move: out of `details` while the recorded ownership is
-- not 100%, and into `paid` or `submitted` while the case is held or closed.
-- Both fail closed, and nothing in this file loosens them.
--
-- The fix restores the two guards exactly as the migration wrote them, in case
-- a recovery dropped or changed one to unblock the earlier Worker. It is safe
-- to run any number of times and changes nothing on a database that already
-- holds them. It writes no row.
DROP TRIGGER IF EXISTS formation_details_ownership;
CREATE TRIGGER IF NOT EXISTS formation_details_ownership
BEFORE UPDATE OF stage ON formation_cases
WHEN OLD.track = 'v2' AND OLD.stage = 'details' AND NEW.stage IN ('quoted','paid')
AND (SELECT coalesce(sum(ownership_bps),0) FROM formation_case_people WHERE case_id = OLD.id AND removed_at IS NULL) <> 10000
BEGIN
  SELECT RAISE(ABORT, 'formation_ownership_incomplete');
END;

DROP TRIGGER IF EXISTS formation_checkpoint_hold;
CREATE TRIGGER IF NOT EXISTS formation_checkpoint_hold
BEFORE UPDATE OF stage ON formation_cases
WHEN OLD.track = 'v2' AND NEW.stage <> OLD.stage AND NEW.stage IN ('paid','submitted')
AND (OLD.hold_reason IS NOT NULL OR OLD.closed_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'formation_checkpoint_held');
END;

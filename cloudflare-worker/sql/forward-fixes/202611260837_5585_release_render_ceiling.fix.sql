-- Forward fix for 202611260837_5585_release_render_ceiling.sql (D5585-p15, #5585).
--
-- When to run it: the Worker was rolled back past #5585 part 15 while the migration stays applied (D1 is never rolled
-- back). The previous Worker records a render approval without a ceiling, and the pairing trigger refuses that row.
-- Dropping the trigger lets the previous Worker record render approvals again. The column stays and is read by
-- nothing. Re-shipping part 15 re-adds the trigger through a new migration, never by hand.
--
-- Idempotent: dropping a trigger that does not exist changes nothing. The release-window rehearsal runs it on the
-- migrated database and on a clean build (D8532, step 5).

DROP TRIGGER IF EXISTS work_graph_release_decisions_render_ceiling;

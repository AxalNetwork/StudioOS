-- D5069 (#5069) — a Use of Funds scenario has a revision, so an edit made from
-- a stale read is refused instead of replacing newer work.
--
--   uof_scenarios.revision  starts at 0 and goes up by one on every write that
--       changes the scenario or what hangs off it: a scenario edit, a split
--       save, a milestone added, changed or removed, and a scenario made the
--       Base. A client reads it with the scenario and sends it back as
--       `expected_revision`; a write whose revision is not the stored one
--       changes no row and answers 409 `changed_since_open`.
--
-- Existing scenarios read 0.

ALTER TABLE uof_scenarios ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

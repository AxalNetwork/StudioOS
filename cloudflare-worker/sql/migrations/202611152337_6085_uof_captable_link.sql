-- D6085 (#6085) — a Use of funds scenario names the cap-table scenario it
-- assumes ("Paid for by", RA-32).
--
--   uof_scenarios.cap_table_scenario_uid  the linked cap_table_scenarios.uid,
--       or NULL when no link is stored (Not linked, today's default). It is a
--       plain uid, not a foreign key: a cap-table scenario can be deleted, and
--       the plan then reads the link as deleted ("Link broken") instead of
--       losing it silently. A link is only written to a scenario of the same
--       project, and only read back from one.
--   uof_scenarios.cap_table_linked_at / cap_table_linked_by  when and by whom
--       the link was last set or cleared.
--
-- Existing scenarios read NULL: Not linked.

ALTER TABLE uof_scenarios ADD COLUMN cap_table_scenario_uid TEXT;
ALTER TABLE uof_scenarios ADD COLUMN cap_table_linked_at TEXT;
ALTER TABLE uof_scenarios ADD COLUMN cap_table_linked_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_uof_scenarios_cap_table ON uof_scenarios(project_id, cap_table_scenario_uid);

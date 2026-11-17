-- D6686 part 2 (#6686): the stage record of every case already on record.
--
-- The owner's answer (2026-11-16): every stage but draft through quoted keeps a
-- formation_case_stages row. transition() opens a row on entering such a stage
-- and completes it on leaving (services/formationCase.ts); ensureCaseForOrder
-- opens the row of a case it makes. Cases already on record (the backfill,
-- 202611151734_6686) get the row of the stage they are at now; the stages they
-- passed before this ran are in their timeline (formation_case_events), not
-- here. INSERT OR IGNORE: running it twice changes nothing.

INSERT OR IGNORE INTO formation_case_stages (case_id, stage, responsible_role)
SELECT c.id, c.stage,
  CASE c.stage
    WHEN 'submitted' THEN 'registry'
    WHEN 'registry_query' THEN 'registry'
    WHEN 'handed_off' THEN 'founder'
    ELSE 'hq'
  END
FROM formation_cases c
WHERE c.stage IN ('paid', 'preparing', 'ready_to_file', 'submitted', 'registry_query', 'registered', 'activating', 'handed_off');

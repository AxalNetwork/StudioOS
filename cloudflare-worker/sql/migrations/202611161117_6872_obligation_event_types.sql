-- D6872 (#6872): Grow stores a compliance obligation under event_type 'compliance', apart from 'other'.
-- Rows Grow wrote before carry kind = 'compliance' over event_type 'other', so they can be told apart and move.
-- A row with event_type 'other' and no kind (Calendar or older) cannot, and keeps reading as compliance.
-- OR IGNORE keeps UNIQUE(project_id, event_type, due_date): a row whose move would clash with a compliance row
-- already due that day is skipped and stays where it is. It names no date column, so it applies to every shape
-- of compliance_events the migration chain can leave (check-migration-column-shapes).
UPDATE OR IGNORE compliance_events SET event_type = 'compliance'
 WHERE kind = 'compliance' AND event_type = 'other';

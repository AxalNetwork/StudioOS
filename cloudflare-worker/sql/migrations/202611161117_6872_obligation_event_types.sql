-- D6872 (#6872): Grow stores a compliance obligation under event_type 'compliance', apart from 'other'.
-- Rows Grow wrote before carry kind = 'compliance' over event_type 'other', so they can be told apart and move.
-- A row with event_type 'other' and no kind (Calendar or older) cannot, and keeps reading as compliance.
-- The NOT EXISTS keeps UNIQUE(project_id, event_type, due_date): a clash leaves that row where it is.
UPDATE compliance_events SET event_type = 'compliance'
 WHERE kind = 'compliance' AND event_type = 'other'
   AND NOT EXISTS (SELECT 1 FROM compliance_events o
                    WHERE o.project_id IS compliance_events.project_id
                      AND o.due_date = compliance_events.due_date
                      AND o.event_type = 'compliance');

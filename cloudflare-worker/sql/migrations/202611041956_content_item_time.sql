-- D4489: optional planned wall-clock time; never schedules a send.
ALTER TABLE content_calendar_items ADD COLUMN planned_at_time TEXT CHECK (planned_at_time IS NULL OR (length(planned_at_time) = 5 AND planned_at_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(planned_at_time, 1, 2) <= '23'));

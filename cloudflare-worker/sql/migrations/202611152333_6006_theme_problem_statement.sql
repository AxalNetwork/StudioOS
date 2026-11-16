-- D6006 (#6006, canvas V19): a theme's problem statement, in three fields the founder writes:
-- who has the problem, how they cope with it today, and what it costs them. Each is NULL until
-- written (Not recorded, never an empty string). The writer stamps who saved it and when.
ALTER TABLE pain_groups ADD COLUMN statement_who TEXT;
ALTER TABLE pain_groups ADD COLUMN statement_cope TEXT;
ALTER TABLE pain_groups ADD COLUMN statement_cost TEXT;
ALTER TABLE pain_groups ADD COLUMN statement_updated_at TEXT;
ALTER TABLE pain_groups ADD COLUMN statement_updated_by INTEGER;

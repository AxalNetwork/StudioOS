-- D6562: legacy agreements remain unknown; only a newly rendered contract records its source inputs.
ALTER TABLE licence_contracts ADD COLUMN terms_revision INTEGER;
ALTER TABLE licence_contracts ADD COLUMN schedule_revision INTEGER;
ALTER TABLE licence_contracts ADD COLUMN terms_snapshot_json TEXT;

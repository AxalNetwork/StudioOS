-- D5354 (#5354): identify CRM-driven deal moves while actor_user_id stays
-- NULL. Values are closed to the three inbound CRM writers.
ALTER TABLE deal_stage_events ADD COLUMN source TEXT
  CHECK (source IS NULL OR source IN ('hubspot', 'salesforce', 'affinity'));

-- D5984 (#5984): one GitHub bug per section incident episode. The Slack
-- channel and thread stay on this row (channel_id, message_ts) and are never sent.
ALTER TABLE section_incident_outbox ADD COLUMN incident_case TEXT;
ALTER TABLE section_incident_outbox ADD COLUMN classification TEXT;
-- NULL: nothing filed. 'filing': a durable intent written before the create
-- call; left in place when the outcome is unknown, it blocks every new filing
-- until an operator reconciles it. 'linked': github_issue is the bug.
ALTER TABLE section_incident_outbox ADD COLUMN github_state TEXT CHECK (github_state IN ('filing', 'linked'));
ALTER TABLE section_incident_outbox ADD COLUMN github_issue INTEGER;
-- The count published in the body at filing, then the highest power of two
-- confirmed in a comment. github_milestone_pending is a comment sent whose
-- outcome is not yet confirmed; it is checked against its receipt, never resent.
ALTER TABLE section_incident_outbox ADD COLUMN github_milestone INTEGER;
ALTER TABLE section_incident_outbox ADD COLUMN github_milestone_pending INTEGER;
ALTER TABLE section_incident_outbox ADD COLUMN github_next_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE section_incident_outbox ADD COLUMN github_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_section_incident_github ON section_incident_outbox(github_state);

-- D6713 (#6713): additive obligation metadata; published catalogue rows stay immutable.
ALTER TABLE formation_steps ADD COLUMN pack_item_key TEXT;
ALTER TABLE compliance_events ADD COLUMN pack_item_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_formation_steps_pack_item ON formation_steps(project_id, pack_item_key) WHERE pack_item_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_compliance_events_pack_item ON compliance_events(pack_item_key) WHERE pack_item_key IS NOT NULL;
ALTER TABLE formation_pack_items ADD COLUMN obligation_phase TEXT CHECK (obligation_phase IN ('post_registration', 'ongoing'));
ALTER TABLE formation_pack_items ADD COLUMN source_id INTEGER REFERENCES formation_sources(id);
ALTER TABLE formation_pack_items ADD COLUMN checked_on TEXT;
ALTER TABLE formation_pack_items ADD COLUMN due_rule_json TEXT CHECK (due_rule_json IS NULL OR (json_valid(due_rule_json) AND source_id IS NOT NULL AND checked_on IS NOT NULL));
ALTER TABLE formation_pack_items ADD COLUMN event_kind TEXT;
ALTER TABLE formation_pack_items ADD COLUMN recurrence TEXT CHECK (recurrence IN ('annual', 'quarterly', 'monthly', 'one_time', 'event'));

-- #5314 part 3 (D4822): the Delivery records D4682 left without a revision get
-- one, so every Delivery edit can state the version it was read at.
--
-- D4682 gave milestones, blockers, deliverables, seats and status reports a
-- `revision`. The four stores below are upserts keyed by a natural key (the
-- engagement, the firm or person, the period), and D4682 left them out because
-- they "have no state to lose". They do: two people editing the same health
-- row, cap or month of hours each overwrite the other without either knowing.
--
-- From here a write that names the revision it read changes nothing when the
-- row has moved on, and answers 409 `delivery_changed` with the current one.
-- A write that names `expected_revision: null` says it read no row: it inserts
-- only while there still is none.
ALTER TABLE partner_engagement_health ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_capacity ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_internal_hours ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engagement_hours ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

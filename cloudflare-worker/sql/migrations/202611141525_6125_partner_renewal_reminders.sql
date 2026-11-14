-- D6125 (#6125): what Grow's daily step has sent for a partner's renewal.
-- JSON `{"on":"YYYY-MM-DD","sent":[30,7]}`: the renewal date the reminders
-- were sent for and the thresholds (days before) already sent for it. A
-- different `renewal_on` makes the record stale, so a changed date re-arms
-- both thresholds without any writer clearing this column. NULL: nothing sent.
-- Additive: no row is rewritten or backfilled.
ALTER TABLE growth_partners ADD COLUMN renewal_reminders_sent_json TEXT;

-- 182 — the three advisor columns migration 042 added to a table that has
-- never existed.
--
-- 042 ends with:
--
--     ALTER TABLE mentors ADD COLUMN topics_willing_json TEXT;
--     ALTER TABLE mentors ADD COLUMN topics_unwilling_json TEXT;
--     ALTER TABLE mentors ADD COLUMN weekly_hours_band TEXT;
--
-- There is no `CREATE TABLE mentors` anywhere in this repository. The naming
-- settled on `advisors`, and 042 was written against the earlier word; those
-- three statements have been failing since the day they shipped.
--
-- The code went the other way. `services/advisor/writeRouter.ts` routes
-- advisor.topics.willing / .unwilling / advisor.calendar.weekly_hours into
--
--     UPDATE advisors SET ${m.col} = ? …
--
-- and the answered-check reads the same three names back off
-- `SELECT * FROM advisors`. So the write throws, falls back to the
-- users.advisor_extras_json sidecar (the answer is kept, just untyped), the
-- caller is told status:'saved', and the read returns undefined — which means
-- the advisor is asked all three questions again, every session, forever.
--
-- The six sibling entries in the same map — display_name, bio, sectors_json,
-- expertise_json, hourly_rate_usd, linkedin_url — are all real columns and
-- work. The answered-check survives too, but only because it selects `*`
-- rather than a column list: had it named the columns, one unknown name would
-- have taken the whole row down and re-asked all nine.
--
-- Added rather than re-targeted because the intent is unambiguous and already
-- written down twice: 042 tried to create exactly these three columns, and the
-- router and the answered-check both name them on `advisors`. 042 itself is
-- left alone — it has already been applied, and rewriting an applied migration
-- is how two databases stop agreeing.

ALTER TABLE advisors ADD COLUMN topics_willing_json TEXT;
ALTER TABLE advisors ADD COLUMN topics_unwilling_json TEXT;
ALTER TABLE advisors ADD COLUMN weekly_hours_band TEXT;

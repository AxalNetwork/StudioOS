-- D5947 (#5947, revenue ledger slice 3 of #5038) — each stream a branch reports
-- carries its state, where the figure came from and when that source was read.
--
-- `subsidiary_usage_reports` (migration 260) stored a figure and a currency and
-- dropped the branch's sentence about it. Since D5947 a branch can MEASURE a
-- stream (subscriptions, from its own `financial_events` ledger through the
-- D5946 reader), so HQ has to be able to tell a measured figure from one read
-- over part of a quarter, and both from a stream nobody could measure.
--
--   state         complete | incomplete | not_recorded | not_available | unreadable
--                 (the same words the revenue read model, D5950, uses). NULL is a
--                 row a build before D5947 reported: its state was never sent.
--   reason        the branch's own sentence for that state, or NULL.
--   source        what the branch read the figure from (`financial_events`,
--                 `ai_usage_logs`), or `none` when it has no store for the stream.
--   source_as_of  when the branch read that source. `reported_at` stays the
--                 report's own stamp.
--
-- THE KEY IS NOT WIDENED. The table stays UNIQUE on (licence_uid, period,
-- stream), so a stream has one currency per period. A branch whose ledger holds
-- a stream in two currencies reports that stream `incomplete` (D5947 says why),
-- and no amount is ever summed across currencies.
ALTER TABLE subsidiary_usage_reports ADD COLUMN state TEXT
  CHECK (state IS NULL OR state IN ('complete', 'incomplete', 'not_recorded', 'not_available', 'unreadable'));
ALTER TABLE subsidiary_usage_reports ADD COLUMN reason TEXT;
ALTER TABLE subsidiary_usage_reports ADD COLUMN source TEXT;
ALTER TABLE subsidiary_usage_reports ADD COLUMN source_as_of TEXT;

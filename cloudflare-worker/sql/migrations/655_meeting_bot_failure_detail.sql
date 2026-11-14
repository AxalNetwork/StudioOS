-- 655 — where a meeting bot run failed (D1368).
--
-- `failure_code` keeps D886's member-facing codes, so `platform_blocked` and
-- an unrecognised Meet screen both read `runtime_failed`. This column keeps
-- the bot's own code and the last join step it reached, for example
-- `platform_blocked@meet_prejoin_result:unknown`. Codes only: the bot and the
-- Worker both refuse anything that is not lowercase code words, so no page
-- text, link, name or browser message is stored. Additive; nothing reads it
-- for access or billing.
ALTER TABLE meeting_bots ADD COLUMN failure_detail TEXT;

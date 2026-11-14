-- #5316 (D5316): a deliverable version the advisor has marked ready to send.
--
-- Versions recorded sent, opened and signed off only. The Practice v2 canvas
-- (D4874, "Backend required") draws a Ready filter and a "ready to send" row;
-- this is the fact behind them, recorded rather than derived.
--
--   ready_at           when this version was marked ready, or NULL.
--   ready_by_user_id   the account that marked it.
--
-- MARKING SENDS NOTHING. `POST /me/deliverables/:id/versions/:v/ready` stamps
-- both and nothing else; `DELETE` on the same path clears them. Sending the
-- version (`.../send`) clears both in the same UPDATE that stamps `sent_at`,
-- so a sent version is never also "ready", and an unsent one is ready only
-- while someone has said so.
--
-- NOT BACK-FILLED. A version that existed before these columns has no mark;
-- it is not ready until someone marks it.
ALTER TABLE advisor_deliverable_versions ADD COLUMN ready_at TEXT;
ALTER TABLE advisor_deliverable_versions ADD COLUMN ready_by_user_id INTEGER REFERENCES users(id);

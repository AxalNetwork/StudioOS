-- D5153 (#5153): how far a meeting bot run's runtime got before it started.
--
-- `failure_code` stays the member-facing coarse code (`runtime_unavailable`)
-- and `failure_detail` stays D1368's provider/runtime detail. These columns are
-- operator facts for HQ · Meeting bots, so a run that failed before Google
-- Meet, Zoom or Teams was contacted can be told apart without the Cloudflare
-- console:
--   runtime_stage            last startup stage reached (closed list, D5153)
--   runtime_stage_at         when it was recorded (epoch ms)
--   runtime_version          the meeting-bot Worker's deployed commit
--   runtime_error_code       the startup failure code (closed list, D5153)
--   runtime_callback_seen_at first signed callback from the runtime (epoch ms)
--   runtime_start_ms         dispatch to accepted (or failed) start, in ms
-- Codes and numbers only: the Worker writes nothing outside the allowlists,
-- so no link, page text, name, transcript, secret or signature is stored.
-- Additive; nothing reads these for access or billing. Rows before this
-- migration keep NULLs, which HQ reads as "not recorded".
ALTER TABLE meeting_bots ADD COLUMN runtime_stage TEXT;
ALTER TABLE meeting_bots ADD COLUMN runtime_stage_at INTEGER;
ALTER TABLE meeting_bots ADD COLUMN runtime_version TEXT;
ALTER TABLE meeting_bots ADD COLUMN runtime_error_code TEXT;
ALTER TABLE meeting_bots ADD COLUMN runtime_callback_seen_at INTEGER;
ALTER TABLE meeting_bots ADD COLUMN runtime_start_ms INTEGER;

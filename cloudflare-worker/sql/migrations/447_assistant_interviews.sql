-- 447 — D667: an interview submitted from the founder's own AI assistant
-- (#1497, part of #1495 / D665).
--
-- ChatGPT, Claude, Gemini or Grok submits an interview through StudioOS's MCP
-- server (D666). It lands as an ordinary interview session (migration 438)
-- with its transcript segments, and the assistant's placements land as
-- ordinary `validate_proposals` rows (214, widened by 246 and 439). There is
-- no second proposals table: what is new is only WHERE each row came from.
--
-- `interview_sessions.submitted_via` — NULL when the session was recorded in
--   StudioOS; otherwise the OAuth client id of the grant that submitted it.
--   The session's `channel` stays what the interview WAS (its CHECK admits
--   in_person / video / phone / text / manual), which is why the origin is a
--   column of its own and the table is not rebuilt.
-- `interview_sessions.submitted_via_name` — the client's registered name when
--   it submitted, for display. Self-declared by the client, so the page shows
--   it beside the grant's redirect host (D665).
-- `interview_sessions.submitted_summary` — the assistant's summary, when it
--   sent one. A note on the session, labelled as the assistant's: never a
--   transcript segment (it cannot be quoted) and never a placement.
-- `validate_proposals.source` — 'studioos' or 'assistant'. NULL rows were all
--   written by StudioOS before this column existed and read as 'studioos'.
--
-- Additive: ADD COLUMN only. D1 has no ADD COLUMN IF NOT EXISTS, so a re-run
-- stops at the first ALTER with "duplicate column name" and changes nothing;
-- the runner's ledger applies each file once.

ALTER TABLE interview_sessions ADD COLUMN submitted_via TEXT;
ALTER TABLE interview_sessions ADD COLUMN submitted_via_name TEXT;
ALTER TABLE interview_sessions ADD COLUMN submitted_summary TEXT;
ALTER TABLE validate_proposals ADD COLUMN source TEXT;

-- The daily limit counts a grant's submissions; this keeps that count cheap.
CREATE INDEX IF NOT EXISTS idx_interview_sessions_submitted_via
    ON interview_sessions (submitted_via, created_by_user_id, created_at);

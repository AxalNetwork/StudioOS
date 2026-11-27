-- Task #6 (CB) — Personal Advisor conversation state machine.
--
-- `advisor_state` is the per-(user, question) side-state used by the
-- deterministic state machine in `services/advisor/stateMachine.ts`:
--   - `last_asked_at`  — drives the 5-minute anti-repeat penalty so
--                        the same question can't be re-served back-to-
--                        back across conversations.
--   - `answer_count`   — bumped by `onAnswered()` for analytics /
--                        future "you've answered N this week" surfaces.
-- UNIQUE(user_id, question_id) gives ON CONFLICT upsert semantics
-- without us needing to round-trip a SELECT first.
--
-- The matching cross-conversation index on `advisor_answers` lets the
-- state machine ask "has THIS USER ever answered question X?" cheaply
-- — `advisor_answers` already carries `user_id`, but the existing
-- index is conversation-scoped only.
CREATE TABLE IF NOT EXISTS advisor_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  last_asked_at TEXT NOT NULL DEFAULT (datetime('now')),
  answer_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_advisor_state_user ON advisor_state(user_id);
CREATE INDEX IF NOT EXISTS idx_advisor_state_user_asked ON advisor_state(user_id, last_asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_advisor_answers_user_status ON advisor_answers(user_id, saved_status);

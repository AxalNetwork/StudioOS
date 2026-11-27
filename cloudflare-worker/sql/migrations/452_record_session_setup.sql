-- 452 — Record a session, set up in one call (D685 §5.1, §5.2; #1583).
--
-- Additive only: three columns on interview_sessions, one table, two indexes
-- and a backfill. No table is rebuilt, and there is no BEGIN or pragma.
--
-- interview_sessions.call_provider  how the call is held: zoom, google_meet,
--                                    teams, whatsapp, telegram, phone_speaker,
--                                    signal, paste, or NULL for in person.
--                                    The Worker checks it against the channel.
-- interview_sessions.meeting_url     a pasted video-call link, HTTPS, whose host
--                                    matches the provider. Never a scheduled
--                                    D684 call's link: that one is read from
--                                    interview_channel_refs.join_url.
-- interview_sessions.client_key      the setup call's idempotency key. A repeat
--                                    from the same member answers the same
--                                    session, so a double click opens one.
ALTER TABLE interview_sessions ADD COLUMN call_provider TEXT;
ALTER TABLE interview_sessions ADD COLUMN meeting_url TEXT;
ALTER TABLE interview_sessions ADD COLUMN client_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_sessions_client_key
  ON interview_sessions (created_by_user_id, client_key)
  WHERE client_key IS NOT NULL;

-- The talking points picked at setup, ticked during the session. `text` is a
-- snapshot of `code · claim`, so a later edit or retirement of the hypothesis
-- does not rewrite what was asked. `covered_offset_ms` is on the Worker's
-- clock, never the client's.
CREATE TABLE IF NOT EXISTS interview_session_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  hypothesis_id INTEGER REFERENCES hypotheses(id) ON DELETE SET NULL,
  text TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  covered_at TEXT,
  covered_offset_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_session_points_session
  ON interview_session_points (session_id, sort_order);

-- Interviews recorded before this change have no channel. Copy the channel of
-- each one's latest session (manual stays manual: the list reads it as
-- "Entered by hand").
UPDATE discovery_interviews
   SET channel = (
     SELECT s.channel FROM interview_sessions s
      WHERE s.interview_id = discovery_interviews.id
      ORDER BY s.created_at DESC, s.id DESC LIMIT 1)
 WHERE channel IS NULL
   AND EXISTS (SELECT 1 FROM interview_sessions s WHERE s.interview_id = discovery_interviews.id);

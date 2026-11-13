-- 438 — interview sessions: recording, live and final speech-to-text (D657, #1470).
--
-- A session hangs off one `discovery_interviews` row (migration 001/215), so
-- every venture's interviews get it, a Spin-Out Lab venture's included: a Lab
-- venture is an ordinary `projects` row. It does not touch
-- `spinout_application_interviews`, which are Lab admission interviews.
--
--   interview_sessions             one recording session: its channel, status,
--                                  consent to RECORD (distinct from
--                                  `quote_consent`, which is consent to quote),
--                                  detected language, the live and final models,
--                                  and the duration the server measured.
--   interview_session_chunks       the audio, as numbered R2 objects. The
--                                  primary key (session_id, seq) is what makes a
--                                  repeated upload of one chunk a no-op.
--   interview_session_marks        a moment the founder marked, at an offset.
--   interview_transcript_segments  the transcript, one passage per row:
--                                  source 'live' (a draft) or 'final'.
--   interview_session_receipts     one row per speech-to-text job: the model,
--                                  the minutes, the cost and any fallback.
--
-- Additive: CREATE TABLE IF NOT EXISTS only. No existing row is changed.

CREATE TABLE IF NOT EXISTS interview_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT UNIQUE NOT NULL,
  interview_id INTEGER NOT NULL REFERENCES discovery_interviews(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL,
  created_by_user_id INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_person', 'video', 'phone', 'text', 'manual')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'recording', 'paused', 'stopped', 'transcribing', 'transcribed', 'structured', 'reviewed')),
  consent_status TEXT NOT NULL DEFAULT 'not_recorded'
    CHECK (consent_status IN ('given', 'declined', 'not_recorded')),
  consent_method TEXT,
  consent_at TEXT,
  language TEXT,
  live_model TEXT,
  final_model TEXT,
  -- Server-measured: the sum of the recording intervals between start/resume
  -- and pause/stop, on the Worker's clock. Never a duration the client sent.
  active_ms INTEGER NOT NULL DEFAULT 0,
  recording_since TEXT,
  started_at TEXT,
  stopped_at TEXT,
  audio_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_interview ON interview_sessions(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_sessions_project ON interview_sessions(project_id);

CREATE TABLE IF NOT EXISTS interview_session_chunks (
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  start_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS interview_session_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  offset_ms INTEGER NOT NULL CHECK (offset_ms >= 0),
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_session_marks_session ON interview_session_marks(session_id);

CREATE TABLE IF NOT EXISTS interview_transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('live', 'final')),
  start_ms INTEGER,
  end_ms INTEGER,
  speaker_label TEXT NOT NULL DEFAULT 'Speaker ?',
  speaker_raw TEXT,
  text TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_transcript_segments_session ON interview_transcript_segments(session_id, source, start_ms);

CREATE TABLE IF NOT EXISTS interview_session_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('live', 'final')),
  model TEXT NOT NULL,
  requested_model TEXT,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  audio_minutes REAL NOT NULL DEFAULT 0,
  cost_microusd INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'failed')),
  refusal TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_session_receipts_session ON interview_session_receipts(session_id);

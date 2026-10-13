-- 453 — Record a session, processed without a button (D685 §5.6, §5.7, §5.9,
-- §5.10; #1584). Stop leads to the findings: upload → transcribe → summarise →
-- place findings, as a resumable job.
--
-- Additive only: columns on interview_sessions and interview_session_marks,
-- two tables, three indexes. No table is rebuilt, and there is no BEGIN or
-- pragma.

-- The pipeline's state. `processing_done/total` exist only where a count
-- exists (uploading and transcribing); summarising and placing carry none.
ALTER TABLE interview_sessions ADD COLUMN processing_stage TEXT
  CHECK (processing_stage IS NULL OR processing_stage IN ('uploading', 'transcribing', 'summarising', 'placing', 'done', 'failed'));
ALTER TABLE interview_sessions ADD COLUMN processing_done INTEGER;
ALTER TABLE interview_sessions ADD COLUMN processing_total INTEGER;
ALTER TABLE interview_sessions ADD COLUMN processing_error TEXT;
ALTER TABLE interview_sessions ADD COLUMN processing_updated_at TEXT;
ALTER TABLE interview_sessions ADD COLUMN processing_auto INTEGER;
ALTER TABLE interview_sessions ADD COLUMN expected_last_seq INTEGER;

-- StudioOS's own summary (never the assistant's `submitted_summary`, 447).
-- Each sentence cites transcript spans; the citations are kept beside it.
ALTER TABLE interview_sessions ADD COLUMN summary TEXT;
ALTER TABLE interview_sessions ADD COLUMN summary_model TEXT;
ALTER TABLE interview_sessions ADD COLUMN summarised_at TEXT;
ALTER TABLE interview_sessions ADD COLUMN summary_citations_json TEXT;

-- One row per transcribed chunk, so a retried job never bills a chunk twice.
CREATE TABLE IF NOT EXISTS interview_chunk_transcripts (
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  model TEXT NOT NULL,
  language TEXT,
  segments_json TEXT NOT NULL,
  cost_microusd INTEGER NOT NULL DEFAULT 0,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  transcribed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, seq)
);

-- The summary's receipt lines, as 446 holds structuring's.
CREATE TABLE IF NOT EXISTS interview_summary_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN ('summarised', 're_summarised')),
  model TEXT NOT NULL,
  requested_model TEXT,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_microusd INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused')),
  refusal TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interview_summary_receipts_session
  ON interview_summary_receipts (session_id);

-- §5.6: the member's active session, read on every page load.
CREATE INDEX IF NOT EXISTS idx_interview_sessions_creator_status
  ON interview_sessions (created_by_user_id, status);

-- §5.7: a mark posted twice (a retry after a dropped response) is stored once.
ALTER TABLE interview_session_marks ADD COLUMN client_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_session_marks_client_key
  ON interview_session_marks (session_id, client_key)
  WHERE client_key IS NOT NULL;

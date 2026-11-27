-- D866 §4 (#2618): the same provider-scoped hash as the pending message.
-- Existing passages have no provable source and remain NULL; never guess one.
ALTER TABLE interview_transcript_segments ADD COLUMN source_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_transcript_source_ref
  ON interview_transcript_segments(session_id, source_ref);

-- D1456 (#4014): record the actual failed processing step, never infer it from copy.
ALTER TABLE interview_sessions ADD COLUMN processing_failed_stage TEXT
  CHECK (processing_failed_stage IS NULL OR processing_failed_stage IN ('uploading','transcribing','summarising','placing'));

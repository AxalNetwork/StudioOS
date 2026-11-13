-- D4449: controlled failure reasons for abandoned or cancelled post-call jobs.
ALTER TABLE interview_output_jobs ADD COLUMN failure_reason TEXT;

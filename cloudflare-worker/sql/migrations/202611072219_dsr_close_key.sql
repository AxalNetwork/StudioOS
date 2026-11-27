-- D4675 (#4675): one key per HQ close of a data-subject request.
--
-- The close writes this key in the same batch as the outcome, the subject's
-- notice and the audit rows, so a repeat of the same close (a lost response,
-- a step-up retry) finds its own row and answers with it, instead of writing
-- a second notice or reading as a refusal.
--
-- NULL on every row written before this migration; the partial unique index
-- ignores NULLs, so nothing applied is changed.
ALTER TABLE dsr_requests ADD COLUMN close_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dsr_requests_close_key
    ON dsr_requests(close_key) WHERE close_key IS NOT NULL;

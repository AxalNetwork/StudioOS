-- D4675 (#4675): one key per trust-center Publish.
--
-- The Publish writes this key on its change row, in the same batch as the
-- content it publishes, so a repeat of the same Publish (a lost response, a
-- step-up retry) answers with the change already recorded instead of
-- "nothing to publish". The table is append-only (D1075); adding a column
-- edits no published row.
--
-- NULL on every row written before this migration; the partial unique index
-- ignores NULLs, so nothing applied is changed.
ALTER TABLE trust_content_changes ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_trust_content_changes_request_key
    ON trust_content_changes(request_key) WHERE request_key IS NOT NULL;

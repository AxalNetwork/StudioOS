-- D754 way B, part 2 (#1938): the import of a capture a linked member forwarded
-- to Axal's number, once they said everyone recorded agreed. Additive only:
-- three nullable columns on migration 492's `whatsapp_captures`.
--
--   project_id    the venture the draft interview opens in, set when the
--                 capture opens (S1 on #1938, 2026-10-19 09:28Z): the member's
--                 most recently updated venture until #1939 records a choice
--                 on their link. NULL when they hold none; the import then
--                 waits with `import_error = 'no_venture'`.
--   import_job    the job holding the import, claimed in one conditional
--                 UPDATE, so two deliveries of the same job never import twice.
--   import_error  a code when the import stopped (`no_venture`, `too_large`,
--                 `unsupported_format`, a provider's code), for the `fb`
--                 screens. A refusal never says more than its code.
--
-- No index: every read of these columns is by the capture's id or uid.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction. SQLite's ADD COLUMN is
-- not re-runnable; the runner applies this file once.

ALTER TABLE whatsapp_captures ADD COLUMN project_id INTEGER;
ALTER TABLE whatsapp_captures ADD COLUMN import_job TEXT;
ALTER TABLE whatsapp_captures ADD COLUMN import_error TEXT;

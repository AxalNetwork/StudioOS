-- D4860 question D = (b), #5304 — a managed key's expiry and last use.
--
-- `expires_at` is written only where the provider reports an expiry for the
-- key in place: the Super Admin types the date the provider's own console
-- shows when saving or rotating the key. No managed provider returns one
-- through any call the Worker makes (D4860 "Built (question D)" lists them),
-- so NULL is the common case and the page reads it as "Not recorded".
--
-- `last_used_at` is stamped by `markProviderKeyUsed` after a call that
-- authenticated with the key succeeded, at most once an hour per key.
--
-- A key held as a Worker secret has no secret in this table; its stamps sit on
-- a row whose `client_id` and `client_secret_enc` are both '' (no key
-- material). Every reader of a held key requires `client_secret_enc <> ''`.
-- A save or rotate from the console deletes the row, so a new key starts with
-- neither stamp.
--
-- Additive only. Every row written before this keeps NULL in both.
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

ALTER TABLE provider_oauth_keys ADD COLUMN expires_at TIMESTAMP;
ALTER TABLE provider_oauth_keys ADD COLUMN last_used_at TIMESTAMP;

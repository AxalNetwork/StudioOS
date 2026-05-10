-- Task #2 — DocuSign e-sign integration.
--
-- Extends `esign_envelopes` with a `provider` discriminator, the remote
-- DocuSign envelope id, and the DocuSign account id (so the cron sweep
-- can scope its in-flight query per-tenant instead of globally).
--
-- IDEMPOTENCY MODEL FOR THIS PROJECT:
--   D1 SQLite has no `IF NOT EXISTS` for `ALTER TABLE … ADD COLUMN`.
--   The codebase convention (see replit.md "After a deploy") is that
--   one-shot ALTERs in `sql/migrations/*.sql` are run ONCE against
--   remote D1; re-runs report `duplicate column name` (D1 rolls back
--   that statement only). The canonical idempotent path lives in
--   `routes/esign.ts:ensureSchema` — the per-statement try/catch there
--   swallows the duplicate-column errors at runtime, and is what serves
--   dev D1s and any forgotten migration. Index statements below use
--   `IF NOT EXISTS` and are always safe to re-run.
ALTER TABLE esign_envelopes ADD COLUMN provider TEXT NOT NULL DEFAULT 'native';
ALTER TABLE esign_envelopes ADD COLUMN docusign_envelope_id TEXT;
ALTER TABLE esign_envelopes ADD COLUMN docusign_account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_esign_provider          ON esign_envelopes(provider);
CREATE INDEX IF NOT EXISTS idx_esign_docusign_envelope ON esign_envelopes(docusign_envelope_id);
CREATE INDEX IF NOT EXISTS idx_esign_docusign_account  ON esign_envelopes(docusign_account_id);
-- Partial UNIQUE index — guarantees we never persist two local envelope
-- rows for the same (account, DocuSign envelope) pair, regardless of
-- which user owns the local row. Closes the cron-vs-webhook race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_esign_account_docusign_envelope
  ON esign_envelopes(docusign_account_id, docusign_envelope_id)
  WHERE docusign_envelope_id IS NOT NULL;

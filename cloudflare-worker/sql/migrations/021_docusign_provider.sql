-- Task #2 — DocuSign e-sign integration.
--
-- Extends `esign_envelopes` with a `provider` discriminator and a remote
-- envelope id so envelopes routed through DocuSign can be reconciled by
-- the cron poller and the inbound DocuSign Connect webhook.
--
-- Idempotent: D1 has no `IF NOT EXISTS` for ALTER TABLE … ADD COLUMN,
-- so re-running this migration on a database that already has the
-- columns will error out with `duplicate column name`. ensureSchema in
-- routes/esign.ts swallows that error and treats the column as present.
ALTER TABLE esign_envelopes ADD COLUMN provider TEXT NOT NULL DEFAULT 'native';
ALTER TABLE esign_envelopes ADD COLUMN docusign_envelope_id TEXT;
CREATE INDEX IF NOT EXISTS idx_esign_provider          ON esign_envelopes(provider);
CREATE INDEX IF NOT EXISTS idx_esign_docusign_envelope ON esign_envelopes(docusign_envelope_id);
-- Partial UNIQUE index — guarantees we never persist two local envelope
-- rows for the same DocuSign envelope owned by the same user (cron poller
-- + webhook race + retried send all need to be idempotent at the SQL
-- layer, not just the application layer).
CREATE UNIQUE INDEX IF NOT EXISTS uq_esign_user_docusign_envelope
  ON esign_envelopes(user_id, docusign_envelope_id)
  WHERE docusign_envelope_id IS NOT NULL;

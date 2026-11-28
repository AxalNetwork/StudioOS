-- Forward fix for 202611281133_5585_release_webhooks.sql (D5585-p20, #5585).
--
-- That migration adds `work_graph_release_webhooks` and `work_graph_release_webhook_sends`, their indexes and five
-- triggers (the next seq of a webhook, and refusing UPDATE and DELETE on both). A Worker one version back never reads or
-- writes either table, so a rollback needs nothing; it offers no webhook channel. What a manual recovery can lose is the
-- tables' guards. This fix puts them back as the migration wrote them. Never weaken them.
--
-- Idempotent: every statement is IF NOT EXISTS. The release-window rehearsal runs it on the migrated database and on a
-- clean build (D8532, step 5).

CREATE INDEX IF NOT EXISTS idx_work_graph_release_webhooks_company ON work_graph_release_webhooks (company_id, tenant_id, name, seq);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_webhook_sends_key ON work_graph_release_webhook_sends (tenant_id, company_id, name, release_key);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_webhook_sends_manifest ON work_graph_release_webhook_sends (tenant_id, company_id, name, manifest_uid);

CREATE TRIGGER IF NOT EXISTS work_graph_release_webhooks_next_seq
BEFORE INSERT ON work_graph_release_webhooks
WHEN NEW.seq <> 1 + COALESCE((SELECT MAX(x.seq) FROM work_graph_release_webhooks x
                               WHERE x.tenant_id = NEW.tenant_id AND x.company_id = NEW.company_id AND x.name = NEW.name), 0)
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_webhooks.seq: a row must be the next of its webhook (D5585 part 20).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_webhooks_append_only
BEFORE UPDATE ON work_graph_release_webhooks
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_webhooks is append-only; disable a webhook with a new row (D5585 part 20).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_webhooks_no_delete
BEFORE DELETE ON work_graph_release_webhooks
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_webhooks is append-only (D5585 part 20).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_webhook_sends_append_only
BEFORE UPDATE ON work_graph_release_webhook_sends
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_webhook_sends is append-only (D5585 part 20).');
END;

CREATE TRIGGER IF NOT EXISTS work_graph_release_webhook_sends_no_delete
BEFORE DELETE ON work_graph_release_webhook_sends
BEGIN
  SELECT RAISE(ABORT, 'work_graph_release_webhook_sends is append-only (D5585 part 20).');
END;

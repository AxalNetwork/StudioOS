-- D5585 part 20 (#5585): the signed-webhook external distribution channel, its registrations and its send ledger.
--
--   work_graph_release_webhooks        one row per change to one company's named webhook: a `register` (an https URL
--                                      and the audiences it may carry) or a `disable`. A webhook is its latest row; a
--                                      change is the next `seq` of its (tenant, company, name), named by the writer.
--   work_graph_release_webhook_sends   one row per signed request the channel sent and the receiver accepted (2xx):
--                                      a `published` release or a `withdrawn` one, under the release's key. A receiver
--                                      has no read API, so this ledger is what the channel's `find` reads.
--
-- Both are append-only (UPDATE and DELETE refused). Ids, digests, a URL and status codes only: never content and never
-- the signing key, which is a Worker secret (RELEASE_WEBHOOK_SIGNING_KEY). Additive: with the key unset, the channel is
-- not offered and nothing reads either table.
--
-- forward-fix: cloudflare-worker/sql/forward-fixes/202611281133_5585_release_webhooks.fix.sql

CREATE TABLE IF NOT EXISTS work_graph_release_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40 AND name NOT GLOB '*[^a-z0-9-]*'),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  op TEXT NOT NULL CHECK (op IN ('register', 'disable')),
  url TEXT CHECK (url IS NULL OR (length(url) BETWEEN 12 AND 500 AND url GLOB 'https://*')),
  audiences_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(audiences_json) AND json_type(audiences_json) = 'array'),
  actor_user_id INTEGER NOT NULL CHECK (actor_user_id > 0),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 160),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  created_at TEXT NOT NULL,
  CHECK ((op = 'register') = (url IS NOT NULL)),
  UNIQUE (tenant_id, company_id, name, seq),
  UNIQUE (tenant_id, company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_webhooks_company ON work_graph_release_webhooks (company_id, tenant_id, name, seq);

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

CREATE TABLE IF NOT EXISTS work_graph_release_webhook_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL CHECK (tenant_id > 0),
  company_id INTEGER NOT NULL CHECK (company_id > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  event TEXT NOT NULL CHECK (event IN ('published', 'withdrawn')),
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 120),
  release_key TEXT NOT NULL CHECK (length(release_key) BETWEEN 1 AND 200),
  manifest_uid TEXT NOT NULL CHECK (length(manifest_uid) BETWEEN 1 AND 80),
  digest TEXT NOT NULL CHECK (length(digest) = 64),
  http_status INTEGER NOT NULL CHECK (http_status BETWEEN 200 AND 299),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, company_id, name, event, external_id)
);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_webhook_sends_key ON work_graph_release_webhook_sends (tenant_id, company_id, name, release_key);
CREATE INDEX IF NOT EXISTS idx_work_graph_release_webhook_sends_manifest ON work_graph_release_webhook_sends (tenant_id, company_id, name, manifest_uid);

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

-- 258 — which licences have a deployment, and what state it is in (D.5, D108).
--
-- A SUBSIDIARY IS A LICENCE; A LICENCE HAS AT MOST ONE DEPLOYMENT. The ledger
-- (migration 187) says who holds which territory on what terms. It says
-- nothing about whether that holder has a Worker and a database yet, and the
-- two are genuinely independent: a licence can be issued, signed and active
-- with nothing provisioned, which is the normal state between signature and
-- the first deploy. The reverse must never happen, and `licence_uid UNIQUE`
-- is what stops a second deployment being registered against one licence.
--
-- WHY THE ROW IS HQ'S AND NOT THE BRANCH'S. This is the row HQ's Platform
-- screen reads to answer "is fr.axal.vc up, and on which version" — a question
-- about a deployment that may be unreachable, which is precisely when the
-- answer matters. A branch-held row would be unreadable exactly when it is
-- needed. It lives in HQ's database and is written by provisioning and by the
-- fan-out's health poll.
--
-- `status` IS A REQUEST'S PROGRESS, NOT A HEALTH CHECK. The values follow the
-- provisioning timeline the H3 Deploy step draws: requested, database_created,
-- schema_applied, secrets_present, principal_seeded, worker_live,
-- hostname_active, linked, failed. `last_health_at`/`last_health_ok` are the
-- separate, perishable fact — whether it answered a moment ago — and they are
-- deliberately not folded into `status`, because a live deployment that is
-- briefly unreachable has not regressed to "requested".
--
-- `rpc_secret_hash` IS A HASH AND THE SECRET IS NOT HERE. D.7: a service
-- binding does not tell the callee which binding called it, so a branch's
-- money-adjacent calls to HQ carry a per-deployment secret. HQ keeps only its
-- hash, the way every other credential in this schema is kept, so a read of
-- this table cannot impersonate a branch.
--
-- NO FOREIGN KEY to `territory_licences`. The licence uid is carried as a
-- plain value for the same reason migration 256 gives: these rows are written
-- by a provisioning workflow that may run against a database whose ledger row
-- arrives in a different order, and a constraint that fails the deploy is
-- worse than a uid that has to be joined by hand.

CREATE TABLE IF NOT EXISTS licence_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licence_uid TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  hostname TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  d1_name TEXT NOT NULL,
  -- What was REQUESTED and what was GRANTED, kept apart (D.1). Cloudflare
  -- guarantees `eu` and `fedramp` only; a Dubai branch asks for in-country
  -- and gets a location hint, and a licence that recorded only the request
  -- would misreport its own residency.
  d1_jurisdiction TEXT,
  location_hint TEXT,
  residency_requested TEXT,
  residency_granted TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  status_note TEXT,
  rpc_secret_hash TEXT,
  -- The Actions run that provisioned it, so a failed deploy is traceable to
  -- its log rather than to a screenshot.
  provision_run_id TEXT,
  requested_by_user_id INTEGER,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  live_at TEXT,
  last_health_at TEXT,
  last_health_ok INTEGER,
  last_version TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_licence_deployments_status ON licence_deployments(status);
CREATE INDEX IF NOT EXISTS idx_licence_deployments_code ON licence_deployments(code);

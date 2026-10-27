-- 590 — Vercel part 2: production health events (D1097, #2962, part of
-- #2408). Assigned by the plan's slot table (D1097 · migration 590).
--
-- vercel_health_events — one row per health event of a venture's Vercel
--   project, opened and closed on evidence the sync or a webhook nudge read
--   from Vercel's API (never from a webhook body):
--   · kind: production_failed (the newest production deployment failed),
--     rollback (production points at an older deployment than the newest
--     ready one), domain_misconfigured, domain_unverified,
--     certificate_failed, domain_expiring (a Vercel-registered domain inside
--     its expiry window);
--   · subject: what it is about, a deployment id or a domain name;
--   · opened_at / closed_at: when the evidence first and last held. A row
--     with closed_at NULL is open; at most one open row per kind and subject
--     for a connection and venture;
--   · source: 'sync' or 'webhook', what read the evidence that opened it;
--   · dismissed_at / dismissed_by: the founder dismissed it. A dismissed row
--     stays open until its evidence clears, so the next sync finds it and
--     never opens it again; the read leaves it out.
--   No deployment log, commit message, creator or person is stored.
--   Each row is also a connector_fed_items row,
--   `health:<kind>:<subject>:<opened_at>` (module operating_systems).
--
-- Grep first (D689 D-t): no `vercel_health_events` table, and no Vercel
-- table at all, exists in an earlier migration, in schema_baseline.sql or in
-- a runtime bootstrap. Migration 589 (part 1, #2961: vercel_installations,
-- vercel_projects) is not on main yet; this table depends on neither.
-- Nothing is backfilled: no Vercel evidence has been read before.

CREATE TABLE IF NOT EXISTS vercel_health_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id    INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vercel_project_id TEXT CHECK (vercel_project_id IS NULL OR length(vercel_project_id) BETWEEN 1 AND 128),
  kind              TEXT NOT NULL CHECK (kind IN ('production_failed', 'rollback', 'domain_misconfigured', 'domain_unverified', 'certificate_failed', 'domain_expiring')),
  subject           TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 253),
  opened_at         TEXT NOT NULL,
  closed_at         TEXT,
  source            TEXT NOT NULL CHECK (source IN ('sync', 'webhook')),
  dismissed_at      TEXT,
  dismissed_by      INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (closed_at IS NULL OR closed_at >= opened_at),
  CHECK ((dismissed_at IS NULL) = (dismissed_by IS NULL)),
  UNIQUE (integration_id, project_id, kind, subject, opened_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vercel_health_open
  ON vercel_health_events (integration_id, project_id, kind, subject) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vercel_health_project ON vercel_health_events (project_id, closed_at, opened_at);

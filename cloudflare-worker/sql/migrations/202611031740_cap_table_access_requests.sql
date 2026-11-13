-- 202611031740 — Cap table: Ask for access, stored (D1130, #3010; CT15n, CT22b).
--
-- D1027 let an investor related to a venture "Ask for access", but the ask was
-- only an `activity_logs` row: the founder was told and had nothing to answer.
-- This is the request itself, so the founder's Access tab can list what is
-- waiting and approve it at a level or decline it.
--
--   * One row per ask: the venture, who asked, the level they asked for.
--   * `status` moves pending → approved | declined, once. An approval names the
--     level the founder granted (`granted_level`, which may differ from the
--     ask) and the grant row it created (`grant_id`). Nothing is granted by the
--     ask alone.
--   * `resolved_by` / `resolved_at` say who answered and when.
--   * AT MOST ONE PENDING REQUEST per person and venture: the partial unique
--     index below, not a check in code alone.
--   * `note` is the asker's optional line to the founder, at most 500
--     characters. No email, phone or IP column exists.
--
-- Numbered migration 604 was assigned to this table on 2026-10-25 and never
-- used; numbered files stop at 799 (D4106), so it takes a UTC-minute stamp.
--
-- Grep first (D689 D-t): `cap_table_access_requests` exists in no earlier
-- migration and not in schema_baseline.sql. Additive: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS cap_table_access_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT    NOT NULL UNIQUE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requester_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_level   TEXT    NOT NULL CHECK (requested_level IN ('own_position', 'summary', 'investor', 'full')),
  note              TEXT    CHECK (note IS NULL OR length(note) <= 500),
  status            TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  granted_level     TEXT    CHECK (granted_level IS NULL OR granted_level IN ('own_position', 'summary', 'investor', 'full')),
  grant_id          INTEGER REFERENCES cap_table_access_grants(id) ON DELETE SET NULL,
  resolved_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at       TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK ((status = 'pending') = (resolved_at IS NULL)),
  CHECK (status <> 'approved' OR granted_level IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cap_table_access_requests_pending
  ON cap_table_access_requests (project_id, requester_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cap_table_access_requests_project
  ON cap_table_access_requests (project_id, status, created_at);

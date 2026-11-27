-- 642 — Publish part 1: the Worker core of founder publishing (D1319, #3480,
-- part 1 of #2400). Assigned by S1 (#3480: D1319 · migration 642).
--
-- One shared way to draft, preview, check, confirm, send, record and retract
-- a post to an outside service. Each provider adapter (Beehiiv #2407, X
-- #2403, TikTok #2401, Facebook #2399) plugs into it; none is built here.
-- NOTHING IS EVER SENT AUTOMATICALLY: a send row exists only because the
-- venture's founder pressed Send in the confirm dialog.
--
-- publish_destinations — the account or audience a post lands on (an X
--   handle, a Facebook Page, a Beehiiv publication, a TikTok creator), as the
--   adapter lists it, switched on for ONE company. Off by default
--   (`enabled` 0): connecting switches nothing on. `daily_cap` is the
--   founder's own lower cap, at most the owner's ceiling in code
--   (`PUBLISH_DAILY_CAP`); NULL is the ceiling. Disconnect deletes these rows
--   (the cascade) and keeps the sends.
--
-- publish_drafts — what the founder writes for one venture and one module:
--   the shared text and any per-destination edit (`body_json`), the records
--   it quotes (`source_refs_json`), media from R2 only (`media_r2_keys`), alt
--   text, whether team-only figures were ticked in, and the members who
--   agreed to be named (`named_consent_json`). `origin` is the founder, or
--   Eadwyn's proposal the founder chose to use (part 4).
--
-- publish_sends — one per destination per confirm, keyed by the client's
--   `idempotency_key` (UNIQUE with the draft and destination: a repeated
--   confirm returns the same row). `envelope_json` is exactly what the
--   preview showed and `publish` sends; `envelope_hash` is its hash.
--   Status:
--     ready            confirmed, refused before the request, or waiting for its claim
--     sending          claimed (`claimed_at`), the provider called once
--     sent             accepted and recorded, with the provider's post id and link
--     failed           the provider said "not created" (a 4xx, a 429 with
--                      `retry_after`), or the founder marked an unknown one not sent
--     unknown          not known whether it arrived: a timeout or reset after the
--                      request left, a throw after the provider said yes, or a row
--                      left `sending` for 10 minutes. NEVER re-sent.
--     retracted        deleted at the provider by the founder
--     removed_outside  the founder deleted it at the provider and said so
--   `destination_id` is SET NULL when the destination goes, so the record
--   stays the company's history; `destination_label` and `audience_label`
--   keep what it said. The index serves the daily cap.
--
-- Grep first (D689 D-t): no `publish_*` table exists in an earlier migration,
-- in schema_baseline.sql or in a runtime bootstrap. Nothing is backfilled.

CREATE TABLE IF NOT EXISTS publish_destinations (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  integration_id      INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  company_id          INTEGER NOT NULL,
  provider_key        TEXT NOT NULL,
  external_account_id TEXT NOT NULL CHECK (length(external_account_id) BETWEEN 1 AND 200),
  display_name        TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  audience_label      TEXT CHECK (audience_label IS NULL OR length(audience_label) <= 200),
  enabled             INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enabled_by          INTEGER REFERENCES users(id),
  enabled_at          TEXT,
  daily_cap           INTEGER CHECK (daily_cap IS NULL OR daily_cap >= 1),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (integration_id, company_id, external_account_id)
);
CREATE INDEX IF NOT EXISTS idx_publish_destinations_company ON publish_destinations (company_id, enabled);

CREATE TABLE IF NOT EXISTS publish_drafts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT NOT NULL UNIQUE,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id         INTEGER,
  module             TEXT NOT NULL,
  source_refs_json   TEXT NOT NULL DEFAULT '[]',
  author_user_id     INTEGER NOT NULL REFERENCES users(id),
  calendar_item_id   INTEGER,
  origin             TEXT NOT NULL DEFAULT 'founder' CHECK (origin IN ('founder', 'eadwyn')),
  rail_proposal_uid  TEXT,
  body_json          TEXT NOT NULL DEFAULT '{"text":"","per_destination":{}}',
  media_r2_keys      TEXT NOT NULL DEFAULT '[]',
  alt_texts          TEXT NOT NULL DEFAULT '[]',
  team_only_included INTEGER NOT NULL DEFAULT 0 CHECK (team_only_included IN (0, 1)),
  named_consent_json TEXT NOT NULL DEFAULT '[]',
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_publish_drafts_project ON publish_drafts (project_id, module, status);

CREATE TABLE IF NOT EXISTS publish_sends (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  draft_id          INTEGER NOT NULL REFERENCES publish_drafts(id) ON DELETE CASCADE,
  destination_id    INTEGER REFERENCES publish_destinations(id) ON DELETE SET NULL,
  project_id        INTEGER NOT NULL,
  module            TEXT NOT NULL,
  provider_key      TEXT NOT NULL,
  destination_label TEXT NOT NULL,
  audience_label    TEXT,
  idempotency_key   TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  envelope_json     TEXT NOT NULL,
  envelope_hash     TEXT NOT NULL,
  lint_kinds_json   TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'sending', 'sent', 'failed', 'unknown', 'retracted', 'removed_outside')),
  confirmed_by      INTEGER NOT NULL REFERENCES users(id),
  confirmed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at        TEXT,
  scheduled_for     TEXT,
  sent_at           TEXT,
  external_post_id  TEXT,
  external_url      TEXT,
  error_code        TEXT,
  retry_after       TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  retracted_at      TEXT,
  retracted_by      INTEGER REFERENCES users(id),
  retraction_reason TEXT,
  retract_error     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (draft_id, destination_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_publish_sends_cap ON publish_sends (destination_id, status, sent_at);
CREATE INDEX IF NOT EXISTS idx_publish_sends_project ON publish_sends (project_id, module, status);

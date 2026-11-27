-- 202611091055 — D4636 (#4636): a company update's published versions and its
-- per-recipient delivery records. Named by its UTC minute (D4106).
--
-- A COMPANY UPDATE IS STILL ONE `portfolio_updates` ROW (#2427: never a second
-- updates store). This adds what its lifecycle needs beside that row:
--
--   portfolio_update_versions   one row per published version of an update
--       ('update' kind; a report keeps its own revision chain, D1059). Version
--       1 is written when the update is first published (submit or send); a
--       correction of a published update is version N+1, with the actor who
--       made it and their reason. A version row is written once and never
--       changed: no route issues an UPDATE against this table. The pair
--       (update_id, version) is unique, so two writers who both read version N
--       cannot both publish N+1; the one whose insert lands wins and the other
--       is refused with `changed_since_open`.
--       `content_sha256` is the SHA-256 (lower-case hex) of the version's
--       canonical content, so a reader can tell two versions' content apart.
--
--   portfolio_updates.published_version
--       the version the row's content currently equals; NULL while a draft.
--       A row published before this migration reads NULL until its next
--       operation records version 1 from the row as it stood, attributed to
--       its author, at its original `submitted_at`.
--
--   update_recipients (delivery columns)
--       one logical delivery per recipient per version. `recipient_key` is
--       `user:<id>` or `email:<lower-case address>`; the unique index on
--       (version_id, recipient_key) is the reservation, taken with
--       INSERT … ON CONFLICT DO NOTHING, so concurrent sends reserve each
--       recipient once. Publication (status, submitted_at, published_version,
--       sent_at on the update) is kept apart from delivery progress here:
--         delivery_state   reserved | attempting | delivered | declined |
--                          undeliverable | failed | ambiguous
--         attempts         how many times a send claimed this delivery
--         attempt_claim    the claim token of the attempt that holds it; an
--                          attempt writes its outcome only where its own claim
--                          still stands
--         last_attempt_at  when the latest claim was taken
--         settled_at       when the outcome was recorded
--         provider_ref     the notification inbox row that carried it
--         delivery_uid     the delivery's own id, carried in the notification's
--                          payload so an ambiguous attempt is reconciled by
--                          looking for it rather than by sending again
--         reserved_by_user_id  the actor whose send reserved it
--       Rows written before this migration (and every report's rows) keep
--       NULL in these columns; SQLite treats NULLs as distinct in a unique
--       index, so they never collide.
--
-- No trigger: the routes and `services/updateLifecycle.ts` hold the rules.
--
-- Grep first (D689 D-t): no `portfolio_update_versions` table, and none of the
-- columns below on `portfolio_updates` or `update_recipients`, exists in an
-- earlier migration or in schema_baseline.sql.
--
-- Additive: CREATE … IF NOT EXISTS and ADD COLUMN. No row is changed.

CREATE TABLE IF NOT EXISTS portfolio_update_versions (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                       TEXT NOT NULL UNIQUE,
  update_id                 INTEGER NOT NULL REFERENCES portfolio_updates(id) ON DELETE CASCADE,
  version                   INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  title                     TEXT NOT NULL,
  body                      TEXT,
  period                    TEXT,
  period_start              TEXT,
  period_end                TEXT,
  kpis_json                 TEXT,
  metrics_json              TEXT,
  highlights_json           TEXT,
  lowlights_json            TEXT,
  asks_json                 TEXT,
  audience_json             TEXT,
  network_includes_metrics  INTEGER NOT NULL DEFAULT 0,
  content_sha256            TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  published_by_user_id      INTEGER NOT NULL REFERENCES users(id),
  published_at              TEXT NOT NULL,
  correction_reason         TEXT CHECK (correction_reason IS NULL OR length(correction_reason) <= 280),
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (update_id, version)
);
CREATE INDEX IF NOT EXISTS idx_pupdate_versions_update ON portfolio_update_versions (update_id, version);

ALTER TABLE portfolio_updates ADD COLUMN published_version INTEGER CHECK (published_version IS NULL OR (typeof(published_version) = 'integer' AND published_version >= 1));

ALTER TABLE update_recipients ADD COLUMN version_id INTEGER REFERENCES portfolio_update_versions(id);
ALTER TABLE update_recipients ADD COLUMN recipient_key TEXT;
ALTER TABLE update_recipients ADD COLUMN delivery_uid TEXT;
ALTER TABLE update_recipients ADD COLUMN delivery_state TEXT CHECK (delivery_state IS NULL OR delivery_state IN ('reserved', 'attempting', 'delivered', 'declined', 'undeliverable', 'failed', 'ambiguous'));
ALTER TABLE update_recipients ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE update_recipients ADD COLUMN attempt_claim TEXT;
ALTER TABLE update_recipients ADD COLUMN last_attempt_at TEXT;
ALTER TABLE update_recipients ADD COLUMN settled_at TEXT;
ALTER TABLE update_recipients ADD COLUMN provider_ref TEXT;
ALTER TABLE update_recipients ADD COLUMN reserved_by_user_id INTEGER REFERENCES users(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_update_recipients_version_key ON update_recipients (version_id, recipient_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_update_recipients_delivery_uid ON update_recipients (delivery_uid);

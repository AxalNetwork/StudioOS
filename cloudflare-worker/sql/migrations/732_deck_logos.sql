-- 732 — D1543 (#3781, deck v2 B5): the logos a venture may show on a deck.
--
-- Number given by #3781 (Decision D1543, migration 732).
--
-- deck_logos: one customer's logo per row, kept by the venture (not by one
-- deck version), with a permission flag of its own. A logo wall shows only
-- rows whose customer gave permission, and a share link sends a logo only
-- while its row still says so (shareInclude.shareGatesFor reads this table at
-- share time). Withdrawing permission takes the logo off every link at once.
--
--   logo_key               the reference a deck block carries (`logo_key`,
--                          slideModel GATE_REF): `logo_` and 24 hex digits.
--                          It names the row; it is never a permission by itself.
--   customer_name          whose logo it is, as the founder names them
--   image_uid              the venture's own kept picture (deck_images.uid,
--                          uploaded through POST /api/decks/:id/images/upload)
--   permitted              0 until the customer's permission is recorded
--   permission_reference   how it was given ("Email from their CMO, 2026-10-30");
--                          required while permitted = 1
--   permitted_by/_at       who recorded it, and when; required while permitted = 1
--
-- An unpermitted row can be stored (the founder is still asking) but never
-- inserted into a card or sent on a link: the Worker refuses it with
-- `no_permission`. No BEGIN/COMMIT: D1 applies a migration file as one batch.
--
-- Grep first (D689 D-t): no table named deck_logos exists in
-- schema_baseline.sql or any migration.

CREATE TABLE IF NOT EXISTS deck_logos (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  logo_key              TEXT NOT NULL UNIQUE CHECK (logo_key GLOB 'logo_[0-9a-f]*' AND length(logo_key) = 29),
  customer_name         TEXT NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 80),
  image_uid             TEXT NOT NULL,
  permitted             INTEGER NOT NULL DEFAULT 0 CHECK (permitted IN (0, 1)),
  permission_reference  TEXT CHECK (permission_reference IS NULL OR length(permission_reference) <= 200),
  permitted_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  permitted_at          TEXT,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (permitted = 0 OR (permitted_at IS NOT NULL AND permission_reference IS NOT NULL AND length(trim(permission_reference)) > 0)),
  UNIQUE (project_id, image_uid)
);

CREATE INDEX IF NOT EXISTS idx_deck_logos_project ON deck_logos(project_id, permitted);

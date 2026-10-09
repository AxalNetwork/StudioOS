-- 445 — what each connector delivered, and where it landed (D655, #1467).
--
-- One row per external item a connector delivered into a module. It is two
-- things at once:
--   - the LINK: a GitHub issue to the `roadmap_okrs` row it became, a pull
--     request to its `mvp_features` must-have. A re-sync finds the row here
--     and updates it, so nothing is duplicated. Neither table had a column
--     for an external id.
--   - the LEDGER: `GET /api/connectors/:uid/fed` counts these rows per module.
--
-- `local_table` and `local_id` are NULL when the module has no store for the
-- item yet (a GitHub release): the row records that it arrived, and the fed
-- count says where it could not land, instead of inventing a store.
CREATE TABLE IF NOT EXISTS connector_fed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL,
  project_id INTEGER,
  module TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  local_table TEXT,
  local_id INTEGER,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_connector_fed_items_module
  ON connector_fed_items (integration_id, module);

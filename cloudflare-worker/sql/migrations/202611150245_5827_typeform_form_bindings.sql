-- D5827 (#5827) — the one Typeform form each venture reads.
--
-- One new table and one index; no existing table changes. A row binds a
-- venture (`project_id` UNIQUE) to the form a founder chose explicitly,
-- through that founder's own `typeform` connection. `form_id` is Typeform's
-- id; `fields_json` holds each field's stable identity only, as
-- `[{ "id", "ref", "type" }]`: no title, choice or response leaves Typeform
-- into this table. `access_state` turns `lost` when a later check finds the
-- grant revoked, the read scope missing or the form deleted (`lost_reason`).
-- The provider's disconnect deletes the rows; `integration_id` cascades as a
-- backstop. No token is stored here.
CREATE TABLE IF NOT EXISTS typeform_form_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '[]',
  access_state TEXT NOT NULL DEFAULT 'ok' CHECK (access_state IN ('ok', 'lost')),
  lost_reason TEXT CHECK (lost_reason IS NULL OR lost_reason IN ('grant_revoked', 'scope_missing', 'form_deleted')),
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  bound_by INTEGER NOT NULL REFERENCES users(id),
  bound_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_typeform_form_bindings_integration ON typeform_form_bindings (integration_id);

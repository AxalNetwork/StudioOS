-- D5828 (#5828) — Typeform's incremental response importer: the minimal source
-- records a founder's selected form leaves in Axal. Additive only.
--
--   typeform_form_syncs      one row per connection (integrations.id), venture
--                            (projects.id) and Typeform form: the checkpoint
--                            (the latest durably written completed
--                            submission), the run lease, the last outcome and
--                            when the provider asked us to wait.
--   typeform_field_mappings  the questions the founder mapped, by Typeform's
--                            stable field id. A rename updates the title; a
--                            deleted or type-changed field is flagged
--                            `field_deleted` / `type_changed` for remapping.
--   typeform_responses       one row per response id: its type (completed or
--                            partial) and dates. No answer, hidden field,
--                            metadata, attachment or respondent identity.
--   typeform_answers         the founder-selected field's qualifying answer
--                            text for one response and one mapping, nothing
--                            else. Each has a `connector_fed_items` row keyed
--                            by connection/venture/form/response/field, so a
--                            re-sync lands it once and a withdrawn one stays
--                            withdrawn.
--
-- Timestamps are ISO-8601 UTC strings; every clock comparison wraps both sides
-- in datetime() (D124).
CREATE TABLE IF NOT EXISTS typeform_form_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  form_id TEXT NOT NULL,
  form_title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  sync_state TEXT NOT NULL DEFAULT 'never' CHECK (sync_state IN ('never', 'ok', 'partly', 'rate_limited', 'access_revoked', 'form_unavailable', 'region_unknown', 'unreadable', 'not_stored')),
  last_error TEXT,
  checkpoint_submitted_at TEXT,
  backfill_requested_at TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  retry_after TEXT,
  last_synced_at TEXT,
  last_reconciled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (integration_id, project_id, form_id)
);

CREATE TABLE IF NOT EXISTS typeform_field_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id INTEGER NOT NULL REFERENCES typeform_form_syncs(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  field_type TEXT NOT NULL,
  field_title TEXT,
  kind TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  keep_text INTEGER NOT NULL DEFAULT 0 CHECK (keep_text IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'field_deleted', 'type_changed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sync_id, field_id)
);

CREATE TABLE IF NOT EXISTS typeform_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id INTEGER NOT NULL REFERENCES typeform_form_syncs(id) ON DELETE CASCADE,
  response_id TEXT NOT NULL,
  response_type TEXT NOT NULL CHECK (response_type IN ('completed', 'partial')),
  submitted_at TEXT,
  landed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'provider_deleted')),
  upstream_missing_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (sync_id, response_id)
);

CREATE INDEX IF NOT EXISTS idx_typeform_responses_sync_type
  ON typeform_responses (sync_id, response_type, status);

CREATE TABLE IF NOT EXISTS typeform_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  response_row_id INTEGER NOT NULL REFERENCES typeform_responses(id) ON DELETE CASCADE,
  mapping_id INTEGER NOT NULL REFERENCES typeform_field_mappings(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  answer_text TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (response_row_id, mapping_id)
);

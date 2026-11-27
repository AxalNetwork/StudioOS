-- D6693 (#6693, plan key C3 of #6680): HQ's switch to pause one entity form,
-- so it stops being orderable on the next read without a catalogue edit.
--
-- One row per form key, across catalogue versions: a pause outlives a new
-- version until it is resumed. Each change records who, when and why; the
-- route also logs it in admin_audit_log. No row means not paused.
CREATE TABLE IF NOT EXISTS formation_form_switches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  form_key    TEXT NOT NULL UNIQUE CHECK (length(form_key) BETWEEN 1 AND 64 AND form_key NOT GLOB '*[^a-z0-9_]*'),
  paused      INTEGER NOT NULL CHECK (paused IN (0, 1)),
  reason      TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  changed_by  INTEGER NOT NULL,
  changed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- #8516 (D8516), part 1: a durable record for each effect an e-signature
-- depends on. Today a signature is committed and the dependent steps run in
-- their own try blocks that only log, so a step that fails leaves no trace
-- and nobody can replay it. This table is the trace and the replay's queue.
--
-- esign_effects: one row per (envelope, effect kind). `state` is pending,
--   done or failed. `attempts` counts every run, the first included; the
--   Worker tick retries pending and failed rows until MAX_EFFECT_ATTEMPTS
--   (services/esignEffects.ts). `last_error_class` is a short code (a refusal
--   code or an exception name), never message text, a token or an address.
--   `effect_kind` is checked in code against REQUIRED_EFFECTS, not here, so
--   each later part adds a kind without a table rebuild.
--
-- Grep first: no esign_effects table exists in schema_baseline.sql or an
-- earlier migration. Nothing is added to an existing table.
--
-- STANDS ALONE under the runner: no BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS esign_effects (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id      INTEGER NOT NULL,
  effect_kind      TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT,
  last_attempt_at  TEXT,
  done_at          TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (envelope_id, effect_kind)
);

CREATE INDEX IF NOT EXISTS idx_esign_effects_open ON esign_effects(state, updated_at);

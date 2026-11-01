-- 716 — a deck generation run and its steps (D1502, #3753, deck v2 A3a).
-- Number given by #3753 (S1's revision, 2026-11-01: "still free").
--
-- One run (a batch of areas, or a whole-deck `deck_build`) sits under ONE quote
-- and ONE parent hold (`ai_budget_reservations`, named by `reservation_uid`).
-- Each step's model run settles its charge against that hold
-- (`ai_usage_logs.reservation_uid`); the run settles the hold once, at the sum
-- of what its steps charged, when it ends (done, cancelled or failed).
--
-- `deck_area_batch_steps` is the run's plan and its progress, one row per line
-- of the quote (an area's text, an image, a guard or vision check, a critique
-- pass, a retry). A step that is `done` is never run again: a run rebuilt after
-- a crash (`rebuild`) reads its state from here and repeats nothing.
--
-- One active run per deck (`deck_area_batches_one_active`): a `deck_build` run
-- counts as one. `idem_key` makes a retried request the same run.
CREATE TABLE IF NOT EXISTS deck_area_batches (
  uid             TEXT    PRIMARY KEY,
  deck_id         INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL,
  class           TEXT    NOT NULL DEFAULT 'areas' CHECK (class IN ('areas', 'deck_build')),
  state           TEXT    NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'cancelling', 'done', 'cancelled', 'failed')),
  quote_uid       TEXT,
  quote_microusd  INTEGER NOT NULL CHECK (quote_microusd >= 0),
  reservation_uid TEXT,
  charged_microusd INTEGER NOT NULL DEFAULT 0 CHECK (charged_microusd >= 0),
  idem_key        TEXT    NOT NULL UNIQUE,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  started_at      TEXT,
  settled_at      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS deck_area_batches_one_active ON deck_area_batches(deck_id)
  WHERE state IN ('queued', 'running', 'cancelling');
CREATE INDEX IF NOT EXISTS deck_area_batches_member ON deck_area_batches(created_by, created_at);

CREATE TABLE IF NOT EXISTS deck_area_batch_steps (
  batch_uid        TEXT    NOT NULL REFERENCES deck_area_batches(uid) ON DELETE CASCADE,
  seq              INTEGER NOT NULL CHECK (seq >= 0),
  card_uid         TEXT,
  area_id          TEXT,
  element          TEXT    NOT NULL,
  kind             TEXT    NOT NULL,
  task             TEXT,
  model            TEXT,
  state            TEXT    NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'running', 'done', 'failed', 'stopped')),
  quote_microusd   INTEGER NOT NULL DEFAULT 0 CHECK (quote_microusd >= 0),
  charged_microusd INTEGER NOT NULL DEFAULT 0 CHECK (charged_microusd >= 0),
  model_used       TEXT,
  fallback_used    INTEGER NOT NULL DEFAULT 0 CHECK (fallback_used IN (0, 1)),
  usage_log_id     INTEGER,
  error_code       TEXT,
  started_at       TEXT,
  ended_at         TEXT,
  PRIMARY KEY (batch_uid, seq)
);

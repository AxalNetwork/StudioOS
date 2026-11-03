-- D1512 (#3764, deck v2 A3): what "Generate into areas" proposed, one row per
-- area of a run. Named by its UTC minute (D4106); #3764 named this file 720.
--
-- A row is made when the run is admitted (`state` 'running'), one per area,
-- and settles from the run's steps when they end: 'ready' with each variant's
-- payload, model, seed, cost and seconds in `variants_json`, or 'failed' when
-- every variant failed. Nothing reaches a card from here: Accept (by the
-- area's card_uid and area_id) places one variant and records `outcome`;
-- Discard records 'discard'; a row nobody decided expires after 14 days
-- (A15's daily cleanup). `replaces_block` is the block the variant replaces,
-- read when the run was made. Records-only elements (venture records) carry
-- their one variant from the start and run no model.
--
-- No figure a model wrote is stored here: text variants are words, charts and
-- venture elements are bindings to records.
CREATE TABLE IF NOT EXISTS deck_area_proposals (
  uid              TEXT    PRIMARY KEY,
  deck_id          INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  project_id       INTEGER NOT NULL,
  card_uid         TEXT    NOT NULL CHECK (length(card_uid) BETWEEN 1 AND 40),
  area_id          TEXT    NOT NULL CHECK (length(area_id) BETWEEN 1 AND 64),
  batch_uid        TEXT    REFERENCES deck_area_batches(uid) ON DELETE SET NULL,
  mode             TEXT    NOT NULL DEFAULT 'variants' CHECK (mode IN ('variants', 'records')),
  element          TEXT    NOT NULL CHECK (length(element) BETWEEN 1 AND 40),
  payload_json     TEXT    CHECK (payload_json IS NULL OR length(payload_json) <= 32768),
  variants_json    TEXT    CHECK (variants_json IS NULL OR length(variants_json) <= 262144),
  pipeline_json    TEXT    CHECK (pipeline_json IS NULL OR length(pipeline_json) <= 32768),
  judge_json       TEXT    CHECK (judge_json IS NULL OR length(judge_json) <= 32768),
  state            TEXT    NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'ready', 'failed', 'accepted', 'discarded', 'expired')),
  usage_log_id     INTEGER,
  outcome          TEXT    CHECK (outcome IS NULL OR outcome IN ('accept', 'accept_all', 'discard', 'expired', 'superseded')),
  accepted_variant INTEGER CHECK (accepted_variant IS NULL OR accepted_variant BETWEEN 1 AND 3),
  regenerated_from TEXT,
  replaces_block   TEXT,
  created_by       INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at       TEXT,
  expires_at       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS deck_area_proposals_area ON deck_area_proposals(deck_id, card_uid, area_id, state);
CREATE INDEX IF NOT EXISTS deck_area_proposals_batch ON deck_area_proposals(batch_uid);
CREATE INDEX IF NOT EXISTS deck_area_proposals_open ON deck_area_proposals(state, expires_at);

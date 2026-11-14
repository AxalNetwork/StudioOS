-- 733 — D1540 (#3791, deck v2 B15): recourse and pricing.
--
-- Number given by #3791 (Decision D1540, migration 733).
--
-- deck_proposal_reports: a founder's report of a bad result. One row per
-- deck rail proposal (`ai_rail_proposals.uid`) and member: the reason code,
-- an optional short note, and HQ's resolution. The proposal's option, model
-- and usage row are copied at report time, so HQ reads what ran even after
-- the proposal is decided or gone.
--
--   reason   wrong_figure, poor_writing, wrong_place, bad_image, unsafe, other
--   note     at most 280 characters, the founder's own words, never logged
--   status   open until an HQ admin resolves it; then outcome is one of
--            addressed (HQ acted) or no_fault (the result was as intended)
--
-- deck_run_quotes: the price New deck showed before a run, pinned. One row
-- per quote: who asked, for which venture and step, the hold it quoted, the
-- price list it was quoted under (`pricing_version`, `ai/pricing.ts`
-- pricingVersion) and a hash of the run it priced. A run that names the
-- quote settles at no more than `hold_microusd`, whatever the prices are when
-- it runs (`RunOptions.pinMicrousd`). A quote prices one run: `used_at` is set
-- when a run takes it, and it lapses at `expires_at`.
--
-- Amounts are integer micro-USD, the AI ledger's unit.
-- No BEGIN/COMMIT: D1 applies a migration file as one batch.

CREATE TABLE IF NOT EXISTS deck_proposal_reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  uid              TEXT NOT NULL UNIQUE,
  proposal_uid     TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_ref       TEXT,
  rail_option      TEXT NOT NULL,
  model            TEXT,
  usage_log_id     INTEGER,
  reason           TEXT NOT NULL
    CHECK (reason IN ('wrong_figure', 'poor_writing', 'wrong_place', 'bad_image', 'unsafe', 'other')),
  note             TEXT CHECK (note IS NULL OR length(note) <= 280),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  outcome          TEXT CHECK (outcome IS NULL OR outcome IN ('addressed', 'no_fault')),
  resolution_note  TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),
  resolved_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (proposal_uid, user_id)
);

CREATE INDEX IF NOT EXISTS idx_deck_proposal_reports_status ON deck_proposal_reports(status, id DESC);

CREATE TABLE IF NOT EXISTS deck_run_quotes (
  uid              TEXT PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id       INTEGER NOT NULL,
  step             TEXT NOT NULL CHECK (step IN ('outline', 'build')),
  hold_microusd    INTEGER NOT NULL CHECK (hold_microusd >= 0),
  pricing_version  TEXT NOT NULL,
  input_hash       TEXT NOT NULL,
  model            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at       TEXT NOT NULL,
  used_at          TEXT
);

CREATE INDEX IF NOT EXISTS idx_deck_run_quotes_user ON deck_run_quotes(user_id, created_at);

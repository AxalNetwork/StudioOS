-- 570 — Persona segments part 6: an Admin's suggestions to HQ (D1003, #2818).
-- Reserved for this part by S21 in D997 §6 (#2378).
--
-- ONE TABLE ON EVERY DEPLOYMENT, as `branch_escalations` and `hq_escalations`
-- are two views of one escalation. HQ writes the segment profiles (D1000), so
-- a suggestion is decided at HQ:
--   - an Admin on HQ writes HQ's row directly (origin_code 'hq');
--   - an Admin on a subsidiary writes its own copy and the subsidiary relays
--     it to HQ (`BranchEntrypoint.segmentSuggestion`), where HQ stores it with
--     origin_code = the subsidiary's code and origin_ref = the subsidiary's
--     uid. The copy keeps HQ's uid in hq_uid, or delivery = 'undelivered' with
--     the reason when HQ could not be reached.
-- HQ's decision is pushed back (`HqEntrypoint.applySegmentSuggestionAnswer`),
-- and the subsidiary tells its Admin; on HQ the Admin is told directly.
--
-- WHAT A SUGGESTION IS:
--   segment_key   the segment it is about; NULL only for a new segment;
--   kind          who (who they are), need, offer, new_segment or other;
--   text          what should change, 1 to 500 characters;
--   status        open, accepted or declined; a decision is final;
--   decline_reason  the one line the Admin reads, at most 200 characters,
--                 required for a decline (CHECK below).
--
-- Grep first (D689 D-t): no `segment_suggestions` table exists in an earlier
-- migration or in schema_baseline.sql.

CREATE TABLE IF NOT EXISTS segment_suggestions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                TEXT    NOT NULL UNIQUE,
  segment_key        TEXT    CHECK (segment_key IS NULL OR length(segment_key) BETWEEN 1 AND 64),
  kind               TEXT    NOT NULL CHECK (kind IN ('who', 'need', 'offer', 'new_segment', 'other')),
  text               TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 500),
  status             TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined')),
  decline_reason     TEXT    CHECK (decline_reason IS NULL OR length(decline_reason) <= 200),
  suggested_by       INTEGER,
  suggested_by_name  TEXT,
  origin_code        TEXT    NOT NULL DEFAULT 'hq',
  origin_ref         TEXT,
  hq_uid             TEXT,
  delivery           TEXT    NOT NULL DEFAULT 'local' CHECK (delivery IN ('local', 'delivered', 'undelivered')),
  delivery_reason    TEXT,
  decided_by         INTEGER,
  decided_by_name    TEXT,
  decided_at         TEXT,
  push_ok            INTEGER CHECK (push_ok IS NULL OR push_ok IN (0, 1)),
  push_reason        TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (kind = 'new_segment' OR segment_key IS NOT NULL),
  CHECK (status <> 'declined' OR (decline_reason IS NOT NULL AND length(trim(decline_reason)) > 0))
);

-- A subsidiary's relay retried after a lost response stores one row, not two.
CREATE UNIQUE INDEX IF NOT EXISTS idx_segment_suggestions_origin
  ON segment_suggestions (origin_code, origin_ref) WHERE origin_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_segment_suggestions_status ON segment_suggestions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_segment_suggestions_by ON segment_suggestions (suggested_by, created_at);
CREATE INDEX IF NOT EXISTS idx_segment_suggestions_hq_uid ON segment_suggestions (hq_uid) WHERE hq_uid IS NOT NULL;

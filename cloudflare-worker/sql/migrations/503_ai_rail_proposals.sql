-- 503 — ai_rail_proposals: every draft, proposal or note a rail option's run
-- leaves for the member to decide (D780, #2105; D720 §7 and §9).
--
-- One new table, no change to an existing one. D720 §7 reserved migration 482
-- for it under D765; D765 closed without it, so it lands here (S1 on #2105).
--
-- "Eadwyn drafts; you send" (D720 §9): a run never writes its output into a
-- record. It writes a row here, and the member's press decides it:
--
--   kind     draft     text the member may keep, edit or throw away
--            proposal  a value for a field or a placement, accepted one by one
--            note      a comment beside a record, never written into it
--                      (Eadwyn's notes on a legal draft, `draft:legal/notes`)
--   status   proposed  waiting for the member
--            accepted  kept as Eadwyn wrote it
--            edited    kept after the member changed it (`decided_payload_json`)
--            discarded thrown away by the member
--            withdrawn taken back by the platform (the record moved on)
--
-- Validate's proposals stay in `validate_proposals`, and zone drafts in
-- `research_zone_drafts` (D720 §7). Every other option uses this table, through
-- `services/ai/railProposals.ts`.
--
-- `rail_page`, `rail_option` and `record_ref` are the run's own keys, as
-- `ai_usage_logs` records them (migration 493), and `usage_log_id` names that
-- run's row, so a member can see which run wrote a proposal and what it cost.
-- The rows are the member's own: every read and every decision is scoped to
-- `user_id`, and they go with the account.
--
-- D1 REJECTS BEGIN/COMMIT, so there is no transaction.

CREATE TABLE IF NOT EXISTS ai_rail_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rail_page TEXT NOT NULL,
  rail_option TEXT NOT NULL,
  record_ref TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('draft', 'proposal', 'note')),
  payload_json TEXT NOT NULL,
  model TEXT,
  usage_log_id INTEGER REFERENCES ai_usage_logs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'edited', 'discarded', 'withdrawn')),
  decided_payload_json TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_rail_proposals_user_option
  ON ai_rail_proposals (user_id, rail_option, status, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_rail_proposals_record
  ON ai_rail_proposals (record_ref, rail_option, status);

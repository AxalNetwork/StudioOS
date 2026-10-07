-- 415 — decision_journal_entries.edited_after_outcome_at: timestamp recorded when
-- a thesis, risk, expected outcome, decision, conviction, expected multiple or
-- timeline is edited after an outcome was already recorded (D618, #1315).
--
-- NULL by default; set when an entry with a recorded outcome is edited.
ALTER TABLE decision_journal_entries ADD COLUMN edited_after_outcome_at TEXT;

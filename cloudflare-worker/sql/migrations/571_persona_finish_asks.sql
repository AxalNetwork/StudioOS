-- 571 — "Ask to finish their profile" (D1002, #2817; Persona segments part 5
-- of #2378, D997 §6).
--
-- WHAT IT IS. One row each time an admin asks a member with no segment to
-- finish the sign-up chat. The member is sent one notice; this row is the
-- log the Activity tab reads and the 30-day rule's memory: a member is asked
-- at most once in 30 days, whoever asks. Nothing here is what the member
-- answered.
--
-- Append-only. Additive and idempotent.
--
-- Grep first (D689 D-t): `persona_finish_asks` exists in no earlier
-- migration and not in schema_baseline.sql.

CREATE TABLE IF NOT EXISTS persona_finish_asks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  asked_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_persona_finish_asks_user ON persona_finish_asks(user_id, asked_at);

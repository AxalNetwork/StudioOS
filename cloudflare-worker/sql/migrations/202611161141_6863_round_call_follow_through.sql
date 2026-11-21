-- D6863 (#6863, canvas D6053): Calls for Capital follow-through. Additive; the
-- round-call feature flag (ROUND_CALLS_ENABLED) stays off, so nothing reads
-- these stores in production until it is switched on.
--
-- REMIND. Each recipient keeps when it was last reminded and how many
-- reminders it has had on this call. The Worker enforces the owner's limit
-- (Q2, option A): at most 2 per recipient per call, at least 3 days apart.
-- A recipient never reminded is NULL and 0, never a guessed date.
ALTER TABLE round_call_recipients ADD COLUMN last_reminded_at TEXT;
ALTER TABLE round_call_recipients ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0;

-- STARTED FROM. A call started from a closed one names it, for "Started from".
ALTER TABLE round_calls ADD COLUMN source_call_id INTEGER REFERENCES round_calls(id) ON DELETE SET NULL;

-- THE TYPED LINE. A Signed or Wired line recorded from a call's response keeps
-- that call's uid, so the pipeline line links back to the response. Any other
-- line is NULL.
ALTER TABLE raise_prospects ADD COLUMN round_call_uid TEXT;

-- THE EXPORT LOG. One dated row per CSV or PDF export of a call: who, when,
-- what the file held and whether the questions could be read. No file is kept.
CREATE TABLE IF NOT EXISTS round_call_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  call_id INTEGER NOT NULL REFERENCES round_calls(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK (format IN ('csv','pdf')),
  scope TEXT NOT NULL CHECK (scope IN ('responses','terms')),
  questions_state TEXT NOT NULL CHECK (questions_state IN ('read','unreadable','not_included')),
  named_count INTEGER NOT NULL DEFAULT 0,
  responded_count INTEGER NOT NULL DEFAULT 0,
  withheld_matches INTEGER NOT NULL DEFAULT 0,
  exported_by INTEGER NOT NULL REFERENCES users(id),
  exported_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_round_call_exports_call ON round_call_exports(call_id, exported_at);

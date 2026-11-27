-- 576 — product testers: the tester sub-account and its history (D1042, #2890;
-- Approvals part 4 of #2390, and #2377's task 3).
--
-- WHAT IT IS. A member who applies to test products is one row here, whatever
-- their profile; testing programmes (516) recruit from the active ones. The
-- member's apply route waits on #2318's intake decision, so today only HQ's
-- routes write a row's status: approve, decline, pause, resume and remove
-- (`routes/admin_product_testers.ts`). Admins cannot be testers.
--
-- THE STATES. `applied` → `active` (approved) or `declined`; `active` ↔
-- `paused`; `active` or `paused` → `removed`. A declined member may apply again
-- 90 days after `decided_at`; the apply route reads that from this row.
--
-- WHO SEES WHAT. `note` is HQ's and the member never sees it. `reason` is the
-- sentence the member is told with a decline, a pause or a removal. `answers`,
-- `availability` and the email consent are the member's own, from their
-- application; `consent_version` names the sentence they agreed to, as 516's
-- applications do.
--
-- `product_tester_events` is append-only: every change writes one row, who,
-- what, the note and the reason, and nothing updates or deletes one.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS product_testers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'active', 'paused', 'declined', 'removed')),
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at TEXT,
  decided_by INTEGER REFERENCES users(id),
  note TEXT,
  reason TEXT,
  answers TEXT NOT NULL DEFAULT '[]',
  availability TEXT,
  consent_email_at TEXT,
  consent_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (consent_email_at IS NULL OR consent_version IS NOT NULL),
  CHECK (status = 'applied' OR decided_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_product_testers_status ON product_testers(status, applied_at);

CREATE TABLE IF NOT EXISTS product_tester_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tester_id INTEGER NOT NULL REFERENCES product_testers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('applied', 'approved', 'declined', 'paused', 'resumed', 'removed')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id INTEGER,
  note TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_product_tester_events_tester ON product_tester_events(tester_id, id);

CREATE TRIGGER IF NOT EXISTS product_tester_events_no_update
BEFORE UPDATE ON product_tester_events
BEGIN
  SELECT RAISE(ABORT, 'product_tester_events is append-only (D1042).');
END;

CREATE TRIGGER IF NOT EXISTS product_tester_events_no_delete
BEFORE DELETE ON product_tester_events
BEGIN
  SELECT RAISE(ABORT, 'product_tester_events is append-only (D1042).');
END;

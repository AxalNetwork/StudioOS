-- 360_partner_booking_action_items.sql — Office Hours: action items that come
-- out of a partner session (D355, wave 8, Session 7, deferred list).
--
-- The Office Hours canvas draws "Action items · execution handoff": per
-- session, a title, the Lab tool it feeds, who owns it, a due date and a done
-- box. Nothing stored any of it; the page showed the week's milestone
-- checklist in its place.
--
-- Owner decision (relayed 2026-09-27): BOTH parties to a booking may add and
-- complete items, and each item records who added it. So:
--   * created_by_user_id + created_by_role record the author, never taken
--     from the request — the Worker sets both from the session and the
--     booking;
--   * completed_by_user_id records who ticked it;
--   * only the author may edit the text or delete the item; either party may
--     tick or un-tick it.
-- `linked_tool` is a key from a fixed allowlist of Lab tools (validated in
-- services/partnerBookingFollowups.ts), never a free URL.
--
-- STANDS ALONE: partner_bookings and users are existing tables. CREATE … IF
-- NOT EXISTS only, no BEGIN/COMMIT. Apply with the ledger-driven runner:
--   npm run d1:migrate:remote

CREATE TABLE IF NOT EXISTS partner_booking_action_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES partner_bookings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  linked_tool TEXT,
  due_date TEXT,
  done_at TEXT,
  completed_by_user_id INTEGER REFERENCES users(id),
  created_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('founder', 'partner')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_partner_booking_action_items_booking
  ON partner_booking_action_items (booking_id);

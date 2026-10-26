-- 608 — the founder's own choice of whether the data room needs an NDA (D1102, #2982).
-- Assigned by S1 on #2982, 2026-10-25 19:37Z.
--
-- WHY A NEW COLUMN. `projects.data_room_nda_required` (migration 076) is
-- `INTEGER NOT NULL DEFAULT 0`, so an untouched 0 cannot be told apart from a
-- founder's explicit No. The owner chose an explicit-choice state: the demo-day
-- deck derives "NDA required" from the room's own gates until the founder
-- chooses, and then keeps that choice, No included. SQLite cannot drop NOT NULL
-- in place, and `projects` cannot be rebuilt the way 558 rebuilt a leaf table:
-- dozens of tables reference it, many `ON DELETE CASCADE`. So the choice moves
-- to a new nullable column, the house pattern for this (503, 518, 553):
--
--   data_room_nda_choice   NULL  the founder has not chosen; the deck derives it
--                                (true when any file an investor can be admitted
--                                to is gated `nda`; `services/dataRoomNda.ts`)
--                          1     the founder chose Yes
--                          0     the founder chose No
--
-- THE BACKFILL (S1 on #2982): a stored 1 stays 1, a founder's Yes. A stored 0
-- becomes NULL, unset, because it cannot be told apart from the default. Each
-- rule runs in the protective direction: no deck loses an NDA it showed, and no
-- untouched default hides one the room requires.
--
-- THE OLD COLUMN STAYS, AND NOTHING READS IT. Every reader moves to this
-- column in the same change. The two writers (`PUT /api/projects/:id`,
-- `PUT /api/decks/:id`) store each explicit choice here and mirror it into
-- the old column, so a Worker rolled back to before 608 still reads every
-- choice made since. Never read `data_room_nda_required` for the founder's
-- choice: its 0 still means "unset or No".
--
-- Grep first (D689 D-t): no `data_room_nda_choice` column exists in an earlier
-- migration or in schema_baseline.sql.
ALTER TABLE projects ADD COLUMN data_room_nda_choice INTEGER
  CHECK (data_room_nda_choice IN (0, 1));

UPDATE projects SET data_room_nda_choice = 1 WHERE data_room_nda_required = 1;

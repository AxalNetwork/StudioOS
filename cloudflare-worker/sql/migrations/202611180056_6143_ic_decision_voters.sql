-- D6143 (#6143): the voting roster of an IC decision (Deals v2 DE07, DE21).
--
-- DE07 draws "6 eligible · 4 voted · 1 recused · 1 to vote" and a row for a
-- member who has not voted. Nothing stored who may vote: `ic_meeting_attendees`
-- is an invitation to a meeting, not an entitlement. `ic_decision_voters` is
-- one row per member the decision's author (or an Admin) put on its roster.
-- The owner's answer to Q4 of the #6153 brief (D6153-p2) is A: the author
-- picks the voters, offered from the firm's Investor licence holders. There
-- is no automatic roster, so a decision with no rows here has no roster and
-- its eligible count is not recorded, never 0.
--
-- The condition owner the issue also names is already stored:
-- `ic_conditions.owner_user_id` and `owner_label` came with D6156
-- (202611140938_6156_deals_v2_owner_due_history.sql). Nothing is re-added.
--
-- Additive: a new table only. The CREATEs are idempotent.

CREATE TABLE IF NOT EXISTS ic_decision_voters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ic_decision_id INTEGER NOT NULL REFERENCES ic_decisions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (ic_decision_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ic_decision_voters_user ON ic_decision_voters(user_id);

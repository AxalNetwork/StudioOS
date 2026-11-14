-- #6031 (D6031): Prototype / MVP's dominant action is the next blocked
-- must-have, else the next one due. The "next due" lookup walks this index in
-- due-date order and stops at the first must-have not done, so the card does
-- not scan every open must-have to sort them (#4603's rows-read budget).
--
-- Read-only use: no query result changes.
CREATE INDEX IF NOT EXISTS idx_mvp_features_must_due
  ON mvp_features (project_id, is_must_have, due_date, sort_order);

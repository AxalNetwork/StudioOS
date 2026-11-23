-- #6261 (D6261): an investor's intro ask can now be answered. The owner chose
-- A: the founder is told, accepts or declines, and an accepted ask opens the
-- existing Trust Center NDA step. The investor may withdraw an unanswered ask.
--
--   recipient_user_id  the founder account that may answer the ask, resolved
--                      once from the ids the ask stores (D702's rule: a
--                      founder account, else the project's founder record,
--                      else the founder record; a record names its lowest
--                      user id). NULL when no founder account exists, and
--                      then nobody can answer it; the investor may withdraw.
--   decided_at         when the ask left 'pending' (accepted, declined or
--                      withdrawn). NULL while it is pending.
--   decided_by         the user who moved it: the founder for accept or
--                      decline, the investor for withdraw.
ALTER TABLE investor_introductions ADD COLUMN recipient_user_id INTEGER;
ALTER TABLE investor_introductions ADD COLUMN decided_at TIMESTAMP;
ALTER TABLE investor_introductions ADD COLUMN decided_by INTEGER;

CREATE INDEX IF NOT EXISTS idx_intros_recipient ON investor_introductions(recipient_user_id, status);

-- Asks already recorded keep their status and their spent slot. Each gets the
-- founder who may now answer it, by the same precedence the route uses, so a
-- pending ask made before this change can be accepted or declined. No
-- notification is sent for them: nobody clicked anything today.
UPDATE investor_introductions
   SET recipient_user_id = COALESCE(
         founder_user_id,
         CASE
           WHEN project_id IS NOT NULL THEN (
             SELECT MIN(u.id) FROM users u JOIN projects p ON p.founder_id = u.founder_id
              WHERE p.id = investor_introductions.project_id)
           ELSE (
             SELECT MIN(u.id) FROM users u WHERE u.founder_id = investor_introductions.founder_id)
         END)
 WHERE recipient_user_id IS NULL;

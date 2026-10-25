-- 574 — option pools and vesting per venture, and Carta's rows named as a connector's
-- (D1020, #2857; Cap table part 5 of #2432).
--
-- WHY. `cap_table_option_pools` and `cap_table_vesting` were keyed by the
-- account alone (057), so `GET /api/captable/equity-plan` mixed every venture a
-- founder holds (D1015's map §1, item 11). Both gain `project_id`.
--
-- THE BACKFILL TIES A ROW ONLY WHERE ONE VENTURE IS PROVEN.
--   · A vesting row takes the venture of the register row it vests: its
--     `holder_id`'s `cap_table_holders.project_id`, or else its `security_id`'s
--     `cap_table_securities.project_id`, on the same account. A holder or
--     security with no venture proves nothing, and the row stays unset.
--   · An option pool has no link to a holder, a security or a venture (Carta's
--     sync writes it from the account's issuer). No pool is tied here.
-- A row left unset is account-level. No venture read shows it (D1020 §2); the
-- account view still does. Nothing is guessed from "the founder has one
-- venture".
--
-- CARTA'S SOURCE. Rows Carta's sync wrote carry `source = 'carta'`. They are
-- renamed `connector_carta`, the connector's own key, so a read can say where
-- a row came from in the words every other connector uses (D1015 §5,
-- question 6). Disconnect still turns them into `manual` (carta.ts).

ALTER TABLE cap_table_option_pools ADD COLUMN project_id INTEGER REFERENCES projects(id);
ALTER TABLE cap_table_vesting ADD COLUMN project_id INTEGER REFERENCES projects(id);

CREATE INDEX IF NOT EXISTS idx_cap_table_option_pools_project ON cap_table_option_pools(project_id);
CREATE INDEX IF NOT EXISTS idx_cap_table_vesting_project ON cap_table_vesting(project_id);

UPDATE cap_table_vesting
   SET project_id = (
     SELECT h.project_id FROM cap_table_holders h
      WHERE h.id = cap_table_vesting.holder_id AND h.user_id = cap_table_vesting.user_id
   )
 WHERE project_id IS NULL
   AND holder_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM cap_table_holders h
      WHERE h.id = cap_table_vesting.holder_id AND h.user_id = cap_table_vesting.user_id AND h.project_id IS NOT NULL
   );

UPDATE cap_table_vesting
   SET project_id = (
     SELECT s.project_id FROM cap_table_securities s
      WHERE s.id = cap_table_vesting.security_id AND s.user_id = cap_table_vesting.user_id
   )
 WHERE project_id IS NULL
   AND security_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM cap_table_securities s
      WHERE s.id = cap_table_vesting.security_id AND s.user_id = cap_table_vesting.user_id AND s.project_id IS NOT NULL
   );

UPDATE cap_table_holders SET source = 'connector_carta' WHERE source = 'carta';
UPDATE cap_table_securities SET source = 'connector_carta' WHERE source = 'carta';
UPDATE cap_table_option_pools SET source = 'connector_carta' WHERE source = 'carta';
UPDATE cap_table_vesting SET source = 'connector_carta' WHERE source = 'carta';

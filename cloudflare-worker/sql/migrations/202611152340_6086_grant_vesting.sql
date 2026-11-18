-- D6086 (#6086) — a vesting schedule recorded with an option grant, without Carta.
--
-- WHY TWO PLACES.
--   · `cap_table_issuance_vesting` is the schedule an issuance carries, one row
--     per grant, written in the same batch as the issuance. A co-founder's
--     proposal keeps it here until the owner accepts or dismisses it, so a
--     schedule nobody recorded never reaches the plan.
--   · `cap_table_vesting.issuance_id` ties the plan's row (the table the equity
--     plan, the holder drawer and the Raise readers already read) to the grant
--     it was written from. It is written only when the grant is recorded, and
--     deleted with it when the grant is voided. Carta's rows and the founders'
--     rows from Add holder leave it NULL.
--
-- A new table and a nullable column: nothing existing changes shape.

CREATE TABLE IF NOT EXISTS cap_table_issuance_vesting (
  issuance_id INTEGER PRIMARY KEY REFERENCES cap_table_issuances(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  start_date TEXT NOT NULL,
  total_months INTEGER NOT NULL CHECK (total_months BETWEEN 1 AND 600),
  cliff_months INTEGER NOT NULL CHECK (cliff_months >= 0 AND cliff_months <= total_months),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cap_table_issuance_vesting_project ON cap_table_issuance_vesting(project_id);

ALTER TABLE cap_table_vesting ADD COLUMN issuance_id INTEGER REFERENCES cap_table_issuances(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cap_table_vesting_issuance ON cap_table_vesting(issuance_id) WHERE issuance_id IS NOT NULL;

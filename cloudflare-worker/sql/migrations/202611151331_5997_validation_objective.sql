-- 202611151331 — D5997 (#5997): the venture's validation objective, the line
-- the Validate v2 overview leads with ("Trying to learn:", board V1).
-- Named by its UTC minute and its issue (D4106, D5398).
--
-- ONE ROW PER VENTURE, SHAPED LIKE THE OTHER VALIDATE STORES. Migration 440's
-- small stores (`market_readiness_marks`, `metric_targets`) are their own
-- tables keyed to the project, with the actor and the time beside the value;
-- this one is too, so `projects` (read by every surface) gains no column only
-- Validate reads. `project_id` is the key: a venture has one objective.
--
-- NULL MEANS NOT RECORDED. `objective` is nullable: clearing it keeps the row,
-- so `updated_by` and `updated_at` still say who cleared it and when. A
-- venture with no row has never recorded one; both read "Not recorded".
-- Nothing is backfilled: no venture stated an objective before this file.
--
-- The length limit (280 characters) is the writer's, in
-- `services/validateWriters.ts` (`setValidationObjective`), as every other
-- Validate limit is; the table does not repeat it.
--
-- New table, re-runnable.
CREATE TABLE IF NOT EXISTS validation_objectives (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    objective TEXT,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

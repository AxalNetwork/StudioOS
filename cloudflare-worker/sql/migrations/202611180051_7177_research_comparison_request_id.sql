-- D7177 (#7177, brief D7043) — a request id per Compare sheet, so a repeat of
-- the same save returns the same comparison and "Check save status" can ask
-- the Worker whether a save whose answer was lost was made.
--
-- The client mints one id each time the Compare sheet opens and sends it with
-- every attempt from that sheet. The Worker keeps it on the comparison the
-- attempt made. One member never has two comparisons under one id (the partial
-- unique index), so a retry that races the first attempt fails inside its own
-- all-or-nothing batch and is answered with the comparison that won.
--
-- NULL is a comparison saved without an id: every comparison saved before this
-- migration, and any client that sends none. Expand only: no row changes.
--
-- No transaction statements: D1 rejects them (scripts/check-sql-migrations.mjs).

ALTER TABLE research_project_comparisons ADD COLUMN request_id TEXT
  CHECK (request_id IS NULL OR length(request_id) BETWEEN 8 AND 64);

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_project_comparisons_request
  ON research_project_comparisons(owner_user_id, request_id)
  WHERE request_id IS NOT NULL;

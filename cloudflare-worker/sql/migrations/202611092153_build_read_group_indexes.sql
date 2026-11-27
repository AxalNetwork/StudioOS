-- #4603 part 3, item 1 (D4603): two covering indexes for the Build module
-- reads' grouped scans, and no others.
--
-- Part 2b moved the Prototype / MVP and Product roadmap lists into SQL. That
-- cut the rows returned to the Worker, but each aggregate scanned the
-- venture's rows again, so D1's rows read went up. Part 3 folds each
-- module's aggregates into one grouped scan; these indexes let that scan read
-- the index alone, in group order, with no sort.
--
-- Measured on a local D1 (`cloudflare-worker/test/_build_rows_read.ts`;
-- 1,000 records per list; decisions/D4603.md, part 3, item 1):
--
--   mvp_features (project_id, is_must_have, delivery_status, hypothesis_id, done_at)
--       Prototype / MVP's one grouped scan (counts, the burn-up, the Hypothesis
--       options). Without it the scan reads every feature of the venture and
--       sorts the must-haves to group them. Saves about 1,000 rows read on the
--       module page and 500 on the overview at 1,000 features.
--   roadmap_okrs (project_id, kanban_status, feedback_theme, kpi_key)
--       Product roadmap's one grouped scan (column counts, the Theme and KPI
--       options). Saves about 1,000 rows read on the module page at 1,000 items.
--
-- Read-only use: no query result changes, and nothing else reads these.
CREATE INDEX IF NOT EXISTS idx_mvp_features_must_groups
  ON mvp_features (project_id, is_must_have, delivery_status, hypothesis_id, done_at);
CREATE INDEX IF NOT EXISTS idx_roadmap_okrs_column_groups
  ON roadmap_okrs (project_id, kanban_status, feedback_theme, kpi_key);

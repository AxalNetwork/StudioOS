-- 249 — project_metrics: the per-project metric series, given its own table.
--
-- WHAT WAS BROKEN. `metrics_snapshots` was two tables under one name and the
-- worker wrote both. Production's is the DEAL shape — `deal_id NOT NULL,
-- snapshot_date, key_metrics, traction_score, ai_review, created_by` plus ten
-- named metric columns — created at runtime by `routes/pipeline.ts`'s
-- ensureSchema. `routes/progress.ts` and `integrations/providers/stripe.ts`
-- instead wrote a PER-PROJECT PER-DAY series keyed on `project_id`, with `mrr`,
-- `active_users`, `notes` and `source`. Production has none of those four
-- columns, so every one of those statements threw `no such column: project_id`:
-- the founder's own KPI snapshot form and the Stripe MRR sync, both silently
-- dead.
--
-- Migration 034 DID declare the project shape (034_unmounted_routes.sql:54), but
-- `IF NOT EXISTS` against a table `pipeline.ts` had already created made it a
-- no-op. `progress.ts`'s own `ensureMetricsSnapshotsSchema` then ALTERed ten
-- metric columns into the deal-shaped table — which is exactly the
-- comma-after-`created_by` trail visible in `schema_baseline.sql` — but its
-- required list never included the four that mattered.
--
-- WHY A NEW TABLE AND NOT FOUR MORE ALTERS. The two reader families are
-- disjoint. `deal_id`: `pipeline.ts` (three reads) and
-- `services/tractionSnapshots.ts`. `project_id`: `progress.ts`'s whole CRUD
-- surface — list, create, read, update, delete and three rollups — plus
-- `research.ts` and `stripe.ts`. Folding them together would put two different
-- records in one table, and the `deal_id` family's `SELECT *` reads would start
-- returning project rows with every traction field NULL, which is the pollution
-- D86 refused for the review annotation.
--
-- And `metrics_snapshots.deal_id` is `NOT NULL`. A project-keyed row would have
-- to put something there. `deal_id` IS a `projects.id` (D86), so it would be the
-- same number twice — a thing that works by coincidence and breaks the first
-- time someone changes what `deal_id` means.
--
-- NO BACKFILL, AND THAT IS PROVABLE RATHER THAN HOPEFUL. The old writes named a
-- column that does not exist, so they always threw: there has never been a
-- project-keyed row in `metrics_snapshots` to move. A backfill statement here
-- would be copying from an empty set while implying otherwise.
--
-- No BEGIN/COMMIT: D1 rejects transaction statements inside a migration
-- (migration 200 learned that the hard way).

CREATE TABLE IF NOT EXISTS project_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    -- `YYYY-MM-DD`. Text, sorting lexicographically in date order, which is what
    -- every reader orders by and what makes the UNIQUE below one row per day.
    snapshot_date TEXT NOT NULL,
    mrr REAL,
    arr REAL,
    cac REAL,
    ltv REAL,
    monthly_churn_pct REAL,
    active_users INTEGER,
    new_users INTEGER,
    net_burn REAL,
    cash_balance REAL,
    headcount INTEGER,
    nrr_pct REAL,
    paying_accounts INTEGER,
    notes TEXT,
    -- Who reported it: NULL for a founder's own entry, 'stripe' for the
    -- integration. Part of the uniqueness below, because a founder's figure and
    -- Stripe's figure for the same day are two claims and not one.
    source TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ONE ROW PER PROJECT PER DAY PER SOURCE, which replaces a DELETE.
-- `stripe.ts` deduped a re-sync by deleting today's `source = 'stripe'` row
-- before inserting — a read-modify-write with a window where the day has no
-- figure at all. With this index the writer can upsert instead, and two syncs in
-- one minute cannot leave two rows.
--
-- NULL `source` DOES NOT COLLIDE IN SQLITE: NULLs are distinct in a UNIQUE
-- index, so a founder can log the same day twice by hand and get two rows. That
-- is deliberate — a hand-entered figure is a statement someone made, not a
-- projection to be replaced, and the route decides whether to update or add.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_metrics_day_source
    ON project_metrics(project_id, snapshot_date, source);

CREATE INDEX IF NOT EXISTS idx_project_metrics_project
    ON project_metrics(project_id, snapshot_date DESC);

-- 251 — what a metric MEANS on this project, so month 14 measures month 1's thing.
--
-- WHY THIS EXISTS. `/build/kpi` (FB5 in
-- `design/canvases/integrated/Pages · Founder Build.dc.html`) draws four ops and
-- `Definitions` was registered `unbuilt` — "metric definitions are not stored" —
-- which renders NOTHING, so the artboard's fourth op was invisible. The canvas
-- says why the op is there in its own note: "Metric definitions live on this page
-- precisely so 'net burn' means the same thing in month 14 as in month 1."
--
-- A founder types `net_burn = 61200` in August. Does that include the contractor?
-- The prepaid annual tool? Nothing recorded the answer, so the series is a column
-- of numbers whose comparability nobody can check — and the investor product reads
-- it across the seam (`saasMetrics.ts` computes burn multiple and runway from it).
--
-- NOT A COLUMN ON `metric_targets`, AND THE REASON IS THAT TABLE'S OWN SHAPE.
-- `metric_targets.target_value` is `NOT NULL`. A project that wants to define
-- "net burn" without committing to a plan number for it would have to invent one
-- — so the definition would arrive attached to a fake target, and "4 of 6 against
-- target" would then count a metric nobody set a target for. Same call as
-- migrations 249 and 250: ask what the row is FOR, not what it is near.
--
-- ONE DEFINITION PER METRIC PER PROJECT. `UNIQUE (project_id, metric_key)`, the
-- same key shape `metric_targets` uses, so the two are joinable per metric and a
-- second definition for one metric cannot exist to disagree with the first.
--
-- NOTHING IS SEEDED. A platform-written definition of "net burn" would be
-- indistinguishable from the founder's own, and the whole value of the record is
-- that it is theirs. An undefined metric reads as undefined.
--
-- No BEGIN/COMMIT: D1 rejects transaction statements inside a migration
-- (migration 200 learned that the hard way).

CREATE TABLE IF NOT EXISTS metric_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    -- Matches a column on `project_metrics` and a key on `metric_targets`:
    -- mrr | arr | cac | ltv | monthly_churn_pct | active_users | new_users |
    -- net_burn | cash_balance | headcount | nrr_pct | paying_accounts.
    -- Validated in the route against that list rather than by a CHECK, because a
    -- CHECK would need a migration every time the metric set grows and D1 cannot
    -- alter one.
    metric_key TEXT NOT NULL,
    -- The sentence. What is counted, what is excluded, and where the figure comes
    -- from when it is not typed by hand.
    definition TEXT NOT NULL,
    -- 'manual' | 'stripe' | 'derived'. NOT the same thing as
    -- `project_metrics.source`, which records where ONE ROW came from; this
    -- records where the founder INTENDS this metric to come from. The two
    -- disagreeing is a finding — a metric declared Stripe-synced whose rows all
    -- say 'manual' means the integration is not running — so both are kept.
    source_kind TEXT NOT NULL DEFAULT 'manual',
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE (project_id, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_metric_definitions_project
    ON metric_definitions(project_id);

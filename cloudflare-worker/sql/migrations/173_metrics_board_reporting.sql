-- 173 — the five numbers an investor update actually leads with.
--
-- `metrics_snapshots` was shaped for product CRUD: MRR, CAC, LTV, churn,
-- users. The Metrics design (attached_assets/Metrics.dc.html) specifies a
-- board-reporting KPI board, and five of its nine metrics had no field
-- anywhere in the repo — net burn, cash, headcount, net revenue retention,
-- and paying accounts. A founder could not record them, so the update
-- composer, the board pack and the cadence strip had nothing to read.
--
-- Additive only. Every column is nullable, so existing snapshots stay
-- valid and nothing a founder already sees moves.
--
-- WHY CASH AND NOT RUNWAY. Runway is derived (cash ÷ net burn), and the
-- design labels it "Derived" for that reason. Storing runway directly
-- would let it drift out of agreement with the cash and burn printed
-- beside it in the same board pack, which is the one place those three
-- numbers get read together.

ALTER TABLE metrics_snapshots ADD COLUMN net_burn REAL;         -- dollars/month, positive = burning
ALTER TABLE metrics_snapshots ADD COLUMN cash_balance REAL;     -- dollars on hand at snapshot_date
ALTER TABLE metrics_snapshots ADD COLUMN headcount INTEGER;
ALTER TABLE metrics_snapshots ADD COLUMN nrr_pct REAL;          -- net revenue retention, 119 = 119%
ALTER TABLE metrics_snapshots ADD COLUMN paying_accounts INTEGER;

-- Targets are per project and per metric, not per snapshot: a plan number
-- is set once for a period and compared against every snapshot in it.
-- Keeping them on the snapshot would restate the plan twelve times and
-- let twelve copies disagree.
CREATE TABLE IF NOT EXISTS metric_targets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Matches a key on the snapshot: mrr | arr | cac | ltv |
    -- monthly_churn_pct | active_users | new_users | net_burn |
    -- cash_balance | headcount | nrr_pct | paying_accounts
    metric_key  TEXT NOT NULL,
    target_value REAL NOT NULL,
    -- 'up' when higher is better (MRR), 'down' when lower is (burn, CAC
    -- payback, churn). Without this the UI cannot tell whether being over
    -- the number is good news, and would colour a burn overage green.
    direction   TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up', 'down')),
    label       TEXT,
    created_by  INTEGER REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, metric_key)
);
CREATE INDEX IF NOT EXISTS idx_metric_targets_project ON metric_targets(project_id);

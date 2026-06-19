-- Venture Risk Rating — 10-layer risk aggregation + analyst management.
--
-- Builds on the existing risk surfaces (founder_risk_pulls, score_snapshots,
-- dd_cases) by unifying them into the "10 Layers of Venture Risk" model
-- (Founder, Market, Competition, Timing, Financing, Marketing, Distribution,
-- Technology, Product, Hiring). Two tables, mirroring the snapshot + sticky
-- pattern already used by founder_risk_pulls (latest-row-wins snapshots) and
-- the analyst review fields on score_snapshots.
--
-- Idempotent — every CREATE / INDEX is `IF NOT EXISTS` so re-running on a
-- partially-applied DB is safe. Mirrored into schema.sql.

-- One row per computed assessment; the latest row per project is "current".
-- `layers_json` holds the full 10-layer breakdown (per-layer score, band,
-- proof signals, rationale) so history is a faithful point-in-time snapshot.
CREATE TABLE IF NOT EXISTS venture_risk_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL DEFAULT (lower(hex(randomblob(16)))),
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    overall_risk REAL NOT NULL DEFAULT 0,      -- 0..100, lower = safer
    overall_band TEXT NOT NULL DEFAULT 'medium', -- low | medium | high
    derisk_score REAL NOT NULL DEFAULT 0,      -- 100 - overall_risk (higher = more derisked)
    derisk_pct REAL NOT NULL DEFAULT 0,        -- % of proof signals satisfied
    layers_json TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'auto',       -- auto | analyst
    computed_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_venture_risk_assessments_project
    ON venture_risk_assessments(project_id, created_at DESC);

-- Sticky per-layer analyst overrides. Merged OVER the auto-computed result on
-- every recompute so analyst judgment (band/score/status/note) persists.
-- One row per (project, layer).
CREATE TABLE IF NOT EXISTS venture_risk_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    layer_key TEXT NOT NULL,                   -- founder | market | competition | ...
    band TEXT,                                 -- low | medium | high (optional)
    score REAL,                                -- 0..100 (optional manual override)
    status TEXT NOT NULL DEFAULT 'open',       -- open | mitigating | cleared
    note TEXT,
    owner_user_id INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, layer_key)
);
CREATE INDEX IF NOT EXISTS idx_venture_risk_overrides_project
    ON venture_risk_overrides(project_id);

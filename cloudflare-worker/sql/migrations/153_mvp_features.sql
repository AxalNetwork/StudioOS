-- Task #13 — Spin-Out Lab MVP Scope prioritization (Roadmap module).
-- Value-ranked feature list per project; priority derives from added_value.
CREATE TABLE IF NOT EXISTS mvp_features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    added_value TEXT NOT NULL DEFAULT 'Medium',
    effort TEXT NOT NULL DEFAULT 'M',
    priority_reason TEXT,
    delivery_status TEXT NOT NULL DEFAULT 'Backlog',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mvp_features_project_order
    ON mvp_features (project_id, sort_order);

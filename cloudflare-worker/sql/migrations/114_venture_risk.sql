-- Migration 114 — Venture Risk analyst overrides (Task #9).
--
-- Backs the 10-layer Venture Risk rating system (Founder / Market / Competition
-- / Timing / Financing / Marketing / Distribution / Technology / Product /
-- Hiring). Scoring is HYBRID: the AUTO score per layer is computed live from
-- existing platform data (score_snapshots sub-scores + the projects row) by
-- services/ventureRisk.ts and is NOT stored. This table persists ONLY the
-- ANALYST override layer — one row per (project_id, layer_key); the upsert path
-- uses ON CONFLICT(project_id, layer_key). Internal deal-team only.
--
-- Idempotent (IF NOT EXISTS). Mirrored into schema.sql.
CREATE TABLE IF NOT EXISTS venture_risk_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    layer_key TEXT NOT NULL,
    analyst_score REAL,
    analyst_band TEXT,
    analyst_note TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    updated_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, layer_key)
);
CREATE INDEX IF NOT EXISTS idx_venture_risk_overrides_project
    ON venture_risk_overrides(project_id);

-- T11 — Financials + Wellbeing port from FastAPI to D1.
-- Apply via:
--   npx wrangler d1 execute studioos-db --config ../wrangler.toml --remote \
--     --file=cloudflare-worker/sql/financials_wellbeing.sql
-- Idempotent (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).

-- ---------- financial_models ----------
-- Mirrors backend/app/models/entities.py::FinancialModel. Assumptions,
-- computed projection, sensitivity grid, and capital_recompute are all
-- stored as JSON text columns to match the FastAPI shape exactly.
CREATE TABLE IF NOT EXISTS financial_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id),
    assumptions_json TEXT NOT NULL DEFAULT '{}',
    computed_json TEXT NOT NULL DEFAULT '{}',
    sensitivity_json TEXT NOT NULL DEFAULT '{}',
    capital_recompute_json TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finmodel_project ON financial_models(project_id);

-- ---------- wellbeing_checkins ----------
-- Mirrors entities.py::WellbeingCheckin. Each answer column holds
-- AES-GCM ciphertext (base64 of `iv|ciphertext+tag`). Plaintext never
-- touches D1. Unique (user_id, week_anchor) enforces idempotent
-- weekly upsert; ON CONFLICT DO UPDATE preserves last-write-wins.
CREATE TABLE IF NOT EXISTS wellbeing_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    week_anchor TEXT NOT NULL,           -- ISO date 'YYYY-MM-DD' (Mon of UTC ISO week)
    stress_enc TEXT NOT NULL,
    sleep_enc TEXT NOT NULL,
    support_enc TEXT NOT NULL,
    decisions_enc TEXT NOT NULL,
    energy_enc TEXT NOT NULL,
    notes_enc TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, week_anchor)
);
CREATE INDEX IF NOT EXISTS idx_wb_checkin_user ON wellbeing_checkins(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wb_checkin_created ON wellbeing_checkins(created_at);

-- ---------- wellbeing_resources ----------
-- Plain-text directory of mental-health support resources. No PII.
-- Readable by all authenticated users; mutable only by admins.
CREATE TABLE IF NOT EXISTS wellbeing_resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,              -- therapy | peer_group | hotline | reading | coaching
    name TEXT NOT NULL,
    description TEXT,
    url TEXT,
    region TEXT,                         -- global | us | uk | eu | sg | ...
    is_24_7 INTEGER NOT NULL DEFAULT 0,
    is_free INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_by_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (category, name)
);
CREATE INDEX IF NOT EXISTS idx_wb_res_category ON wellbeing_resources(category, sort_order);
CREATE INDEX IF NOT EXISTS idx_wb_res_region ON wellbeing_resources(region);

-- Migration 001 — Customer Discovery + Roadmap (Task #8)
-- Adds the two D1 tables backing the worker's /api/progress router
-- (port of backend/app/api/routes/progress.py — discovery & roadmap only).
--
-- Idempotent: every CREATE uses IF NOT EXISTS so re-running the file is a
-- no-op (matches the convention in cloudflare-worker/sql/t13_t14_t15.sql
-- noted in replit.md's Gotchas).
--
-- Apply on prod via:
--   wrangler d1 execute studioos-db --file=cloudflare-worker/sql/migrations/001_progress_tables.sql --remote --env=""
--
-- Column naming follows the FastAPI model (interviewee_name / hypotheses_json /
-- pains_json / quarter / key_results_json) rather than the task brief's
-- shorter proposal, because the shipping frontend (DiscoveryPage.jsx,
-- RoadmapPage.jsx) already calls these endpoints with those field names and
-- frontend changes are out of scope.

CREATE TABLE IF NOT EXISTS discovery_interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    interviewee_name TEXT NOT NULL,
    interviewee_role TEXT,
    interview_date TEXT,
    notes TEXT,
    hypotheses_json TEXT,
    pains_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discovery_interviews_project
    ON discovery_interviews (project_id);

CREATE TABLE IF NOT EXISTS roadmap_okrs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    objective TEXT NOT NULL,
    key_results_json TEXT,
    kanban_status TEXT NOT NULL DEFAULT 'now',
    quarter TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roadmap_okrs_project_status_order
    ON roadmap_okrs (project_id, kanban_status, sort_order);

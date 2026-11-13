-- Task #15 — Page header explainers.
-- Tracks which page-explainer cards each user has dismissed. Stored as a
-- JSON array of pageKey strings (e.g. '["dashboard","capital"]').
-- Server is source of truth; localStorage is a read cache that hydrates
-- from /api/settings/explainers on first authed page load.
ALTER TABLE user_settings ADD COLUMN dismissed_explainers TEXT NOT NULL DEFAULT '[]';

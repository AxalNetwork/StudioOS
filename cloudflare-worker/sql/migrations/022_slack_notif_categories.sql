-- Task #1 (2026-05-10) — Slack notifications integration.
-- Adds per-category opt-in map for Slack delivery, parallel to the
-- existing notif_categories_email / notif_categories_inapp columns on
-- user_settings. notify.ts checks this map (when a category is set on
-- the call) before posting to the user's Slack incoming webhook.
--
-- Re-runs will ERROR with "duplicate column name: notif_categories_slack"
-- — that's expected and idempotent at the schema level (D1 rolls the
-- file back but the column is already present).
ALTER TABLE user_settings
  ADD COLUMN notif_categories_slack TEXT NOT NULL DEFAULT '{}';

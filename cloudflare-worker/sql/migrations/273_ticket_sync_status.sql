-- 273 — the ticket→GitHub mirror records whether it worked.
--
-- WHY THIS EXISTS. `tickets` carried github_issue_number / _url / _labels /
-- _assignees / _updated_at — every one of them a field that only exists once
-- the mirror has ALREADY SUCCEEDED. The failure had no column at all:
-- `POST /api/tickets` computed `github_sync_status` and `github_sync_error`,
-- put them in one HTTP response body, and that was the only place they ever
-- existed. Once the caller discarded that response the failure was gone, and
-- nothing — not the ticket, not an admin screen, not the audit log — could
-- say a mirror had ever been attempted, let alone why it failed.
--
-- Measured 2026-09-20: AxalNetwork/StudioOS contained exactly ONE real issue
-- in its entire history, hand-made, while the app had been filing tickets for
-- months. The mirror had never once worked and nothing had recorded that.
-- An absence with no column to live in is an absence nobody can find.
--
-- These three columns are also what makes a RETRY possible. `POST
-- /api/tickets/sync` selected `WHERE github_issue_number IS NOT NULL`, so it
-- could only refresh tickets that had already mirrored — every ticket filed
-- while the mirror was broken was stranded with no path to GitHub. With a
-- recorded status the backfill has something to select on.
--
-- Additive, IF-NOT-EXISTS-shaped (the runner tolerates the duplicate-column
-- error), and deliberately NO BEGIN/COMMIT — D1 rejects transaction
-- statements in a migration file (the #26 lesson).

ALTER TABLE tickets ADD COLUMN github_sync_status TEXT;
ALTER TABLE tickets ADD COLUMN github_sync_error TEXT;
ALTER TABLE tickets ADD COLUMN github_sync_attempted_at TEXT;

-- The backfill and the "what never mirrored" admin read both select on the
-- status; unmirrored rows are the minority, so the index earns its keep.
CREATE INDEX IF NOT EXISTS idx_tickets_sync_status
  ON tickets(github_sync_status, created_at DESC);

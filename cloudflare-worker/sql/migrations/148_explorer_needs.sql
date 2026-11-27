-- Task: Explorer problem/challenge discovery
--
-- Side table keyed by user_id (same pattern as user_role_review /
-- author_websites) so answers persist independent of the user's current
-- role. Explorers are frequently re-tagged to founder/investor/advisor/
-- partner once an admin confirms their profile; this table is never
-- rekeyed on founder_id/advisor_id/etc., so the needs-assessment answers
-- survive that transition intact. Only the owning user (via requireAuth-
-- scoped routes) and admin routes (requireAdmin) may read/write this
-- table — no route resolves it from a client-supplied user id.
--
-- `track` records which of the 4 Explorer question banks (founder/
-- investor/advisor/partner — see banks/explorer.ts) the user answered;
-- it mirrors user_role_review.suggested_role at the time of answering.
-- The CONTEXT/CHALLENGES/TIMELINE columns are shared across all 4 tracks
-- (same shape, different option lists); the track's 4th section (funding/
-- capital/compensation/commercials) varies in content, so it lands in the
-- `track_extra_json` sidecar instead of dedicated columns per track.

CREATE TABLE IF NOT EXISTS explorer_needs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  track TEXT,                          -- founder | investor | advisor | partner
  current_status TEXT,                 -- track-specific status option (see banks/explorer.ts)
  team_structure TEXT,                 -- solo | with_team | fund_team | etc. (track-specific)
  sector TEXT,                         -- AI, B2B SaaS, Climate, Fintech, Healthcare, Consumer, Deep Tech, Other
  geography TEXT,                      -- geographic focus
  challenge_1 TEXT,                    -- primary challenge (top priority, track-specific option)
  challenge_2 TEXT,                    -- secondary challenge
  challenge_3 TEXT,                    -- tertiary challenge
  challenge_1_depth TEXT,               -- depth answer for primary challenge
  timeline_urgency TEXT,               -- within_30_days, within_90_days, within_180_days, no_immediate_timeline
  hard_deadline TEXT,                  -- optional: specific deadline or milestone
  runway_months INTEGER,               -- months of runway remaining (personal or fund/practice)
  track_extra_json TEXT,               -- track's 4th-section answers (funding/capital/compensation/commercials), keyed by question_id
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_explorer_needs_track ON explorer_needs(track);
CREATE INDEX IF NOT EXISTS idx_explorer_needs_status ON explorer_needs(current_status);
CREATE INDEX IF NOT EXISTS idx_explorer_needs_challenges ON explorer_needs(challenge_1, challenge_2, challenge_3);
CREATE INDEX IF NOT EXISTS idx_explorer_needs_timeline ON explorer_needs(timeline_urgency);

-- Extend user_role_review to track explorer needs assessment completion.
-- Plain ADD COLUMN (no IF NOT EXISTS — D1/SQLite doesn't support it on
-- ALTER TABLE); the migration runner only applies this file once per DB.
ALTER TABLE user_role_review ADD COLUMN needs_assessment_completed INTEGER DEFAULT 0;

-- 368_relationship_requests.sql — a relationship record about another person
-- is a request they accept or decline (D493, U8).
--
-- `POST /api/partnernet/relationships` let any signed-in user write a row about
-- any other user, with a type, a strength score and shared metadata. The row
-- appeared in the other person's book at once, its score fed their network
-- score and the public leaderboard, and either side could then edit it and log
-- interactions both could read. Nobody was asked. The owner's decision
-- (2026-10-02): REQUEST AND ACCEPT, with existing rows treated as accepted and
-- their subjects told.
--
--   status       'pending'   — requested; visible only to its author, and to
--                              the other person as a request naming who and what
--                              type, nothing more (no score, no metadata);
--                'accepted'  — both see it, as the route did before;
--                'declined'  — the other person said no;
--                'withdrawn' — the author took the request back;
--                'removed'   — either side ended an accepted relationship.
--                Only 'accepted' rows count towards a network score, appear in
--                a book, or accept interactions, reminders or edits.
--   requested_by / requested_at — who asked and when (NULL on a pre-368 row).
--   responded_at — when the other person accepted or declined.
--   legacy_noticed_at — a pre-368 row whose subject has been sent the one-time
--                notice listing it (owner: "treat as accepted, notify").
--
-- Every row that exists when this runs keeps DEFAULT 'accepted': the owner
-- chose not to hide or re-ask existing relationships. The validated status set
-- lives in routes/partnernet.ts (REL_STATUSES); an ALTER cannot add a CHECK.
--
-- STANDS ALONE: partner_relationships is an existing table (production
-- baseline). Additive ALTERs and CREATE INDEX IF NOT EXISTS only.

ALTER TABLE partner_relationships ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE partner_relationships ADD COLUMN requested_by INTEGER;
ALTER TABLE partner_relationships ADD COLUMN requested_at TEXT;
ALTER TABLE partner_relationships ADD COLUMN responded_at TEXT;
ALTER TABLE partner_relationships ADD COLUMN legacy_noticed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pr_status ON partner_relationships (status);
CREATE INDEX IF NOT EXISTS idx_pr_requested_by ON partner_relationships (requested_by, requested_at);

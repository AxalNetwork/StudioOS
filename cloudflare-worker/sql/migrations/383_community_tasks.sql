-- D544 (#1107) — the Super Admin's review queue for suggested tasks and feature requests.
--
-- community_tasks: one row per support ticket of type `task`, which is a user's
-- suggestion of a task that would help other users. It starts `pending`; the
-- Super Admin approves it (it is published to the community task list, #1108,
-- for one persona or `all`) or declines it with a reason the user is sent.
--
-- THE PENDING ROW IS WRITTEN BY A TRIGGER, not by routes/tickets.ts, so the
-- ticket form (#1022's) is left alone. A ticket inserted as a task, or later
-- re-typed to one (the GitHub label sync can change `type`), gets its row; the
-- UNIQUE ticket_id makes the second a no-op. Tickets filed before this
-- migration get no row: the queue starts empty rather than holding every
-- ticket that ever defaulted to `task`.
--
-- feature_request_reviews: the Super Admin's decision on a ticket of type
-- `feature`. The decision is recorded HERE, not only as the `feature:approved`
-- / `feature:declined` label on the mirrored issue, because the label is a
-- call to GitHub that can fail or be unconfigured; `label_status` says which.
CREATE TABLE IF NOT EXISTS community_tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id      INTEGER NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    body           TEXT,
    -- A persona (founder, investor, advisor, partner, explorer) or 'all'. Set on approval.
    audience       TEXT NOT NULL DEFAULT 'all',
    status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    decided_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at     TEXT,
    decline_reason TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_community_tasks_status ON community_tasks(status, audience);

CREATE TABLE IF NOT EXISTS feature_request_reviews (
    ticket_id      INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
    status         TEXT NOT NULL CHECK (status IN ('approved', 'declined')),
    decided_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at     TEXT NOT NULL DEFAULT (datetime('now')),
    decline_reason TEXT,
    -- 'added' | 'no_issue' | 'not_configured' | 'failed': what became of the label.
    label_status   TEXT
);

CREATE TRIGGER IF NOT EXISTS community_tasks_from_ticket
AFTER INSERT ON tickets
WHEN NEW.type = 'task'
BEGIN
    INSERT OR IGNORE INTO community_tasks (ticket_id, title, body) VALUES (NEW.id, NEW.title, NEW.description);
END;

CREATE TRIGGER IF NOT EXISTS community_tasks_from_retyped_ticket
AFTER UPDATE OF type ON tickets
WHEN NEW.type = 'task' AND OLD.type IS NOT 'task'
BEGIN
    INSERT OR IGNORE INTO community_tasks (ticket_id, title, body) VALUES (NEW.id, NEW.title, NEW.description);
END;

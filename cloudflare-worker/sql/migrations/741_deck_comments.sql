-- 741 — D1570 (#3817, deck builder v2 D9): comments on a deck's cards, with
-- @mentions, an assignee and Resolve, and the approval a share waits for
-- (PD-3 · pd33 "Comments on a card", and its inset "Approval needed before
-- sharing"). Number given at filing on #3817; free on main and in every open
-- pull request on 2026-11-01.
--
--   deck_comments                       one comment, pinned to a card (and
--                                       optionally one area on it), written on
--                                       one version. A thread is its first
--                                       comment and the replies that name it
--                                       as `parent_id`; the assignee and
--                                       Resolve live on that first comment.
--                                       Separate from the deck's notes (538),
--                                       the admins' thread to the founders.
--   deck_comment_mentions               who a comment mentions, one row per
--                                       person. `notified_at` is claimed with
--                                       one UPDATE before the notice is sent,
--                                       so a person is told once per comment.
--   deck_approvers                      who must approve the venture's deck
--                                       before a share link is made, and the
--                                       version each one approved. Removing an
--                                       approver stamps `removed_at`; the row
--                                       stays, so who approved what is kept.
--   advisor_client_grants.scope_deck    owner decision Q = B (2026-11-01): an
--                                       advisor or Operating Partner comments
--                                       on the deck only when the founder
--                                       grants this scope. Off by default, so
--                                       no grant made before this opens the
--                                       deck.
--
-- Additive: CREATE TABLE IF NOT EXISTS, and one ADD COLUMN with a default.
-- NON-IDEMPOTENT (D1's ALTER TABLE has no IF NOT EXISTS): the ledger runner
-- applies it once. No BEGIN/COMMIT: D1 applies a migration file as one batch.

CREATE TABLE IF NOT EXISTS deck_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- The version the comment was written on: one `pitch_decks` row.
  deck_id INTEGER NOT NULL REFERENCES pitch_decks(id) ON DELETE CASCADE,
  deck_version INTEGER NOT NULL,
  -- The card by its place on that version, and by its uid (D1500) when it has one, so a comment follows its card.
  card_index INTEGER NOT NULL CHECK (card_index >= 0),
  card_uid TEXT,
  -- One area on the card (The Grid's area id), or NULL for the whole card.
  area TEXT CHECK (area IS NULL OR length(area) BETWEEN 1 AND 64),
  -- NULL on a thread's first comment; a reply names that first comment.
  parent_id INTEGER REFERENCES deck_comments(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  -- On a thread's first comment only.
  assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_comments_project ON deck_comments(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deck_comments_parent ON deck_comments(parent_id);

CREATE TABLE IF NOT EXISTS deck_comment_mentions (
  comment_id INTEGER NOT NULL REFERENCES deck_comments(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_deck_comment_mentions_user ON deck_comment_mentions(user_id, created_at);

CREATE TABLE IF NOT EXISTS deck_approvers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by_user_id INTEGER NOT NULL REFERENCES users(id),
  -- The version this approver signed off: one `pitch_decks` row. A share of any other version waits again.
  approved_deck_id INTEGER REFERENCES pitch_decks(id) ON DELETE SET NULL,
  approved_version INTEGER,
  approved_at TEXT,
  removed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_deck_approvers_project ON deck_approvers(project_id, removed_at);

ALTER TABLE advisor_client_grants ADD COLUMN scope_deck INTEGER NOT NULL DEFAULT 0;
